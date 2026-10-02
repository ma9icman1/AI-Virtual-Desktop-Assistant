const {app, BrowserWindow, ipcMain, screen, desktopCapturer, session, globalShortcut, shell} = require("electron");
const {execFile, spawn} = require("child_process");
const fs = require("fs");
const path = require("path");
const http = require("http");
const { getVisionCanvasSize, createCoordinateMap, parseCoordinateMap, formatCoordinateMap, mapPointFromCoordinateMap } = require("./computer-control.cjs");

const gotSingleInstanceLock = app.requestSingleInstanceLock();
if (!gotSingleInstanceLock) {
  app.quit();
} else {
  app.on("second-instance", () => {
    const existingWindow = BrowserWindow.getAllWindows()[0];
    if (existingWindow && !existingWindow.isDestroyed()) {
      if (existingWindow.isMinimized()) existingWindow.restore();
      existingWindow.show();
      existingWindow.focus();
    }
  });
}

const port = Number(process.env.MAGIC_PORT || 3210);
// Vision uses a bounded canvas whose aspect ratio follows the current primary
// display. The coordinate map then carries the exact screenshot-to-physical-
// screen transform used by every pointer action.
const AI_SCREEN_WIDTH = 1280;
let desktopPermission = "none";
let desktopKilled = false;
let speechProcess = null;
let speechWindow = null;
let speechStopRequested = false;
let windowsSpeechProcess = null;
let speechMode = null;
const ollamaWorkingDirectory = process.env.MAGIC_APP_ROOT || process.cwd();
const CUSTOM_OLLAMA_MODEL = "minicpm-magic-assistant:latest";
const BASE_OLLAMA_MODEL = "minicpm-v:latest";
const OLLAMA_COMMAND_TIMEOUT = 5000;
const ollamaDownloadProcesses = new Set();

function getBundledMiniCPMModelfile() {
  const candidates = [
    path.join(app.getAppPath(), "public", "models", "minicpm-magic-assistant", "Modelfile"),
    path.join(app.getAppPath(), "Modelfile"),
  ];
  const source = candidates.find((candidate) => fs.existsSync(candidate));

  if (!source) {
    throw new Error("The bundled MiniCPM Magic Assistant Modelfile is missing from the app package.");
  }

  const targetDir = path.join(
    app.getPath("userData"),
    "models",
    "minicpm-magic-assistant"
  );

  const target = path.join(targetDir, "Modelfile");

  fs.mkdirSync(targetDir, { recursive: true });
  fs.copyFileSync(source, target);

  return target;
}

const supportedOllamaModels = new Set([
  "qwen2.5vl:3b",
  "llama3.2:3b",
  "minicpm-v",
  CUSTOM_OLLAMA_MODEL,
]);

function stopWhisperSpeech() {
  // Whisper is resident for fast access. STOP ends only the current recording
  // and lets the worker flush the final phrase while keeping the model loaded.
  if (speechProcess && speechMode === "whisper") {
    speechStopRequested = false;
    try { speechProcess.stdin?.write("STOP\n"); } catch {}
  }

  // The legacy Windows Speech fallback is still a disposable process.
  if (windowsSpeechProcess) {
    speechStopRequested = true;
    const proc = windowsSpeechProcess;
    windowsSpeechProcess = null;
    speechMode = speechProcess ? "whisper" : null;
    try { proc.stdin?.write("STOP\n"); } catch {}
    setTimeout(() => { try { proc.kill(); } catch {} }, 1200);
  }

  return Promise.resolve();
}

function terminateSpeechProcesses() {
  speechStopRequested = true;
  const processes = [speechProcess, windowsSpeechProcess].filter(Boolean);
  speechProcess = null;
  windowsSpeechProcess = null;
  speechMode = null;
  for (const proc of processes) {
    try { proc.stdin?.write("QUIT\n"); } catch {}
    setTimeout(() => { try { proc.kill(); } catch {} }, 1000);
  }
}

function resolvePythonCommand() {
  if (process.env.MAGIC_PYTHON) return process.env.MAGIC_PYTHON;
  const candidates = process.platform === "win32" ? ["python", "py", "python3"] : ["python3", "python"];
  for (const candidate of candidates) {
    try {
      const result = require("child_process").execFileSync(
        process.platform === "win32" ? "where.exe" : "which",
        [candidate],
        { encoding: "utf8", windowsHide: true, timeout: 2500 }
      ).trim();
      if (result) return candidate;
    } catch {
      // Try the next Python launcher.
    }
  }
  throw new Error("Python was not found. Install Python 3 and the Whisper dependencies, or set MAGIC_PYTHON to the Python executable.");
}

async function startWhisperProcess(window) {
  if (speechProcess && speechMode === "whisper") {
    speechWindow = window;
    return true;
  }
  await stopWhisperSpeech();
  speechStopRequested = false;
  speechWindow = window;
  const workerPath = path.join(__dirname, "whisper_worker.py");
  let pythonCommand;
  try {
    pythonCommand = resolvePythonCommand();
  } catch (error) {
    if (speechWindow && !speechWindow.isDestroyed()) {
      speechWindow.webContents.send("magic-voice-error", error.message);
    }
    throw error;
  }

  speechProcess = spawn(pythonCommand, [workerPath], {
    windowsHide: true,
    env: { ...process.env, PYTHONUNBUFFERED: "1" },
  });
  speechMode = "whisper";

  return await new Promise((resolve, reject) => {
    let output = "";
    let settled = false;
    const startupTimeout = setTimeout(() => {
      const message = "Whisper microphone startup timed out. Check that Python, faster-whisper, sounddevice, and a Windows microphone are installed.";
      if (speechWindow && !speechWindow.isDestroyed()) {
        speechWindow.webContents.send("magic-voice-error", message);
      }
      try { speechProcess?.kill(); } catch {}
      settleReject(new Error(message));
    }, 30000);

    const settleResolve = () => {
      if (settled) return;
      settled = true;
      clearTimeout(startupTimeout);
      resolve(true);
    };
    const settleReject = (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(startupTimeout);
      reject(error instanceof Error ? error : new Error(String(error)));
    };

    speechProcess.stdout.on("data", (chunk) => {
      output += chunk.toString();
      const lines = output.split(/\r?\n/);
      output = lines.pop() || "";
      for (const line of lines) {
        if (!line) continue;
        const [kind, text, confidence] = line.split("|");
        if (kind === "READY") {
          if (speechWindow && !speechWindow.isDestroyed()) {
            speechWindow.webContents.send("magic-voice-ready");
          }
          settleResolve();
          continue;
        }
        if (kind === "RECORDING") {
          if (speechWindow && !speechWindow.isDestroyed()) {
            speechWindow.webContents.send("magic-voice-recording", text === "1");
          }
          continue;
        }
        if (kind === "SPEECH_ERROR") {
          const message = text || "Whisper speech recognition failed.";
          if (speechWindow && !speechWindow.isDestroyed()) {
            speechWindow.webContents.send("magic-voice-error", message);
          }
          if (!settled) settleReject(new Error(message));
          continue;
        }
        if (kind === "DEVICE") {
          if (speechWindow && !speechWindow.isDestroyed()) {
            speechWindow.webContents.send("magic-voice-device", text || "Default microphone");
          }
          continue;
        }
        if (kind === "TRANSCRIPT" && text && speechWindow && !speechWindow.isDestroyed()) {
          speechWindow.webContents.send("magic-voice-transcript", {
            text,
            confidence: Number(confidence) || 0.8,
          });
        }
        if (kind === "LEVEL" && speechWindow && !speechWindow.isDestroyed()) {
          speechWindow.webContents.send("magic-voice-level", Number(text) || 0);
        }
      }
    });

    speechProcess.stderr.on("data", (chunk) => {
      const message = chunk.toString().trim();
      if (/SPEECH_ERROR\|/i.test(message)) {
        const clean = message.replace(/^.*SPEECH_ERROR\|/i, "");
        if (speechWindow && !speechWindow.isDestroyed()) {
          speechWindow.webContents.send("magic-voice-error", clean);
        }
        if (!settled) settleReject(new Error(clean));
      } else if (message) {
        console.warn("[Whisper]", message);
      }
    });

    speechProcess.once("error", (error) => {
      if (speechWindow && !speechWindow.isDestroyed()) {
        speechWindow.webContents.send("magic-voice-error", error.message);
      }
      speechProcess = null;
      settleReject(error);
    });

    speechProcess.once("exit", (code) => {
      const wasStarting = !settled;
      if (!speechStopRequested && speechWindow && !speechWindow.isDestroyed() && !desktopKilled) {
        speechWindow.webContents.send("magic-voice-error", `Whisper speech recognition stopped (exit code ${code ?? "unknown"}).`);
      }
      speechProcess = null;
      if (wasStarting && !speechStopRequested) {
        settleReject(new Error(`Whisper speech recognition stopped before the microphone became ready (exit code ${code ?? "unknown"}).`));
      }
    });
  });
}

/* desktop execution policy hardening v1 */
function runPowerShell(script, args = []) {
  console.log(`[DEBUG PS] args=${JSON.stringify(args.map((value) => String(value ?? "")))}`);
  return new Promise((resolve, reject) => {
    const scriptArgs = JSON.stringify(args.map((value) => String(value ?? "")));
    const safeScript = "$scriptArgs = ConvertFrom-Json $env:MAGIC_RUN_ARGS;\n" + script;
    execFile(
      "powershell.exe",
      ["-NoProfile", "-NonInteractive", "-Command", safeScript],
      {
        windowsHide: true,
        timeout: 15000,
        maxBuffer: 1024 * 1024,
        env: { ...process.env, MAGIC_RUN_ARGS: scriptArgs },
      },
      (error, stdout, stderr) => {
        if (error) {
          console.error(`[DEBUG PS] ERROR stdout=${JSON.stringify(stdout)} stderr=${JSON.stringify(stderr)} message=${error.message}`);
          reject(new Error(stderr.trim() || error.message));
        } else {
          console.log(`[DEBUG PS] OK stdout=${JSON.stringify(stdout)} stderr=${JSON.stringify(stderr)}`);
          resolve(stdout.trim());
        }
      }
    );
  });
}

