@echo off
setlocal
powershell.exe -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File "%~dp0Stop-Game.ps1"
exit /b %ERRORLEVEL%
