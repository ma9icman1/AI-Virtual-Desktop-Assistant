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

// The microphone must start OFF. The user explicitly enables it with the
// round mic button. Remove any old automatic startup greeting/wake listener.
const appFile = path.join(process.cwd(), 'src', 'App.tsx');
if (fs.existsSync(appFile)) {
  let text = fs.readFileSync(appFile, 'utf8');

  // Remove the startup timer regardless of formatting/line endings.
  const startupPattern = /\s*useEffect\(\(\)\s*=>\s*\{\s*const greetingTimer\s*=\s*window\.setTimeout\(\(\)\s*=>\s*triggerMagicGreeting\(false\),\s*900\);\s*return\s*\(\)\s*=>\s*window\.clearTimeout\(greetingTimer\);\s*\},\s*\[triggerMagicGreeting\]\);/m;
  if (startupPattern.test(text)) {
    text = text.replace(startupPattern, '\n  // Microphone starts OFF. User enables voice by clicking the round mic button.');
    console.log('[voice] Disabled automatic microphone startup.');
  }

  // The manual mic button is always full command mode, never wake-word standby.
  // This is what makes ordinary speech appear in chat after clicking the mic.
  const manualStartPattern = /setIsListening\(true\);\s*setAssistantState\("listening"\);\s*setVoiceNotice\("Starting microphone…"\);\s*VoiceEngine\.startListening\(\)\.then\(\(\)\s*=>\s*\{\s*setVoiceNotice\("Microphone active — speak now\."\);/m;
  const manualStartReplacement = `VoiceEngine.setWakeWordMode(false);\n      setIsListening(true);\n      setAssistantState("listening");\n      setVoiceNotice("Starting microphone…");\n      VoiceEngine.startListening().then(() => {\n        setVoiceNotice("Microphone active — speak now.");`;
  if (manualStartPattern.test(text)) {
    text = text.replace(manualStartPattern, manualStartReplacement);
    console.log('[voice] Manual mic button now enters full command mode.');
  }

  text = text.replace(
    /VoiceEngine\.speak\("Microphone commands are off\. Say ma9icAI when you need me\."\);/g,
    'VoiceEngine.speak("Microphone is off. Click the mic when you want to talk.");'
  );

  text = text.replace(
    /setVoiceNotice\("Wake word active — say ma9icAI\."\);/g,
    'setVoiceNotice("Wake word active — say Magic.");'
  );

  fs.writeFileSync(appFile, text, 'utf8');
}
