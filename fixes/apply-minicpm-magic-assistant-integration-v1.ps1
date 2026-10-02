$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

$root = (Get-Location).Path
$serverPath = Join-Path $root "server.ts"
$mainPath = Join-Path $root "electron\main.cjs"

foreach ($p in @($serverPath, $mainPath)) {
    if (-not (Test-Path -LiteralPath $p)) {
        throw "Missing required file: $p"
    }
}

function Read-Normalized([string]$Path) {
    return ([IO.File]::ReadAllText($Path) -replace "`r`n", "`n")
}

function Write-Normalized([string]$Path, [string]$Text, [string]$Original) {
    $out = $Text
    if ($Original.Contains("`r`n")) {
        $out = $out -replace "`n", "`r`n"
    }
    [IO.File]::WriteAllText($Path, $out, [Text.UTF8Encoding]::new($false))
}

function Replace-Exactly([string]$Text, [string]$Old, [string]$New, [string]$Label) {
    $count = ([regex]::Matches($Text, [regex]::Escape($Old))).Count
    if ($count -ne 1) {
        throw "$Label expected 1 match, found $count. No changes were written."
    }
    return $Text.Replace($Old, $New)
}

$serverRaw = [IO.File]::ReadAllText($serverPath)
$server = $serverRaw -replace "`r`n", "`n"
$mainRaw = [IO.File]::ReadAllText($mainPath)
$main = $mainRaw -replace "`r`n", "`n"

# -------------------------
# server.ts
# -------------------------
$serverRepls = [ordered]@{
'let activeOllamaModel = process.env.OLLAMA_CHAT_MODEL || "minicpm-v:latest";' =
'const DEFAULT_OLLAMA_MODEL = "minicpm-magic-assistant:latest";
const DEFAULT_OLLAMA_VISION_MODEL = "minicpm-magic-assistant:latest";
let activeOllamaModel = process.env.OLLAMA_CHAT_MODEL || DEFAULT_OLLAMA_MODEL;'

'let activeOllamaVisionModel = process.env.OLLAMA_VISION_MODEL || "minicpm-v:latest";' =
'let activeOllamaVisionModel = process.env.OLLAMA_VISION_MODEL || DEFAULT_OLLAMA_VISION_MODEL;'

'for (const model of [activeOllamaModel, "magic-assistant:latest", "minicpm-v:latest"].filter(' =
'for (const model of [activeOllamaModel, DEFAULT_OLLAMA_MODEL].filter('

'availableOllamaModels: ollama.models,' =
'availableOllamaModels: [
      ...ollama.models,
      ...(ollama.models.some((model: any) => model.name === DEFAULT_OLLAMA_MODEL)
        ? []
        : [{ name: DEFAULT_OLLAMA_MODEL, size: 0, custom: true }]),
    ],'
}

foreach ($kv in $serverRepls.GetEnumerator()) {
    if ($kv.Key -eq "availableOllamaModels: ollama.models,") {
        $count = ([regex]::Matches($server, [regex]::Escape($kv.Key))).Count
        if ($count -ne 2) {
            throw "server available-models replacement expected 2 matches, found $count. No changes were written."
        }
        $server = $server.Replace($kv.Key, $kv.Value)
    }
    else {
        $server = Replace-Exactly $server $kv.Key $kv.Value "server replacement"
    }
}

# -------------------------
# electron/main.cjs
# -------------------------
$mainRepls = [ordered]@{
'const supportedOllamaModels = new Set(["qwen2.5vl:3b", "llama3.2:3b", "minicpm-v"]);' =
'const CUSTOM_OLLAMA_MODEL = "minicpm-magic-assistant:latest";
const BASE_OLLAMA_MODEL = "minicpm-v:latest";

function getBundledMiniCPMModelfile() {
  const source = path.join(
    app.getAppPath(),
    "public",
    "models",
    "minicpm-magic-assistant",
    "Modelfile"
  );
  if (!fs.existsSync(source)) {
    throw new Error("The bundled MiniCPM Magic Assistant Modelfile is missing.");
  }

  const targetDir = path.join(app.getPath("userData"), "models", "minicpm-magic-assistant");
  const target = path.join(targetDir, "Modelfile");
  fs.mkdirSync(targetDir, { recursive: true });
  fs.copyFileSync(source, target);
  return target;
}

const supportedOllamaModels = new Set(["qwen2.5vl:3b", "llama3.2:3b", "minicpm-v", CUSTOM_OLLAMA_MODEL]);'

"const command = 'ollama run minicpm-v';" =
"const command = `ollama run ${CUSTOM_OLLAMA_MODEL}`;"

'ipcMain.handle("magic-ollama-download", (_event, model) =>' =
'ipcMain.handle("magic-ollama-download", (event, model) => {
  assertTrustedRenderer(event);'
}

foreach ($kv in $mainRepls.GetEnumerator()) {
    $main = Replace-Exactly $main $kv.Key $kv.Value "electron replacement"
}

