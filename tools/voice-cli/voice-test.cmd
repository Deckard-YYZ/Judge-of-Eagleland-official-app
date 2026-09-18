@echo off
setlocal
if "%~1"=="" (
  echo For microphone recording, open voice-record.cmd.
  echo.
  "%~dp0voice-test.exe" --help
  pause
  exit /b 0
)
"%~dp0voice-test.exe" --model-dir "%~dp0model" %*
exit /b %errorlevel%
