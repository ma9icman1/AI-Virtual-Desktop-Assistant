# ma9icAI full backup + commit + push
# Run from: C:\!Projectz\!!!SORT_ALL_GITS\ma9icAIv1-main\ma9icAIv1-main
$ErrorActionPreference = "Stop"

$root = (Get-Location).Path
$stamp = Get-Date -Format "yyyyMMdd-HHmmss"
$backupDir = Join-Path (Split-Path $root -Parent) "ma9icAI-full-backup-$stamp"
$zipPath = "$backupDir.zip"

Write-Host "=== ma9icAI FULL BACKUP + COMMIT + PUSH ===" -ForegroundColor Cyan

if (-not (Test-Path (Join-Path $root ".git"))) {
    throw "This folder is not a Git repository: $root"
}

# Show current state before changing anything.
Write-Host "`nCurrent Git status:" -ForegroundColor Yellow
git status --short
git branch --show-current
git remote -v

# 1. Full filesystem backup, excluding .git/node_modules/build output.
Write-Host "`nCreating full source backup..." -ForegroundColor Cyan
New-Item -ItemType Directory -Path $backupDir -Force | Out-Null

robocopy $root $backupDir /E /COPY:DAT /DCOPY:DAT /R:1 /W:1 `
    /XD ".git" "node_modules" "dist" "release" "release-v7" `
    /XF "*.log" "*.tmp" | Out-Null

# robocopy returns 0-7 for successful copies.
if ($LASTEXITCODE -gt 7) {
    throw "Backup copy failed. robocopy exit code: $LASTEXITCODE"
}

Compress-Archive -Path "$backupDir\*" -DestinationPath $zipPath -Force
Remove-Item $backupDir -Recurse -Force

Write-Host "Backup created: $zipPath" -ForegroundColor Green

# 2. Commit current working tree.
git add -A

$changes = git status --porcelain
if ($changes) {
    git commit -m "Backup before mouse-control work"
    if ($LASTEXITCODE -ne 0) {
        throw "Git commit failed."
    }
    Write-Host "Commit created." -ForegroundColor Green
} else {
    Write-Host "No uncommitted changes to commit." -ForegroundColor Yellow
}

# 3. Create a restore tag at the exact current commit.
$tag = "backup-before-mouse-control-$stamp"
git tag $tag
if ($LASTEXITCODE -ne 0) {
    throw "Could not create restore tag."
}

Write-Host "Restore tag: $tag" -ForegroundColor Green

# 4. Push branch and tag.
$branch = (git branch --show-current).Trim()
if (-not $branch) {
    throw "Could not determine current branch."
}

Write-Host "`nPushing branch '$branch'..." -ForegroundColor Cyan
git push origin $branch
if ($LASTEXITCODE -ne 0) {
    throw "Branch push failed. The local commit and ZIP backup remain available."
}

Write-Host "Pushing restore tag '$tag'..." -ForegroundColor Cyan
git push origin $tag
if ($LASTEXITCODE -ne 0) {
    throw "Tag push failed. The branch was pushed, and the local ZIP backup remains available."
}

Write-Host ""
Write-Host "========================================" -ForegroundColor Green
Write-Host "BACKUP + COMMIT + PUSH COMPLETE" -ForegroundColor Green
Write-Host "========================================" -ForegroundColor Green
Write-Host "ZIP backup: $zipPath"
Write-Host "Git tag:    $tag"
Write-Host "Branch:     $branch"
Write-Host ""
Write-Host "DO NOT START MOUSE-CONTROL CHANGES UNTIL THIS SCRIPT REPORTS COMPLETE." -ForegroundColor Yellow
