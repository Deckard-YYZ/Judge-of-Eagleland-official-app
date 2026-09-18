@echo off
setlocal
"%~dp0asr-test.exe" --model-dir "%~dp0model" %*
exit /b %errorlevel%
