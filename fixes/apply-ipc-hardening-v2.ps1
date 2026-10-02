$ErrorActionPreference = "Stop"

$Root = Split-Path -Parent $MyInvocation.MyCommand.Path
$Target = Join-Path $Root "electron\main.cjs"
$Marker = "/* trusted renderer IPC hardening v1 */"

if (-not (Test-Path -LiteralPath $Target)) { throw "Target not found: $Target" }

$originalRaw = [System.IO.File]::ReadAllText($Target)
$hadCrLf = $originalRaw.Contains("`r`n")
$source = $originalRaw -replace "`r`n", "`n"

if ($source.Contains($Marker)) { throw "IPC hardening marker already exists. No changes were written." }

function Require-Count([string]$Text, [string]$Needle, [int]$Expected, [string]$Label) {
    $count = ([regex]::Matches($Text, [regex]::Escape($Needle))).Count
    if ($count -ne $Expected) {
        throw "${Label}: expected exactly $Expected match(es), found $count. No changes were written."
    }
}

$handlers = @(
    "magic-window-move","desktop-control-permission","desktop-control-action",
    "desktop-capture-screen","magic-voice-start","magic-voice-stop","desktop-control-kill",
    "magic-window-close","magic-ollama-start","magic-ollama-download","magic-window-layout"
)

Require-Count $source "function waitForServer(url, attempts = 80) {" 1 "waitForServer"
foreach ($channel in $handlers) { Require-Count $source $channel 1 "IPC channel $channel" }

$helper = @'
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

'@

$anchor = "function waitForServer(url, attempts = 80) {"
$source = $source.Replace($anchor, $helper + $anchor)

$source = $source.Replace('ipcMain.on("magic-window-move", (event, deltaX, deltaY) => {', 'ipcMain.on("magic-window-move", (event, deltaX, deltaY) => {' + "`n" + '  assertTrustedRenderer(event);')
$source = $source.Replace('ipcMain.on("desktop-control-permission", (_event, level) => {', 'ipcMain.on("desktop-control-permission", (event, level) => {' + "`n" + '  assertTrustedRenderer(event);')
$source = $source.Replace('ipcMain.handle("desktop-control-action", async (_event, action, params) => executeDesktopAction(action, params));', 'ipcMain.handle("desktop-control-action", async (event, action, params) => {' + "`n" + '  assertTrustedRenderer(event);' + "`n" + '  return executeDesktopAction(action, params);' + "`n" + '});')
$source = $source.Replace('ipcMain.handle("desktop-capture-screen", async (event) => {', 'ipcMain.handle("desktop-capture-screen", async (event) => {' + "`n" + '  assertTrustedRenderer(event);')
$source = $source.Replace('ipcMain.handle("magic-voice-start", (event) => {', 'ipcMain.handle("magic-voice-start", (event) => {' + "`n" + '  assertTrustedRenderer(event);')
$source = $source.Replace('ipcMain.on("magic-voice-stop", () => stopWhisperSpeech());', 'ipcMain.on("magic-voice-stop", (event) => {' + "`n" + '  assertTrustedRenderer(event);' + "`n" + '  stopWhisperSpeech();' + "`n" + '});')
$source = $source.Replace('ipcMain.on("desktop-control-kill", () => {', 'ipcMain.on("desktop-control-kill", (event) => {' + "`n" + '  assertTrustedRenderer(event);')
$source = $source.Replace('ipcMain.on("magic-window-close", (event) => {', 'ipcMain.on("magic-window-close", (event) => {' + "`n" + '  assertTrustedRenderer(event);')
$source = $source.Replace('ipcMain.handle("magic-ollama-start", () => {', 'ipcMain.handle("magic-ollama-start", (event) => {' + "`n" + '  assertTrustedRenderer(event);')
$source = $source.Replace('ipcMain.handle("magic-ollama-download", (_event, model) => {', 'ipcMain.handle("magic-ollama-download", (event, model) => {' + "`n" + '  assertTrustedRenderer(event);')
$source = $source.Replace('ipcMain.on("magic-window-layout", (event, overlayMode) => {', 'ipcMain.on("magic-window-layout", (event, overlayMode) => {' + "`n" + '  assertTrustedRenderer(event);')

$definitionCount = ([regex]::Matches($source, [regex]::Escape("function assertTrustedRenderer(event)"))).Count
$callSiteCount = ([regex]::Matches($source, [regex]::Escape("  assertTrustedRenderer(event);"))).Count
if ($definitionCount -ne 1) { throw "Postflight failed: expected 1 trust-helper definition, found $definitionCount." }
if ($callSiteCount -ne 11) { throw "Postflight failed: expected 11 IPC trust checks, found $callSiteCount." }
if (-not $source.Contains('throw new Error("Untrusted renderer.");')) { throw "Postflight failed: renderer rejection guard is missing." }
if (-not $source.Contains('/^http:\/\/127\.0\.0\.1:\d+\//i')) { throw "Postflight failed: loopback origin validation is missing." }

foreach ($channel in $handlers) {
    $idx = $source.IndexOf($channel)
    if ($idx -lt 0) { throw "Postflight failed: missing IPC channel $channel." }
    $window = $source.Substring($idx, [Math]::Min(500, $source.Length - $idx))
    if (-not $window.Contains("assertTrustedRenderer(event);")) {
        throw "Postflight failed: no trust check found near $channel."
    }
}

$timestamp = Get-Date -Format "yyyyMMdd-HHmmss"
$backup = Join-Path $Root "electron\main.cjs.ipc-hardening-backup-$timestamp"
Copy-Item -LiteralPath $Target -Destination $backup -Force

try {
    $output = if ($hadCrLf) { $source -replace "`n", "`r`n" } else { $source }
    [System.IO.File]::WriteAllText($Target, $output, [System.Text.UTF8Encoding]::new($false))
} catch {
    Copy-Item -LiteralPath $backup -Destination $Target -Force
    throw
}

try {
    $written = ([System.IO.File]::ReadAllText($Target)) -replace "`r`n", "`n"
    if (([regex]::Matches($written, [regex]::Escape("function assertTrustedRenderer(event)"))).Count -ne 1) { throw "Final verification failed: helper definition count is not 1." }
    if (([regex]::Matches($written, [regex]::Escape("  assertTrustedRenderer(event);"))).Count -ne 11) { throw "Final verification failed: IPC trust-check count is not 11." }
} catch {
    Copy-Item -LiteralPath $backup -Destination $Target -Force
    throw
}

Write-Host ""
Write-Host "Electron IPC trust-boundary hardening applied successfully."
Write-Host "Backup: $backup"
Write-Host "Verified: 1 helper definition + 11 IPC trust checks."
Write-Host "Next: npm run typecheck"
Write-Host "Then: npm run build"
