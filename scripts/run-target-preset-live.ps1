<#!
.SYNOPSIS
  Runs the live operational-video + shared DNA preset test without putting a
  Supabase secret in the shell history or in the report.

.DESCRIPTION
  The Supabase CLI must already be logged in on this machine. The script gets
  the current service key at runtime, uses it only in this child process, and
  invokes the resumable end-to-end test. It never writes the key to disk.
#>
[CmdletBinding()]
param(
  [string]$TargetVideoPath,
  [switch]$NoReset,
  [string]$ProjectRef = $env:SUPABASE_PROJECT_REF,
  [string]$TargetUserEmail = $env:TARGET_USER_EMAIL
)

$ErrorActionPreference = "Stop"
$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
Set-Location $repoRoot
if (-not $TargetVideoPath) {
  $TargetVideoPath = Join-Path $repoRoot ".runtime\\target-preflight\\sample.mp4"
}
if ([string]::IsNullOrWhiteSpace($ProjectRef)) {
  throw "Defina SUPABASE_PROJECT_REF ou passe -ProjectRef."
}
if ([string]::IsNullOrWhiteSpace($TargetUserEmail)) {
  throw "Defina TARGET_USER_EMAIL ou passe -TargetUserEmail com um usuário existente."
}

try {
  $rawKeys = & npx supabase projects api-keys --project-ref $ProjectRef --reveal --output json 2>$null
  if ($LASTEXITCODE -ne 0) { throw "NÃ£o foi possÃ­vel obter a chave de serviÃ§o do projeto atual." }
  $keys = $rawKeys | ConvertFrom-Json
  $serviceKey = @($keys | Where-Object { $_.id -eq "service_role" } | Select-Object -First 1).api_key
  if (-not $serviceKey) {
    $serviceKey = @($keys | Where-Object {
      $_.type -eq "secret" -and $_.secret_jwt_template.role -eq "service_role"
    } | Select-Object -First 1).api_key
  }
  if (-not $serviceKey) { throw "A chave service_role nÃ£o foi encontrada." }

  $env:SUPABASE_URL = "https://$ProjectRef.supabase.co"
  $env:SUPABASE_PROJECT_REF = $ProjectRef
  $env:SUPABASE_SERVICE_ROLE_KEY = $serviceKey
  $env:TARGET_VIDEO_PATH = (Resolve-Path $TargetVideoPath).Path
  $env:TARGET_USER_EMAIL = $TargetUserEmail
  if ($NoReset) { Remove-Item Env:RESET_RUN -ErrorAction SilentlyContinue }
  else { $env:RESET_RUN = "1" }

  # `vite-node --script` can let the Windows process exit while the first
  # Supabase fetch is still pending. The normal CLI entry keeps the async
  # pipeline alive through upload, analysis, assembly, validation and promote.
  & npx vite-node .\scripts\test-viral-preset-on-video-live.ts
  exit $LASTEXITCODE
} finally {
  Remove-Item Env:SUPABASE_SERVICE_ROLE_KEY -ErrorAction SilentlyContinue
  Remove-Item Env:SUPABASE_PROJECT_REF -ErrorAction SilentlyContinue
  Remove-Item Env:SUPABASE_URL -ErrorAction SilentlyContinue
}
