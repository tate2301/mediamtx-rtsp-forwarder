@echo off
setlocal

set LOGFILE=C:\cctv-server\forward-to-relay.log
echo ================================================== >> "%LOGFILE%"
echo [%date% %time%] START >> "%LOGFILE%"
echo MTX_PATH=%MTX_PATH% >> "%LOGFILE%"
echo RTSP_PORT=%RTSP_PORT% >> "%LOGFILE%"

set FFMPEG=C:\Users\Atipamara\AppData\Local\Microsoft\WinGet\Packages\Gyan.FFmpeg_Microsoft.Winget.Source_8wekyb3d8bbwe\ffmpeg-8.0.1-full_build\bin\ffmpeg.exe
set RELAY_HOST=stream.pagka.dev
set RELAY_PORT=8554

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
