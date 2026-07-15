param(
  [string]$TaskName = 'DNAViralDevServer',
  [switch]$Uninstall
)

$ErrorActionPreference = 'Stop'

if ($Uninstall) {
  Stop-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
  Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false -ErrorAction SilentlyContinue
  Write-Host "Tarefa $TaskName removida."
  exit 0
}

$watchdogPath = (Resolve-Path (Join-Path $PSScriptRoot 'start-dev-watchdog.ps1')).Path
$powershellPath = Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe'
$action = New-ScheduledTaskAction `
  -Execute $powershellPath `
  -Argument "-NoProfile -NonInteractive -WindowStyle Hidden -ExecutionPolicy Bypass -File `"$watchdogPath`""
$logonTrigger = New-ScheduledTaskTrigger -AtLogOn -User $env:USERNAME
# O disparo recorrente recupera o watchdog mesmo quando o Windows encerra a
# instancia com 0xC000013A. IgnoreNew impede instancias duplicadas enquanto a
# tarefa saudavel esta ativa.
$recoveryTrigger = New-ScheduledTaskTrigger `
  -Once `
  -At (Get-Date).AddMinutes(1) `
  -RepetitionInterval (New-TimeSpan -Minutes 1) `
  -RepetitionDuration (New-TimeSpan -Days 3650)
$principal = New-ScheduledTaskPrincipal -UserId $env:USERNAME -LogonType Interactive -RunLevel Limited
$settings = New-ScheduledTaskSettingsSet `
  -AllowStartIfOnBatteries `
  -DontStopIfGoingOnBatteries `
  -DontStopOnIdleEnd `
  -StartWhenAvailable `
  -MultipleInstances IgnoreNew `
  -RestartCount 999 `
  -RestartInterval (New-TimeSpan -Minutes 1) `
  -ExecutionTimeLimit ([TimeSpan]::Zero)

Register-ScheduledTask `
  -TaskName $TaskName `
  -Action $action `
  -Trigger @($logonTrigger, $recoveryTrigger) `
  -Principal $principal `
  -Settings $settings `
  -Description 'Mantém o servidor local DNA Viral disponível na porta 8080 independentemente do Codex.' `
  -Force | Out-Null

Start-ScheduledTask -TaskName $TaskName
Write-Host "Tarefa $TaskName instalada e iniciada."
