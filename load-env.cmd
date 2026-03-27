@echo off
set "ENV_FILE=%~dp0.env"
if not exist "%ENV_FILE%" exit /b 0

for /f "usebackq tokens=1,* delims==" %%A in (`findstr /v /r "^[ ]*#" "%ENV_FILE%"`) do (
  if not "%%A"=="" set "%%A=%%B"
)

exit /b 0
