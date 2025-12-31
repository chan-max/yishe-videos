const express = require('express');
const path = require('path');
const fs = require('fs');
const https = require('https');
const http = require('http');
const { URL } = require('url');
const cors = require('cors');
const bodyParser = require('body-parser');
const swaggerUi = require('swagger-ui-express');
const swaggerSpec = require('./swagger');
const ffmpeg = require('./lib/ffmpeg');

// 尝试加载 sharp（如果已安装）
let sharp = null;
try {
  sharp = require('sharp');
} catch (e) {
  console.warn('[图片处理] sharp 未安装，图片缩放功能将不可用，请运行 npm install sharp 安装');
}

// 图片尺寸限制（避免超大图片导致内存问题）
const MAX_IMAGE_WIDTH = 2560;
const MAX_IMAGE_HEIGHT = 2560;

const app = express();
const PORT = process.env.PORT || 1571;

// 中间件
app.use(cors());
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));
app.use(express.static('public'));

// Swagger 文档
app.use('/api-docs', swaggerUi.serve, swaggerUi.setup(swaggerSpec, {
  customCss: '.swagger-ui .topbar { display: none }',
  customSiteTitle: 'FFmpeg API 文档'
}));

// 确保必要的目录存在
const uploadsDir = path.join(__dirname, 'uploads');
const outputDir = path.join(__dirname, 'output');
const templateDir = path.join(__dirname, 'template');
[uploadsDir, outputDir, templateDir].forEach(dir => {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
});

// multer 配置已移除（不再需要文件上传功能）
// 所有接口现在都支持直接使用远程资源（url 参数），无需预先上传

/**
 * 下载网络资源到 uploads 目录（支持 HTTPS）
 */
async function downloadFromUrl(url) {
  return new Promise((resolve, reject) => {
    try {
      const urlObj = new URL(url);
      const protocol = urlObj.protocol === 'https:' ? https : http;
      
      const options = {
        timeout: 60000, // 60秒超时
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        },
      };

      // HTTPS 选项：忽略证书错误（用于开发环境）
      if (urlObj.protocol === 'https:') {
        options.rejectUnauthorized = false; // 允许自签名证书
      }
      
      const request = protocol.get(url, options, (response) => {
        // 处理重定向
        if (response.statusCode >= 300 && response.statusCode < 400 && response.headers.location) {
          return downloadFromUrl(response.headers.location).then(resolve).catch(reject);
        }
        
        if (response.statusCode !== 200) {
          reject(new Error(`下载失败: HTTP ${response.statusCode}`));
          return;
        }
        
        let ext = path.extname(urlObj.pathname).split('?')[0]; // 移除查询参数
        const contentType = response.headers['content-type'];
        
        if (!ext || ext === '') {
          const mimeToExt = {
            'video/mp4': '.mp4',
            'video/avi': '.avi',
            'video/quicktime': '.mov',
            'video/x-msvideo': '.avi',
            'video/webm': '.webm',
            'image/jpeg': '.jpg',
            'image/jpg': '.jpg',
            'image/png': '.png',
            'image/gif': '.gif',
            'image/webp': '.webp',
            'image/bmp': '.bmp',
            'audio/mpeg': '.mp3',
            'audio/mp3': '.mp3',
            'audio/wav': '.wav',
            'audio/aac': '.aac',
            'audio/ogg': '.ogg',
          };
          const contentTypeBase = contentType ? contentType.split(';')[0].trim() : '';
          ext = mimeToExt[contentTypeBase] || mimeToExt[contentType] || '.jpg';
        }
        
        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
        const filename = `downloaded_${uniqueSuffix}${ext}`;
        const filePath = path.join(uploadsDir, filename); // 直接保存到 uploads 目录
        
        const fileStream = fs.createWriteStream(filePath);
        response.pipe(fileStream);
        
        fileStream.on('finish', async () => {
          fileStream.close();
          
          // 如果是图片，检查并调整尺寸（使用 sharp）
          const isImage = /\.(jpg|jpeg|png|gif|webp|bmp)$/i.test(ext);
          if (isImage && sharp) {
            try {
              const image = sharp(filePath);
              const metadata = await image.metadata();
              
              // 如果图片尺寸超过限制，进行缩放
              if (metadata.width && metadata.height && 
                  (metadata.width > MAX_IMAGE_WIDTH || metadata.height > MAX_IMAGE_HEIGHT)) {
                console.log(`[图片处理] 图片尺寸过大 (${metadata.width}x${metadata.height})，缩放到 ${MAX_IMAGE_WIDTH}x${MAX_IMAGE_HEIGHT}`);
                
                // 使用 sharp 缩放图片，保持比例
                await image
                  .resize(MAX_IMAGE_WIDTH, MAX_IMAGE_HEIGHT, {
                    fit: 'inside',
                    withoutEnlargement: true,
                  })
                  .jpeg({ quality: 90 }) // 转换为 JPEG 格式以减小文件大小
                  .toFile(filePath + '.resized');
                
                // 替换原文件
                fs.renameSync(filePath + '.resized', filePath);
                
                const newStats = fs.statSync(filePath);
                console.log(`[图片处理] 图片已缩放，新尺寸: ${newStats.size} bytes`);
              }
            } catch (resizeError) {
              console.warn(`[图片处理] 缩放图片失败，使用原图: ${resizeError.message}`);
              // 缩放失败不影响，继续使用原图
            }
          }
          
          const stats = fs.statSync(filePath);
          resolve({
            filename: filename,
            path: filePath,
            size: stats.size,
            originalUrl: url
          });
        });
        
        fileStream.on('error', (err) => {
          fs.unlink(filePath, () => {});
          reject(err);
        });
      });
      
      request.on('error', (err) => {
        reject(new Error(`下载失败: ${err.message}`));
      });
      
      request.on('timeout', () => {
        request.destroy();
        reject(new Error('下载超时'));
      });
      
  } catch (error) {
      reject(new Error(`无效的 URL: ${error.message}`));
  }
});
}

