@echo off
chcp 65001 >nul
echo.
echo   ╔══════════════════════════════════╗
echo   ║    📸 成长相册排版软件          ║
echo   ║    Pet Growth Album Maker       ║
echo   ╚══════════════════════════════════╝
echo.
echo   正在启动服务器...
echo.

cd /d "%~dp0"
echo   启动后请在浏览器访问: http://localhost:3458
echo.
node server.js

pause
