@echo off
setlocal
call "%~dp0voice-record.cmd" -SaluteNear %*
exit /b %errorlevel%
