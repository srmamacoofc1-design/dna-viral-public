param(
  [string]$ProjectPath = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path,
  [int]$Port = 8080,
  [int]$CheckIntervalSeconds = 5
)

$ErrorActionPreference = 'SilentlyContinue'
$runtimePath = Join-Path $ProjectPath '.runtime'
New-Item -ItemType Directory -Path $runtimePath -Force | Out-Null
$stdoutPath = Join-Path $runtimePath 'vite-stdout.log'
$stderrPath = Join-Path $runtimePath 'vite-stderr.log'

while ($true) {
  $listener = Get-NetTCPConnection -State Listen -LocalPort $Port -ErrorAction SilentlyContinue |
    Select-Object -First 1

  if (-not $listener) {
    Start-Process -FilePath 'npm.cmd' `
      -ArgumentList @('run', 'dev', '--', '--host', '0.0.0.0', '--port', $Port) `
      -WorkingDirectory $ProjectPath `
      -WindowStyle Hidden `
      -RedirectStandardOutput $stdoutPath `
      -RedirectStandardError $stderrPath | Out-Null
  }

  Start-Sleep -Seconds $CheckIntervalSeconds
}