function normalizeProcessName(value) {
  return String(value || "").trim().toLowerCase().replace(/\.exe$/i, "");
}

function resolveAutomationProcessName(value) {
  const requested = normalizeProcessName(value);
  const aliases = { files: "explorer", explorer: "explorer", terminal: "windowsterminal", calculator: "calculator", taskmgr: "taskmgr" };
  return aliases[requested] || requested;
}

async function getActiveWindowInfo() {
  const script = `
Add-Type @'
using System;
using System.Text;
using System.Runtime.InteropServices;
public static class MagicWindowInfo {
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern int GetWindowText(IntPtr hWnd, StringBuilder text, int count);
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint processId);
}
'@
$hwnd = [MagicWindowInfo]::GetForegroundWindow()
$sb = New-Object System.Text.StringBuilder 512
[void][MagicWindowInfo]::GetWindowText($hwnd, $sb, $sb.Capacity)
[uint32]$processId = 0
[void][MagicWindowInfo]::GetWindowThreadProcessId($hwnd, [ref]$processId)
$name = ""
if ($processId -gt 0) { try { $name = (Get-Process -Id $processId -ErrorAction Stop).ProcessName } catch {} }
[pscustomobject]@{ hwnd=[int64]$hwnd; title=$sb.ToString(); process=$name; pid=$processId } | ConvertTo-Json -Compress
`;
  const raw = await runPowerShell(script);
  try { return JSON.parse(raw || "{}"); } catch { return { title: "", process: "", pid: 0 }; }
}

async function findUiElement(params = {}) {
  const name = String(params.name || "").trim();
  const automationId = String(params.automationId || "").trim();
  const controlType = String(params.controlType || "").trim().toLowerCase();
  const processName = normalizeProcessName(params.process || "");
  if (!name && !automationId && !controlType) {
    throw new Error("UI element search requires a name, automationId, or controlType.");
  }
  const script = `
Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName UIAutomationTypes
$root = [System.Windows.Automation.AutomationElement]::RootElement
$name = $scriptArgs[0]
$aid = $scriptArgs[1]
$type = $scriptArgs[2]
$proc = $scriptArgs[3]
$all = [System.Windows.Automation.TreeScope]::Descendants
$elements = $root.FindAll($all, [System.Windows.Automation.Condition]::TrueCondition)
$matches = @()
foreach ($el in $elements) {
  try {
    $p = $el.Current.ProcessId
    $n = $el.Current.Name
    $a = $el.Current.AutomationId
    $ct = $el.Current.ControlType.ProgrammaticName -replace '^ControlType\\.', ''
    $pn = ''
    if ($p -gt 0) { try { $pn = (Get-Process -Id $p -ErrorAction Stop).ProcessName } catch {} }
    if ($name -and $n -notlike $name) { continue }
    if ($aid -and $a -ne $aid) { continue }
    if ($type -and $ct.ToLowerInvariant() -ne $type) { continue }
    if ($proc -and $pn.ToLowerInvariant() -ne $proc -and !(($proc -eq "calculatorapp") -and ($pn.ToLowerInvariant() -in @("applicationframehost","calc","calculatorapp")))) { continue }
    $r = $el.Current.BoundingRectangle
    if ($r.Width -le 0 -or $r.Height -le 0) { continue }
    $matches += [pscustomobject]@{
      name=$n; automationId=$a; controlType=$ct; process=$pn; pid=$p;
      x=[int][math]::Round($r.X); y=[int][math]::Round($r.Y);
      width=[int][math]::Round($r.Width); height=[int][math]::Round($r.Height)
    }
    if ($matches.Count -ge 20) { break }
  } catch {}
}
@($matches) | ConvertTo-Json -Compress
`;
  const raw = await runPowerShell(script, [name, automationId, controlType, processName]);
  try {
    const parsed = JSON.parse(raw || "[]");
    return Array.isArray(parsed) ? parsed : [parsed];
  } catch {
    return [];
  }
}

async function readUiElement(params = {}) {
  const matches = await findUiElement(params);
  if (!matches.length) throw new Error("No matching UI element was found.");
  const target = matches[0];
  const script = `
Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName UIAutomationTypes
$processId = [int]$scriptArgs[0]; $aid = $scriptArgs[1]; $name = $scriptArgs[2]
$elements = [System.Windows.Automation.AutomationElement]::RootElement.FindAll([System.Windows.Automation.TreeScope]::Descendants, [System.Windows.Automation.Condition]::TrueCondition)
$target = $null
foreach ($el in $elements) { try { if ($el.Current.ProcessId -ne $processId) { continue }; if ($aid -and $el.Current.AutomationId -ne $aid) { continue }; if ($name -and $el.Current.Name -notlike $name) { continue }; $target=$el; break } catch {} }
if (-not $target) { throw "The UI element disappeared before it could be read." }
$value=''; $pattern=''
try { $vp=$target.GetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern); $value=[string]$vp.Current.Value; $pattern='ValuePattern' } catch {}
if (-not $value) { $value=[string]$target.Current.Name }
[pscustomobject]@{ name=[string]$target.Current.Name; automationId=[string]$target.Current.AutomationId; controlType=[string]($target.Current.ControlType.ProgrammaticName -replace '^ControlType\\.',''); value=$value; pattern=$pattern; enabled=[bool]$target.Current.IsEnabled } | ConvertTo-Json -Compress
`;
  const raw = await runPowerShell(script, [String(target.pid || 0), String(target.automationId || ""), String(target.name || "")]);
  try { return { ok: true, element: JSON.parse(raw || "{}") }; } catch { throw new Error("Could not read the UI element value."); }
}

async function setUiElementValue(params = {}) {
  const value = String(params.value ?? params.text ?? "");
  if (value.length > 4000) throw new Error("UI text is too long.");
  const matches = await findUiElement(params);
  if (!matches.length) throw new Error("No matching UI element was found.");
  const target = matches[0];
  const script = `
Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName UIAutomationTypes
Add-Type -AssemblyName System.Windows.Forms
$processId=[int]$scriptArgs[0]; $aid=$scriptArgs[1]; $name=$scriptArgs[2]; $value=$scriptArgs[3]
$elements=[System.Windows.Automation.AutomationElement]::RootElement.FindAll([System.Windows.Automation.TreeScope]::Descendants,[System.Windows.Automation.Condition]::TrueCondition)
$target=$null
foreach($el in $elements){try{if($el.Current.ProcessId -ne $processId){continue};if($aid -and $el.Current.AutomationId -ne $aid){continue};if($name -and $el.Current.Name -notlike $name){continue};$target=$el;break}catch{}}
if(-not $target){throw "The UI element disappeared before it could receive text."}
try{$vp=$target.GetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern);$vp.SetValue($value);'ValuePattern'}catch{
  try{$target.SetFocus()}catch{}
  [System.Windows.Forms.SendKeys]::SendWait('^a'); [System.Windows.Forms.SendKeys]::SendWait($value.Replace('{','{{}').Replace('}','{}}')); 'keyboard'
}
`;
  const result = await runPowerShell(script, [String(target.pid || 0), String(target.automationId || ""), String(target.name || ""), value]);
  if (desktopPermission === "one_action") desktopPermission = "none";
  return { ok: true, verified: true, method: result, element: target };
}

async function waitForUiElement(params = {}) {
  const timeoutMs = Math.min(15000, Math.max(250, Number(params.timeoutMs) || 5000));
  const intervalMs = Math.min(1000, Math.max(100, Number(params.intervalMs) || 250));
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const matches = await findUiElement(params);
    if (matches.length) return { ok: true, found: true, elapsedMs: Date.now() - started, element: matches[0] };
    await new Promise(resolve => setTimeout(resolve, intervalMs));
  }
  return { ok: true, found: false, elapsedMs: Date.now() - started };
}

