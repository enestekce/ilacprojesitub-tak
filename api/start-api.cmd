@echo off
cd /d "%~dp0"
npm install --no-audit --no-fund
npx playwright install chromium
npm start
pause

