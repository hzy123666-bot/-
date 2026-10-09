@echo off
chcp 65001 >nul
cd /d %~dp0
echo ============================================
echo   《跳转之外》本地服务器启动中...
echo   直接双击 index.html 会导致图片广告黑屏
echo ============================================
where python >nul 2>nul
if %errorlevel%==0 (
  start "" http://localhost:8765/index.html
  python -m http.server 8765
  goto :end
)
where py >nul 2>nul
if %errorlevel%==0 (
  start "" http://localhost:8765/index.html
  py -m http.server 8765
  goto :end
)
echo 未找到 Python。请安装 Python，或用 VS Code 的 Live Server 打开本目录。
pause
:end