// /api/upload 接口已移除
// 现在所有接口都支持直接使用远程资源（url 参数），无需预先上传

/**
 * @swagger
 * /api/compose:
 *   post:
 *     summary: 合成视频（将多个资源合成为一个新视频，支持远程资源自动下载）
 *     description: |
 *       此接口支持两种资源提供方式：
 *       1. **远程资源（推荐）**：使用 `url` 参数提供 HTTP/HTTPS 链接，系统会自动下载并处理
 *       2. **本地资源**：使用 `filename` 参数提供已存在的本地文件名（不推荐，建议使用 url）
 *       
 *       远程资源会自动进行以下处理：
 *       - 自动下载远程图片/视频/音频文件
 *       - 自动识别文件类型和格式
 *       - 图片自动缩放（如果超过 2560x2560 像素）
 *       - 处理完成后自动清理临时文件
 *       
 *       示例请求：
 *       ```json
 *       {
 *         "resources": [
 *           {
 *             "type": "image",
 *             "url": "https://example.com/image.jpg",
 *             "duration": 3,
 *             "transition": "fade"
 *           },
 *           {
 *             "type": "audio",
 *             "url": "https://example.com/audio.mp3",
 *             "volume": 100
 *           }
 *         ],
 *         "options": {
 *           "width": 720,
 *           "height": 720,
 *           "fps": 30
 *         }
 *       }
 *       ```
 *     tags: [Process]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - resources
 *             properties:
 *               resources:
 *                 type: array
 *                 description: 资源数组，每个资源必须包含 type，以及 url（远程链接）或 filename（本地文件）之一
 *                 items:
 *                   type: object
 *                   required:
 *                     - type
 *                   properties:
 *                     type:
 *                       type: string
 *                       enum: [image, video, audio]
 *                       description: 资源类型（必填）- image（图片）、video（视频）、audio（音频）
 *                     url:
 *                       type: string
 *                       format: uri
 *                       description: |
 *                         远程资源 URL（推荐使用）
 *                         - 支持 HTTP 和 HTTPS 协议
 *                         - 系统会自动下载并处理
 *                         - 图片会自动缩放（如果超过限制）
 *                         - 无需预先上传文件
 *                         - 示例：https://example.com/image.jpg
 *                     filename:
 *                       type: string
 *                       description: |
 *                         本地文件名（可选，不推荐使用）
 *                         - 仅在没有提供 url 时使用
 *                         - 文件必须已存在于 uploads 目录中
 *                         - 推荐使用 url 参数直接提供远程资源
 *                         - 示例：downloaded_1234567890-123456789.jpg
 *                     duration:
 *                       type: number
 *                       description: 持续时间（秒），图片资源必填，视频/音频可选
 *                     transition:
 *                       type: string
 *                       enum: [none, fade, directional-left, directional-right]
 *                       default: none
 *                       description: 过渡效果（仅图片有效）
 *                     transitionDuration:
 *                       type: number
 *                       default: 0.5
 *                       description: 过渡持续时间（秒）
 *                     position:
 *                       type: string
 *                       default: center
 *                       description: 位置（center, top, bottom, left, right）
 *                     scaleMode:
 *                       type: string
 *                       enum: [fit, fill]
 *                       default: fit
 *                       description: 缩放模式（fit=适应，fill=填充）
 *                     startTime:
 *                       type: number
 *                       description: 开始时间（秒），视频/音频资源可选
 *                     volume:
 *                       type: number
 *                       default: 100
 *                       description: 音量（0-100），音频资源有效
 *               options:
 *                 type: object
 *                 description: 视频输出选项
 *                 properties:
 *                   width:
 *                     type: number
 *                     default: 1280
 *                     description: 视频宽度（像素）
 *                   height:
 *                     type: number
 *                     default: 720
 *                     description: 视频高度（像素）
 *                   resolution:
 *                     type: string
 *                     default: "1280x720"
 *                     description: 视频分辨率（格式：宽x高），如果提供了 width 和 height，则优先使用
 *                   fps:
 *                     type: number
 *                     default: 25
 *                     description: 帧率
 *                   videoCodec:
 *                     type: string
 *                     default: "libx264"
 *                     description: 视频编码器
 *                   audioCodec:
 *                     type: string
 *                     default: "aac"
 *                     description: 音频编码器
 *                   backgroundColor:
 *                     type: string
 *                     default: "#000000"
 *                     description: 背景颜色（十六进制格式）
 *     responses:
 *       200:
 *         description: 合成成功
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 outputFile:
 *                   type: string
 *                   description: 输出文件名
 *                   example: "composed_1234567890.mp4"
 *                 path:
 *                   type: string
 *                   description: 输出文件访问路径
 *                   example: "/output/composed_1234567890.mp4"
 *                 command:
 *                   type: string
 *                   description: 执行的 FFmpeg 命令
 *       400:
 *         description: 请求参数错误
 *       500:
 *         description: 服务器错误
 */
