param(
  [string]$InstallDir = "C:\cctv-server",
  [string]$FfmpegPath
)

$ErrorActionPreference = "Stop"

$resolvedInstallDir = (Resolve-Path $InstallDir).Path
$envFile = Join-Path $resolvedInstallDir ".env"

if (-not $FfmpegPath -and (Test-Path $envFile)) {
  foreach ($line in Get-Content $envFile) {
    if ($line -match "^\s*#" -or $line -notmatch "=") {
      continue
    }
    $parts = $line -split "=", 2
    if ($parts[0] -eq "FFMPEG_PATH" -and -not [string]::IsNullOrWhiteSpace($parts[1])) {
      $FfmpegPath = $parts[1]
      break
    }
  }
}

if (-not $FfmpegPath) {
  $command = Get-Command ffmpeg -ErrorAction SilentlyContinue
  if ($command) {
    $FfmpegPath = $command.Source
  }
}

if (-not $FfmpegPath) {
  throw "ffmpeg.exe was not found. Install FFmpeg, add it to PATH, or set FFMPEG_PATH."
}

if (-not (Test-Path $FfmpegPath)) {
  throw "Configured ffmpeg path does not exist: $FfmpegPath"
}

$encoderOutput = & $FfmpegPath -hide_banner -encoders 2>&1 | Out-String

$checks = @(
  @{ Name = "libx264"; Pattern = "libx264" },
  @{ Name = "aac"; Pattern = " aac\s" },
  @{ Name = "libopus"; Pattern = "libopus" }
)

$missing = @()
foreach ($check in $checks) {
  if ($encoderOutput -notmatch $check.Pattern) {
    $missing += $check.Name
  }
}

Write-Host "FFmpeg path: $FfmpegPath"
Write-Host ""

if ($missing.Count -gt 0) {
  Write-Host "Compatibility check failed." -ForegroundColor Red
  Write-Host ("Missing encoders: {0}" -f ($missing -join ", "))
  exit 1
}

Write-Host "Compatibility check passed." -ForegroundColor Green
Write-Host "Available encoders: libx264, aac, libopus"
