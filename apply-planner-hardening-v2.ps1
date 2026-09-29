$ErrorActionPreference = 'Stop'

$ServerPath = Join-Path (Get-Location) 'server.ts'
if (-not (Test-Path -LiteralPath $ServerPath -PathType Leaf)) {
  throw "server.ts was not found at $ServerPath"
}

$timestamp = Get-Date -Format 'yyyyMMdd-HHmmss'
$backupPath = "$ServerPath.planner-backup-$timestamp"

$source = [System.IO.File]::ReadAllText($ServerPath).Replace("`r`n", "`n")

$validator = @'
const PLANNER_ACTION_TYPES = new Set([
  "LAUNCH_APP",
  "NAVIGATE_URL",
  "MOVE_MOUSE",
  "CLICK_BUTTON",
  "DOUBLE_CLICK",
  "RIGHT_CLICK",
  "DRAG",
  "SCROLL",
  "TYPE_INPUT",
  "KEY_PRESS",
  "WAIT",
]);
const PLANNER_APPS = new Set([
  "brave", "edge", "chrome", "firefox", "notepad", "calculator",
  "paint", "explorer", "files", "terminal", "taskmgr",
]);

function validateAgentPlan(plan: any) {
  if (!plan || typeof plan !== "object" || !Array.isArray(plan.steps)) {
    throw new Error("Planner returned an invalid plan.");
  }
  if (plan.steps.length === 0 || plan.steps.length > 12) {
    throw new Error("Planner returned an invalid number of steps.");
  }

  const steps = plan.steps.map((step: any, index: number) => {
    if (!step || typeof step !== "object") {
      throw new Error(`Planner step ${index + 1} is invalid.`);
    }
    const actionType = String(step.actionType || "");
    if (!PLANNER_ACTION_TYPES.has(actionType)) {
      throw new Error(`Planner action is not allowed: ${actionType || "unknown"}.`);
    }
    const rawParams = step.params && typeof step.params === "object" && !Array.isArray(step.params)
      ? step.params
      : {};
    const normalized = {
      stepNumber: index + 1,
      description: String(step.description || `${actionType} step`).slice(0, 240),
      actionType,
      params: { ...rawParams },
      estimatedDurationMs: Math.min(15000, Math.max(0, Number(step.estimatedDurationMs) || 0)),
    };

    if (actionType === "LAUNCH_APP") {
      const app = String(normalized.params.app || "").trim().toLowerCase();
      if (!PLANNER_APPS.has(app)) throw new Error(`Planner app is not allowed: ${app || "unknown"}.`);
      normalized.params = { app };
    }
    if (actionType === "NAVIGATE_URL") {
      const url = String(normalized.params.url || "").trim();
      let parsedUrl: URL;
      try {
        parsedUrl = new URL(url);
      } catch {
        throw new Error("Planner URL is invalid.");
      }
      if (!/^https?:$/.test(parsedUrl.protocol) || url.length > 2048) {
        throw new Error("Planner URL is not allowed.");
      }
      normalized.params = { url };
    }
    if (["MOVE_MOUSE", "CLICK_BUTTON", "DOUBLE_CLICK", "RIGHT_CLICK"].includes(actionType)) {
      for (const [key, max] of [["x", 1280], ["y", 800]] as const) {
        const value = Number(normalized.params[key]);
        if (!Number.isFinite(value) || value < 0 || value > max) {
          throw new Error(`Planner coordinate ${key} is invalid.`);
        }
        normalized.params[key] = Math.round(value);
      }
    }
    if (actionType === "DRAG") {
      for (const [key, max] of [["x", 1280], ["endX", 1280], ["y", 800], ["endY", 800]] as const) {
        const value = Number(normalized.params[key]);
        if (!Number.isFinite(value) || value < 0 || value > max) {
          throw new Error(`Planner coordinate ${key} is invalid.`);
        }
        normalized.params[key] = Math.round(value);
      }
    }
    if (actionType === "SCROLL") {
      const amount = Number(normalized.params.amount);
      if (!Number.isFinite(amount) || amount < -10000 || amount > 10000) {
        throw new Error("Planner scroll amount is invalid.");
      }
      normalized.params = { amount: Math.round(amount) };
    }
    if (actionType === "TYPE_INPUT") {
      const text = String(normalized.params.text ?? "");
      if (text.length > 4000) throw new Error("Planner input is too long.");
      normalized.params = { text };
    }
    if (actionType === "KEY_PRESS") {
      const key = String(normalized.params.key || "");
      if (!key || key.length > 64) throw new Error("Planner key input is invalid.");
      normalized.params = { key };
    }
    if (actionType === "WAIT") {
      const ms = Number(normalized.params.ms);
      if (!Number.isFinite(ms) || ms < 0 || ms > 10000) throw new Error("Planner wait duration is invalid.");
      normalized.params = { ms: Math.round(ms) };
    }

    return normalized;
  });

  return {
    planTitle: String(plan.planTitle || "Desktop task").slice(0, 120),
    spokenIntro: String(plan.spokenIntro || "").slice(0, 500),
    steps,
    spokenCompletion: String(plan.spokenCompletion || "").slice(0, 500),
  };
}

'@

$oldPrompt = @'
Supported Step Action Types:
- "LAUNCH_APP": { "app": "brave" | "edge" | "chrome" | "notepad" | "calculator" | "paint" | "files" | "terminal" | "taskmgr" }
- "NAVIGATE_URL": { "url": string }
- "FOCUS_ELEMENT": { "selector": string, "description": string }
- "TYPE_INPUT": { "text": string, "pressEnter": boolean }
- "CLICK_BUTTON": { "buttonName": string }
- "CREATE_DIRECTORY": { "path": string, "name": string }
- "CALCULATE": { "expression": string }
- "SYSTEM_COMMAND": { "cmd": string }
- "VERIFY_STATE": { "condition": string }
'@

