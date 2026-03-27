@echo off
setlocal
call "%~dp0load-env.cmd"
cd /d "%~dp0"
node "%~dp0server.js"
