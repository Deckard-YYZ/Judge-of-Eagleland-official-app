@echo off
setlocal
call "%~dp0voice-record.cmd" -Segment %*
exit /b %errorlevel%
