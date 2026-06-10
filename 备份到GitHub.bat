@echo off
chcp 65001 >nul
cd /d d:\photo-album-maker
echo ============================================
echo   相册制作工具 - 备份到 GitHub
echo ============================================
echo.
set /p msg="请输入这次改了什么（例如：修复拖拽问题）: "
echo.
echo 正在提交...
git add .
git commit -m "%msg%"
echo.
echo 正在推送到 GitHub...
git push origin main
echo.
echo 完成！按任意键关闭...
pause >nul
