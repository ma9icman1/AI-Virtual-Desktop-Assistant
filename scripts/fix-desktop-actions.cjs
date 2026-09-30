const fs = require('fs');
const path = require('path');

const appFile = path.join(process.cwd(), 'src', 'App.tsx');
if (fs.existsSync(appFile)) {
  let text = fs.readFileSync(appFile, 'utf8');
  const marker = '      OPEN_FOLDER: { action: "OPEN_FOLDER", params: { path: params.path || params.parameter || "" } },';
  const addition = marker + '\n' +
    '      MINIMIZE_APP: { action: "MINIMIZE_APP", params: { app: params.app || params.parameter || "" } },\n' +
    '      MAXIMIZE_APP: { action: "MAXIMIZE_APP", params: { app: params.app || params.parameter || "" } },\n' +
    '      RESTORE_APP: { action: "RESTORE_APP", params: { app: params.app || params.parameter || "" } },';
  if (!text.includes('MINIMIZE_APP: { action: "MINIMIZE_APP"')) {
    if (!text.includes(marker)) throw new Error('[desktop-actions] App mapping marker not found');
    text = text.replace(marker, addition);
    fs.writeFileSync(appFile, text, 'utf8');
    console.log('[desktop-actions] Added window-state action mappings.');
  }
}

