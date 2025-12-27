#!/bin/bash

echo "========================================"
echo "  Yishe Videos - Docker 启动脚本"
echo "========================================"
echo ""

echo "[1/3] 检查 Docker 是否安装..."
if ! command -v docker &> /dev/null; then
    echo "[错误] Docker 未安装！"
    echo "请先安装 Docker: https://www.docker.com/products/docker-desktop/"
    exit 1
fi
echo "[成功] Docker 已安装"
echo ""

echo "[2/3] 构建 Docker 镜像..."
docker-compose build
if [ $? -ne 0 ]; then
    echo "[错误] 镜像构建失败！"
    exit 1
fi
echo "[成功] 镜像构建完成"
echo ""

echo "[3/3] 启动容器..."
docker-compose up -d
if [ $? -ne 0 ]; then
    echo "[错误] 容器启动失败！"
    exit 1
fi
echo "[成功] 容器已启动"
echo ""

echo "========================================"
echo "  服务已启动！"
echo "  访问地址: http://localhost:1571"
echo "========================================"
echo ""
echo "常用命令:"
echo "  查看日志: docker-compose logs -f"
echo "  停止服务: docker-compose down"
echo "  重启服务: docker-compose restart"
echo ""