async function inspectUiTree(params = {}) {
  const processName = normalizeProcessName(params.process || "");
  const maxDepth = Math.min(6, Math.max(1, Number(params.maxDepth) || 4));
  const maxNodes = Math.min(300, Math.max(20, Number(params.maxNodes) || 150));
  const includeUnnamed = params.includeUnnamed === true;
  const activeOnly = params.activeOnly !== false;

  const script = `
Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName UIAutomationTypes
Add-Type @'
using System;
using System.Runtime.InteropServices;
public static class MagicTreeWindow {
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
}
'@
$processFilter = $scriptArgs[0]
$maxDepth = [int]$scriptArgs[1]
$maxNodes = [int]$scriptArgs[2]
$includeUnnamed = [bool]::Parse($scriptArgs[3])
$activeOnly = [bool]::Parse($scriptArgs[4])
$root = $null
if ($activeOnly) {
  $hwnd = [MagicTreeWindow]::GetForegroundWindow()
  if ($hwnd -ne [IntPtr]::Zero) { $root = [System.Windows.Automation.AutomationElement]::FromHandle($hwnd) }
}
if (-not $root) { $root = [System.Windows.Automation.AutomationElement]::RootElement }
if ($processFilter) {
  try {
    $rootPid = $root.Current.ProcessId
    $rootProc = (Get-Process -Id $rootPid -ErrorAction Stop).ProcessName
    if ($rootProc.ToLowerInvariant() -ne $processFilter) { $root = [System.Windows.Automation.AutomationElement]::RootElement }
  } catch {}
}
$count = 0
$result = New-Object System.Collections.Generic.List[object]
function Add-Node($el, $depth, $parentIndex) {
  if ($script:count -ge $maxNodes -or $depth -gt $maxDepth) { return }
  try {
    $p = $el.Current.ProcessId
    $pn = ''
    if ($p -gt 0) { try { $pn = (Get-Process -Id $p -ErrorAction Stop).ProcessName } catch {} }
    if ($processFilter -and $pn.ToLowerInvariant() -ne $processFilter) { return }
    $n = [string]$el.Current.Name
    $aid = [string]$el.Current.AutomationId
    $ct = [string]($el.Current.ControlType.ProgrammaticName -replace '^ControlType\\.', '')
    if (-not $includeUnnamed -and -not $n -and -not $aid) { }
    $r = $el.Current.BoundingRectangle
    $idx = $script:count
    $script:count++
    $result.Add([pscustomobject]@{
      index=$idx; parentIndex=$parentIndex; depth=$depth; name=$n; automationId=$aid; controlType=$ct;
      className=[string]$el.Current.ClassName; process=$pn; pid=$p;
      enabled=[bool]$el.Current.IsEnabled; offscreen=[bool]$el.Current.IsOffscreen;
      x=[int][math]::Round($r.X); y=[int][math]::Round($r.Y); width=[int][math]::Round($r.Width); height=[int][math]::Round($r.Height)
    })
    if ($depth -ge $maxDepth -or $script:count -ge $maxNodes) { return }
    $children = $el.FindAll([System.Windows.Automation.TreeScope]::Children, [System.Windows.Automation.Condition]::TrueCondition)
    foreach ($child in $children) {
      if ($script:count -ge $maxNodes) { break }
      Add-Node $child ($depth + 1) $idx
    }
  } catch {}
}
Add-Node $root 0 -1
[pscustomobject]@{
  activeOnly=$activeOnly; processFilter=$processFilter; maxDepth=$maxDepth; maxNodes=$maxNodes;
  rootName=([string]$root.Current.Name); rootProcess=$rootProcessName;
  truncated=($script:count -ge $maxNodes); count=$script:count; elements=@($result)
} | ConvertTo-Json -Depth 8 -Compress
`;
  const raw = await runPowerShell(script, [processName, String(maxDepth), String(maxNodes), String(includeUnnamed), String(activeOnly)]);
  try { return JSON.parse(raw || "{}"); } catch { return { count: 0, elements: [], error: "Could not parse UI tree." }; }
}

async function verifyProcessRunning(processName, attempts = 12, delayMs = 250) {
  const normalized = normalizeProcessName(processName);
  if (!normalized) return false;

  // Some Windows launchers hand off to a different executable name.
  // Keep verification strict, but recognize the process names used by the
  // apps that this assistant explicitly allows.
  const verificationNames = {
    edge: ["msedge"],
    msedge: ["msedge"],
    calculator: ["calculatorapp", "calculator"],
    calc: ["calculatorapp", "calculator"],
    taskmgr: ["taskmgr"],
    terminal: ["windowsterminal", "wt"],
    wt: ["windowsterminal", "wt"],
    explorer: ["explorer"],
    files: ["explorer"],
    notepad: ["notepad"],
    paint: ["mspaint"],
    chrome: ["chrome"],
    brave: ["brave"],
    firefox: ["firefox"],
      roblox: ["C:\\Users\\ma9ic\\AppData\\Local\\Roblox\\Versions\\version-2366ba214ec740ca\\RobloxPlayerBeta.exe"],
  };
  const names = verificationNames[normalized] || [normalized];
  const escapedNames = names.map((name) => `'${name.replace(/'/g, "''")}'`).join(",");

  // Give Windows launchers time to hand off to the final application process.
  const script = `$names = @(${escapedNames}); Get-Process -ErrorAction SilentlyContinue | Where-Object { $names -contains $_.ProcessName.ToLowerInvariant() } | Select-Object -First 1 -ExpandProperty Id`;

  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const result = await runPowerShell(script).catch(() => "");
    if (/^\d+$/.test(String(result).trim())) return true;
    if (attempt < attempts - 1) {
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }
  return false;
}

async function maximizeWindow(hwnd) {
  const handle = Number(hwnd);
  if (!Number.isFinite(handle) || handle <= 0) return false;
  const script = `
Add-Type @'
using System;
using System.Runtime.InteropServices;
public static class MagicMaximize {
  [DllImport("user32.dll")] public static extern bool ShowWindowAsync(IntPtr hWnd, int nCmdShow);
}
'@
[void][MagicMaximize]::ShowWindowAsync([IntPtr]${handle}, 3)
`;
  try {
    await runPowerShell(script);
    return true;
  } catch {
    return false;
  }
}

async function detectWebpage(params = {}) {
  const timeoutMs = Math.min(15000, Math.max(750, Number(params.timeoutMs) || 5000));
  const intervalMs = Math.min(1000, Math.max(150, Number(params.intervalMs) || 300));
  const expectedHost = normalizedHostname(params.expectedHost || "");
  const browserProcesses = new Set(["msedge", "chrome", "brave", "firefox", "opera", "vivaldi"]);
  const started = Date.now();

  while (Date.now() - started < timeoutMs) {
    const info = await getActiveWindowInfo();
    const process = normalizeProcessName(info.process);

    if (browserProcesses.has(process) && Number(info.hwnd) > 0) {
      await maximizeWindow(info.hwnd);

      // Chromium/Firefox expose the address bar through UI Automation, but the
      // address bar can briefly report an empty ValuePattern while a new tab is
      // starting. Read the active browser window directly and try both
      // ValuePattern and LegacyIAccessible, plus any URL-like element value.
      // The old implementation only accepted Edit controls whose Name matched
      // "address/search/omnibox"; that is too brittle across browser versions
      // and localization.
      const script = `
Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName UIAutomationTypes
$targetPid = [int]$scriptArgs[0]
$targetHwnd = [IntPtr]::new([int64]$scriptArgs[1])
$root = $null
try { $root = [System.Windows.Automation.AutomationElement]::FromHandle($targetHwnd) } catch {}
if (-not $root) { $root = [System.Windows.Automation.AutomationElement]::RootElement }

$elements = $root.FindAll(
  [System.Windows.Automation.TreeScope]::Descendants,
  [System.Windows.Automation.Condition]::TrueCondition
)

$url = ""
foreach ($el in $elements) {
  try {
    if ($el.Current.ProcessId -ne $targetPid) { continue }

    $name = [string]$el.Current.Name
    $type = [string]($el.Current.ControlType.ProgrammaticName -replace '^ControlType\.', '')
    $value = ""

    try {
      $vp = $el.GetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern)
      $value = [string]$vp.Current.Value
    } catch {}

    if (-not $value) {
      try {
        $legacy = $el.GetCurrentPattern([System.Windows.Automation.LegacyIAccessiblePattern]::Pattern)
        $value = [string]$legacy.Current.Value
      } catch {}
    }

    $candidates = @($value, $name)
    foreach ($candidate in $candidates) {
      $candidateText = [string]$candidate
      if ($candidateText -match '(?i)^(https?|file)://[^\s]+') {
        $url = $candidateText.Trim()
        break
      }
    }

    if ($url) { break }
  } catch {}
}

[pscustomobject]@{ url=$url; hwnd=[int64]$targetHwnd; pid=$targetPid } | ConvertTo-Json -Compress
`;

      const raw = await runPowerShell(script, [String(info.pid || 0), String(info.hwnd || 0)]).catch(() => "{}");
      let url = "";
      try { url = String(JSON.parse(raw || "{}").url || ""); } catch {}

      if (url) {
        const observedHost = normalizedHostname(url);

        // When NAVIGATE_URL supplies an expected host, do not accept an old
        // tab/window from the same browser process. Keep polling until the
        // browser exposes the requested destination.
        if (expectedHost && observedHost !== expectedHost) {
          await new Promise((resolve) => setTimeout(resolve, intervalMs));
          continue;
        }

        console.log("[WEB DETECT] verified browser page", {
          browser: process,
          pid: info.pid,
          hwnd: info.hwnd,
          url,
          expectedHost: expectedHost || null,
          elapsedMs: Date.now() - started,
        });

        return {
          ok: true,
          detected: true,
          browser: process,
          title: String(info.title || "").trim(),
          url,
          elapsedMs: Date.now() - started,
        };
      }
    }

    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }

  return {
    ok: true,
    detected: false,
    browser: "",
    title: "",
    url: "",
    expectedHost: expectedHost || "",
    elapsedMs: Date.now() - started,
  };
}

function resolveBrowserExecutable(browser) {
  const normalized = String(browser || "").trim().toLowerCase();
  const candidates = {
    edge: [
      "msedge.exe",
      process.env.ProgramFiles && path.join(process.env.ProgramFiles, "Microsoft", "Edge", "Application", "msedge.exe"),
      process.env["ProgramFiles(x86)"] && path.join(process.env["ProgramFiles(x86)"], "Microsoft", "Edge", "Application", "msedge.exe"),
      process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, "Microsoft", "Edge", "Application", "msedge.exe"),
    ],
    chrome: [
      "chrome.exe",
      process.env.ProgramFiles && path.join(process.env.ProgramFiles, "Google", "Chrome", "Application", "chrome.exe"),
      process.env["ProgramFiles(x86)"] && path.join(process.env["ProgramFiles(x86)"], "Google", "Chrome", "Application", "chrome.exe"),
      process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, "Google", "Chrome", "Application", "chrome.exe"),
    ],
    brave: [
      "brave.exe",
      process.env.ProgramFiles && path.join(process.env.ProgramFiles, "BraveSoftware", "Brave-Browser", "Application", "brave.exe"),
      process.env["ProgramFiles(x86)"] && path.join(process.env["ProgramFiles(x86)"], "BraveSoftware", "Brave-Browser", "Application", "brave.exe"),
      process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, "BraveSoftware", "Brave-Browser", "Application", "brave.exe"),
    ],
    firefox: [
      "firefox.exe",
      process.env.ProgramFiles && path.join(process.env.ProgramFiles, "Mozilla Firefox", "firefox.exe"),
      process.env["ProgramFiles(x86)"] && path.join(process.env["ProgramFiles(x86)"], "Mozilla Firefox", "firefox.exe"),
    ],
    opera: [
      "opera.exe",
      process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, "Programs", "Opera", "opera.exe"),
    ],
    vivaldi: [
      "vivaldi.exe",
      process.env.ProgramFiles && path.join(process.env.ProgramFiles, "Vivaldi", "Application", "vivaldi.exe"),
      process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, "Vivaldi", "Application", "vivaldi.exe"),
    ],
  };
  const list = (candidates[normalized] || []).filter(Boolean);
  return list.find((candidate) => fs.existsSync(candidate)) || list.find((candidate) => !path.isAbsolute(candidate)) || null;
}

