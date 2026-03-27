param(
  [string]$InstallDir = "C:\cctv-server",
  [string]$GatewayServiceName = "HuchuCCTVGateway",
  [string]$MediaMtxServiceName = "HuchuCCTVMediaMTX"
)

$ErrorActionPreference = "Stop"

function Assert-Admin {
  $identity = [Security.Principal.WindowsIdentity]::GetCurrent()
  $principal = New-Object Security.Principal.WindowsPrincipal($identity)
  if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
    throw "Run this script from an elevated PowerShell window."
  }
}

Assert-Admin

$resolvedInstallDir = (Resolve-Path $InstallDir).Path
$nssm = Join-Path $resolvedInstallDir "nssm.exe"

if (-not (Test-Path $nssm)) {
  throw "nssm.exe was not found in $resolvedInstallDir."
}

foreach ($serviceName in @($MediaMtxServiceName, $GatewayServiceName)) {
  $service = Get-Service -Name $serviceName -ErrorAction SilentlyContinue
  if (-not $service) {
    Write-Warning "Service '$serviceName' was not found."
    continue
  }

  Write-Host "Restarting $serviceName..."
  & $nssm restart $serviceName | Out-Null
  Start-Sleep -Seconds 2

  $service.Refresh()
  Write-Host (" - Status: {0}" -f $service.Status)
}

Write-Host ""
Write-Host "Gateway health check:" -ForegroundColor Green
try {
  $health = Invoke-WebRequest -UseBasicParsing -Uri "http://127.0.0.1:8888/health" -TimeoutSec 10
  Write-Host $health.Content
} catch {
  Write-Warning ("Gateway health check failed: {0}" -f $_.Exception.Message)
}
