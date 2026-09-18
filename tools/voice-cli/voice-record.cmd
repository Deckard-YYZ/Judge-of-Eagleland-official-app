@echo off
setlocal
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0voice-record.ps1" %*
set "recordExit=%errorlevel%"
pause
exit /b %recordExit%