function normalizedHostname(value) {
  try {
    return new URL(String(value || "")).hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return "";
  }
}

async function executeDesktopAction(action, params = {}) {
  console.log(`[DEBUG ACTION] action=${JSON.stringify(action)} params=${JSON.stringify(params)}`);
  if (desktopKilled || !["one_action", "one_session", "always"].includes(desktopPermission)) {
    throw new Error("Desktop control is not permitted.");
  }

  const display = screen.getPrimaryDisplay();
  const defaultVisionSize = getVisionCanvasSize(display, AI_SCREEN_WIDTH);
  const visionWidth = Number(params.visionWidth) > 0 ? Number(params.visionWidth) : defaultVisionSize.width;
  const visionHeight = Number(params.visionHeight) > 0 ? Number(params.visionHeight) : defaultVisionSize.height;
  const coordinateMap = params.coordinateMap
    ? parseCoordinateMap(params.coordinateMap)
    : createCoordinateMap(display, screen, visionWidth, visionHeight);
  const mapCoordinate = (valueX, valueY) => {
    if (params.coordinateSpace === "vision") {
      if (!coordinateMap) throw new Error("Vision input is missing a valid coordinate map.");
      return mapPointFromCoordinateMap(valueX, valueY, coordinateMap);
    }
    const numericX = Number(valueX);
    const numericY = Number(valueY);
    if (!Number.isFinite(numericX) || !Number.isFinite(numericY)) return { x: 0, y: 0 };
    return { x: Math.round(numericX), y: Math.round(numericY) };
  };
  const mappedPoint = mapCoordinate(params.x, params.y);
  const x = mappedPoint.x;
  const y = mappedPoint.y;
  if (action === "LAUNCH_APP") {
    const requested = String(params.app || "").trim().toLowerCase();
    const browserAliases = new Set(["browser", "web browser", "internet", "internet browser", "edge", "microsoft edge", "chrome", "google chrome", "firefox", "mozilla firefox", "brave", "brave browser", "opera", "opera browser", "vivaldi", "vivaldi browser"]);

    // Browser requests delegate to Windows so the configured default browser is always used.
    if (browserAliases.has(requested)) {
      const child = spawn("cmd.exe", ["/c", "start", "", "https://www.google.com"], { detached: true, stdio: "ignore", windowsHide: true });
      await new Promise((resolve, reject) => {
        child.once("error", (error) => reject(new Error(`Windows could not open the default browser: ${error.message}`)));
        child.once("spawn", resolve);
      });
      child.unref();
      await new Promise((resolve) => setTimeout(resolve, 350));
      if (desktopPermission === "one_action") desktopPermission = "none";
      return { ok: true, verified: true, process: "default-browser", requested };
    }

    const aliases = {
      notepad: ["notepad.exe"],
      calculator: ["calc.exe"],
      paint: ["mspaint.exe"],
      explorer: ["explorer.exe"],
      files: ["explorer.exe"],
      terminal: ["wt.exe"],
      taskmgr: ["taskmgr.exe"],
    };
    const candidates = aliases[requested];
    if (!candidates) throw new Error(`Application is not allowed: ${requested || "requested app"}.`);
    const target = candidates.find((candidate) => candidate && fs.existsSync(candidate)) || candidates.find((candidate) => /\.exe$/i.test(candidate));
    if (!target) throw new Error(`Could not find application: ${requested || "requested app"}.`);
    // Launch GUI apps without hiding the application window.
    // Keep the child declaration on its own real source line.
    const child = spawn(target, [], { detached: true, stdio: "ignore", windowsHide: false });
    await new Promise((resolve, reject) => {
      child.once("error", (error) => reject(new Error(`Windows could not launch ${requested || target}: ${error.message}`)));
      child.once("spawn", resolve);
    });
    child.unref();
    const verifyTarget = normalizeProcessName(target);
    const verified = path.isAbsolute(target)
      ? true
      : await verifyProcessRunning(verifyTarget);
    if (!verified) throw new Error(`Windows started ${requested}, but the process could not be verified.`);
    // [desktop-input] launch focus v2
    await runPowerShell(`
$processName = $scriptArgs[0]
$proc = Get-Process -Name $processName -ErrorAction SilentlyContinue | Where-Object { $_.MainWindowHandle -ne 0 } | Select-Object -First 1
if ($proc) {
  Add-Type @'
using System;
using System.Runtime.InteropServices;
public static class MagicLaunchFocusV2 { [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hWnd); [DllImport("user32.dll")] public static extern bool ShowWindowAsync(IntPtr hWnd, int nCmdShow); }
'@
  [void][MagicLaunchFocusV2]::ShowWindowAsync($proc.MainWindowHandle, 9)
  [void][MagicLaunchFocusV2]::SetForegroundWindow($proc.MainWindowHandle)
}
Start-Sleep -Milliseconds 500
`, [requested]);
    // The launch-focus v2 block above already focuses the window.
    // Do not run a second no-argument PowerShell script here because runPowerShell
    // initializes $scriptArgs from MAGIC_RUN_ARGS, and an empty argument list can
    // make ConvertFrom-Json fail before the application action completes.
    if (desktopPermission === "one_action") desktopPermission = "none";
    return { ok: true, verified: true, process: requested };
  }
  if (action === "FOCUS_APP") {
    const requested = normalizeProcessName(params.app);
    const processName = resolveAutomationProcessName(requested);
    if (!requested) throw new Error("No application was provided to focus.");
    const script = `
$proc = Get-Process -Name '${processName.replace(/'/g, "''")}' -ErrorAction SilentlyContinue | Where-Object { $_.MainWindowHandle -ne 0 } | Select-Object -First 1
if (-not $proc) { throw "Application is not running or has no visible window: $requested" }
Add-Type @'
using System;
using System.Runtime.InteropServices;
public static class MagicFocus { [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hWnd); }
'@
if (-not [MagicFocus]::SetForegroundWindow($proc.MainWindowHandle)) { throw "Windows could not focus $requested" }
`;
    await runPowerShell(script);
    const info = await getActiveWindowInfo();
    if (normalizeProcessName(info.process) !== requested) throw new Error(`Focus verification failed for ${requested}.`);
    if (desktopPermission === "one_action") desktopPermission = "none";
    return { ok: true, verified: true, activeWindow: info };
  }
  if (action === "CLOSE_APP") {
    const requested = normalizeProcessName(params.app);
    const processName = resolveAutomationProcessName(requested);
    if (!requested) throw new Error("No application was provided to close.");
    const script = `Get-Process -Name '${processName.replace(/'/g, "''")}' -ErrorAction SilentlyContinue | Stop-Process -Force`;
    await runPowerShell(script);
    await new Promise((resolve) => setTimeout(resolve, 250));
    const stillRunning = await verifyProcessRunning(processName);
    if (stillRunning) throw new Error(`Windows could not verify that ${requested} closed.`);
    if (desktopPermission === "one_action") desktopPermission = "none";
    return { ok: true, verified: true, process: requested };
  }
  if (action === "OPEN_FOLDER") {
    const folderPath = String(params.path || "").trim();
    if (!folderPath || !path.isAbsolute(folderPath)) throw new Error("Opening a folder requires an absolute path.");
    if (!fs.existsSync(folderPath) || !fs.statSync(folderPath).isDirectory()) throw new Error("Folder does not exist.");
    const errorMessage = await shell.openPath(folderPath);
    if (errorMessage) throw new Error(`Could not open folder: ${errorMessage}`);
    if (desktopPermission === "one_action") desktopPermission = "none";
    return { ok: true, verified: true, path: folderPath };
  }
  if (action === "GET_ACTIVE_WINDOW") {
    return await getActiveWindowInfo();
  }
  if (action === "INSPECT_UI_TREE") {
    return { ok: true, tree: await inspectUiTree(params) };
  }
  if (action === "FIND_UI_ELEMENT") {
    return { ok: true, elements: await findUiElement(params) };
  }
  if (action === "READ_UI_ELEMENT") {
    return await readUiElement(params);
  }
  if (action === "SET_UI_VALUE") {
    return await setUiElementValue(params);
  }
  if (action === "WAIT_FOR_UI_ELEMENT") {
    return await waitForUiElement(params);
  }
  if (action === "CLICK_UI_ELEMENT") {
    const matches = await findUiElement(params);
    if (!matches.length) throw new Error("No matching UI element was found.");
    const target = matches[0];
    const clickScript = `
Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName UIAutomationTypes
Add-Type @'
using System;
using System.Runtime.InteropServices;
public static class MagicUiInput {
  [DllImport("user32.dll")] public static extern bool SetCursorPos(int X, int Y);
  [DllImport("user32.dll")] public static extern void mouse_event(uint flags, uint dx, uint dy, uint data, UIntPtr extra);
}
'@
$targetName = $scriptArgs[0]
$targetId = $scriptArgs[1]
$targetPid = [int]$scriptArgs[2]
$root = [System.Windows.Automation.AutomationElement]::RootElement
$elements = $root.FindAll([System.Windows.Automation.TreeScope]::Descendants, [System.Windows.Automation.Condition]::TrueCondition)
$target = $null
foreach ($el in $elements) {
  try {
    if ($el.Current.ProcessId -ne $targetPid) { continue }
    if ($targetId -and $el.Current.AutomationId -ne $targetId) { continue }
    if ($targetName -and $el.Current.Name -notlike $targetName) { continue }
    $target = $el; break
  } catch {}
}
if (-not $target) { throw "The UI element disappeared before it could be clicked." }
try {
  $invoke = $target.GetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern)
  $invoke.Invoke()
  'invoke'
} catch {
  $r = $target.Current.BoundingRectangle
  if ($r.Width -le 0 -or $r.Height -le 0) { throw "The UI element has no clickable bounds." }
  $cx = [int][math]::Round($r.X + ($r.Width / 2)); $cy = [int][math]::Round($r.Y + ($r.Height / 2))
  [MagicUiInput]::SetCursorPos($cx, $cy) | Out-Null
  [MagicUiInput]::mouse_event(2,0,0,0,[UIntPtr]::Zero)
  Start-Sleep -Milliseconds 70
  [MagicUiInput]::mouse_event(4,0,0,0,[UIntPtr]::Zero)
  'physical-click'
}
`;
    const result = await runPowerShell(clickScript, [String(target.name || ""), String(target.automationId || ""), String(target.pid || 0)]);
    if (desktopPermission === "one_action") desktopPermission = "none";
    return { ok: true, verified: true, method: result, element: target };
  }
  if (action === "OPEN_FILE") {
    const filePath = String(params.path || "").trim();
    if (!filePath) throw new Error("No file path was provided.");
    if (!path.isAbsolute(filePath)) {
      throw new Error("Opening a file requires an absolute path.");
    }

    const resolvedPath = path.resolve(filePath);
    const blockedExtensions = new Set([
      ".exe", ".com", ".bat", ".cmd", ".ps1", ".psm1",
      ".vbs", ".vbe", ".js", ".jse", ".wsf", ".wsh",
      ".msi", ".msix", ".appx", ".scr", ".cpl", ".dll",
      ".sys", ".lnk", ".url",
    ]);
    const extension = path.extname(resolvedPath).toLowerCase();
    if (blockedExtensions.has(extension)) {
      throw new Error(`Opening this file type is not allowed: ${extension}`);
    }

    const errorMessage = await shell.openPath(resolvedPath);
    if (errorMessage) throw new Error(`Could not open file: ${errorMessage}`);
    if (desktopPermission === "one_action") desktopPermission = "none";
    return;
  }
  if (action === "NAVIGATE_URL") {
    const url = String(params.url || "").trim();
    if (!/^https?:\/\//i.test(url)) throw new Error("Navigation requires an http or https URL.");
    if (/undefined|null|NaN/i.test(url)) throw new Error("Navigation received a malformed URL.");
    try {
      const parsed = new URL(url);
      if (!["http:", "https:"].includes(parsed.protocol) || !parsed.hostname || !parsed.hostname.includes(".")) throw new Error();
    } catch {
      throw new Error("Navigation requires a valid http or https URL.");
    }

    const requestedBrowser = String(params.browser || "").trim().toLowerCase().replace(/\s+browser$/i, "");
    const targetBrowser = requestedBrowser === "microsoft edge" ? "edge"
      : requestedBrowser === "google chrome" ? "chrome"
      : requestedBrowser === "brave browser" ? "brave"
      : requestedBrowser === "mozilla firefox" ? "firefox"
      : requestedBrowser === "opera browser" ? "opera"
      : requestedBrowser === "vivaldi browser" ? "vivaldi"
      : requestedBrowser;

    if (targetBrowser && targetBrowser !== "browser") {
      const executable = resolveBrowserExecutable(targetBrowser);
      if (!executable) throw new Error(`Could not find the requested browser: ${requestedBrowser}.`);
      const child = spawn(executable, [url], { detached: true, stdio: "ignore", windowsHide: false });
      await new Promise((resolve, reject) => {
        child.once("error", (error) => reject(new Error(`Windows could not navigate ${targetBrowser}: ${error.message}`)));
        child.once("spawn", resolve);
      });
      child.unref();
    } else {
      const errorMessage = await shell.openExternal(url);
      if (errorMessage) throw new Error(`Could not open URL: ${errorMessage}`);
    }

    const expectedHost = normalizedHostname(url);

    // Navigation is the handoff point into the live desktop observer. Windows
    // UI Automation can occasionally fail to expose the browser address bar
    // even though the browser has already opened the requested site. Do not
    // abort the user's multi-step task in that case: the next step performs a
    // fresh desktop screenshot and vision scan against the actual visible page.
    let webpage = {
      ok: true,
      detected: false,
      browser: "",
      title: "",
      url: "",
      expectedHost,
      elapsedMs: 0,
    };
    try {
      webpage = await detectWebpage({ timeoutMs: 15000, intervalMs: 350, expectedHost });
    } catch (verificationError) {
      console.warn("[WEB NAV] Browser verification was unavailable after launch; continuing to desktop vision.", verificationError);
    }

    const observedBrowser = normalizeProcessName(webpage.browser);
    const observedHost = normalizedHostname(webpage.url);
    const browserMatches = !targetBrowser || targetBrowser === "browser" || !observedBrowser || observedBrowser === targetBrowser;
    const hostMatches = !observedHost || observedHost === expectedHost;

    if (!webpage.detected || !browserMatches || !hostMatches) {
      console.warn("[WEB NAV] Soft verification: navigation was launched, but UI verification was incomplete.", {
        requestedUrl: url,
        expectedHost,
        targetBrowser: targetBrowser || "default-browser",
        detected: Boolean(webpage.detected),
        observedBrowser: observedBrowser || null,
        observedUrl: webpage.url || null,
      });
    }

    if (desktopPermission === "one_action") desktopPermission = "none";
    return {
      ok: true,
      verified: Boolean(webpage.detected && browserMatches && hostMatches),
      launched: true,
      url,
      browser: targetBrowser || "default-browser",
      webpage,
      verification: {
        expectedHost,
        observedHost,
        observedBrowser,
        browserMatches,
        hostMatches,
      },
    };
  }
  if (action === "SEARCH_WEB") {
    const query = String(params.query || params.text || "").trim();
    if (!query) throw new Error("Web search requires a query.");
    if (query.length > 1000) throw new Error("Web search query is too long.");
    const searchUrl = `https://www.google.com/search?q=${encodeURIComponent(query)}`;
    const errorMessage = await shell.openExternal(searchUrl);
    if (errorMessage) throw new Error(`Could not open web search: ${errorMessage}`);
    const webpage = await detectWebpage({ timeoutMs: 5000 });
    if (desktopPermission === "one_action") desktopPermission = "none";
    return { ok: true, verified: true, query, url: searchUrl, webpage };
  }
  if (action === "DETECT_WEBPAGE") {
    return await detectWebpage(params);
  }
  if (["MINIMIZE_APP", "MAXIMIZE_APP", "RESTORE_APP"].includes(action)) {
    const requested = normalizeProcessName(params.app);
    const processName = resolveAutomationProcessName(requested);
    if (!requested) throw new Error("No application was provided for window control.");
    const mode = action === "MINIMIZE_APP" ? 6 : action === "MAXIMIZE_APP" ? 3 : 9;
    const psLines = [
      "Add-Type @'",
      "using System;",
      "using System.Runtime.InteropServices;",
      "public static class MagicWindowState {",
      "  [DllImport(\"user32.dll\")] public static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);",
      "}",
      "'@",
      "$proc = Get-Process -Name '" + processName.replace(/'/g, "''") + "' -ErrorAction SilentlyContinue | Where-Object { $_.MainWindowHandle -ne 0 } | Select-Object -First 1",
      "if (-not $proc) { throw 'No visible window was found.' }",
      "[MagicWindowState]::ShowWindow($proc.MainWindowHandle, " + mode + ") | Out-Null",
    ].join("\n");
    await runPowerShell(psLines);
    if (desktopPermission === "one_action") desktopPermission = "none";
    return { ok: true, verified: true, process: requested, action };
  }
  const supportedInputActions = new Set([
    "MOVE_MOUSE",
    "CLICK",
    "RIGHT_CLICK",
    "DOUBLE_CLICK",
    "DRAG",
    "SCROLL",
    "TYPE_TEXT",
    "KEY_PRESS",
    "WAIT",
  ]);
  if (!supportedInputActions.has(action)) {
    throw new Error(`Unsupported desktop action: ${String(action)}`);
  }

  const boundedInteger = (value, min, max, label) => {
    const numeric = Number(value);
    if (!Number.isFinite(numeric) || !Number.isInteger(numeric) || numeric < min || numeric > max) {
      throw new Error(`${label} is outside the allowed range.`);
    }
    return numeric;
  };

  if (["MOVE_MOUSE", "CLICK", "RIGHT_CLICK", "DOUBLE_CLICK", "DRAG", "SCROLL"].includes(action)) {
    // x/y are canonical physical-screen pixels after coord-map conversion.
    const physicalDisplay = createCoordinateMap(display, screen, visionWidth, visionHeight);
    const maxX = physicalDisplay.captureX + physicalDisplay.captureWidth - 1;
    const maxY = physicalDisplay.captureY + physicalDisplay.captureHeight - 1;
    boundedInteger(x, physicalDisplay.captureX, maxX, "X coordinate");
    boundedInteger(y, physicalDisplay.captureY, maxY, "Y coordinate");
  }
  if (action === "DRAG") {
    const endPoint = mapCoordinate(params.endX, params.endY);
    const endX = endPoint.x;
    const endY = endPoint.y;
    const physicalDisplay = createCoordinateMap(display, screen, visionWidth, visionHeight);
    boundedInteger(
      endX,
      physicalDisplay.captureX,
      physicalDisplay.captureX + physicalDisplay.captureWidth - 1,
      "End X coordinate",
    );
    boundedInteger(
      endY,
      physicalDisplay.captureY,
      physicalDisplay.captureY + physicalDisplay.captureHeight - 1,
      "End Y coordinate",
    );
  }
  if (action === "SCROLL") {
    boundedInteger(params.amount, -10000, 10000, "Scroll amount");
  }
  if (action === "TYPE_TEXT") {
    const text = String(params.text || "");
    if (text.length > 4000) throw new Error("Text input is limited to 4000 characters.");
  }
  if (action === "KEY_PRESS") {
    const key = String(params.key || "");
    if (!key || key.length > 64) throw new Error("Key input is limited to 64 characters.");
  }
  if (action === "WAIT") {
    boundedInteger(params.ms, 0, 10000, "Wait duration");
  }

  const script = `
Add-Type @'
using System;
using System.Runtime.InteropServices;
public static class MagicInput {
  [DllImport("user32.dll")] public static extern bool SetCursorPos(int X, int Y);
  [DllImport("user32.dll")] public static extern void mouse_event(uint flags, uint dx, uint dy, uint data, UIntPtr extra);
  [DllImport("user32.dll")] public static extern void keybd_event(byte key, byte scan, uint flags, UIntPtr extra);
  public const uint LEFTDOWN=0x02, LEFTUP=0x04, RIGHTDOWN=0x08, RIGHTUP=0x10, KEYUP=0x02;
}
'@
$action = $scriptArgs[0]
switch ($action) {
  'MOVE_MOUSE' { [MagicInput]::SetCursorPos([int]$scriptArgs[1], [int]$scriptArgs[2]) }
  'CLICK' { [MagicInput]::SetCursorPos([int]$scriptArgs[1], [int]$scriptArgs[2]); [MagicInput]::mouse_event(2,0,0,0,[UIntPtr]::Zero); Start-Sleep -Milliseconds 80; [MagicInput]::mouse_event(4,0,0,0,[UIntPtr]::Zero) }
  'RIGHT_CLICK' { [MagicInput]::SetCursorPos([int]$scriptArgs[1], [int]$scriptArgs[2]); [MagicInput]::mouse_event(8,0,0,0,[UIntPtr]::Zero); Start-Sleep -Milliseconds 80; [MagicInput]::mouse_event(16,0,0,0,[UIntPtr]::Zero) }
  'DOUBLE_CLICK' { [MagicInput]::SetCursorPos([int]$scriptArgs[1], [int]$scriptArgs[2]); 1..2 | ForEach-Object { [MagicInput]::mouse_event(2,0,0,0,[UIntPtr]::Zero); Start-Sleep -Milliseconds 80; [MagicInput]::mouse_event(4,0,0,0,[UIntPtr]::Zero); Start-Sleep -Milliseconds 80 } }
  'DRAG' { [MagicInput]::SetCursorPos([int]$scriptArgs[1], [int]$scriptArgs[2]); [MagicInput]::mouse_event(2,0,0,0,[UIntPtr]::Zero); Start-Sleep -Milliseconds 100; [MagicInput]::SetCursorPos([int]$scriptArgs[4], [int]$scriptArgs[5]); Start-Sleep -Milliseconds 100; [MagicInput]::mouse_event(4,0,0,0,[UIntPtr]::Zero) }
  'SCROLL' {
    [MagicInput]::SetCursorPos([int]$scriptArgs[1], [int]$scriptArgs[2])
    [MagicInput]::mouse_event(0x0800, 0, 0, [int]$scriptArgs[3], [UIntPtr]::Zero)
  }
  'TYPE_TEXT' {
    $value = [string]$scriptArgs[3]
    if ([string]::IsNullOrEmpty($value)) { break }

    Add-Type -AssemblyName System.Windows.Forms
    Add-Type @'
using System;
using System.Runtime.InteropServices;
public static class MagicPasteInput {
  [DllImport("user32.dll")]
  public static extern void keybd_event(byte bVk, byte bScan, uint dwFlags, UIntPtr dwExtraInfo);
  public const uint KEYEVENTF_KEYUP = 0x0002;
  public const byte VK_CONTROL = 0x11;
  public const byte VK_V = 0x56;
}
'@

    Write-Host "[TYPE_TEXT] Sending text: $value"
    [System.Windows.Forms.Clipboard]::SetText($value)
    Start-Sleep -Milliseconds 100
    [MagicPasteInput]::keybd_event([MagicPasteInput]::VK_CONTROL, 0, 0, [UIntPtr]::Zero)
    [MagicPasteInput]::keybd_event([MagicPasteInput]::VK_V, 0, 0, [UIntPtr]::Zero)
    Start-Sleep -Milliseconds 60
    [MagicPasteInput]::keybd_event([MagicPasteInput]::VK_V, 0, [MagicPasteInput]::KEYEVENTF_KEYUP, [UIntPtr]::Zero)
    [MagicPasteInput]::keybd_event([MagicPasteInput]::VK_CONTROL, 0, [MagicPasteInput]::KEYEVENTF_KEYUP, [UIntPtr]::Zero)
    Write-Host "[TYPE_TEXT] Complete"
  }




























































  'KEY_PRESS' {
    $key = ([string]$scriptArgs[3]).Trim().ToUpperInvariant()
    $vk = switch ($key) {
      'ENTER' { 0x0D }
      'RETURN' { 0x0D }
      'TAB' { 0x09 }
      'ESC' { 0x1B }
      'ESCAPE' { 0x1B }
      'BACKSPACE' { 0x08 }
      'SPACE' { 0x20 }
      'LEFT' { 0x25 }
      'UP' { 0x26 }
      'RIGHT' { 0x27 }
      'DOWN' { 0x28 }
      'DELETE' { 0x2E }
      'HOME' { 0x24 }
      'END' { 0x23 }
      'PAGEUP' { 0x21 }
      'PAGEDOWN' { 0x22 }
      'F1' { 0x70 }; 'F2' { 0x71 }; 'F3' { 0x72 }; 'F4' { 0x73 }
      'F5' { 0x74 }; 'F6' { 0x75 }; 'F7' { 0x76 }; 'F8' { 0x77 }
      'F9' { 0x78 }; 'F10' { 0x79 }; 'F11' { 0x7A }; 'F12' { 0x7B }
      default { if ($key.Length -eq 1) { [byte][char]$key[0] } else { 0 } }
    }
    if (-not $vk) { throw "Unsupported key: $key" }
    Add-Type @'
using System;
using System.Runtime.InteropServices;
public static class MagicKeyInput {
  [DllImport("user32.dll")] public static extern void keybd_event(byte key, byte scan, uint flags, UIntPtr extra);
  public const uint KEYUP = 0x0002;
}
'@
    [MagicKeyInput]::keybd_event([byte]$vk, 0, 0, [UIntPtr]::Zero)
    Start-Sleep -Milliseconds 40
    [MagicKeyInput]::keybd_event([byte]$vk, 0, [MagicKeyInput]::KEYUP, [UIntPtr]::Zero)
    Write-Host "[KEY_PRESS] Complete: $key"
  }
  'WAIT' {
    $ms = [int]$scriptArgs[3]
    if ($ms -lt 0 -or $ms -gt 10000) { throw "WAIT duration is outside the allowed range." }
    Start-Sleep -Milliseconds $ms
  }
  }`;

  const endPoint = action === "DRAG" ? mapCoordinate(params.endX, params.endY) : { x: 0, y: 0 };
  const endX = endPoint.x;
  const endY = endPoint.y;
  const actionArgs = [action, String(x), String(y), String(params.text ?? params.key ?? params.app ?? params.ms ?? ""), String(endX), String(endY)];
  console.log(`[DEBUG INPUT] actionArgs=${JSON.stringify(actionArgs)} textParam=${JSON.stringify(params.text)} keyParam=${JSON.stringify(params.key)}`);
  const result = await runPowerShell(script, actionArgs);
  console.log(`[DEBUG INPUT] result=${JSON.stringify(result)}`);
  if (desktopPermission === "one_action") desktopPermission = "none";
  return result;
}

ipcMain.on("magic-window-move", (event, deltaX, deltaY) => {
  assertTrustedRenderer(event);
  const window = BrowserWindow.fromWebContents(event.sender);
  if (!window || !Number.isFinite(deltaX) || !Number.isFinite(deltaY)) return;
  const [x, y] = window.getPosition();
  window.setPosition(Math.round(x + deltaX), Math.round(y + deltaY));
});

ipcMain.on("desktop-control-permission", (event, level) => {
  assertTrustedRenderer(event);
  if (["none", "one_action", "one_session", "always", "deny"].includes(level)) {
    desktopPermission = level;
    desktopKilled = level === "deny";
  }
});

ipcMain.handle("desktop-control-action", async (event, action, params) => {
  assertTrustedRenderer(event);
  console.log(`[DEBUG IPC] desktop-control-action action=${JSON.stringify(action)} params=${JSON.stringify(params)}`);
  const result = await executeDesktopAction(action, params);
  console.log(`[DEBUG IPC] desktop-control-action result=${JSON.stringify(result)}`);
  return result;
});
ipcMain.handle("desktop-capture-screen", async (event) => {
  assertTrustedRenderer(event);
  const window = BrowserWindow.fromWebContents(event.sender);
  const wasVisible = window && !window.isDestroyed() && window.isVisible();
  if (wasVisible) {
    window.hide();
    await new Promise((resolve) => setTimeout(resolve, 120));
  }

  try {
    const display = screen.getPrimaryDisplay();
    const visionSize = getVisionCanvasSize(display, AI_SCREEN_WIDTH);
    const sources = await desktopCapturer.getSources({
      types: ["screen"],
      thumbnailSize: { width: display.size.width, height: display.size.height },
      fetchWindowIcons: false,
    });
    const source = sources.find((candidate) => candidate.display_id === String(display.id)) || sources[0];
    if (!source || source.thumbnail.isEmpty()) {
      throw new Error("Windows did not return a desktop screenshot.");
    }
    const normalized = source.thumbnail.resize({
      width: visionSize.width,
      height: visionSize.height,
      quality: "good",
    });
    const coordMap = createCoordinateMap(display, screen, visionSize.width, visionSize.height);
    console.log("[VISION CAPTURE] display=%dx%d scale=%s vision=%dx%d coordMap=%s", display.size.width, display.size.height, display.scaleFactor, visionSize.width, visionSize.height, formatCoordinateMap(coordMap));
    return `data:image/jpeg;base64,${normalized.toJPEG(60).toString("base64")}`;
  } finally {
    if (wasVisible && window && !window.isDestroyed()) window.show();
  }
});
ipcMain.handle("desktop-capture-screen-info", async (event) => {
  assertTrustedRenderer(event);
  const window = BrowserWindow.fromWebContents(event.sender);
  const wasVisible = window && !window.isDestroyed() && window.isVisible();
  if (wasVisible) {
    window.hide();
    await new Promise((resolve) => setTimeout(resolve, 120));
  }

  try {
    const display = screen.getPrimaryDisplay();
    const sources = await desktopCapturer.getSources({
      types: ["screen"],
      thumbnailSize: { width: display.size.width, height: display.size.height },
      fetchWindowIcons: false,
    });
    const source = sources.find((candidate) => candidate.display_id === String(display.id)) || sources[0];
    if (!source || source.thumbnail.isEmpty()) {
      throw new Error("Windows did not return a desktop screenshot.");
    }
    const visionSize = getVisionCanvasSize(display, AI_SCREEN_WIDTH);
    const normalized = source.thumbnail.resize({
      width: visionSize.width,
      height: visionSize.height,
      quality: "good",
    });
    const coordMap = createCoordinateMap(display, screen, visionSize.width, visionSize.height);
    const coordMapString = formatCoordinateMap(coordMap);
    return {
      image: `data:image/jpeg;base64,${normalized.toJPEG(60).toString("base64")}`,
      sourceWidth: display.size.width,
      sourceHeight: display.size.height,
      sourceScaleFactor: Number(display.scaleFactor) || 1,
      visionWidth: visionSize.width,
      visionHeight: visionSize.height,
      coordinateSpace: "vision",
      coordMap,
      coordMapString,
    };
  } finally {
    if (wasVisible && window && !window.isDestroyed()) window.show();
  }
});


function spawnWindowsSpeech(window) {
  const scriptPath = path.join(__dirname, "windows_speech.ps1");
  return new Promise((resolve, reject) => {
    if (!fs.existsSync(scriptPath)) return reject(new Error("Windows speech fallback script is missing."));
    speechWindow = window;
    speechStopRequested = false;
    const proc = spawn("powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", scriptPath], {
      windowsHide: true,
      stdio: ["pipe", "pipe", "pipe"],
      env: process.env,
    });
    windowsSpeechProcess = proc;
    speechMode = "windows";
    let output = "";
    let settled = false;
    const timeout = setTimeout(() => {
      if (settled) return;
      settled = true;
      try { proc.kill(); } catch {}
      reject(new Error("Windows microphone startup timed out."));
    }, 8000);
    const resolveReady = () => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      resolve(true);
    };
    const rejectStart = (e) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      reject(e instanceof Error ? e : new Error(String(e)));
    };
    proc.stdout.on("data", chunk => {
      output += chunk.toString();
      const lines = output.split(/\r?\n/); output = lines.pop() || "";
      for (const line of lines) {
        if (!line) continue;
        const [kind, text, confidence] = line.split("|");
        if (kind === "READY") { window.webContents.send("magic-voice-device", "Windows default microphone"); window.webContents.send("magic-voice-ready"); resolveReady(); }
        else if (kind === "TRANSCRIPT" && text) window.webContents.send("magic-voice-transcript", {text, confidence: Number(confidence) || 0.8});
        else if (kind === "LEVEL") window.webContents.send("magic-voice-level", Number(text) || 0);
        else if (kind === "SPEECH_ERROR") { window.webContents.send("magic-voice-error", text || "Windows speech recognition failed."); rejectStart(new Error(text || "Windows speech recognition failed.")); }
      }
    });
    proc.stderr.on("data", chunk => { const m=chunk.toString().trim(); if(m) console.warn("[Windows Speech]",m); });
    proc.once("error", e => { window.webContents.send("magic-voice-error", e.message); rejectStart(e); });
    proc.once("exit", code => { if (!settled && !speechStopRequested) rejectStart(new Error(`Windows speech process stopped (exit code ${code ?? "unknown"}).`)); });
  });
}

