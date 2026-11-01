@echo off
REM Starts the Sentinel AC backend (Windows). Run setup steps from docs\INSTALL.md first.
cd /d "%~dp0"
node src\index.js
pause
