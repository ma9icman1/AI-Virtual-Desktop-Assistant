const fs = require('fs');
const path = require('path');

const electronFile = path.join(process.cwd(), 'electron', 'main.cjs');
if (!fs.existsSync(electronFile)) process.exit(0);

let text = fs.readFileSync(electronFile, 'utf8');

const marker = '  const supportedInputActions = new Set([';
const start = '  if (["MINIMIZE_APP", "MAXIMIZE_APP", "RESTORE_APP"].includes(action)) {';
const startIndex = text.indexOf(start);
const markerIndex = text.indexOf(marker);

if (startIndex !== -1 && markerIndex !== -1 && startIndex < markerIndex) {
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
      `$proc = Get-Process -Name '${processName.replace(/'/g, "''")}' -ErrorAction SilentlyContinue | Where-Object { $_.MainWindowHandle -ne 0 } | Select-Object -First 1`,
      `if (-not $proc) { throw \"No visible ${processName} window was found.\" }`,
      `[MagicWindowState]::ShowWindow($proc.MainWindowHandle, ${mode}) | Out-Null`,
    ].join("\\n");
    await runPowerShell(psLines);
    if (desktopPermission === "one_action") desktopPermission = "none";
    return { ok: true, verified: true, process: requested, action };
  }
`;
  text = text.slice(0, startIndex) + safeBlock + text.slice(markerIndex);
  fs.writeFileSync(electronFile, text, 'utf8');
  console.log('[desktop-actions] Repaired native window action block.');
}