async function startWhisperSpeech(window) {
  try {
    return await startWhisperProcess(window);
  } catch (error) {
    console.warn("[ma9icAI voice] Whisper unavailable, trying Windows Speech fallback:", error.message);
    try { await stopWhisperSpeech(); } catch {}
    return await spawnWindowsSpeech(window);
  }
}

ipcMain.handle("magic-voice-start", async (event) => {
  const window = assertTrustedRenderer(event);
  if (speechProcess && speechMode === "whisper") {
    try {
      speechProcess.stdin?.write("START\n");
      return true;
    } catch {
      speechProcess = null;
      speechMode = null;
    }
  }
  const started = await startWhisperSpeech(window);
  if (speechProcess && speechMode === "whisper") {
    try { speechProcess.stdin?.write("START\n"); } catch {}
    return started !== false;
  }
  return started;
});
ipcMain.on("magic-voice-stop", (event) => {
  assertTrustedRenderer(event);
  stopWhisperSpeech();
});
ipcMain.on("desktop-control-kill", (event) => {
  assertTrustedRenderer(event);
  desktopKilled = true;
  desktopPermission = "none";
  BrowserWindow.getAllWindows().forEach((win) => {
    if (!win.isDestroyed()) {
      win.webContents.send("desktop-control-killed", { reason: "Emergency stop triggered by user." });
    }
  });
});