$oldBlock = @'
ipcMain.handle("magic-ollama-download", (event, model) => {
  assertTrustedRenderer(event);
  if (typeof model !== "string" || !supportedOllamaModels.has(model)) {
    throw new Error("That Ollama model is not available in the download menu.");
  }
  const child = spawn("cmd.exe", ["/c", "start", "", "/min", "cmd.exe", "/k", `cd /d "${ollamaWorkingDirectory}" && ollama pull ${model}`], {
    windowsHide: false,
    detached: true,
    stdio: "ignore",
    cwd: ollamaWorkingDirectory,
  });
  child.unref();
  return true;
});
'@

$newBlock = @'
ipcMain.handle("magic-ollama-download", (event, model) => {
  assertTrustedRenderer(event);
  if (typeof model !== "string" || !supportedOllamaModels.has(model)) {
    throw new Error("That Ollama model is not available in the download menu.");
  }

  const modelFile = model === CUSTOM_OLLAMA_MODEL
    ? getBundledMiniCPMModelfile()
    : null;

  const command =
    model === CUSTOM_OLLAMA_MODEL
      ? `ollama pull ${BASE_OLLAMA_MODEL} && ollama create ${CUSTOM_OLLAMA_MODEL} -f "${modelFile}"`
      : `ollama pull ${model}`;

  const child = spawn("cmd.exe", ["/c", "start", "", "/min", "cmd.exe", "/k", `cd /d "${ollamaWorkingDirectory}" && ${command}`], {
    windowsHide: false,
    detached: true,
    stdio: "ignore",
    cwd: ollamaWorkingDirectory,
  });
  child.unref();
  return true;
});
'@

$main = Replace-Exactly $main $oldBlock $newBlock "Ollama download handler"

# -------------------------
# Postflight validation
# -------------------------
if ($server.Contains('"magic-assistant:latest"')) {
    throw "Postflight failed: broken magic-assistant fallback remains."
}
if (-not $server.Contains('DEFAULT_OLLAMA_MODEL = "minicpm-magic-assistant:latest"')) {
    throw "Postflight failed: custom Ollama default is missing."
}
if (-not $main.Contains('CUSTOM_OLLAMA_MODEL = "minicpm-magic-assistant:latest"')) {
    throw "Postflight failed: custom Electron model is missing."
}
if (-not $main.Contains('ollama pull ${BASE_OLLAMA_MODEL} && ollama create ${CUSTOM_OLLAMA_MODEL}')) {
    throw "Postflight failed: custom install flow is missing."
}
if (([regex]::Matches($server, [regex]::Escape("availableOllamaModels: ["))).Count -ne 2) {
    throw "Postflight failed: expected two available-model lists."
}
if (([regex]::Matches($server, [regex]::Escape("DEFAULT_OLLAMA_MODEL"))).Count -ne 4) {
    throw "Postflight failed: unexpected DEFAULT_OLLAMA_MODEL count."
}
if (([regex]::Matches($main, [regex]::Escape("function getBundledMiniCPMModelfile()"))).Count -ne 1) {
    throw "Postflight failed: bundled Modelfile helper count is not 1."
}
if (([regex]::Matches($main, [regex]::Escape("assertTrustedRenderer(event);"))).Count -ne 11) {
    throw "Postflight failed: existing IPC trust-check count changed."
}

# -------------------------
# Transactional write
# -------------------------
$stamp = Get-Date -Format "yyyyMMdd-HHmmss"
$backup = Join-Path $root ".ollama-integration-backup-$stamp"
New-Item -ItemType Directory -Force -Path $backup | Out-Null
Copy-Item $serverPath (Join-Path $backup "server.ts")
Copy-Item $mainPath (Join-Path $backup "main.cjs")

try {
    Write-Normalized $serverPath $server $serverRaw
    Write-Normalized $mainPath $main $mainRaw

    $writtenServer = Read-Normalized $serverPath
    $writtenMain = Read-Normalized $mainPath

    if (-not $writtenServer.Contains('DEFAULT_OLLAMA_MODEL = "minicpm-magic-assistant:latest"')) {
        throw "Read-back verification failed for server.ts."
    }
    if (-not $writtenMain.Contains('CUSTOM_OLLAMA_MODEL = "minicpm-magic-assistant:latest"')) {
        throw "Read-back verification failed for main.cjs."
    }
}
catch {
    Copy-Item (Join-Path $backup "server.ts") $serverPath -Force
    Copy-Item (Join-Path $backup "main.cjs") $mainPath -Force
    throw
}

Write-Host ""
Write-Host "MiniCPM Magic Assistant integration applied successfully." -ForegroundColor Green
Write-Host "Backup: $backup"
Write-Host ""
Write-Host "Next:"
Write-Host "  npm run typecheck"
Write-Host "  npm run build"
Write-Host ""
Write-Host "The app default is now:"
Write-Host "  minicpm-magic-assistant:latest"