app.post('/api/compose', async (req, res) => {
  try {
    const { resources, options = {} } = req.body;
    
    console.log('[视频合成] 收到请求，resources:', JSON.stringify(resources, null, 2));
    
    if (!Array.isArray(resources) || resources.length === 0) {
      return res.status(400).json({ error: '资源列表不能为空' });
    }
    
    // 验证资源并构建路径（支持远程 URL，filename 为可选）
    const resourcePaths = [];
    const tempFiles = []; // 记录临时下载的文件，用于后续清理
    
    for (let i = 0; i < resources.length; i++) {
      const resource = resources[i];
      
      console.log(`[视频合成] 处理资源 ${i + 1}:`, JSON.stringify(resource));
      
      // 验证 type 字段
      if (!resource.type) {
        console.error(`[视频合成] 资源 ${i + 1} 缺少 type 字段`);
        return res.status(400).json({ error: `资源 ${i + 1} 必须包含 type 字段` });
      }
      
      if (!['image', 'video', 'audio'].includes(resource.type)) {
        return res.status(400).json({ error: `资源 ${i + 1} 不支持的资源类型: ${resource.type}`});
      }
      
      let filePath;
      let isTempFile = false;
      
      // 优先使用 url（远程链接），如果提供了 url 则自动下载
      if (resource.url) {
        try {
          // 验证 URL 格式
          try {
            new URL(resource.url);
          } catch (urlError) {
            return res.status(400).json({ error: `资源 ${i + 1} 的 URL 格式无效: ${resource.url}` });
          }
          
          console.log(`[视频合成] 开始下载远程资源 ${i + 1}: ${resource.url}`);
          const downloadResult = await downloadFromUrl(resource.url);
          
          // downloadFromUrl 已经将文件保存到 uploadsDir，直接使用返回的路径
          filePath = downloadResult.path;
          isTempFile = true; // 标记为临时文件，后续需要清理
          tempFiles.push(filePath);
          console.log(`[视频合成] 远程资源下载成功: ${resource.url} -> ${downloadResult.filename} (${(downloadResult.size / 1024).toFixed(2)} KB)`);
        } catch (downloadError) {
          console.error(`[视频合成] 下载远程资源失败 (资源 ${i + 1}):`, downloadError);
          const errorMessage = downloadError.message || '未知错误';
          return res.status(500).json({ 
            error: `资源 ${i + 1} 下载远程资源失败`,
            details: {
              url: resource.url,
              type: resource.type,
              message: errorMessage
            }
          });
        }
      } else if (resource.filename) {
        // 使用本地文件名（可选，如果没有 url 才需要）
        filePath = path.join(uploadsDir, resource.filename);
      if (!fs.existsSync(filePath)) {
          return res.status(404).json({ error: `资源 ${i + 1} 文件不存在: ${resource.filename}` });
        }
        console.log(`[视频合成] 使用本地文件: ${resource.filename}`);
      } else {
        // 既没有 url 也没有 filename，报错
        console.error(`[视频合成] 资源 ${i + 1} 既没有 url 也没有 filename`);
        return res.status(400).json({ error: `资源 ${i + 1} 必须提供 url（远程链接）或 filename（本地文件）` });
      }
      
      resourcePaths.push({
        type: resource.type,
        path: filePath,
        duration: resource.duration,
        startTime: resource.startTime,
        transition: resource.transition || 'none',
        transitionDuration: resource.transitionDuration || 0.5,
        position: resource.position || 'center',
        scaleMode: resource.scaleMode || 'fit',
        rotation: resource.rotation || 0,
        opacity: resource.opacity !== undefined ? resource.opacity : 100,
        fade: resource.fade || 'none',
        fadeDuration: resource.fadeDuration || 1,
        volume: resource.volume !== undefined ? resource.volume : 100
      });
    }
    
    // 生成输出文件名
    const outputFilename = `composed_${Date.now()}.mp4`;
    const outputPath = path.join(outputDir, outputFilename);
    
    // 调用合成方法
    // 处理分辨率：支持 width/height 或 resolution 格式
    let resolution = '1280x720';
    if (options.width && options.height) {
      resolution = `${options.width}x${options.height}`;
    } else if (options.resolution) {
      resolution = options.resolution;
    }
    
    const result = await ffmpeg.composeVideo(resourcePaths, outputPath, {
      resolution: resolution,
      width: options.width || 1280,
      height: options.height || 720,
      fps: options.fps || 25,
      videoCodec: options.videoCodec || 'libx264',
      videoPreset: options.videoPreset || 'medium',
      videoCrf: options.videoCrf !== undefined ? options.videoCrf : 23,
      videoBitrate: options.videoBitrate || '2000k',
      audioCodec: options.audioCodec || 'aac',
      audioBitrate: options.audioBitrate || '192k',
      audioSampleRate: options.audioSampleRate || 44100,
      audioChannels: options.audioChannels || 2,
      backgroundColor: options.backgroundColor || '#000000'
    });
    
    // 清理临时下载的文件
    tempFiles.forEach(tempFile => {
      try {
        if (fs.existsSync(tempFile)) {
          fs.unlinkSync(tempFile);
          console.log(`[视频合成] 已清理临时文件: ${tempFile}`);
        }
      } catch (cleanupError) {
        console.warn(`[视频合成] 清理临时文件失败: ${tempFile}`, cleanupError.message);
      }
    });
    
    res.json({
      success: true,
      outputFile: outputFilename,
      path: `/output/${outputFilename}`,
      command: result.command
    });
  } catch (error) {
    // 发生错误时也清理临时文件
    if (typeof tempFiles !== 'undefined' && Array.isArray(tempFiles)) {
      tempFiles.forEach(tempFile => {
        try {
          if (fs.existsSync(tempFile)) {
            fs.unlinkSync(tempFile);
          }
        } catch (cleanupError) {
          // 忽略清理错误
        }
      });
    }
    res.status(500).json({ error: error.message });
  }
});