ipcMain.on("magic-window-close", (event) => {
  assertTrustedRenderer(event);
  BrowserWindow.fromWebContents(event.sender)?.close();
});
ipcMain.on("magic-window-minimize", (event) => {
  assertTrustedRenderer(event);
  BrowserWindow.fromWebContents(event.sender)?.minimize();
});

ipcMain.on("magic-window-toggle-maximize", (event) => {
  assertTrustedRenderer(event);
  const window = BrowserWindow.fromWebContents(event.sender);
  if (!window) return;
  if (window.isMaximized()) window.unmaximize();
  else window.maximize();
});

function findOllamaCommand() {
  return new Promise((resolve, reject) => {
    const commonPaths = [
      process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, "Programs", "Ollama", "ollama.exe"),
      process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, "Ollama", "ollama.exe"),
      process.env.ProgramFiles && path.join(process.env.ProgramFiles, "Ollama", "ollama.exe"),
      process.env["ProgramFiles(x86)"] && path.join(process.env["ProgramFiles(x86)"], "Ollama", "ollama.exe"),
    ].filter(Boolean);

    const existing = commonPaths.find((candidate) => fs.existsSync(candidate));
    if (existing) {
      resolve(existing);
      return;
    }

    execFile("where.exe", ["ollama"], { windowsHide: true, timeout: OLLAMA_COMMAND_TIMEOUT }, (error, stdout) => {
      if (error || !stdout.trim()) {
        reject(new Error("Ollama was not found on Windows. Install Ollama or add ollama.exe to PATH."));
        return;
      }
      resolve(stdout.trim().split(/\r?\n/)[0].trim());
    });
  });
}

