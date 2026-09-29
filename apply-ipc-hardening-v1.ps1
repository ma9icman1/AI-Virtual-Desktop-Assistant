$ErrorActionPreference = "Stop"

$root = (Get-Location).Path
$target = Join-Path $root "electron\main.cjs"
if (-not (Test-Path -LiteralPath $target)) { throw "electron\main.cjs not found." }

$raw = [IO.File]::ReadAllText($target)
$nl = if ($raw.Contains("`r`n")) { "`r`n" } else { "`n" }
$src = $raw -replace "`r`n", "`n"

if ($src.Contains("/* trusted renderer IPC hardening v1 */")) {
  throw "IPC hardening v1 is already present. No changes were written."
}

$anchor = 'function waitForServer(url, attempts = 80) {'
if (([regex]::Matches($src, [regex]::Escape($anchor))).Count -ne 1) {
  throw "Preflight failed: waitForServer anchor count is not 1. No changes were written."
}

$handlers = @(
'ipcMain.on("magic-window-move",',
'ipcMain.on("desktop-control-permission",',
'ipcMain.handle("desktop-control-action",',
'ipcMain.handle("desktop-capture-screen",',
'ipcMain.handle("magic-voice-start",',
'ipcMain.on("magic-voice-stop",',
'ipcMain.on("desktop-control-kill",',
'ipcMain.on("magic-window-close",',
'ipcMain.handle("magic-ollama-start",',
'ipcMain.handle("magic-ollama-download",',
'ipcMain.on("magic-window-layout",'
)
foreach ($h in $handlers) {
  if (([regex]::Matches($src, [regex]::Escape($h))).Count -ne 1) {
    throw "Preflight failed: handler '$h' count is not 1. No changes were written."
  }
}

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

$repls = [ordered]@{
'ipcMain.on("magic-window-move", (event, deltaX, deltaY) => {' = 'ipcMain.on("magic-window-move", (event, deltaX, deltaY) => {`n  assertTrustedRenderer(event);'
'ipcMain.on("desktop-control-permission", (_event, level) => {' = 'ipcMain.on("desktop-control-permission", (event, level) => {`n  assertTrustedRenderer(event);'
'ipcMain.handle("desktop-control-action", async (_event, action, params) => executeDesktopAction(action, params));' = 'ipcMain.handle("desktop-control-action", async (event, action, params) => {`n  assertTrustedRenderer(event);`n  return executeDesktopAction(action, params);`n});'
'ipcMain.handle("desktop-capture-screen", async (event) => {' = 'ipcMain.handle("desktop-capture-screen", async (event) => {`n  assertTrustedRenderer(event);'
'ipcMain.handle("magic-voice-start", (event) => {' = 'ipcMain.handle("magic-voice-start", (event) => {`n  assertTrustedRenderer(event);'
'ipcMain.on("magic-voice-stop", () => stopWhisperSpeech());' = 'ipcMain.on("magic-voice-stop", (event) => {`n  assertTrustedRenderer(event);`n  stopWhisperSpeech();`n});'
'ipcMain.on("desktop-control-kill", () => {' = 'ipcMain.on("desktop-control-kill", (event) => {`n  assertTrustedRenderer(event);'
'ipcMain.on("magic-window-close", (event) => {' = 'ipcMain.on("magic-window-close", (event) => {`n  assertTrustedRenderer(event);'
'ipcMain.handle("magic-ollama-start", () => {' = 'ipcMain.handle("magic-ollama-start", (event) => {`n  assertTrustedRenderer(event);'
'ipcMain.handle("magic-ollama-download", (_event, model) => {' = 'ipcMain.handle("magic-ollama-download", (event, model) => {`n  assertTrustedRenderer(event);'
'ipcMain.on("magic-window-layout", (event, overlayMode) => {' = 'ipcMain.on("magic-window-layout", (event, overlayMode) => {`n  assertTrustedRenderer(event);'
}

foreach ($old in $repls.Keys) {
  $count = ([regex]::Matches($src, [regex]::Escape($old))).Count
  if ($count -ne 1) { throw "Preflight failed: replacement target count is $count for '$old'. No changes were written." }
}

$backup = "$target.ipc-hardening-backup-$(Get-Date -Format 'yyyyMMdd-HHmmss')"
[IO.File]::Copy($target, $backup, $false)

try {
  $out = $src
  $out = $out.Replace($anchor, $helper + $anchor)
  foreach ($old in $repls.Keys) { $out = $out.Replace($old, $repls[$old]) }

  if (-not $out.Contains("/* trusted renderer IPC hardening v1 */")) { throw "Postflight failed: marker missing." }
  if (([regex]::Matches($out, [regex]::Escape("assertTrustedRenderer(event)"))).Count -ne 11) {
    throw "Postflight failed: expected 11 trusted renderer checks."
  }
  if (-not $out.Contains('if (!sender || !/^http:\/\/127\.0\.0\.1:\d+\//i.test(frameUrl))')) {
    throw "Postflight failed: origin validation missing."
  }

  if ($nl -eq "`r`n") { $out = $out -replace "`n", "`r`n" }
  [IO.File]::WriteAllText($target, $out, [Text.UTF8Encoding]::new($false))
}
catch {
  [IO.File]::Copy($backup, $target, $true)
  throw
}

Write-Host "IPC trust-boundary hardening applied successfully."
Write-Host "Backup: $backup"
Write-Host "Next: npm run typecheck"
Write-Host "Then: npm run build"
