const fs = require("fs");
const path = require("path");

const electronFile = path.join(process.cwd(), "electron", "main.cjs");
if (!fs.existsSync(electronFile)) throw new Error("[desktop-input] electron/main.cjs not found");

let text = fs.readFileSync(electronFile, "utf8");

// Desktop action arguments are:
// [action, x, y, text/key/app/value, endX, endY]
// TYPE_TEXT therefore MUST read scriptArgs[3].
// Use Win32 SendInput with KEYEVENTF_UNICODE instead of SendKeys/clipboard so
// spaces, punctuation, and Unicode text are delivered to the focused app.
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
    [FieldOffset(0)]
    public KEYBDINPUT ki;
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
      if (sent != 2) {
        throw new Exception("SendInput failed while typing text.");
      }
    }
  }
}
'@

    Write-Host "[TYPE_TEXT] Sending text: $value"
    [MagicTextInput]::TypeText($value)
    Write-Host "[TYPE_TEXT] Complete"
  }
`;

// Replace the entire TYPE_TEXT case, regardless of whether the previous repair
// used SendKeys, clipboard paste, or another multiline implementation.
const casePattern = /  'TYPE_TEXT'\s*\{[\s\S]*?(?=\n  'KEY_PRESS'\s*\{)/;
if (casePattern.test(text)) {
  text = text.replace(casePattern, newBlock);
  fs.writeFileSync(electronFile, text, "utf8");
  console.log("[desktop-input] Installed Win32 Unicode SendInput TYPE_TEXT handler.");
  process.exit(0);
}

throw new Error("[desktop-input] Could not find TYPE_TEXT case in electron/main.cjs");
