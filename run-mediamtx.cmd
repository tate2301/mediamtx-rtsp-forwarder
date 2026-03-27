@echo off
setlocal
call "%~dp0load-env.cmd"
cd /d "%~dp0"
"%~dp0mediamtx.exe" "%~dp0mediamtx.yml"
