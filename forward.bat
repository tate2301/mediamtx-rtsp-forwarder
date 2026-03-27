@echo off
setlocal
call "%~dp0load-env.cmd"

set LOGFILE=C:\cctv-server\forward-to-relay.log
echo ================================================== >> "%LOGFILE%"
echo [%date% %time%] START >> "%LOGFILE%"
echo MTX_PATH=%MTX_PATH% >> "%LOGFILE%"
echo RTSP_PORT=%RTSP_PORT% >> "%LOGFILE%"

if defined FFMPEG_PATH (
  set "FFMPEG=%FFMPEG_PATH%"
) else (
  set "FFMPEG="
  for /f "delims=" %%I in ('where ffmpeg 2^>nul') do (
    if not defined FFMPEG set "FFMPEG=%%I"
  )
  if not defined FFMPEG set "FFMPEG=ffmpeg"
)

if not defined RELAY_HOST set "RELAY_HOST=stream.pagka.dev"
if not defined RELAY_PORT set "RELAY_PORT=8554"

echo Input URL: rtsp://127.0.0.1:%RTSP_PORT%/%MTX_PATH% >> "%LOGFILE%"
echo Output URL: rtsp://%RELAY_HOST%:%RELAY_PORT%/%MTX_PATH% >> "%LOGFILE%"
echo FFMPEG=%FFMPEG% >> "%LOGFILE%"

(
"%FFMPEG%" -loglevel debug ^
-rtsp_transport tcp ^
-i "rtsp://127.0.0.1:%RTSP_PORT%/%MTX_PATH%" ^
-c copy ^
-f rtsp ^
-rtsp_transport tcp ^
"rtsp://%RELAY_HOST%:%RELAY_PORT%/%MTX_PATH%"
) >> "%LOGFILE%" 2>&1

echo [%date% %time%] END code=%ERRORLEVEL% >> "%LOGFILE%"
