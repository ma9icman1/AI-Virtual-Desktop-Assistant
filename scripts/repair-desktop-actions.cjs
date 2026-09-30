const fs = require('fs');
const path = require('path');

const electronFile = path.join(process.cwd(), 'electron', 'main.cjs');
if (!fs.existsSync(electronFile)) process.exit(0);

let text = fs.readFileSync(electronFile, 'utf8');

// The generated verification code must test for numeric PowerShell output.
// Repair the over-escaped regex produced by older desktop-action patches.
text = text.replace(/if \(\/\^\\\\d\+\$\/\.test\(String\(result\)\.trim\(\)\)\)/g,
  'if (/^\\d+$/.test(String(result).trim()))');

const marker = '  const supportedInputActions = new Set([';
const start = '  if (["MINIMIZE_APP", "MAXIMIZE_APP", "RESTORE_APP"].includes(action)) {';
const markerIndex = text.indexOf(marker);
if (markerIndex === -1) {
  fs.writeFileSync(electronFile, text, 'utf8');
  console.log('[desktop-actions] Repaired process verification regex.');
  process.exit(0);
}

const safeBlock = `  if (["MINIMIZE_APP", "MAXIMIZE_APP", "RESTORE_APP"].includes(action)) {
    const requested = normalizeProcessName(params.app);
    const processName = resolveAutomationProcessName(requested);
    if (!requested) throw new Error("No application was provided for window control.");
    const mode = action === "MINIMIZE_APP" ? 6 : action === "MAXIMIZE_APP" ? 3 : 9;
    const psLines = [
      "Add-Type @'",
      "using System;",
      "using System.Runtime.InteropServices;",
      "public static class MagicWindowState {",
      "  [DllImport(\\\"user32.dll\\\")] public static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);",
      "}",
      "'@",
      "$proc = Get-Process -Name '" + processName.replace(/'/g, "''") + "' -ErrorAction SilentlyContinue | Where-Object { $_.MainWindowHandle -ne 0 } | Select-Object -First 1",
      "if (-not $proc) { throw 'No visible window was found.' }",
      "[MagicWindowState]::ShowWindow($proc.MainWindowHandle, " + mode + ") | Out-Null",
    ].join("\\n");
    await runPowerShell(psLines);
    if (desktopPermission === "one_action") desktopPermission = "none";
    return { ok: true, verified: true, process: requested, action };
  }
`;

const startIndex = text.indexOf(start);
if (startIndex !== -1 && startIndex < markerIndex) {
  text = text.slice(0, startIndex) + safeBlock + text.slice(markerIndex);
  console.log('[desktop-actions] Repaired native window action block.');
} else {
  text = text.slice(0, markerIndex) + safeBlock + text.slice(markerIndex);
  console.log('[desktop-actions] Installed native window action block.');
}

fs.writeFileSync(electronFile, text, 'utf8');
console.log('[desktop-actions] Process verification repair complete.');
