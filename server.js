const express = require('express');
const multer = require('multer');
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

// 配置 multer 用于文件上传
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, uploadsDir);
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    cb(null, uniqueSuffix + path.extname(file.originalname));
  }
});

const upload = multer({
  storage: storage,
  limits: { fileSize: 500 * 1024 * 1024 }, // 500MB
  fileFilter: (req, file, cb) => {
    const allowedTypes = /mp4|avi|mov|mkv|flv|wmv|webm|m4v|3gp|mp3|wav|aac|ogg|jpg|jpeg|png|gif|bmp|webp/;
    const extname = allowedTypes.test(path.extname(file.originalname).toLowerCase());
    const mimetype = allowedTypes.test(file.mimetype);
    
    if (mimetype && extname) {
      return cb(null, true);
    } else {
      cb(new Error('不支持的文件格式'));
    }
  }
});

/**
 * 下载网络资源到 template 目录
 */
async function downloadFromUrl(url) {
  return new Promise((resolve, reject) => {
    try {
      const urlObj = new URL(url);
      const protocol = urlObj.protocol === 'https:' ? https : http;
      
      protocol.get(url, (response) => {
        if (response.statusCode !== 200) {
          reject(new Error(`下载失败: HTTP ${response.statusCode}`));
          return;
        }
        
        let ext = path.extname(urlObj.pathname);
        const contentType = response.headers['content-type'];
        
        if (!ext || ext === '') {
          const mimeToExt = {
            'video/mp4': '.mp4',
            'video/avi': '.avi',
            'video/quicktime': '.mov',
            'video/x-msvideo': '.avi',
            'video/webm': '.webm',
            'image/jpeg': '.jpg',
            'image/png': '.png',
            'image/gif': '.gif'
          };
          ext = mimeToExt[contentType] || '.mp4';
        }
        
        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
        const filename = `downloaded_${uniqueSuffix}${ext}`;
        const filePath = path.join(templateDir, filename);
        
        const fileStream = fs.createWriteStream(filePath);
        response.pipe(fileStream);
        
        fileStream.on('finish', () => {
          fileStream.close();
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
      }).on('error', (err) => {
        reject(err);
      });
    } catch (error) {
      reject(new Error(`无效的 URL: ${error.message}`));
    }
  });
}

/**
 * @swagger
 * /api/upload:
 *   post:
 *     summary: 上传视频/图片文件（支持本地文件和网络 URL）
 *     tags: [Upload]
 *     requestBody:
 *       required: true
 *       content:
 *         multipart/form-data:
 *           schema:
 *             type: object
 *             properties:
 *               file:
 *                 type: string
 *                 format: binary
 *                 description: 视频/图片文件
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               url:
 *                 type: string
 *                 format: uri
 *                 description: 网络文件 URL
 *     responses:
 *       200:
 *         description: 上传成功
 */
app.post('/api/upload', async (req, res) => {
  try {
    if (req.body && req.body.url) {
      const { url } = req.body;
      
      if (!url || typeof url !== 'string') {
        return res.status(400).json({ error: '无效的 URL' });
      }
      
      try {
        const downloadResult = await downloadFromUrl(url);
        const finalPath = path.join(uploadsDir, downloadResult.filename);
        try {
          fs.renameSync(downloadResult.path, finalPath);
        } catch (renameError) {
          if (renameError.code === 'EXDEV' || renameError.message.includes('cross-device')) {
            fs.copyFileSync(downloadResult.path, finalPath);
            fs.unlinkSync(downloadResult.path);
          } else {
            throw renameError;
          }
        }
        
        res.json({
          success: true,
          filename: downloadResult.filename,
          originalName: path.basename(new URL(url).pathname) || 'downloaded_file',
          path: `/uploads/${downloadResult.filename}`,
          size: downloadResult.size,
          source: 'url'
        });
      } catch (error) {
        res.status(500).json({ error: `下载失败: ${error.message}` });
      }
    } else {
      upload.single('file')(req, res, (err) => {
        if (err) {
          return res.status(400).json({ error: err.message });
        }
        
        if (!req.file) {
          return res.status(400).json({ error: '没有上传文件' });
        }
        
        res.json({
          success: true,
          filename: req.file.filename,
          originalName: req.file.originalname,
          path: `/uploads/${req.file.filename}`,
          size: req.file.size,
          source: 'local'
        });
      });
    }
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * @swagger
 * /api/compose:
 *   post:
 *     summary: 合成视频（将多个资源合成为一个新视频）
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
 *                 description: 资源数组，每个资源包含 type, filename, duration 等
 *                 items:
 *                   type: object
 *                   properties:
 *                     type:
 *                       type: string
 *                       enum: [image, video, audio]
 *                     filename:
 *                       type: string
 *                     duration:
 *                       type: number
 *                       description: 持续时间（秒），图片必填
 *                     startTime:
 *                       type: number
 *                       description: 开始时间（秒），视频/音频可选
 *               options:
 *                 type: object
 *                 properties:
 *                   resolution:
 *                     type: string
 *                     default: "1280x720"
 *                   fps:
 *                     type: number
 *                     default: 25
 *                   videoCodec:
 *                     type: string
 *                     default: "libx264"
 *                   audioCodec:
 *                     type: string
 *                     default: "aac"
 *     responses:
 *       200:
 *         description: 合成成功
 */
app.post('/api/compose', async (req, res) => {
  try {
    const { resources, options = {} } = req.body;
    
    if (!Array.isArray(resources) || resources.length === 0) {
      return res.status(400).json({ error: '资源列表不能为空' });
    }
    
    // 验证资源并构建路径
    const resourcePaths = [];
    for (const resource of resources) {
      if (!resource.type || !resource.filename) {
        return res.status(400).json({ error: '资源必须包含 type 和 filename' });
      }
      
      if (!['image', 'video', 'audio'].includes(resource.type)) {
        return res.status(400).json({ error: `不支持的资源类型: ${resource.type}`});
      }
      
      const filePath = path.join(uploadsDir, resource.filename);
      if (!fs.existsSync(filePath)) {
        return res.status(404).json({ error: `文件不存在: ${resource.filename}` });
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
    
    res.json({
      success: true,
      outputFile: outputFilename,
      path: `/output/${outputFilename}`,
      command: result.command
    });
  } catch (error) {
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

