$ErrorActionPreference = "Stop"

$target = Join-Path (Get-Location) "electron\main.cjs"
if (-not (Test-Path -LiteralPath $target -PathType Leaf)) {
  throw "electron\main.cjs was not found. Run this from the project root."
}

$raw = [System.IO.File]::ReadAllText($target)

if ($raw.Contains("desktop execution policy hardening v1")) {
  throw "This Electron hardening patch appears to have already been applied."
}

$oldAlias = @'
      terminal: ["powershell.exe"],
      powershell: ["powershell.exe"],
'@

$newAlias = @'
      terminal: ["wt.exe"],
'@

$oldOpen = @'
  if (action === "OPEN_FILE") {
    const filePath = String(params.path || "").trim();
    if (!filePath) throw new Error("No file path was provided.");
    if (!path.isAbsolute(filePath)) {
      throw new Error("Opening a file requires an absolute path.");
    }
    const errorMessage = await shell.openPath(path.resolve(filePath));
    if (errorMessage) throw new Error(`Could not open file: ${errorMessage}`);
    if (desktopPermission === "one_action") desktopPermission = "none";
    return;
  }
'@

$newOpen = @'
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
'@

$oldSupported = @'
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

  const script = `
'@

$newSupported = @'
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
    boundedInteger(params.x, 0, AI_SCREEN_WIDTH - 1, "X coordinate");
    boundedInteger(params.y, 0, AI_SCREEN_HEIGHT - 1, "Y coordinate");
  }
  if (action === "DRAG") {
    boundedInteger(params.endX, 0, AI_SCREEN_WIDTH - 1, "End X coordinate");
    boundedInteger(params.endY, 0, AI_SCREEN_HEIGHT - 1, "End Y coordinate");
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
'@

$checks = [ordered]@{
  Alias = ([regex]::Matches($raw, [regex]::Escape($oldAlias))).Count
  OpenFile = ([regex]::Matches($raw, [regex]::Escape($oldOpen))).Count
  Supported = ([regex]::Matches($raw, [regex]::Escape($oldSupported))).Count
}
foreach ($name in $checks.Keys) {
  if ($checks[$name] -ne 1) {
    throw "Preflight failed: $name block count = $($checks[$name]); expected 1. No changes were written."
  }
}

$backup = "$target.desktop-hardening-backup-$(Get-Date -Format 'yyyyMMdd-HHmmss')"
[System.IO.File]::Copy($target, $backup, $false)

try {
  $updated = $raw.Replace($oldAlias, $newAlias)
  $updated = $updated.Replace($oldOpen, $newOpen)
  $updated = $updated.Replace($oldSupported, $newSupported)

  $marker = "/* desktop execution policy hardening v1 */"
  $updated = $updated.Replace("function runPowerShell", "$marker`r`nfunction runPowerShell")

  [System.IO.File]::WriteAllText($target, $updated, [System.Text.UTF8Encoding]::new($false))

  $check = [System.IO.File]::ReadAllText($target)
  if (([regex]::Matches($check, [regex]::Escape($marker))).Count -ne 1) {
    throw "Postflight failed: hardening marker missing."
  }
  if ($check.Contains('powershell: ["powershell.exe"]')) {
    throw "Postflight failed: direct PowerShell alias remains."
  }
  if (-not $check.Contains("const blockedExtensions = new Set([")) {
    throw "Postflight failed: OPEN_FILE extension block missing."
  }
  if (-not $check.Contains("const boundedInteger = (value, min, max, label) =>")) {
    throw "Postflight failed: parameter validation missing."
  }

  Write-Host "Electron desktop execution hardening applied successfully."
  Write-Host "Backup: $backup"
  Write-Host "Next: npm run typecheck"
  Write-Host "Then: npm run build"
}
catch {
  if (Test-Path -LiteralPath $backup) {
    [System.IO.File]::Copy($backup, $target, $true)
  }
  throw
}