const serverFile = path.join(process.cwd(), 'server.ts');
if (fs.existsSync(serverFile)) {
  let text = fs.readFileSync(serverFile, 'utf8');
  const marker = '  if (requestedApp && asksToOpen && parsed?.action?.type !== "LAUNCH_APP" && parsed?.action?.type !== "MULTI_STEP_PLAN") {';
  if (!text.includes('const desktopVoiceWindowMatch')) {
    if (!text.includes(marker)) throw new Error('[desktop-actions] Server intent marker not found');
    const block = String.raw`  // Deterministic voice desktop commands. These run before the general AI intent so
  // common commands do not depend on model formatting.
  const desktopVoiceWindowMatch = request.match(/\b(?:switch|focus|bring)\s+(?:to\s+)?(?:the\s+)?(.+?)\s*$/i);
  const desktopVoiceOpenMatch = request.match(/\b(?:open|launch|start|run)\s+(?:the\s+)?(.+?)\s*$/i);
  const desktopVoiceCloseMatch = request.match(/\b(?:close|quit|exit|kill)\s+(?:the\s+)?(.+?)\s*$/i);
  const desktopVoiceMinMatch = request.match(/\bminimi[sz]e\s+(?:the\s+)?(.+?)\s*$/i);
  const desktopVoiceMaxMatch = request.match(/\bmaximi[sz]e\s+(?:the\s+)?(.+?)\s*$/i);
  const desktopVoiceRestoreMatch = request.match(/\brestore\s+(?:the\s+)?(.+?)\s*$/i);
  const desktopVoiceTypeMatch = message.match(/\b(?:type|write|enter)\s+["']?(.+?)["']?\s*$/i);
  const desktopVoiceKeyMatch = message.match(/\b(?:press|hit)\s+(.+?)\s*$/i);
  const desktopVoiceClickMatch = request.match(/\b(double[- ]?click|right[- ]?click|click)\s+(?:at\s+)?(?:x\s*)?(\d{2,5})\s*(?:,|and)\s*(?:y\s*)?(\d{2,5})\b/i);
  const desktopVoiceMoveMatch = request.match(/\b(?:move|put)\s+(?:the\s+)?mouse\s+(?:to\s+)?(?:x\s*)?(\d{2,5})\s*(?:,|and)\s*(?:y\s*)?(\d{2,5})\b/i);
  const desktopVoiceScrollMatch = request.match(/\bscroll\s+(up|down)(?:\s+(\d+))?/i);
  const desktopVoiceFolderMatch = message.match(/\b(?:open|go\s+to)\s+(?:the\s+)?folder\s+["']?(.+?)["']?\s*$/i);
  const desktopVoiceFileMatch = message.match(/\b(?:open|load)\s+(?:the\s+)?file\s+["']?(.+?)["']?\s*$/i);

  const makePlan = (title, description, steps, completion) => ({
    ...parsed,
    action: { type: "MULTI_STEP_PLAN", description, multiStepPlan: {
      planTitle: title, spokenIntro: description, steps, spokenCompletion: completion, currentStepIndex: 0, status: "idle"
    } }
  });

  if (desktopVoiceMoveMatch) {
    const x = Number(desktopVoiceMoveMatch[1]); const y = Number(desktopVoiceMoveMatch[2]);
    return makePlan("Move mouse to " + x + ", " + y, "I will move the mouse to " + x + ", " + y + ".", [
      { stepNumber: 1, description: "Move mouse to " + x + ", " + y, actionType: "MOVE_MOUSE", params: { x, y }, status: "pending", estimatedDurationMs: 400 }
    ], "Mouse moved.");
  }

  if (desktopVoiceClickMatch) {
    const kind = desktopVoiceClickMatch[1].toLowerCase(); const x = Number(desktopVoiceClickMatch[2]); const y = Number(desktopVoiceClickMatch[3]);
    const actionType = kind.startsWith("double") ? "DOUBLE_CLICK" : kind.startsWith("right") ? "RIGHT_CLICK" : "CLICK_BUTTON";
    return makePlan(kind + " at " + x + ", " + y, "I will " + kind + " at " + x + ", " + y + ".", [
      { stepNumber: 1, description: kind + " at " + x + ", " + y, actionType, params: { x, y }, status: "pending", estimatedDurationMs: 300 }
    ], "Done.");
  }

  if (desktopVoiceScrollMatch) {
    const direction = desktopVoiceScrollMatch[1].toLowerCase(); const count = Math.min(12, Math.max(1, Number(desktopVoiceScrollMatch[2] || 1)));
    const key = direction === "up" ? "{PGUP}" : "{PGDN}";
    return makePlan("Scroll " + direction, "I will scroll " + direction + ".", [
      { stepNumber: 1, description: "Scroll " + direction, actionType: "SCROLL", params: { x: 640, y: 400, key: Array(count).fill(key).join("") }, status: "pending", estimatedDurationMs: 250 }
    ], "Done.");
  }

  if (desktopVoiceMinMatch || desktopVoiceMaxMatch || desktopVoiceRestoreMatch) {
    const match = desktopVoiceMinMatch || desktopVoiceMaxMatch || desktopVoiceRestoreMatch;
    const actionType = desktopVoiceMinMatch ? "MINIMIZE_APP" : desktopVoiceMaxMatch ? "MAXIMIZE_APP" : "RESTORE_APP";
    const app = match[1].trim();
    const verb = actionType === "MINIMIZE_APP" ? "minimize" : actionType === "MAXIMIZE_APP" ? "maximize" : "restore";
    return makePlan(verb + " " + app, "I will " + verb + " " + app + ".", [
      { stepNumber: 1, description: verb + " " + app, actionType, params: { app, parameter: app }, status: "pending", estimatedDurationMs: 500 }
    ], "Done.");
  }

  if (desktopVoiceCloseMatch) {
    const app = desktopVoiceCloseMatch[1].trim();
    return makePlan("Close " + app, "I will close " + app + ".", [
      { stepNumber: 1, description: "Close " + app, actionType: "CLOSE_APP", params: { app, parameter: app }, status: "pending", estimatedDurationMs: 500 }
    ], app + " closed.");
  }

  if (desktopVoiceWindowMatch && !/\b(?:what|where|which)\b/.test(request)) {
    const app = desktopVoiceWindowMatch[1].trim();
    return makePlan("Switch to " + app, "I will switch to " + app + ".", [
      { stepNumber: 1, description: "Focus " + app, actionType: "FOCUS_APP", params: { app, parameter: app }, status: "pending", estimatedDurationMs: 500 }
    ], app + " is focused.");
  }

  if (desktopVoiceFolderMatch) {
    const folder = desktopVoiceFolderMatch[1].trim();
    return makePlan("Open folder", "I will open the folder " + folder + ".", [
      { stepNumber: 1, description: "Open folder " + folder, actionType: "OPEN_FOLDER", params: { path: folder, parameter: folder }, status: "pending", estimatedDurationMs: 700 }
    ], "Folder opened.");
  }

  if (desktopVoiceFileMatch) {
    const file = desktopVoiceFileMatch[1].trim();
    return makePlan("Open file", "I will open the file " + file + ".", [
      { stepNumber: 1, description: "Open file " + file, actionType: "OPEN_FILE", params: { path: file, parameter: file }, status: "pending", estimatedDurationMs: 700 }
    ], "File opened.");
  }

  if (desktopVoiceTypeMatch && !/\b(?:what|who|where|when|why|how)\b/.test(request)) {
    const textToType = desktopVoiceTypeMatch[1].trim();
    return makePlan("Type text", "I will type " + textToType + ".", [
      { stepNumber: 1, description: "Type " + textToType, actionType: "TYPE_INPUT", params: { text: textToType }, status: "pending", estimatedDurationMs: 400 }
    ], "Text entered.");
  }

  if (desktopVoiceKeyMatch && /\b(?:enter|return|tab|escape|esc|backspace|delete|space|up|down|left|right|home|end|page up|page down|ctrl|control|alt|shift|win|windows)\b/i.test(desktopVoiceKeyMatch[1])) {
    const key = desktopVoiceKeyMatch[1].trim().toLowerCase().replace(/\bcontrol\b/g, "ctrl").replace(/\bescape\b/g, "esc").replace(/\bwindows\b/g, "win");
    return makePlan("Press " + key, "I will press " + key + ".", [
      { stepNumber: 1, description: "Press " + key, actionType: "KEY_PRESS", params: { key }, status: "pending", estimatedDurationMs: 250 }
    ], "Done.");
  }

  if (desktopVoiceOpenMatch && !requestedApp) {
    const app = desktopVoiceOpenMatch[1].trim();
    return makePlan("Open " + app, "I will open " + app + ".", [
      { stepNumber: 1, description: "Open " + app, actionType: "LAUNCH_APP", params: { app, parameter: app }, status: "pending", estimatedDurationMs: 800 }
    ], app + " opened.");
  }

`;
    text = text.replace(marker, block + marker);
    fs.writeFileSync(serverFile, text, 'utf8');
    console.log('[desktop-actions] Added deterministic voice desktop command parser.');
  }
}

