const fs = require('fs');
const path = require('path');

const electronFile = path.join(process.cwd(), 'electron', 'main.cjs');
if (!fs.existsSync(electronFile)) process.exit(0);
let text = fs.readFileSync(electronFile, 'utf8');

// Cache PID -> process name inside each UIAutomation PowerShell scan.
// The old code called Get-Process once for every UI element.
text = text.replace(
  '  $matches = @()\n  foreach ($el in $elements) {',
  '  $matches = @()\n  $processCache = @{}\n  foreach ($el in $elements) {'
);
text = text.replace(
  '    $pn = \'\'\n    if ($p -gt 0) { try { $pn = (Get-Process -Id $p -ErrorAction Stop).ProcessName } catch {} }',
  '    $pn = \'\'\n    if ($p -gt 0) { if ($processCache.ContainsKey($p)) { $pn = $processCache[$p] } else { try { $pn = (Get-Process -Id $p -ErrorAction Stop).ProcessName } catch {} ; $processCache[$p] = $pn } }',
);

// Same optimization for browser web-field discovery, without changing its
// physical click/focus timing.
text = text.replace(
  '$candidates = @()\n\nforeach ($el in $all) {',
  '$candidates = @()\n$processCache = @{}\n\nforeach ($el in $all) {'
);
text = text.replace(
  '$pn = (Get-Process -Id $p -ErrorAction Stop).ProcessName.ToLowerInvariant()',
  '$pn = if ($processCache.ContainsKey($p)) { $processCache[$p] } else { try { $v = (Get-Process -Id $p -ErrorAction Stop).ProcessName.ToLowerInvariant() } catch { $v = \'\' }; $processCache[$p] = $v; $v }',
);

// Very short active-window cache prevents duplicate foreground discovery in
// one burst of actions while still tracking window changes quickly.
const activeStart = text.indexOf('async function getActiveWindowInfo() {');
const activeEnd = text.indexOf('async function findUiElement', activeStart);
if (activeStart !== -1 && activeEnd !== -1) {
  let block = text.slice(activeStart, activeEnd);
  if (!block.includes('magicActiveWindowCache')) {
    block = block.replace(
      'async function getActiveWindowInfo() {',
      'const magicActiveWindowCache = { value: null, expiresAt: 0 };\nasync function getActiveWindowInfo() {'
    );
    block = block.replace(
      '  const raw = await runPowerShell(script);',
      '  const now = Date.now();\n  if (magicActiveWindowCache.value && magicActiveWindowCache.expiresAt > now) return magicActiveWindowCache.value;\n  const raw = await runPowerShell(script);'
    );
    block = block.replace(
      '  try { return JSON.parse(raw || "{}"); } catch { return { title: "", process: "", pid: 0 }; }',
      '  try { const value = JSON.parse(raw || "{}"); magicActiveWindowCache.value = value; magicActiveWindowCache.expiresAt = Date.now() + 150; return value; } catch { return { title: "", process: "", pid: 0 }; }'
    );
    text = text.slice(0, activeStart) + block + text.slice(activeEnd);
    console.log('[performance] Added 150ms active-window cache.');
  }
}

// Opt-in timing telemetry. Set MAGIC_PERF=1 to measure real action latency.
const psStart = text.indexOf('function runPowerShell(script, args = []) {');
const psEnd = text.indexOf('function normalizeProcessName', psStart);
if (psStart !== -1 && psEnd !== -1) {
  let block = text.slice(psStart, psEnd);
  if (!block.includes('[PERF] PowerShell')) {
    block = block.replace(
      '  return new Promise((resolve, reject) => {',
      '  const startedAt = Date.now();\n  return new Promise((resolve, reject) => {'
    );
    block = block.replace(
      '          resolve(stdout.trim());',
      '          if (process.env.MAGIC_PERF === "1") console.log(`[PERF] PowerShell ${Date.now() - startedAt}ms args=${args.length}`);\n          resolve(stdout.trim());'
    );
    text = text.slice(0, psStart) + block + text.slice(psEnd);
    console.log('[performance] Added PowerShell timing telemetry.');
  }
}

fs.writeFileSync(electronFile, text, 'utf8');
console.log('[performance] Automation performance pass complete.');