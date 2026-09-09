# Dot-source this script: . ./scripts/use-local-tools.ps1
$delaRoot = Split-Path -Parent $PSScriptRoot
$delaNodeDir = Join-Path $delaRoot '.tools/node-v24.21.0-win-x64'
$delaPnpmDir = Join-Path $delaRoot '.tools/package-manager/node_modules/@pnpm/exe.win32-x64'
if (!(Test-Path (Join-Path $delaNodeDir 'node.exe')) -or !(Test-Path (Join-Path $delaPnpmDir 'pnpm.exe'))) {
  throw 'Local tools are missing. Install Node.js 24.21.0 and pnpm 12.3.4 or follow README.md.'
}
$env:PATH = "$delaNodeDir;$delaPnpmDir;" + $env:PATH
