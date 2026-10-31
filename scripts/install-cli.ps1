# Installs the `recme` command for the Recme you installed with the setup program (Windows).
# It runs the CLI with the app's own Electron runtime, so Node.js is not needed.
#
#   powershell -ExecutionPolicy Bypass -File scripts\install-cli.ps1
#   powershell -ExecutionPolicy Bypass -File scripts\install-cli.ps1 -Exe "D:\Apps\Recme\Recme.exe"
#   powershell -ExecutionPolicy Bypass -File scripts\install-cli.ps1 -Uninstall
#
# It only touches your user PATH (no admin rights). Open a new terminal afterwards.
param(
  [string]$Exe = (Join-Path $env:LOCALAPPDATA 'Programs\Recme\Recme.exe'),
  [switch]$Uninstall
)

$binDir = Join-Path $env:LOCALAPPDATA 'Recme\bin'
$shim = Join-Path $binDir 'recme.cmd'
$userPath = [Environment]::GetEnvironmentVariable('Path', 'User')
$entries = @(); if ($userPath) { $entries = $userPath -split ';' | Where-Object { $_ } }

if ($Uninstall) {
  if (Test-Path $shim) { Remove-Item $shim -Force }
  $kept = $entries | Where-Object { $_.TrimEnd('\') -ne $binDir }
  [Environment]::SetEnvironmentVariable('Path', ($kept -join ';'), 'User')
  Write-Host "Removed the recme command."
  return
}

if (-not (Test-Path $Exe)) { Write-Error "Recme.exe not found at $Exe. Install Recme first, or pass -Exe with its path."; exit 1 }
$cli = Join-Path (Split-Path $Exe) 'resources\app.asar\src\cli.js'
if (-not (Test-Path (Join-Path (Split-Path $Exe) 'resources\app.asar'))) { Write-Error "This Recme install has no resources\app.asar next to Recme.exe."; exit 1 }

New-Item -ItemType Directory -Force $binDir | Out-Null
# Recme.exe is a GUI-subsystem program, so cmd would not wait for it or show its output. Piping through
# findstr makes the console wait and print everything (a side effect: the exit code is findstr's, not recme's).
$content = "@echo off`r`nsetlocal`r`nset ELECTRON_RUN_AS_NODE=1`r`n`"$Exe`" `"$cli`" %* 2>&1 | findstr /r `"^`"`r`n"
[System.IO.File]::WriteAllText($shim, $content, [System.Text.Encoding]::ASCII)

if (-not ($entries | Where-Object { $_.TrimEnd('\') -eq $binDir })) {
  [Environment]::SetEnvironmentVariable('Path', (($entries + $binDir) -join ';'), 'User')
  Write-Host "Added $binDir to your user PATH."
}
Write-Host "Installed: $shim"
Write-Host 'Open a new terminal and run: recme status'
