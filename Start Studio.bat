@echo off
rem Double-click to start spaghettiCode Studio, then it opens in your browser.
cd /d "%~dp0"
where node >nul 2>nul || (echo Node.js is not installed. Run: winget install OpenJS.NodeJS.LTS & pause & exit /b 1)
tasklist /fi "imagename eq ollama.exe" | find /i "ollama.exe" >nul || start "" /b ollama serve
netstat -ano | find ":5757" | find "LISTENING" >nul || start "spaghettiCode Studio" /min node app\server.mjs
timeout /t 2 /nobreak >nul
start "" http://localhost:5757
