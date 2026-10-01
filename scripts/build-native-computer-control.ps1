$ErrorActionPreference = "Stop"

$root = Split-Path -Parent $PSScriptRoot
$manifest = Join-Path $root "native\computer-control\Cargo.toml"
$targetExe = Join-Path $root "native\target\release\ma9ic-computer-control.exe"
$binDir = Join-Path $root "native\bin"
$destination = Join-Path $binDir "ma9ic-computer-control.exe"

Write-Host "=== Building ma9icAI native computer-control sidecar ==="

if (-not (Get-Command cargo -ErrorAction SilentlyContinue)) {
    throw "Rust Cargo was not found. Install Rust from https://rustup.rs/ and run this again."
}

if (-not (Test-Path $manifest)) {
    throw "Native computer-control Cargo.toml is missing: $manifest"
}

New-Item -ItemType Directory -Force -Path $binDir | Out-Null

cargo build --release --manifest-path $manifest

if (-not (Test-Path $targetExe)) {
    throw "Rust build completed but the sidecar executable was not created: $targetExe"
}

Copy-Item -Force $targetExe $destination

Write-Host "Native sidecar ready: $destination"
Write-Host "Enigo 0.6.1 + XCap 0.8.0"