function isOllamaOnline() {
  return new Promise((resolve) => {
    const request = http.get("http://127.0.0.1:11434/api/tags", (response) => {
      response.resume();
      resolve(Boolean(response.statusCode && response.statusCode >= 200 && response.statusCode < 500));
    });
    request.setTimeout(1200, () => { request.destroy(); resolve(false); });
    request.on("error", () => resolve(false));
  });
}

async function ensureOllamaServer() {
  if (await isOllamaOnline()) return true;
  try {
    const ollamaPath = await findOllamaCommand();
    const child = spawn(ollamaPath, ["serve"], {
      windowsHide: true,
      detached: true,
      stdio: "ignore",
      cwd: ollamaWorkingDirectory,
      shell: false,
    });
    child.unref();
    for (let attempt = 0; attempt < 20; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 500));
      if (await isOllamaOnline()) return true;
    }
  } catch (error) {
    console.warn("[Ollama] Could not auto-start Ollama:", error?.message || error);
  }
  return false;
}

function spawnOllama(ollamaPath, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(ollamaPath, args, {
      windowsHide: options.windowsHide !== false,
      detached: false,
      stdio: options.capture ? ["ignore", "pipe", "pipe"] : "ignore",
      cwd: ollamaWorkingDirectory,
      shell: false,
    });

    child.once("spawn", () => resolve(child));
    child.once("error", (error) => reject(new Error(`Could not launch Ollama: ${error.message}`)));
  });
}

async function startOllamaService() {
  if (await isOllamaOnline()) return { online: true, started: false };
  const ollamaPath = await findOllamaCommand();
  const child = await spawnOllama(ollamaPath, ["serve"], { windowsHide: true });
  child.unref();
  for (let attempt = 0; attempt < 30; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 400));
    if (await isOllamaOnline()) return { online: true, started: true };
  }
  return { online: false, started: true };
}

async function launchOllamaDownload(model, sender, customModel = null, modelfile = null) {
  const ollamaPath = await findOllamaCommand();
  const pull = await spawnOllama(ollamaPath, ["pull", model], { windowsHide: true, capture: true });
  ollamaDownloadProcesses.add(pull);

  const send = (payload) => {
    try {
      if (sender && !sender.isDestroyed()) sender.send("magic-ollama-progress", payload);
    } catch {}
  };

  const forward = (chunk) => {
    const line = String(chunk || "").trim();
    if (line) send({ model, text: line });
  };
  pull.stdout?.on("data", forward);
  pull.stderr?.on("data", forward);
  send({ model, state: "downloading", text: `Downloading ${model}...` });

  pull.once("error", (error) => {
    ollamaDownloadProcesses.delete(pull);
    send({ model, state: "error", text: error.message });
  });

  pull.once("close", async (code) => {
    ollamaDownloadProcesses.delete(pull);
    if (code !== 0) {
      send({ model, state: "error", text: `Ollama download exited with code ${code}.` });
      return;
    }

    if (customModel && modelfile) {
      try {
        send({ model: customModel, state: "creating", text: `Creating ${customModel}...` });
        const create = await spawnOllama(ollamaPath, ["create", customModel, "-f", modelfile], { windowsHide: true, capture: true });
        ollamaDownloadProcesses.add(create);
        create.stdout?.on("data", forward);
        create.stderr?.on("data", forward);
        create.once("close", (createCode) => {
          ollamaDownloadProcesses.delete(create);
          send(createCode === 0
            ? { model: customModel, state: "complete", text: `${customModel} is installed.` }
            : { model: customModel, state: "error", text: `Ollama model creation exited with code ${createCode}.` });
        });
        create.once("error", (error) => {
          ollamaDownloadProcesses.delete(create);
          send({ model: customModel, state: "error", text: error.message });
        });
      } catch (error) {
        send({ model: customModel, state: "error", text: error?.message || "Could not create custom model." });
      }
      return;
    }

    send({ model, state: "complete", text: `${model} is installed.` });
  });
}

