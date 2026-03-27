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
if not defined RELAY_VIDEO_PRESET set "RELAY_VIDEO_PRESET=veryfast"
if not defined RELAY_VIDEO_BITRATE set "RELAY_VIDEO_BITRATE=1800k"
if not defined RELAY_MAX_RATE set "RELAY_MAX_RATE=2200k"
if not defined RELAY_BUFFER_SIZE set "RELAY_BUFFER_SIZE=3600k"
if not defined RELAY_GOP set "RELAY_GOP=50"
if not defined RELAY_AUDIO_BITRATE set "RELAY_AUDIO_BITRATE=128k"

echo Input URL: rtsp://127.0.0.1:%RTSP_PORT%/%MTX_PATH% >> "%LOGFILE%"
echo Output URL: rtsp://%RELAY_HOST%:%RELAY_PORT%/%MTX_PATH% >> "%LOGFILE%"
echo FFMPEG=%FFMPEG% >> "%LOGFILE%"
echo RELAY_VIDEO_PRESET=%RELAY_VIDEO_PRESET% >> "%LOGFILE%"
echo RELAY_VIDEO_BITRATE=%RELAY_VIDEO_BITRATE% >> "%LOGFILE%"
echo RELAY_MAX_RATE=%RELAY_MAX_RATE% >> "%LOGFILE%"
echo RELAY_BUFFER_SIZE=%RELAY_BUFFER_SIZE% >> "%LOGFILE%"
echo RELAY_GOP=%RELAY_GOP% >> "%LOGFILE%"
echo RELAY_AUDIO_BITRATE=%RELAY_AUDIO_BITRATE% >> "%LOGFILE%"

(
"%FFMPEG%" -loglevel debug ^
-rtsp_transport tcp ^
-i "rtsp://127.0.0.1:%RTSP_PORT%/%MTX_PATH%" ^
-map 0:v:0 ^
-map 0:a:0? ^
-c:v libx264 ^
-preset %RELAY_VIDEO_PRESET% ^
-tune zerolatency ^
-pix_fmt yuv420p ^
-profile:v main ^
-level:v 4.0 ^
-b:v %RELAY_VIDEO_BITRATE% ^
-maxrate %RELAY_MAX_RATE% ^
-bufsize %RELAY_BUFFER_SIZE% ^
-g %RELAY_GOP% ^
-keyint_min %RELAY_GOP% ^
-sc_threshold 0 ^
-c:a aac ^
-b:a %RELAY_AUDIO_BITRATE% ^
-ac 2 ^
-f rtsp ^
-rtsp_transport tcp ^
"rtsp://%RELAY_HOST%:%RELAY_PORT%/%MTX_PATH%"
) >> "%LOGFILE%" 2>&1

echo [%date% %time%] END code=%ERRORLEVEL% >> "%LOGFILE%"
