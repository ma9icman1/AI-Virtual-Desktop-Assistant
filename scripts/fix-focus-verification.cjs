const fs = require('fs');
const path = require('path');

const file = path.join(process.cwd(), 'electron', 'main.cjs');
if (!fs.existsSync(file)) {
  throw new Error('[focus-fix] electron/main.cjs not found. Run this from the project root.');
}

let text = fs.readFileSync(file, 'utf8');
const before = text;

// PowerShell reserves $PID as an automatic, read-only variable. The desktop
// focus verifier used $pid for GetWindowThreadProcessId, which makes the
// second command fail even though the first TYPE_TEXT command succeeds.
text = text.replace(/\$pid\b/g, '$processId');

if (text === before) {
  console.log('[focus-fix] No $pid references found; nothing to change.');
  process.exit(0);
}

fs.writeFileSync(file, text, 'utf8');
console.log('[focus-fix] Replaced PowerShell $pid references with $processId.');
console.log('[focus-fix] FOCUS_APP verification should now work on the next build.');
