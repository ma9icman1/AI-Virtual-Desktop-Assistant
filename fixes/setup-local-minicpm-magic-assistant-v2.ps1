$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

$repo = (Get-Location).Path
$modelsDir = Join-Path $repo "public\models\minicpm-magic-assistant"
$modelfile = Join-Path $modelsDir "Modelfile"
$modelName = "minicpm-magic-assistant:latest"
$baseModel = "minicpm-v:latest"

Write-Host "== Local MiniCPM Magic Assistant setup ==" -ForegroundColor Cyan
Write-Host "Repo: $repo"
Write-Host "Target: $modelName"
Write-Host ""

if (-not (Test-Path (Join-Path $repo "package.json"))) {
    throw "package.json was not found. Run this from the project root."
}

if (-not (Get-Command ollama -ErrorAction SilentlyContinue)) {
    throw "Ollama was not found on PATH."
}

New-Item -ItemType Directory -Force -Path $modelsDir | Out-Null

$systemPrompt = @'
You are Nova, a highly capable Local Desktop Assistant. You have two main capabilities: engaging in conversational chat and interpreting desktop screenshots to automate user actions.

CRITICAL OUTPUT FORMATTING:
You must always separate your thoughts/conversational feedback from your technical automation instructions. Use the following format for every response:

---
[Your friendly, conversational response explaining what you see, what you are doing, or answering general questions.]

```json
{
  "thought": "Brief explanation of the action being taken",
  "action": "click" | "type" | "keypress" | "wait" | "none",
  "target": "Description of the UI element or text string to target",
  "text_to_type": "string to type if action is type, otherwise null",
  "key_combination": "e.g., ctrl+c if action is keypress, otherwise null"
}
```
---

RULES FOR DESKTOP CONTROL:
1. If the user asks a general conversation question without an action, set "action" to "none".
2. When looking at a screenshot to click something, explicitly describe the target item in the "target" field so the host computer's automation script can locate it.
3. Keep conversational responses concise, clear, and polite.
'@

$modelfileText = @"
FROM $baseModel

SYSTEM """
$systemPrompt
"""

PARAMETER temperature 0.2
PARAMETER num_ctx 4096
PARAMETER stop <|im_start|>
PARAMETER stop <|im_end|>
"@

[System.IO.File]::WriteAllText(
    $modelfile,
    $modelfileText,
    [System.Text.UTF8Encoding]::new($false)
)

Write-Host "Created: $modelfile" -ForegroundColor Green

Write-Host ""
Write-Host "Checking base model..." -ForegroundColor Cyan
$list = (& ollama list 2>&1 | Out-String)
if ($LASTEXITCODE -ne 0) {
    throw "ollama list failed.`n$list"
}
if ($list -notmatch '(?im)^minicpm-v(?::latest)?\s') {
    Write-Host "Base model not found. Pulling $baseModel ..." -ForegroundColor Yellow
    & ollama pull $baseModel
    if ($LASTEXITCODE -ne 0) {
        throw "ollama pull failed for $baseModel."
    }
} else {
    Write-Host "Base model already installed." -ForegroundColor Green
}

Write-Host ""
Write-Host "Building $modelName ..." -ForegroundColor Cyan
& ollama create $modelName -f $modelfile
if ($LASTEXITCODE -ne 0) {
    throw "ollama create failed."
}

Write-Host ""
Write-Host "Verifying model..." -ForegroundColor Cyan
$show = (& ollama show $modelName 2>&1 | Out-String)
if ($LASTEXITCODE -ne 0) {
    throw "ollama show failed after create.`n$show"
}

Write-Host ""
Write-Host "SUCCESS: $modelName is installed and visible to Ollama." -ForegroundColor Green
Write-Host ""
Write-Host "Next test:"
Write-Host "  ollama run $modelName"
Write-Host ""
Write-Host "Then type:"
Write-Host "  Say READY and nothing else."