$newPrompt = @'
Only use these executable step action types:
- "LAUNCH_APP": { "app": "brave" | "edge" | "chrome" | "firefox" | "notepad" | "calculator" | "paint" | "explorer" | "files" | "terminal" | "taskmgr" }
- "NAVIGATE_URL": { "url": string }
- "MOVE_MOUSE": { "x": number, "y": number }
- "CLICK_BUTTON": { "x": number, "y": number }
- "DOUBLE_CLICK": { "x": number, "y": number }
- "RIGHT_CLICK": { "x": number, "y": number }
- "DRAG": { "x": number, "y": number, "endX": number, "endY": number }
- "SCROLL": { "amount": number }
- "TYPE_INPUT": { "text": string }
- "KEY_PRESS": { "key": string }
- "WAIT": { "ms": number }

Never output shell commands, PowerShell, command prompt instructions, executable paths, file deletion/install commands, or any action type outside this list.
Return no more than 12 steps.
'@

$oldGoalCheck = @'
    const { goal, context = {} } = req.body;
    if (!goal) {
      return res.status(400).json({ error: "Goal is required" });
    }
'@
$newGoalCheck = @'
    const { goal, context = {} } = req.body;
    if (!goal || typeof goal !== "string") {
      return res.status(400).json({ error: "Goal is required" });
    }
    if (goal.length > 4000) {
      return res.status(413).json({ error: "Goal is too long" });
    }
'@

$oldOllamaReturn = @'
        if (parsed && parsed.steps) {
          return res.json(parsed);
        }
'@
$newOllamaReturn = @'
        if (parsed && parsed.steps) {
          return res.json(validateAgentPlan(parsed));
        }
'@

$oldFinalValidation = @'
    if (!parsed || !parsed.steps) {
      throw new Error("Could not parse valid plan structure");
    }

    res.json(parsed);
'@
$newFinalValidation = @'
    res.json(validateAgentPlan(parsed));
'@

$oldCatch = @'
    res.json({
      planTitle: "Direct Task Assistance",
      spokenIntro: "I'll guide you step by step.",
      steps: [
        {
          stepNumber: 1,
          description: req.body.goal || "Assist with task",
          actionType: "SYSTEM_COMMAND",
          params: {},
          estimatedDurationMs: 1000,
        },
      ],
      spokenCompletion: "Ready for your next request.",
      warning: error.message,
    });
'@
$newCatch = @'
    res.status(502).json({
      error: "The task planner could not produce a safe executable plan.",
    });
'@

$checks = @(
  @{ Name = 'planner endpoint marker'; Old = '// Multi-Step Task Planner Endpoint'; Expected = 1 },
  @{ Name = 'planner prompt'; Old = $oldPrompt; Expected = 1 },
  @{ Name = 'goal validation'; Old = $oldGoalCheck; Expected = 1 },
  @{ Name = 'Ollama plan return'; Old = $oldOllamaReturn; Expected = 1 },
  @{ Name = 'final plan validation'; Old = $oldFinalValidation; Expected = 1 },
  @{ Name = 'unsafe planner fallback'; Old = $oldCatch; Expected = 1 }
)

foreach ($check in $checks) {
  $count = ([regex]::Matches($source, [regex]::Escape($check.Old))).Count
  if ($count -ne $check.Expected) {
    throw "Preflight failed for $($check.Name): expected $($check.Expected) match(es), found $count. No changes were written."
  }
}

if ($source.Contains('function validateAgentPlan')) {
  throw 'Preflight failed: validateAgentPlan already exists. Refusing to apply twice.'
}

$updated = $source
$updated = $updated.Replace('// Multi-Step Task Planner Endpoint', "// Multi-Step Task Planner Endpoint`r`n$validator")
$updated = $updated.Replace($oldPrompt, $newPrompt)
$updated = $updated.Replace($oldGoalCheck, $newGoalCheck)
$updated = $updated.Replace($oldOllamaReturn, $newOllamaReturn)
$updated = $updated.Replace($oldFinalValidation, $newFinalValidation)
$updated = $updated.Replace($oldCatch, $newCatch)

if ($updated.Contains('SYSTEM_COMMAND') -or $updated.Contains('actionType: "SYSTEM_COMMAND"')) {
  throw 'Postflight failed: SYSTEM_COMMAND still exists in server.ts. No changes were written.'
}
if (([regex]::Matches($updated, 'validateAgentPlan\(parsed\)')).Count -ne 2) {
  throw 'Postflight failed: expected exactly two planner validation calls. No changes were written.'
}
if (([regex]::Matches($updated, 'function validateAgentPlan')).Count -ne 1) {
  throw 'Postflight failed: validator count is incorrect. No changes were written.'
}
if (([regex]::Matches($updated, 'res\.status\(502\)\.json')).Count -ne 1) {
  throw 'Postflight failed: safe planner error response is missing. No changes were written.'
}

[System.IO.File]::Copy($ServerPath, $backupPath, $false)
$updatedForDisk = $updated.Replace("`n", "`r`n")
[System.IO.File]::WriteAllText($ServerPath, $updatedForDisk, [System.Text.UTF8Encoding]::new($false))

Write-Host "Planner hardening applied successfully." -ForegroundColor Green
Write-Host "Backup: $backupPath"
Write-Host "Next: npm run typecheck"
Write-Host "Then: npm run build"