const electronFile = path.join(process.cwd(), 'electron', 'main.cjs');
if (fs.existsSync(electronFile)) {
  let text = fs.readFileSync(electronFile, 'utf8');
  const marker = '  const supportedInputActions = new Set([';
  if (!text.includes('if (["MINIMIZE_APP", "MAXIMIZE_APP", "RESTORE_APP"].includes(action))')) {
    if (!text.includes(marker)) throw new Error('[desktop-actions] Electron action marker not found');
    const block = String.raw`  if (["MINIMIZE_APP", "MAXIMIZE_APP", "RESTORE_APP"].includes(action)) {
    const requested = normalizeProcessName(params.app);
    const processName = resolveAutomationProcessName(requested);
    if (!requested) throw new Error("No application was provided for window control.");
    const mode = action === "MINIMIZE_APP" ? 6 : action === "MAXIMIZE_APP" ? 3 : 9;
    const script = "\nAdd-Type @'\nusing System;\nusing System.Runtime.InteropServices;\npublic static class MagicWindowState {\n  [DllImport(\"user32.dll\")] public static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);\n}\n'@\n$proc = Get-Process -Name '" + processName.replace(/'/g, "''") + "' -ErrorAction SilentlyContinue | Where-Object { $_.MainWindowHandle -ne 0 } | Select-Object -First 1\nif (-not $proc) { throw \"No visible window was found.\" }\n[MagicWindowState]::ShowWindow($proc.MainWindowHandle, " + mode + ") | Out-Null\n";
    await runPowerShell(script);
    if (desktopPermission === "one_action") desktopPermission = "none";
    return { ok: true, verified: true, process: requested, action };
  }
`;
    text = text.replace(marker, block + marker);
    fs.writeFileSync(electronFile, text, 'utf8');
    console.log('[desktop-actions] Added native minimize/maximize/restore actions.');
  }

  // A launched process can exist without becoming the foreground window. Voice
  // commands such as "Open Notepad" followed by "Type ..." must leave the
  // launched app focused so the next input action reaches it instead of ma9icAI.
  if (!text.includes('[desktop-actions] launch focus repair')) {
    const verifyLine = '    if (!verified) throw new Error(`Windows started ${requested}, but the process could not be verified.`);';
    if (!text.includes(verifyLine)) throw new Error('[desktop-actions] Launch verification marker not found');
    const focusBlock = [
      verifyLine,
      '    // [desktop-actions] launch focus repair',
      '    const focusScript = "Add-Type @\'\\nusing System;\\nusing System.Runtime.InteropServices;\\npublic static class MagicLaunchFocus { [DllImport(\\\"user32.dll\\\")] public static extern bool SetForegroundWindow(IntPtr hWnd); }\\n\'@\\n$proc = Get-Process -Name \'" + verifyTarget.replace(/\'/g, "\'\'") + "\' -ErrorAction SilentlyContinue | Where-Object { $_.MainWindowHandle -ne 0 } | Select-Object -First 1\\nif ($proc) { [MagicLaunchFocus]::SetForegroundWindow($proc.MainWindowHandle) | Out-Null }\\n";',
      '    await runPowerShell(focusScript);',
      '    await new Promise((resolve) => setTimeout(resolve, 180));'
    ].join('\n');
    text = text.replace(verifyLine, focusBlock);
    fs.writeFileSync(electronFile, text, 'utf8');
    console.log('[desktop-actions] launch focus repair installed.');
  }
}
