[CmdletBinding()]
param(
  [string]$ProjectRef = $env:SUPABASE_PROJECT_REF
)

$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'

$ProjectRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
if ([string]::IsNullOrWhiteSpace($ProjectRef)) {
  throw 'Defina SUPABASE_PROJECT_REF ou passe -ProjectRef com o projeto Supabase que sera usado.'
}
$SupabaseUrl = 'https://{0}.supabase.co' -f $ProjectRef
$EmDash = [char]0x2014
$PresetName = 'Base Viral {0} 50 Shorts Fornecidos (Jul 2026)' -f $EmDash
$RuntimeRoot = Join-Path $ProjectRoot '.runtime\viral-base-job'
$LogPath = Join-Path $RuntimeRoot 'pipeline.log'
$StatusPath = Join-Path $RuntimeRoot 'status.json'

New-Item -ItemType Directory -Path $RuntimeRoot -Force | Out-Null
Set-Location -LiteralPath $ProjectRoot

function Write-JobStatus {
  param(
    [Parameter(Mandatory = $true)][string]$Stage,
    [Parameter(Mandatory = $true)][string]$State,
    [int]$ExitCode = 0,
    [string]$Message = ''
  )

  $payload = [ordered]@{
    updated_at = (Get-Date).ToUniversalTime().ToString('o')
    stage = $Stage
    state = $State
    exit_code = $ExitCode
    message = $Message
  }
  $temporaryPath = "$StatusPath.tmp"
  $payload | ConvertTo-Json | Set-Content -LiteralPath $temporaryPath -Encoding utf8
  Move-Item -LiteralPath $temporaryPath -Destination $StatusPath -Force
}

function Add-JobLog {
  param([Parameter(Mandatory = $true)][string]$Message)
  $line = '{0} {1}' -f (Get-Date).ToUniversalTime().ToString('o'), $Message
  Add-Content -LiteralPath $LogPath -Value $line -Encoding utf8
}

function Invoke-LoggedNodeScript {
  param([Parameter(Mandatory = $true)][string]$ScriptPath)
  # Windows PowerShell 5.1 wraps native stderr lines as ErrorRecord objects.
  # With the runner-wide Stop preference, an ordinary console.warn (for
  # example, an idempotent retry) used to abort the whole scheduled job even
  # when Node was still healthy. Scope native output collection to Continue,
  # persist both streams, and decide success exclusively from LASTEXITCODE.
  $previousErrorActionPreference = $ErrorActionPreference
  try {
    $ErrorActionPreference = 'Continue'
    & npx.cmd vite-node $ScriptPath 2>&1 | ForEach-Object {
      Add-Content -LiteralPath $LogPath -Value ([string]$_) -Encoding utf8
    }
    $nativeExitCode = $LASTEXITCODE
  }
  finally {
    $ErrorActionPreference = $previousErrorActionPreference
  }
  if ($null -eq $nativeExitCode) { return 1 }
  return [int]$nativeExitCode
}

try {
  Write-JobStatus -Stage 'credentials' -State 'running'
  Add-JobLog 'Obtendo credencial temporaria do projeto Supabase autorizado.'

  $rawKeys = & npx.cmd supabase projects api-keys --project-ref $ProjectRef --reveal --output json 2>$null
  if ($LASTEXITCODE -ne 0) { throw 'Nao foi possivel consultar as chaves do projeto pelo Supabase CLI.' }
  $serviceRoleKey = (($rawKeys | ConvertFrom-Json) | Where-Object { $_.name -eq 'service_role' }).api_key
  if ([string]::IsNullOrWhiteSpace($serviceRoleKey)) { throw 'Service role nao encontrada.' }

  $env:SUPABASE_URL = $SupabaseUrl
  $env:SUPABASE_PROJECT_REF = $ProjectRef
  $env:SUPABASE_SERVICE_ROLE_KEY = $serviceRoleKey
  # Keep provider pressure serial while the shared pool is quota constrained.
  # Idempotent retries and the persistent task preserve throughput without
  # recreating simultaneous claims or doubling model requests.
  $env:VIRAL_CONCURRENCY = '1'
  $env:VIRAL_PRESET_NAME = $PresetName
  Remove-Item Env:VIRAL_IMPORT_LIMIT -ErrorAction SilentlyContinue
  Remove-Item Env:VIRAL_SKIP_PRESET -ErrorAction SilentlyContinue
  Remove-Item Env:VIRAL_FORCE_REPROCESS -ErrorAction SilentlyContinue

  Write-JobStatus -Stage 'viral_base' -State 'running'
  Add-JobLog 'Iniciando ingestao auditada dos 50 Shorts unicos.'
  $importExitCode = Invoke-LoggedNodeScript -ScriptPath 'scripts/import-viral-base-live.ts'
  if ($importExitCode -ne 0) {
    Write-JobStatus -Stage 'viral_base' -State 'failed' -ExitCode $importExitCode -Message 'A Base Viral nao atingiu 50/50; consulte o relatorio sanitizado.'
    exit $importExitCode
  }

  $env:TARGET_PRESET_NAME = $PresetName
  $env:TARGET_LANGUAGE = 'pt-BR'
  $env:TARGET_NOTES = 'Prioridade visual absoluta. Modelar as estrategias do DNA sem copiar frases-fonte. Gancho forte, desenvolvimento com micro-revelacoes e payoff fiel ao video.'

  Write-JobStatus -Stage 'target_video' -State 'running'
  Add-JobLog 'Iniciando teste operacional no video 1-4.mp4 com Escritor e Avaliador.'
  $targetExitCode = Invoke-LoggedNodeScript -ScriptPath 'scripts/test-viral-preset-on-video-live.ts'
  if ($targetExitCode -ne 0) {
    Write-JobStatus -Stage 'target_video' -State 'failed' -ExitCode $targetExitCode -Message 'O teste operacional nao passou em todos os gates; consulte o relatorio sanitizado.'
    exit $targetExitCode
  }

  Write-JobStatus -Stage 'complete' -State 'completed'
  Add-JobLog 'Base Viral e teste operacional concluidos com aprovacao.'
  exit 0
}
catch {
  $safeMessage = [string]$_.Exception.Message
  if ($env:SUPABASE_SERVICE_ROLE_KEY) {
    $safeMessage = $safeMessage.Replace($env:SUPABASE_SERVICE_ROLE_KEY, '[REDACTED]')
  }
  Write-JobStatus -Stage 'runner' -State 'failed' -ExitCode 1 -Message $safeMessage
  Add-JobLog ("Falha do runner: {0}" -f $safeMessage)
  exit 1
}
finally {
  Remove-Item Env:SUPABASE_SERVICE_ROLE_KEY -ErrorAction SilentlyContinue
  Remove-Item Env:SUPABASE_PROJECT_REF -ErrorAction SilentlyContinue
  Remove-Item Env:TARGET_NOTES -ErrorAction SilentlyContinue
}
