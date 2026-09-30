const fs = require('fs');
const path = require('path');

const file = path.join(process.cwd(), 'src', 'services', 'voiceEngine.ts');
if (!fs.existsSync(file)) process.exit(0);

const text = fs.readFileSync(file, 'utf8');
const pattern = /  private getWakeWordAliases\(\): string\[\] \{[\s\S]*?\n  \}\n\n  private parseWakeWord/;
const replacement = `  private getWakeWordAliases(): string[] {
    // The spoken wake word is independent from the assistant display name.
    // The title may be "ma9icAI", but the spoken wake word is always "Magic".
    return ["magic"];
  }

  private parseWakeWord`;

if (!pattern.test(text)) {
  console.log('[wake-word] Magic wake-word parser already fixed or pattern not found.');
  process.exit(0);
}

fs.writeFileSync(file, text.replace(pattern, replacement), 'utf8');
console.log('[wake-word] Fixed wake word to Magic.');
