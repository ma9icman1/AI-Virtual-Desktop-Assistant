const fs = require("fs");
const path = require("path");

const electronFile = path.join(process.cwd(), "electron", "main.cjs");
if (!fs.existsSync(electronFile)) throw new Error("[desktop-input] electron/main.cjs not found");

let text = fs.readFileSync(electronFile, "utf8");

// Desktop action arguments:
// [action, x, y, text/key/app/value, endX, endY]
// TYPE_TEXT uses the Windows clipboard + Ctrl+V. This is much more reliable
// than synthesizing one Unicode key event per character (which can produce
// incorrect repeated characters on some Windows keyboard/input configurations).
const newBlock = `  'TYPE_TEXT' {
    $value = [string]$scriptArgs[3]
    if ([string]::IsNullOrEmpty($value)) { break }

    Add-Type -AssemblyName System.Windows.Forms
    Add-Type @'
using System;
using System.Runtime.InteropServices;
public static class MagicPasteInput {
  [DllImport("user32.dll")]
  public static extern void keybd_event(byte bVk, byte bScan, uint dwFlags, UIntPtr dwExtraInfo);
  public const uint KEYEVENTF_KEYUP = 0x0002;
  public const byte VK_CONTROL = 0x11;
  public const byte VK_V = 0x56;
}
'@

    Write-Host "[TYPE_TEXT] Sending text: $value"
    [System.Windows.Forms.Clipboard]::SetText($value)
    Start-Sleep -Milliseconds 100
    [MagicPasteInput]::keybd_event([MagicPasteInput]::VK_CONTROL, 0, 0, [UIntPtr]::Zero)
    [MagicPasteInput]::keybd_event([MagicPasteInput]::VK_V, 0, 0, [UIntPtr]::Zero)
    Start-Sleep -Milliseconds 60
    [MagicPasteInput]::keybd_event([MagicPasteInput]::VK_V, 0, [MagicPasteInput]::KEYEVENTF_KEYUP, [UIntPtr]::Zero)
    [MagicPasteInput]::keybd_event([MagicPasteInput]::VK_CONTROL, 0, [MagicPasteInput]::KEYEVENTF_KEYUP, [UIntPtr]::Zero)
    Write-Host "[TYPE_TEXT] Complete"
  }
`;

const keyPressBlock = `  'KEY_PRESS' {
    $key = ([string]$scriptArgs[3]).Trim().ToUpperInvariant()
    $vk = switch ($key) {
      'ENTER' { 0x0D }; 'RETURN' { 0x0D }; 'TAB' { 0x09 }
      'ESC' { 0x1B }; 'ESCAPE' { 0x1B }; 'BACKSPACE' { 0x08 }
      'SPACE' { 0x20 }; 'LEFT' { 0x25 }; 'UP' { 0x26 }; 'RIGHT' { 0x27 }
      'DOWN' { 0x28 }; 'DELETE' { 0x2E }; 'HOME' { 0x24 }; 'END' { 0x23 }
      'PAGEUP' { 0x21 }; 'PAGEDOWN' { 0x22 }
      'F1' { 0x70 }; 'F2' { 0x71 }; 'F3' { 0x72 }; 'F4' { 0x73 }
      'F5' { 0x74 }; 'F6' { 0x75 }; 'F7' { 0x76 }; 'F8' { 0x77 }
      'F9' { 0x78 }; 'F10' { 0x79 }; 'F11' { 0x7A }; 'F12' { 0x7B }
      default { if ($key.Length -eq 1) { [byte][char]$key[0] } else { 0 } }
    }
    if (-not $vk) { throw "Unsupported key: $key" }
    Add-Type @'
using System;
using System.Runtime.InteropServices;
public static class MagicKeyInput {
  [DllImport("user32.dll")] public static extern void keybd_event(byte key, byte scan, uint flags, UIntPtr extra);
  public const uint KEYUP = 0x0002;
}
'@
    [MagicKeyInput]::keybd_event([byte]$vk, 0, 0, [UIntPtr]::Zero)
    Start-Sleep -Milliseconds 40
    [MagicKeyInput]::keybd_event([byte]$vk, 0, [MagicKeyInput]::KEYUP, [UIntPtr]::Zero)
    Write-Host "[KEY_PRESS] Complete: $key"
  }
`;

const waitBlock = `  'WAIT' {
    $ms = [int]$scriptArgs[3]
    if ($ms -lt 0 -or $ms -gt 10000) { throw "WAIT duration is outside the allowed range." }
    Start-Sleep -Milliseconds $ms
  }
`;

const existingCase = /  ['\"]TYPE_TEXT['\"]\s*\{[\s\S]*?(?=\n\s*['\"]KEY_PRESS['\"]\s*\{)/;
if (existingCase.test(text)) {
  text = text.replace(existingCase, newBlock);
  fs.writeFileSync(electronFile, text, "utf8");
  console.log("[desktop-input] Replaced TYPE_TEXT with clipboard/paste handler.");
  process.exit(0);
}

const keyPressCase = /\n\s*['\"]KEY_PRESS['\"]\s*\{/;
if (keyPressCase.test(text)) {
  text = text.replace(keyPressCase, `\n${newBlock}  'KEY_PRESS' {`);
  fs.writeFileSync(electronFile, text, "utf8");
  console.log("[desktop-input] Inserted clipboard/paste TYPE_TEXT handler.");
  process.exit(0);
}

const switchEndPattern = /(  'SCROLL'\s*\{[\s\S]*?\n  \}\n)(  \}\`;)/;
if (switchEndPattern.test(text)) {
  text = text.replace(switchEndPattern, `$1${newBlock}${keyPressBlock}${waitBlock}$2`);
  fs.writeFileSync(electronFile, text, "utf8");
  console.log("[desktop-input] Restored TYPE_TEXT/KEY_PRESS/WAIT handlers.");
  process.exit(0);
}

console.warn("[desktop-input] No compatible input switch block found; leaving electron/main.cjs unchanged.");
process.exit(0);
