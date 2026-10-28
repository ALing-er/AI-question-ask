@echo off
setlocal
cd /d "%~dp0"
title AI-QA Launcher

powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0start.ps1"

echo.
echo Press any key to close this window.
pause >nul