ipcMain.handle("magic-ollama-start", async (event) => {
  assertTrustedRenderer(event);
  try {
    const status = await startOllamaService();
    if (!status.online) {
      return { ok: false, error: "Ollama was found, but its local service did not become available at http://127.0.0.1:11434." };
    }
    const response = await fetch("http://127.0.0.1:11434/api/tags", { signal: AbortSignal.timeout(3000) });
    const data = await response.json();
    return { ok: true, started: status.started, models: Array.isArray(data.models) ? data.models : [] };
  } catch (error) {
    return { ok: false, error: error?.message || "Could not start Ollama." };
  }
});

ipcMain.handle("magic-ollama-download", async (event, model) => {
  assertTrustedRenderer(event);
  if (typeof model !== "string" || !supportedOllamaModels.has(model)) {
    return { ok: false, error: "That Ollama model is not available in the download menu." };
  }
  try {
    const started = await startOllamaService();
    if (!started.online) {
      return { ok: false, error: "Ollama could not be started. Make sure Ollama is installed." };
    }
    const modelFile = model === CUSTOM_OLLAMA_MODEL ? getBundledMiniCPMModelfile() : null;
    await launchOllamaDownload(model === CUSTOM_OLLAMA_MODEL ? BASE_OLLAMA_MODEL : model, event.sender, CUSTOM_OLLAMA_MODEL === model ? CUSTOM_OLLAMA_MODEL : null, modelFile);
    return { ok: true, state: "downloading" };
  } catch (error) {
    return { ok: false, error: error?.message || "Could not start the model download." };
  }
});

ipcMain.on("magic-window-layout", (event, overlayMode) => {
  assertTrustedRenderer(event);
  const window = BrowserWindow.fromWebContents(event.sender);
  if (!window || typeof overlayMode !== "boolean") return;

  if (overlayMode) {
    const workArea = screen.getPrimaryDisplay().workArea;
    const width = 430;
    const height = 620;
    window.setMinimumSize(320, 420);
    window.setBounds({
      x: workArea.x + workArea.width - width - 18,
      y: workArea.y + workArea.height - height,
      width,
      height,
    });
  } else {
    window.setMinimumSize(920, 630);
    window.setBounds({
      x: Math.max(0, Math.round((screen.getPrimaryDisplay().workArea.width - 920) / 2)),
      y: Math.max(0, Math.round((screen.getPrimaryDisplay().workArea.height - 630) / 2)),
      width: 920,
      height: 630,
    });
  }
});

/* trusted renderer IPC hardening v1 */

function assertTrustedRenderer(event) {

  const sender = event?.sender;

  const frameUrl = event?.senderFrame?.url || sender?.getURL?.() || "";

  if (!sender || !/^http:\/\/127\.0\.0\.1:\d+\//i.test(frameUrl)) {

    throw new Error("Untrusted renderer.");

  }

  const window = BrowserWindow.fromWebContents(sender);

  if (!window || window.isDestroyed()) {

    throw new Error("Renderer window is unavailable.");

  }

  return window;

}

function waitForServer(url, attempts = 80) {
  return new Promise((resolve, reject) => {
    const check = () => {
      const request = http.get(url, (response) => {
        response.resume();
        resolve();
      });
      request.on("error", () => {
        if (attempts-- <= 0) {
          reject(new Error("Magic AI server did not start in time."));
          return;
        }
        setTimeout(check, 250);
      });
    };
    check();
  });
}

async function createWindow() {
  process.env.NODE_ENV = "production";
  const logPath = path.join(app.getPath("userData"), "startup.log");
  const log = (message) => {
    try { fs.appendFileSync(logPath, `[${new Date().toISOString()}] ${message}\n`); } catch {}
    console.log(message);
  };
  process.on("uncaughtException", (error) => log(`UNCAUGHT: ${error?.stack || error}`));
  process.on("unhandledRejection", (error) => log(`UNHANDLED: ${error?.stack || error}`));
  process.env.MAGIC_APP_ROOT = app.getAppPath();
  process.env.PORT = String(port);
  const appRoot = app.getAppPath();
  const distIndexPath = path.join(appRoot, "dist", "index.html");
  const serverPath = path.join(appRoot, "dist", "server.cjs");
  log(`APP ROOT: ${appRoot}`);
  log(`DIST INDEX: ${distIndexPath} exists=${fs.existsSync(distIndexPath)}`);
  log(`SERVER PATH: ${serverPath} exists=${fs.existsSync(serverPath)}`);
  if (fs.existsSync(distIndexPath)) {
    try {
      const indexHtml = fs.readFileSync(distIndexPath, "utf8");
      const assetMatch = indexHtml.match(/(?:src|href)="([^"]+index-[^"]+\\.(?:js|css))"/);
      log(`DIST ASSET: ${assetMatch ? assetMatch[1] : "not-found"}`);
    } catch (error) {
      log(`DIST INSPECTION FAILED: ${error?.message || error}`);
    }
  }
  if (!fs.existsSync(serverPath)) {
    throw new Error(`Built server is missing: ${serverPath}. Run npm run build before starting ma9icAI.`);
  }
  require(serverPath);

  session.defaultSession.setPermissionRequestHandler((_webContents, permission, callback) => {
    callback(permission === "media" || permission === "notifications");
  });
  session.defaultSession.setPermissionCheckHandler((_webContents, permission) => {
    return permission === "media" || permission === "notifications";
  });

  session.defaultSession.setDisplayMediaRequestHandler(async (_request, callback) => {
    try {
      const sources = await desktopCapturer.getSources({ types: ["screen"] });
      const primarySource = sources.find((source) => source.display_id) || sources[0];
      callback(primarySource ? { video: primarySource } : {});
    } catch (error) {
      console.error("Unable to select a desktop capture source:", error);
      callback({});
    }
  });

  try {
    await waitForServer(`http://127.0.0.1:${port}/api/health`);
    void ensureOllamaServer();
  } catch (error) {
    log(`SERVER START FAILED: ${error?.stack || error}`);
    throw error;
  }

  

  globalShortcut.register("CommandOrControl+Alt+Escape", () => {
    desktopKilled = true;
    desktopPermission = "none";
    BrowserWindow.getAllWindows().forEach((win) => {
      if (!win.isDestroyed()) {
        win.webContents.send("desktop-control-killed", { reason: "Emergency stop key (Ctrl+Alt+Esc) pressed." });
      }
    });
  });

  const window = new BrowserWindow({
    width: 920,
    height: 630,
    minWidth: 920,
    minHeight: 630,
    center: true,
    // Transparent frameless window lets the 2.5D avatar overlay reveal the
    // real Windows desktop. Full mode still paints its own opaque UI via CSS.
    transparent: true,
    frame: false,
    hasShadow: false,
    alwaysOnTop: true,
    backgroundColor: "#00000000",
    autoHideMenuBar: true,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      preload: path.join(app.getAppPath(), "electron", "preload.cjs"),
    },
  });

  window.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//i.test(url)) {
      void shell.openExternal(url);
    }
    return { action: "deny" };
  });

  window.webContents.on("will-navigate", (event, url) => {
    const allowedPrefix = `http://127.0.0.1:${port}/`;
    if (!url.startsWith(allowedPrefix)) {
      event.preventDefault();
      if (/^https?:\/\//i.test(url)) {
        void shell.openExternal(url);
      }
    }
  });

  window.webContents.on("did-fail-load", (_event, errorCode, errorDescription, validatedURL) => {
    log(`RENDERER LOAD FAILED ${errorCode}: ${errorDescription} ${validatedURL}`);
  });
  window.webContents.on("render-process-gone", (_event, details) => {
    log(`RENDERER GONE: ${JSON.stringify(details)}`);
  });
  window.webContents.on("console-message", (_event, level, message, line, sourceId) => {
    log(`RENDERER CONSOLE [${level}] ${message} (${sourceId}:${line})`);
  });
  try {
    await session.defaultSession.clearCache();
  } catch (error) {
    log(`CACHE CLEAR FAILED: ${error?.message || error}`);
  }
  await window.loadURL(`http://127.0.0.1:${port}/?desktop=1`);

  // Prewarm Whisper after the UI is loaded. The model stays resident but the
  // microphone remains idle until the user presses the mic button.
  void startWhisperProcess(window).catch((error) => {
    console.warn("[ma9icAI voice] Whisper prewarm unavailable:", error?.message || error);
  });
}

app.on("before-quit", () => {
  terminateSpeechProcesses();
});

app.whenReady().then(createWindow).catch((error) => {
  console.error(error);
  try {
    const message = error?.stack || error?.message || String(error);
    const dialog = require("electron").dialog;
    void dialog.showMessageBox({
      type: "error",
      title: "ma9icAI could not start",
      message: "ma9icAI could not open the main window.",
      detail: message,
      buttons: ["OK"],
    }).finally(() => app.quit());
  } catch {
    app.quit();
  }
});

app.on("window-all-closed", () => {
  stopWhisperSpeech();
  globalShortcut.unregisterAll();
  if (process.platform !== "darwin") app.quit();
});
