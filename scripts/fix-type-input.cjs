const fs = require("fs");
const path = require("path");

const electronFile = path.join(process.cwd(), "electron", "main.cjs");
if (!fs.existsSync(electronFile)) throw new Error("[desktop-input] electron/main.cjs not found");

let text = fs.readFileSync(electronFile, "utf8");

// Desktop action arguments are:
// [action, x, y, text/key/app/value, endX, endY]
// TYPE_TEXT MUST read scriptArgs[3].
const newBlock = `  'TYPE_TEXT' {
    $value = [string]$scriptArgs[3]
    if ([string]::IsNullOrEmpty($value)) { break }

    Add-Type @'
using System;
using System.Runtime.InteropServices;

public static class MagicTextInput {
  [StructLayout(LayoutKind.Sequential)]
  public struct INPUT {
    public uint type;
    public InputUnion U;
  }

  [StructLayout(LayoutKind.Explicit)]
  public struct InputUnion {
    [FieldOffset(0)] public KEYBDINPUT ki;
  }

  [StructLayout(LayoutKind.Sequential)]
  public struct KEYBDINPUT {
    public ushort wVk;
    public ushort wScan;
    public uint dwFlags;
    public uint time;
    public UIntPtr dwExtraInfo;
  }

  [DllImport("user32.dll", SetLastError = true)]
  public static extern uint SendInput(uint nInputs, INPUT[] pInputs, int cbSize);

  public const uint INPUT_KEYBOARD = 1;
  public const uint KEYEVENTF_KEYUP = 0x0002;
  public const uint KEYEVENTF_UNICODE = 0x0004;

  public static void TypeText(string text) {
    foreach (char c in text) {
      INPUT[] inputs = new INPUT[2];
      inputs[0].type = INPUT_KEYBOARD;
      inputs[0].U.ki.wVk = 0;
      inputs[0].U.ki.wScan = c;
      inputs[0].U.ki.dwFlags = KEYEVENTF_UNICODE;
      inputs[0].U.ki.time = 0;
      inputs[0].U.ki.dwExtraInfo = UIntPtr.Zero;
      inputs[1].type = INPUT_KEYBOARD;
      inputs[1].U.ki.wVk = 0;
      inputs[1].U.ki.wScan = c;
      inputs[1].U.ki.dwFlags = KEYEVENTF_UNICODE | KEYEVENTF_KEYUP;
      inputs[1].U.ki.time = 0;
      inputs[1].U.ki.dwExtraInfo = UIntPtr.Zero;
      uint sent = SendInput(2, inputs, Marshal.SizeOf(typeof(INPUT)));
      if (sent != 2) throw new Exception("SendInput failed while typing text.");
    }
  }
}
'@

    Write-Host "[TYPE_TEXT] Sending text: $value"
    [MagicTextInput]::TypeText($value)
    Write-Host "[TYPE_TEXT] Complete"
  }
`;

const keyPressBlock = `  'KEY_PRESS' {
    $key = ([string]$scriptArgs[3]).Trim().ToUpperInvariant()
    $vk = switch ($key) {
      'ENTER' { 0x0D }
      'RETURN' { 0x0D }
      'TAB' { 0x09 }
      'ESC' { 0x1B }
      'ESCAPE' { 0x1B }
      'BACKSPACE' { 0x08 }
      'SPACE' { 0x20 }
      'LEFT' { 0x25 }
      'UP' { 0x26 }
      'RIGHT' { 0x27 }
      'DOWN' { 0x28 }
      'DELETE' { 0x2E }
      'HOME' { 0x24 }
      'END' { 0x23 }
      'PAGEUP' { 0x21 }
      'PAGEDOWN' { 0x22 }
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

// Replace an existing TYPE_TEXT case, regardless of its previous implementation.
const existingCase = /  ['\"]TYPE_TEXT['\"]\s*\{[\s\S]*?(?=\n\s*['\"]KEY_PRESS['\"]\s*\{)/;
if (existingCase.test(text)) {
  text = text.replace(existingCase, newBlock);
  if (!/['\"]KEY_PRESS['\"]\s*\{/.test(text)) {
    text = text.replace(/\n\s*}\`;\s*\n/, `\n${keyPressBlock}${waitBlock}  }\`;\n`);
  }
  fs.writeFileSync(electronFile, text, "utf8");
  console.log("[desktop-input] Installed Win32 Unicode SendInput TYPE_TEXT handler.");
  process.exit(0);
}

// If a previous repair removed TYPE_TEXT entirely but KEY_PRESS remains, insert TYPE_TEXT.
const keyPressCase = /\n\s*['\"]KEY_PRESS['\"]\s*\{/;
if (keyPressCase.test(text)) {
  text = text.replace(keyPressCase, `\n${newBlock}  'KEY_PRESS' {`);
  fs.writeFileSync(electronFile, text, "utf8");
  console.log("[desktop-input] TYPE_TEXT was missing; inserted a Win32 Unicode SendInput handler.");
  process.exit(0);
}

// Current fallback: some repair passes removed BOTH TYPE_TEXT and KEY_PRESS from
// the PowerShell switch. Insert the complete input cases immediately before the
// switch's closing brace. The distinctive SCROLL case keeps this targeted.
const switchEndPattern = /(  'SCROLL'\s*\{[\s\S]*?\n  \}\n)(  \}\`;)/;
if (switchEndPattern.test(text)) {
  text = text.replace(switchEndPattern, `$1${newBlock}${keyPressBlock}${waitBlock}$2`);
  fs.writeFileSync(electronFile, text, "utf8");
  console.log("[desktop-input] TYPE_TEXT/KEY_PRESS/WAIT cases were missing; inserted all three handlers.");
  process.exit(0);
}

console.warn("[desktop-input] No compatible input switch block found; leaving electron/main.cjs unchanged.");
process.exit(0);
