param(
  [string]$InstallDir = "C:\cctv-server",
  [string]$ERPUrl,
  [string]$GatewayKey,
  [string]$RelayHost = "stream.pagka.dev",
  [int]$RelayPort = 8554,
  [string]$FfmpegPath,
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

function Require-Command([string]$Name) {
  $command = Get-Command $Name -ErrorAction SilentlyContinue
  if (-not $command) {
    throw "Required command '$Name' was not found."
  }
  return $command.Source
}

function Set-EnvValue {
  param(
    [string]$Path,
    [string]$Key,
    [string]$Value
  )

  if ([string]::IsNullOrWhiteSpace($Value)) {
    return
  }

  $escapedKey = [Regex]::Escape($Key)
  $line = "$Key=$Value"
  if (Select-String -Path $Path -Pattern "^$escapedKey=" -Quiet) {
    $content = Get-Content $Path
    $content = $content | ForEach-Object {
      if ($_ -match "^$escapedKey=") { $line } else { $_ }
    }
    Set-Content -Path $Path -Value $content
  } else {
    Add-Content -Path $Path -Value $line
  }
}

function Ensure-Service {
  param(
    [string]$Nssm,
    [string]$Name,
    [string]$Application,
    [string]$AppDirectory,
    [string]$StdoutLog,
    [string]$StderrLog
  )

  $exists = Get-Service -Name $Name -ErrorAction SilentlyContinue
  if (-not $exists) {
    & $Nssm install $Name $Application | Out-Null
  } else {
    & $Nssm stop $Name | Out-Null
  }

  & $Nssm set $Name AppDirectory $AppDirectory | Out-Null
  & $Nssm set $Name AppStdout $StdoutLog | Out-Null
  & $Nssm set $Name AppStderr $StderrLog | Out-Null
  & $Nssm set $Name Start SERVICE_AUTO_START | Out-Null
  & $Nssm start $Name | Out-Null
}

Assert-Admin

$resolvedInstallDir = (Resolve-Path $InstallDir).Path
$nssm = Join-Path $resolvedInstallDir "nssm.exe"
$envExample = Join-Path $resolvedInstallDir ".env.example"
$envFile = Join-Path $resolvedInstallDir ".env"
$gatewayRunner = Join-Path $resolvedInstallDir "run-gateway.cmd"
$mediamtxRunner = Join-Path $resolvedInstallDir "run-mediamtx.cmd"

if (-not (Test-Path $nssm)) {
  throw "nssm.exe was not found in $resolvedInstallDir."
}

Require-Command "node" | Out-Null
Require-Command "pnpm" | Out-Null
Require-Command "tailscale" | Out-Null

if (-not (Test-Path $envFile)) {
  Copy-Item $envExample $envFile
}

Set-EnvValue -Path $envFile -Key "ERP_URL" -Value $ERPUrl
Set-EnvValue -Path $envFile -Key "GATEWAY_KEY" -Value $GatewayKey
Set-EnvValue -Path $envFile -Key "RELAY_HOST" -Value $RelayHost
Set-EnvValue -Path $envFile -Key "RELAY_PORT" -Value ([string]$RelayPort)
Set-EnvValue -Path $envFile -Key "FFMPEG_PATH" -Value $FfmpegPath

$envValues = @{}
foreach ($line in Get-Content $envFile) {
  if ($line -match "^\s*#" -or $line -notmatch "=") {
    continue
  }
  $parts = $line -split "=", 2
  $envValues[$parts[0]] = $parts[1]
}

if (-not $envValues["ERP_URL"] -or -not $envValues["GATEWAY_KEY"]) {
  throw "Set ERP_URL and GATEWAY_KEY in .env before installing services."
}

if ($envValues["FFMPEG_PATH"]) {
  if (-not (Test-Path $envValues["FFMPEG_PATH"])) {
    throw "FFMPEG_PATH does not exist: $($envValues["FFMPEG_PATH"])"
  }
} elseif (-not (Get-Command ffmpeg -ErrorAction SilentlyContinue)) {
  throw "ffmpeg.exe was not found on PATH. Set FFMPEG_PATH in .env or install FFmpeg."
}

Push-Location $resolvedInstallDir
try {
  & pnpm install
} finally {
  Pop-Location
}

Ensure-Service -Nssm $nssm -Name $GatewayServiceName -Application $gatewayRunner -AppDirectory $resolvedInstallDir -StdoutLog (Join-Path $resolvedInstallDir "gateway-service.log") -StderrLog (Join-Path $resolvedInstallDir "gateway-service.err.log")
Ensure-Service -Nssm $nssm -Name $MediaMtxServiceName -Application $mediamtxRunner -AppDirectory $resolvedInstallDir -StdoutLog (Join-Path $resolvedInstallDir "mediamtx-service.log") -StderrLog (Join-Path $resolvedInstallDir "mediamtx-service.err.log")

$tailscaleIp = try { (& tailscale ip -4)[0] } catch { "Unavailable" }

Write-Host ""
Write-Host "Installed services:" -ForegroundColor Green
Write-Host " - $GatewayServiceName"
Write-Host " - $MediaMtxServiceName"
Write-Host ""
Write-Host "Tailscale IPv4: $tailscaleIp"
Write-Host "Gateway health: http://127.0.0.1:8888/health"
Write-Host "MediaMTX local player: http://127.0.0.1:8889/"
Write-Host ""
Write-Host "If needed, edit $envFile and rerun this script."
