param(
  [string]$InstallDir = "C:\cctv-server",
  [string]$GatewayServiceName = "HuchuCCTVGateway",
  [string]$MediaMtxServiceName = "HuchuCCTVMediaMTX"
)

$ErrorActionPreference = "Stop"
$nssm = Join-Path (Resolve-Path $InstallDir).Path "nssm.exe"

foreach ($serviceName in @($GatewayServiceName, $MediaMtxServiceName)) {
  if (Get-Service -Name $serviceName -ErrorAction SilentlyContinue) {
    & $nssm stop $serviceName | Out-Null
    & $nssm remove $serviceName confirm | Out-Null
    Write-Host "Removed $serviceName"
  }
}
