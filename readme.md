# FFmpeg 视频处理服务

全面的视频处理 Web UI，支持视频分析、格式转换、调整大小、裁剪、提取帧、提取音频、添加水印、图片转视频等多种功能。

## ✨ 功能特性

- 📊 **视频分析**：获取视频详细信息（格式、时长、分辨率、编码等）
- 🔧 **视频处理**：格式转换、调整大小、裁剪
- 🖼️ **提取帧**：从视频中提取截图
- 🎵 **提取音频**：从视频中提取音频文件
- 💧 **水印**：在视频上添加图片水印
- 🎬 **图片转视频**：将图片转换为视频
- 🐳 **Docker 支持**：一键部署，无需安装依赖

## 🚀 快速开始

### 方式一：本地安装

**需要先安装 Node.js 和 FFmpeg**

1. **安装依赖**
   ```bash
   npm install
   ```

2. **安装 FFmpeg**
   - Windows: [下载安装包](https://ffmpeg.org/download.html) 或使用 `choco install ffmpeg`
   - Mac: `brew install ffmpeg`
   - Linux: `sudo apt-get install ffmpeg`

3. **启动服务**
   ```bash
   npm start
   ```

4. **访问服务**
   - 打开浏览器：http://localhost:1571

## 📖 使用文档

- [API 文档](http://localhost:1571/api-docs) - Swagger API 文档（启动服务后访问）

## 🛠️ 技术栈

- **后端**: Node.js + Express
- **前端**: Vue 3 + Semantic UI
- **视频处理**: FFmpeg
- **API 文档**: Swagger

## 📁 项目结构

```
yishe-videos/
├── lib/                 # 核心库
│   └── ffmpeg.js       # FFmpeg 封装
├── public/             # 前端文件
│   ├── index.html      # 主页面
│   ├── app.js          # Vue 应用
│   └── lib/            # 前端库（本地化）
├── uploads/            # 上传文件目录
├── output/             # 输出文件目录
├── template/           # 临时文件目录
├── server.js           # 服务器入口
├── swagger.js          # Swagger 配置
└── package.json        # Node.js 依赖
```

## 🔧 配置

### 环境变量

- `PORT`: 服务端口（默认: 1571）
- `NODE_ENV`: 运行环境（production/development）
- `FFMPEG_PATH`: FFmpeg 可执行文件路径（可选，如果 FFmpeg 不在 PATH 中）

### 端口配置

默认端口是 `1571`，可以在以下位置修改：

- **环境变量**: `PORT=1571 npm start`
- **代码**: 修改 `server.js` 中的 `PORT` 变量

## 📝 API 端点

- `GET /api/health` - 健康检查
- `GET /api/ffmpeg-status` - FFmpeg 状态
- `POST /api/compose` - 合成视频（**支持远程资源自动下载**）
- `POST /api/info` - 获取视频信息
- `POST /api/process` - 链式视频处理
- `GET /api/files/list` - 获取文件列表
- `DELETE /api/files/delete` - 删除文件

完整 API 文档：http://localhost:1571/api-docs

## 🌐 远程资源支持

`yishe-videos` 服务完全支持远程资源（HTTP/HTTPS 链接），无需预先上传文件。

### 使用远程资源

在调用 `/api/compose` 接口时，可以直接使用 `url` 参数提供远程资源链接：

```json
{
  "resources": [
    {
      "type": "image",
      "url": "https://example.com/image.jpg",
      "duration": 3,
      "transition": "fade"
    },
    {
      "type": "audio",
      "url": "https://example.com/audio.mp3",
      "volume": 100
    }
  ],
  "options": {
    "width": 720,
    "height": 720,
    "fps": 30
  }
}
```

### 自动处理功能

当使用远程资源时，系统会自动：

1. **自动下载**：从远程 URL 下载资源到本地临时目录
2. **格式识别**：自动识别文件类型（图片/视频/音频）和格式
3. **图片优化**：如果图片超过 2560x2560 像素，自动缩放以优化性能
4. **自动清理**：处理完成后自动删除临时文件，节省存储空间
5. **错误处理**：如果下载失败，返回清晰的错误信息

### 支持的资源类型

- **图片**：JPG, PNG, GIF, WebP, BMP
- **视频**：MP4, AVI, MOV, WebM, MKV
- **音频**：MP3, WAV, AAC, OGG

### 注意事项

- 远程资源必须通过 HTTP 或 HTTPS 协议访问
- 支持重定向（最多 5 次）
- 下载超时时间为 60 秒
- HTTPS 链接支持自签名证书（开发环境）
- 图片会自动缩放，但保持原始宽高比

## 🎯 支持的操作类型

### 格式转换 (convert)
- 支持格式：MP4, AVI, MOV, WEBM 等
- 可设置视频编码器、音频编码器、质量等

### 调整大小 (resize)
- 设置目标宽度和高度
- 支持保持宽高比

### 裁剪 (crop)
- 指定裁剪区域的坐标和尺寸
- 可设置开始时间和持续时间

### 提取帧 (extractFrame)
- 从视频指定时间点提取截图
- 支持设置截图尺寸

### 提取音频 (extractAudio)
- 从视频中提取音频
- 支持多种音频格式（MP3, WAV, AAC 等）

### 添加水印 (addWatermark)
- 在视频上添加图片水印
- 支持设置位置、大小、透明度

### 图片转视频 (imageToVideo)
- 将图片转换为视频
- 可设置时长、帧率、分辨率

## 📄 许可证

MIT

## 🤝 贡献

欢迎提交 Issue 和 Pull Request！
