@echo off
cd /d "%~dp0"
npm install --no-audit --no-fund
npm start
pause

