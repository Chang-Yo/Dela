# Dot-source this script: . ./scripts/use-local-tools.ps1
$delaRoot = Split-Path -Parent $PSScriptRoot
$delaNodeVersion = (Get-Content -LiteralPath (Join-Path $delaRoot '.node-version') -Raw).Trim()
$delaPackageManager = (Get-Content -LiteralPath (Join-Path $delaRoot 'package.json') -Raw | ConvertFrom-Json).packageManager
$delaNodeDir = Join-Path $delaRoot ".tools/node-v$delaNodeVersion-win-x64"
$delaPnpmDir = Join-Path $delaRoot '.tools/package-manager/node_modules/@pnpm/exe.win32-x64'
if (!(Test-Path (Join-Path $delaNodeDir 'node.exe')) -or !(Test-Path (Join-Path $delaPnpmDir 'pnpm.exe'))) {
  throw "Local tools are missing. Install Node.js $delaNodeVersion and $delaPackageManager or follow README.md."
}
$env:PATH = "$delaNodeDir;$delaPnpmDir;" + $env:PATH
