@echo off
echo ========================================
echo   Yishe Videos - Docker 启动脚本
echo ========================================
echo.

echo [1/3] 检查 Docker 是否安装...
docker --version >nul 2>&1
if errorlevel 1 (
    echo [错误] Docker 未安装！
    echo 请先安装 Docker Desktop: https://www.docker.com/products/docker-desktop/
    pause
    exit /b 1
)
echo [成功] Docker 已安装
echo.

echo [2/3] 构建 Docker 镜像...
docker-compose build
if errorlevel 1 (
    echo [错误] 镜像构建失败！
    pause
    exit /b 1
)
echo [成功] 镜像构建完成
echo.

echo [3/3] 启动容器...
docker-compose up -d
if errorlevel 1 (
    echo [错误] 容器启动失败！
    pause
    exit /b 1
)
echo [成功] 容器已启动
echo.

echo ========================================
echo   服务已启动！
echo   访问地址: http://localhost:1571
echo ========================================
echo.
echo 常用命令:
echo   查看日志: docker-compose logs -f
echo   停止服务: docker-compose down
echo   重启服务: docker-compose restart
echo.
pause

