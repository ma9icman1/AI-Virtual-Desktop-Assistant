const fs = require('fs');
const path = require('path');

const voiceFile = path.join(process.cwd(), 'src', 'services', 'voiceEngine.ts');
if (fs.existsSync(voiceFile)) {
  const text = fs.readFileSync(voiceFile, 'utf8');
  const pattern = /  private getWakeWordAliases\(\): string\[\] \{[\s\S]*?\n  \}\n\n  private parseWakeWord/;
  const replacement = `  private getWakeWordAliases(): string[] {
    // The spoken wake word is independent from the assistant display name.
    // The title may be "ma9icAI", but the spoken wake word is always "Magic".
    return ["magic"];
  }

  private parseWakeWord`;
  if (pattern.test(text)) {
    fs.writeFileSync(voiceFile, text.replace(pattern, replacement), 'utf8');
    console.log('[wake-word] Fixed wake word to Magic.');
  }
}

const appFile = path.join(process.cwd(), 'src', 'App.tsx');
if (fs.existsSync(appFile)) {
  let text = fs.readFileSync(appFile, 'utf8');
  const startupPattern = /\s*useEffect\(\(\)\s*=>\s*\{\s*const greetingTimer\s*=\s*window\.setTimeout\(\(\)\s*=>\s*triggerMagicGreeting\(false\),\s*900\);\s*return\s*\(\)\s*=>\s*window\.clearTimeout\(greetingTimer\);\s*\},\s*\[triggerMagicGreeting\]\);/m;
  if (startupPattern.test(text)) {
    text = text.replace(startupPattern, '\n  // Microphone starts OFF. User enables voice by clicking the round mic button.');
    console.log('[voice] Disabled automatic microphone startup.');
  }
  const manualStartPattern = /setIsListening\(true\);\s*setAssistantState\("listening"\);\s*setVoiceNotice\("Starting microphone…"\);\s*VoiceEngine\.startListening\(\)\.then\(\(\)\s*=>\s*\{\s*setVoiceNotice\("Microphone active — speak now\."\);/m;
  const manualStartReplacement = `VoiceEngine.setWakeWordMode(false);
      setIsListening(true);
      setAssistantState("listening");
      setVoiceNotice("Starting microphone…");
      VoiceEngine.startListening().then(() => {
        setVoiceNotice("Microphone active — speak now.");`;
  if (manualStartPattern.test(text)) {
    text = text.replace(manualStartPattern, manualStartReplacement);
    console.log('[voice] Manual mic button now enters full command mode.');
  }
  text = text.replace(/VoiceEngine\.speak\("Microphone commands are off\. Say ma9icAI when you need me\."\);/g, 'VoiceEngine.speak("Microphone is off. Click the mic when you want to talk.");');
  text = text.replace(/setVoiceNotice\("Wake word active — say ma9icAI\."\);/g, 'setVoiceNotice("Wake word active — say Magic.");');
  fs.writeFileSync(appFile, text, 'utf8');
}

// Repair an older malformed native window-action block before the next build step.
process.on('exit', () => {
  const electronFile = path.join(process.cwd(), 'electron', 'main.cjs');
  if (!fs.existsSync(electronFile)) return;
  let text = fs.readFileSync(electronFile, 'utf8');
  const start = '  if (["MINIMIZE_APP", "MAXIMIZE_APP", "RESTORE_APP"].includes(action)) {';
  const marker = '  const supportedInputActions = new Set([';
  const startIndex = text.indexOf(start);
  const markerIndex = text.indexOf(marker);
  if (startIndex === -1 || markerIndex === -1 || startIndex >= markerIndex) return;

  const block = [
    '  if (["MINIMIZE_APP", "MAXIMIZE_APP", "RESTORE_APP"].includes(action)) {',
    '    const requested = normalizeProcessName(params.app);',
    '    const processName = resolveAutomationProcessName(requested);',
    '    if (!requested) throw new Error("No application was provided for window control.");',
    '    const mode = action === "MINIMIZE_APP" ? 6 : action === "MAXIMIZE_APP" ? 3 : 9;',
    '    const psLines = [',
    '      "Add-Type @\'",',
    '      "using System;",',
    '      "using System.Runtime.InteropServices;",',
    '      "public static class MagicWindowState {",',
    '      "  [DllImport(\\"user32.dll\\")] public static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);",',
    '      "}",',
    '      "\'@",',
    '      "$proc = Get-Process -Name \"${processName.replace(/\"/g, \"\"\")}\" -ErrorAction SilentlyContinue | Where-Object { $_.MainWindowHandle -ne 0 } | Select-Object -First 1",',
    '      "if (-not $proc) { throw \\\"No visible window was found.\\\" }",',
    '      `[MagicWindowState]::ShowWindow($proc.MainWindowHandle, ${mode}) | Out-Null`,',
    '    ].join("\\n");',
    '    await runPowerShell(psLines);',
    '    if (desktopPermission === "one_action") desktopPermission = "none";',
    '    return { ok: true, verified: true, process: requested, action };',
    '  }',
    ''
  ].join('\n');
  text = text.slice(0, startIndex) + block + text.slice(markerIndex);
  fs.writeFileSync(electronFile, text, 'utf8');
  console.log('[desktop-actions] Repaired malformed native window-action block.');
});