/**
 * @swagger
 * /api/process:
 *   post:
 *     summary: 链式视频处理（统一接口）
 *     tags: [Process]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - filename
 *               - operations
 *             properties:
 *               filename:
 *                 type: string
 *               operations:
 *                 type: array
 *                 items:
 *                   type: object
 *                   required:
 *                     - type
 *                   properties:
 *                     type:
 *                       type: string
 *                       enum: [convert, resize, crop, extractFrame, extractAudio, addWatermark, imageToVideo]
 *                     params:
 *                       type: object
 *     responses:
 *       200:
 *         description: 处理成功
 */
app.post('/api/process', async (req, res) => {
  try {
    const { filename, operations } = req.body;
    
    if (!filename) {
      return res.status(400).json({ error: '缺少必要参数: filename' });
    }
    
    if (!Array.isArray(operations) || operations.length === 0) {
      return res.status(400).json({ error: 'operations 必须是非空数组' });
    }
    
    const inputPath = path.join(uploadsDir, filename);
    if (!fs.existsSync(inputPath)) {
      return res.status(404).json({ error: '文件不存在' });
    }
    
    let currentInputPath = inputPath;
    const commands = [];
    const tempFiles = [];
    
    try {
      for (let i = 0; i < operations.length; i++) {
        const operation = operations[i];
        const { type, params = {} } = operation;
        
        if (!type) {
          throw new Error(`操作 ${i + 1} 缺少 type 字段`);
        }
        
        let outputPath;
        if (i === operations.length - 1) {
          const baseName = path.parse(filename).name;
          const ext = params.format ? `.${params.format}` : path.extname(filename);
          const outputFilename = `processed_${Date.now()}_${baseName}${ext}`;
          outputPath = path.join(outputDir, outputFilename);
        } else {
          const tempFilename = `temp_${Date.now()}_${i}.${path.extname(currentInputPath).slice(1) || 'mp4'}`;
          outputPath = path.join(outputDir, tempFilename);
          tempFiles.push(outputPath);
        }
        
        let command;
        
        switch (type) {
          case 'convert':
            command = await ffmpeg.convert(currentInputPath, outputPath, {
              format: params.format || 'mp4',
              videoCodec: params.videoCodec || 'libx264',
              audioCodec: params.audioCodec || 'aac',
              quality: params.quality,
              size: params.size,
              fps: params.fps,
              audioBitrate: params.audioBitrate,
              startTime: params.startTime,
              duration: params.duration
            });
            break;
            
          case 'resize':
            command = await ffmpeg.resize(currentInputPath, outputPath, {
              width: parseInt(params.width),
              height: parseInt(params.height),
              maintainAspectRatio: params.maintainAspectRatio !== false
            });
            break;
            
          case 'crop':
            command = await ffmpeg.crop(currentInputPath, outputPath, {
              x: parseInt(params.x) || 0,
              y: parseInt(params.y) || 0,
              width: parseInt(params.width),
              height: parseInt(params.height),
              startTime: params.startTime,
              duration: params.duration
            });
            break;
            
          case 'extractFrame':
            const frameExt = params.format || 'jpg';
            const frameOutputPath = outputPath.replace(/\.[^.]+$/, `.${frameExt}`);
            command = await ffmpeg.extractFrame(currentInputPath, frameOutputPath, {
              time: parseFloat(params.time) || 0,
              size: params.size
            });
            outputPath = frameOutputPath;
            break;
            
          case 'extractAudio':
            const audioExt = params.format || 'mp3';
            const audioOutputPath = outputPath.replace(/\.[^.]+$/, `.${audioExt}`);
            command = await ffmpeg.extractAudio(currentInputPath, audioOutputPath, {
              format: audioExt,
              audioCodec: params.audioCodec,
              audioBitrate: params.audioBitrate
            });
            outputPath = audioOutputPath;
            break;
            
          case 'addWatermark':
            const watermarkPath = params.watermarkPath ? path.join(uploadsDir, params.watermarkPath) : null;
            if (!watermarkPath || !fs.existsSync(watermarkPath)) {
              throw new Error('水印文件不存在');
            }
            command = await ffmpeg.addWatermark(currentInputPath, outputPath, {
              watermarkPath: watermarkPath,
              position: params.position || 'bottom-right',
              x: parseInt(params.x) || 10,
              y: parseInt(params.y) || 10,
              scale: parseFloat(params.scale) || 1.0,
              opacity: parseFloat(params.opacity) || 1.0
            });
            break;
            
          case 'imageToVideo':
            command = await ffmpeg.imageToVideo(currentInputPath, outputPath, {
              duration: parseFloat(params.duration) || 5,
              fps: parseInt(params.fps) || 25,
              resolution: params.resolution || '1280x720'
            });
            break;
            
          default:
            throw new Error(`不支持的操作类型: ${type}`);
        }
        
        commands.push(command.command);
        
        if (i > 0 && currentInputPath !== inputPath && fs.existsSync(currentInputPath)) {
          try {
            fs.unlinkSync(currentInputPath);
          } catch (e) {
            console.warn(`删除临时文件失败: ${currentInputPath}`, e.message);
          }
        }
        
        currentInputPath = outputPath;
      }
      
      tempFiles.forEach(tempFile => {
        if (fs.existsSync(tempFile) && tempFile !== currentInputPath) {
          try {
            fs.unlinkSync(tempFile);
          } catch (e) {
            console.warn(`清理临时文件失败: ${tempFile}`, e.message);
          }
        }
      });
      
      const outputFilename = path.basename(currentInputPath);
      
      res.json({
        success: true,
        outputFile: outputFilename,
        path: `/output/${outputFilename}`,
        commands: commands
      });
      
    } catch (error) {
      tempFiles.forEach(tempFile => {
        if (fs.existsSync(tempFile)) {
          try {
            fs.unlinkSync(tempFile);
          } catch (e) {
          }
        }
      });
      throw error;
    }
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * @swagger
 * /api/health:
 *   get:
 *     summary: 健康检查
 *     tags: [Health]
 *     responses:
 *       200:
 *         description: 服务状态
 */
app.get('/api/health', async (req, res) => {
  try {
    const ffmpegStatus = await ffmpeg.checkInstallation();
    res.json({
      status: 'healthy',
      ffmpeg: ffmpegStatus
    });
  } catch (error) {
    res.status(500).json({
      status: 'unhealthy',
      error: error.message
    });
  }
});

/**
 * @swagger
 * /api/ffmpeg-status:
 *   get:
 *     summary: 检测 FFmpeg 安装状态
 *     tags: [Health]
 *     responses:
 *       200:
 *         description: 检测成功
 */
app.get('/api/ffmpeg-status', async (req, res) => {
  try {
    const status = await ffmpeg.checkInstallation();
    res.json({
      success: true,
      ...status
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// 路由：提供上传的文件
app.use('/uploads', express.static(uploadsDir));
app.use('/output', express.static(outputDir));

/**
 * @swagger
 * /api/files/list:
 *   get:
 *     summary: 获取文件列表
 *     tags: [文件管理]
 *     parameters:
 *       - in: query
 *         name: directory
 *         schema:
 *           type: string
 *           enum: [uploads, output]
 *         required: true
 *     responses:
 *       200:
 *         description: 文件列表
 */
app.get('/api/files/list', async (req, res) => {
  try {
    const { directory } = req.query;
    
    if (!directory || !['uploads', 'output'].includes(directory)) {
      return res.status(400).json({
        success: false,
        error: '目录参数无效，必须是 uploads 或 output'
      });
    }
    
    const dirPath = directory === 'uploads' ? uploadsDir : outputDir;
    
    if (!fs.existsSync(dirPath)) {
      return res.json({
        success: true,
        files: []
      });
    }
    
    const files = fs.readdirSync(dirPath)
      .map(filename => {
        const filePath = path.join(dirPath, filename);
        const stats = fs.statSync(filePath);
        
        return {
          name: filename,
          size: stats.size,
          sizeFormatted: formatFileSize(stats.size),
          modified: stats.mtime,
          isDirectory: stats.isDirectory(),
          url: `/${directory}/${filename}`
        };
      })
      .filter(file => !file.isDirectory)
      .sort((a, b) => b.modified - a.modified);
    
    res.json({
      success: true,
      files,
      directory,
      totalSize: files.reduce((sum, file) => sum + file.size, 0),
      totalSizeFormatted: formatFileSize(files.reduce((sum, file) => sum + file.size, 0))
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * @swagger
 * /api/files/delete:
 *   delete:
 *     summary: 删除文件
 *     tags: [文件管理]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - directory
 *               - filename
 *             properties:
 *               directory:
 *                 type: string
 *                 enum: [uploads, output]
 *               filename:
 *                 type: string
 *     responses:
 *       200:
 *         description: 删除成功
 */
app.delete('/api/files/delete', async (req, res) => {
  try {
    const { directory, filename } = req.body;
    
    if (!directory || !['uploads', 'output'].includes(directory)) {
      return res.status(400).json({
        success: false,
        error: '目录参数无效，必须是 uploads 或 output'
      });
    }
    
    if (!filename) {
      return res.status(400).json({
        success: false,
        error: '文件名不能为空'
      });
    }
    
    if (filename.includes('..') || filename.includes('/') || filename.includes('\\')) {
      return res.status(400).json({
        success: false,
        error: '文件名包含非法字符'
      });
    }
    
    const dirPath = directory === 'uploads' ? uploadsDir : outputDir;
    const filePath = path.join(dirPath, filename);
    
    if (!filePath.startsWith(dirPath)) {
      return res.status(400).json({
        success: false,
        error: '文件路径无效'
      });
    }
    
    if (!fs.existsSync(filePath)) {
      return res.status(404).json({
        success: false,
        error: '文件不存在'
      });
    }
    
    fs.unlinkSync(filePath);
    
    res.json({
      success: true,
      message: '文件删除成功'
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * @swagger
 * /api/files/clear:
 *   delete:
 *     summary: 清空目录
 *     tags: [文件管理]
 *     parameters:
 *       - in: query
 *         name: directory
 *         schema:
 *           type: string
 *           enum: [uploads, output]
 *         required: true
 *     responses:
 *       200:
 *         description: 清空成功
 */
app.delete('/api/files/clear', async (req, res) => {
  try {
    const { directory } = req.query;
    
    if (!directory || !['uploads', 'output'].includes(directory)) {
      return res.status(400).json({
        success: false,
        error: '目录参数无效，必须是 uploads 或 output'
      });
    }
    
    const dirPath = directory === 'uploads' ? uploadsDir : outputDir;
    
    if (!fs.existsSync(dirPath)) {
      return res.json({
        success: true,
        message: '目录不存在或已为空'
      });
    }
    
    const files = fs.readdirSync(dirPath);
    let deletedCount = 0;
    let totalSize = 0;
    
    files.forEach(filename => {
      const filePath = path.join(dirPath, filename);
      const stats = fs.statSync(filePath);
      
      if (stats.isFile()) {
        totalSize += stats.size;
        fs.unlinkSync(filePath);
        deletedCount++;
      }
    });
    
    res.json({
      success: true,
      message: `成功删除 ${deletedCount} 个文件`,
      deletedCount,
      totalSize,
      totalSizeFormatted: formatFileSize(totalSize)
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// 格式化文件大小
function formatFileSize(bytes) {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return Math.round(bytes / Math.pow(k, i) * 100) / 100 + ' ' + sizes[i];
}

// 启动服务器
app.listen(PORT, async () => {
  console.log(`服务器运行在 http://localhost:${PORT}`);
  console.log(`Swagger API 文档: http://localhost:${PORT}/api-docs`);
  console.log('请确保已安装 FFmpeg: https://ffmpeg.org/download.html');
  
  // 启动时检查 FFmpeg
  try {
    const status = await ffmpeg.checkInstallation();
    if (!status.installed) {
      console.log('\n⚠️  FFmpeg 未检测到！');
      console.log('如果 FFmpeg 已安装但无法检测，请尝试：');
      console.log('1. 设置环境变量 FFMPEG_PATH=你的ffmpeg.exe完整路径');
      console.log('2. 重启编辑器/终端以刷新环境变量');
      console.log('3. 确保 FFmpeg 在系统 PATH 中');
    } else {
      console.log(`✅ FFmpeg ${status.version} 已就绪`);
    }
  } catch (error) {
    console.warn('FFmpeg 检测失败:', error.message);
  }
});

