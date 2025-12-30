const { spawn } = require('child_process');
const { exec } = require('child_process');
const { promisify } = require('util');
const execAsync = promisify(exec);
const path = require('path');
const fs = require('fs');

class FFmpeg {
  constructor() {
    this.ffmpegPath = this.getFFmpegPath();
    this.version = null;
    this.isInstalled = false;
    this._checkPromise = null;
  }

  /**
   * 获取 FFmpeg 可执行文件路径
   */
  getFFmpegPath() {
    // 如果设置了环境变量，使用指定的 ffmpeg 路径
    if (process.env.FFMPEG_PATH) {
      console.log(`使用指定的 FFmpeg 路径: ${process.env.FFMPEG_PATH}`);
      return process.env.FFMPEG_PATH;
    }

    // 尝试自动检测 FFmpeg 路径（Windows 常见路径）
    const commonPaths = [
      'C:\\ffmpeg\\bin\\ffmpeg.exe',
      'C:\\Program Files\\ffmpeg\\bin\\ffmpeg.exe',
      'C:\\Program Files (x86)\\ffmpeg\\bin\\ffmpeg.exe',
      'D:\\ffmpeg\\bin\\ffmpeg.exe',
      'E:\\ffmpeg\\bin\\ffmpeg.exe'
    ];

    for (const ffmpegPath of commonPaths) {
      if (fs.existsSync(ffmpegPath)) {
        console.log(`自动检测到 FFmpeg 路径: ${ffmpegPath}`);
        return ffmpegPath;
      }
    }

    // 尝试从 PATH 中查找
    const pathEnv = process.env.PATH || '';
    const pathDirs = pathEnv.split(path.delimiter || ';');
    
    for (const dir of pathDirs) {
      const ffmpegPath = path.join(dir, 'ffmpeg.exe');
      if (fs.existsSync(ffmpegPath)) {
        console.log(`从 PATH 中找到 FFmpeg: ${ffmpegPath}`);
        return ffmpegPath;
      }
    }
    
    // 如果都没找到，使用 'ffmpeg'（假设在 PATH 中）
    console.warn('未找到 FFmpeg，将使用系统 PATH 中的 ffmpeg 命令');
    return 'ffmpeg';
  }

  /**
   * 检查 FFmpeg 安装状态
   */
  async checkCommand() {
    try {
      const { stdout, stderr } = await execAsync(`"${this.ffmpegPath}" -version`, {
        encoding: 'utf8',
        env: process.env
      });
      
      const output = (stdout || stderr || '').trim();
      
      if (output) {
        this.isInstalled = true;
        
        // 提取版本信息
        const versionMatch = output.match(/ffmpeg version ([^\s]+)/i);
        if (versionMatch) {
          this.version = versionMatch[1];
        }
        
        console.log(`✅ FFmpeg ${this.version || 'unknown'} 已就绪`);
        return;
      }
      
      throw new Error('ffmpeg 命令无输出');
    } catch (error) {
      this.isInstalled = false;
      console.warn('⚠️ 警告: 未检测到 FFmpeg');
      console.warn(`错误详情: ${error.message}`);
      console.warn('解决方案：');
      console.warn('1. 确保 FFmpeg 已安装并在系统 PATH 中');
      console.warn('2. 或设置环境变量 FFMPEG_PATH 指向 ffmpeg.exe 的完整路径');
      console.warn('3. 或重启编辑器/终端以刷新环境变量');
    }
  }

  /**
   * 确保已检测 FFmpeg（延迟检测）
   */
  async ensureChecked() {
    if (this._checkPromise) {
      return this._checkPromise;
    }
    this._checkPromise = this.checkCommand();
    await this._checkPromise;
    return;
  }

  /**
   * 检查 FFmpeg 安装状态
   */
  async checkInstallation() {
    try {
      await this.ensureChecked();
      
      if (!this.isInstalled) {
        return {
          installed: false,
          version: null,
          message: 'FFmpeg 未安装或不在 PATH 中'
        };
      }

      // 再次验证
      const { stdout, stderr } = await execAsync(`"${this.ffmpegPath}" -version`, {
        encoding: 'utf8'
      });
      
      const output = (stdout || stderr || '').trim();
      const versionMatch = output.match(/ffmpeg version ([^\s]+)/i);
      const version = versionMatch ? versionMatch[1] : (this.version || 'unknown');

      return {
        installed: true,
        version: version,
        message: `FFmpeg ${version} 已安装`
      };
    } catch (error) {
      this._checkPromise = null;
      this.isInstalled = false;
      await this.checkCommand();
      
      if (this.isInstalled) {
        return {
          installed: true,
          version: this.version || 'unknown',
          message: `FFmpeg ${this.version || 'unknown'} 已安装`
        };
      }
      
      return {
        installed: false,
        version: null,
        message: `检测失败: ${error.message}`
      };
    }
  }

  /**
   * 执行 FFmpeg 命令
   */
  async executeFFmpeg(args, options = {}) {
    return new Promise((resolve, reject) => {
      const command = this.ffmpegPath;
      const allArgs = Array.isArray(args) ? args : [args];
      
      console.log('FFmpeg 命令:', `"${command}" ${allArgs.join(' ')}`);
      
      const ffmpegProcess = spawn(command, allArgs, {
        stdio: ['ignore', 'pipe', 'pipe'],
        shell: false,
        env: process.env
      });

      let stdout = '';
      let stderr = '';
      let commandStr = `"${command}" ${allArgs.join(' ')}`;

      ffmpegProcess.stdout.on('data', (data) => {
        stdout += data.toString();
        if (options.onProgress) {
          // 解析进度信息
          const progressMatch = data.toString().match(/time=(\d+):(\d+):(\d+\.\d+)/);
          if (progressMatch) {
            const hours = parseInt(progressMatch[1]);
            const minutes = parseInt(progressMatch[2]);
            const seconds = parseFloat(progressMatch[3]);
            const totalSeconds = hours * 3600 + minutes * 60 + seconds;
            if (options.duration && options.duration > 0) {
              const percent = (totalSeconds / options.duration) * 100;
              options.onProgress({ percent: Math.min(100, percent) });
            }
          }
        }
      });

      ffmpegProcess.stderr.on('data', (data) => {
        stderr += data.toString();
        // FFmpeg 将进度信息输出到 stderr
        if (options.onProgress) {
          const progressMatch = data.toString().match(/time=(\d+):(\d+):(\d+\.\d+)/);
          if (progressMatch) {
            const hours = parseInt(progressMatch[1]);
            const minutes = parseInt(progressMatch[2]);
            const seconds = parseFloat(progressMatch[3]);
            const totalSeconds = hours * 3600 + minutes * 60 + seconds;
            if (options.duration && options.duration > 0) {
              const percent = (totalSeconds / options.duration) * 100;
              options.onProgress({ percent: Math.min(100, percent) });
            }
          }
        }
      });

      ffmpegProcess.on('close', (code) => {
        if (code === 0) {
          resolve({ command: commandStr, stdout, stderr });
        } else {
          reject(new Error(`FFmpeg 执行失败 (退出码: ${code}): ${stderr || stdout}`));
        }
      });

      ffmpegProcess.on('error', (err) => {
        reject(new Error(`FFmpeg 启动失败: ${err.message}`));
      });
    });
  }

  /**
   * 合成视频（多资源合成）
   * @param {Array} resources - 资源列表 [{type: 'image', path: '...', duration: 3, ...}, ...]
   * @param {String} outputPath - 输出路径
   * @param {Object} options - 选项 {resolution: '1280x720', fps: 25, audioCodec: 'aac', videoCodec: 'libx264'}
   */
  async composeVideo(resources, outputPath, options = {}) {
    // 确保输出目录存在
    const outputDir = path.dirname(outputPath);
    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir, { recursive: true });
    }

    // 规范化输出路径
    const normalizedOutputPath = path.resolve(outputPath);
    
    // 验证输出目录可写
    try {
      const testFile = path.join(outputDir, '.test_write');
      fs.writeFileSync(testFile, 'test');
      fs.unlinkSync(testFile);
    } catch (e) {
      throw new Error(`输出目录不可写: ${outputDir} - ${e.message}`);
    }
    
    // 确保输出文件不存在（如果存在则删除）
    if (fs.existsSync(normalizedOutputPath)) {
      try {
        fs.unlinkSync(normalizedOutputPath);
      } catch (e) {
        console.warn('无法删除已存在的输出文件:', e.message);
      }
    }

    // 处理分辨率
    let width = options.width || 1280;
    let height = options.height || 720;
    if (options.resolution) {
      const parts = options.resolution.split('x');
      if (parts.length === 2) {
        width = parseInt(parts[0]) || width;
        height = parseInt(parts[1]) || height;
      }
    }
    const resolutionFilter = `${width}:${height}`;
    const fps = options.fps || 25;
    const videoCodec = options.videoCodec || 'libx264';
    const videoPreset = options.videoPreset || 'medium';
    const videoCrf = options.videoCrf !== undefined ? options.videoCrf : 23;
    const audioCodec = options.audioCodec || 'aac';
    const audioBitrate = options.audioBitrate || '192k';
    const audioSampleRate = options.audioSampleRate || 44100;
    const audioChannels = options.audioChannels || 2;
    const videoBitrate = options.videoBitrate || '2000k';
    const backgroundColor = options.backgroundColor || '#000000';
    
    // 将背景颜色从 #RRGGBB 转换为 0xRRGGBB 格式（用于FFmpeg）
    const bgColorHex = backgroundColor.replace('#', '0x');

    if (!resources || resources.length === 0) {
      throw new Error('资源列表不能为空');
    }

    // 验证所有输入文件存在
    for (const resource of resources) {
      if (!fs.existsSync(resource.path)) {
        throw new Error(`输入文件不存在: ${resource.path}`);
      }
    }

    // 分离不同类型的资源
    const images = [];
    const videos = [];
    const audios = [];

    resources.forEach((resource) => {
      if (resource.type === 'image') {
        images.push(resource);
      } else if (resource.type === 'video') {
        videos.push(resource);
      } else if (resource.type === 'audio') {
        audios.push(resource);
      }
    });

    // 如果没有视频内容（只有音频），无法生成视频
    if (images.length === 0 && videos.length === 0) {
      throw new Error('至少需要一个图片或视频资源');
    }

    // 构建 FFmpeg 命令参数
    const args = ['-y']; // 覆盖输出文件
    const filterComplex = [];
    let inputIndex = 0;
    const videoInputs = [];
    const audioInputs = [];

    // 辅助函数：构建缩放和位置filter
    function buildScaleAndPositionFilter(inputLabel, resource, targetWidth, targetHeight) {
      const scaleMode = resource.scaleMode || 'fit';
      const position = resource.position || 'center';
      const rotation = resource.rotation || 0;
      const opacity = resource.opacity !== undefined ? resource.opacity : 100;
      
      let filter = inputLabel;
      
      // 缩放模式
      if (scaleMode === 'fit') {
        // 适应：保持比例，可能有黑边
        filter += `scale=${targetWidth}:${targetHeight}:force_original_aspect_ratio=decrease`;
      } else if (scaleMode === 'fill') {
        // 填充：保持比例，可能裁剪
        filter += `scale=${targetWidth}:${targetHeight}:force_original_aspect_ratio=increase`;
      } else if (scaleMode === 'crop') {
        // 裁剪：填满画面
        filter += `scale=${targetWidth}:${targetHeight}:force_original_aspect_ratio=increase,crop=${targetWidth}:${targetHeight}`;
      } else {
        // 默认：适应
        filter += `scale=${targetWidth}:${targetHeight}:force_original_aspect_ratio=decrease`;
      }
      
      // 计算pad位置
      let padX = '(ow-iw)/2';
      let padY = '(oh-ih)/2';
      if (position === 'top-left') {
        padX = '0';
        padY = '0';
      } else if (position === 'top-right') {
        padX = 'ow-iw';
        padY = '0';
      } else if (position === 'bottom-left') {
        padX = '0';
        padY = 'oh-ih';
      } else if (position === 'bottom-right') {
        padX = 'ow-iw';
        padY = 'oh-ih';
      }
      
      // 添加pad和背景色
      filter += `,pad=${targetWidth}:${targetHeight}:${padX}:${padY}:color=${bgColorHex}`;
      
      // 旋转
      if (rotation !== 0) {
        filter += `,rotate=${rotation * Math.PI / 180}:fillcolor=${bgColorHex}:ow=${targetWidth}:oh=${targetHeight}`;
      }
      
      // 透明度
      if (opacity < 100) {
        const alpha = opacity / 100;
        filter += `,format=yuva420p,colorchannelmixer=aa=${alpha}`;
      }
      
      return filter;
    }
    
    // 辅助函数：构建过渡效果filter
    function buildTransitionFilter(transition, transitionDuration, totalDuration, currentWidth, currentHeight) {
      let filter = '';
      
      if (transition === 'none') {
        return filter;
      }
      
      // Fade效果
      if (transition === 'fade' || transition === 'fadein') {
        filter += `,fade=t=in:st=0:d=${transitionDuration}`;
      }
      if (transition === 'fade' || transition === 'fadeout') {
        const fadeOutStart = Math.max(0, totalDuration - transitionDuration);
        filter += `,fade=t=out:st=${fadeOutStart}:d=${transitionDuration}`;
      }
      
      // Slide效果（使用x和y坐标实现滑动）
      // 注意：这些效果需要在已经缩放和pad的基础上应用
      if (transition === 'slideLeft') {
        // 从左滑入：x从-width到0
        const xExpr = `-${currentWidth}*(1-t/${transitionDuration})`;
        filter += `,crop=${currentWidth}:${currentHeight}:max(0,${xExpr}):0,pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2:color=${bgColorHex}`;
      } else if (transition === 'slideRight') {
        // 从右滑入：x从width到0
        const xExpr = `${currentWidth}*(1-t/${transitionDuration})`;
        filter += `,crop=${currentWidth}:${currentHeight}:min(iw-${currentWidth},${xExpr}):0,pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2:color=${bgColorHex}`;
      } else if (transition === 'slideUp') {
        // 从下滑入：y从height到0
        const yExpr = `${currentHeight}*(1-t/${transitionDuration})`;
        filter += `,crop=${currentWidth}:${currentHeight}:0:min(ih-${currentHeight},${yExpr}),pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2:color=${bgColorHex}`;
      } else if (transition === 'slideDown') {
        // 从上滑入：y从-height到0
        const yExpr = `-${currentHeight}*(1-t/${transitionDuration})`;
        filter += `,crop=${currentWidth}:${currentHeight}:0:max(0,${yExpr}),pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2:color=${bgColorHex}`;
      }
      
      // Zoom效果（在已经缩放的基础上再次缩放）
      if (transition === 'zoomIn') {
        // 从0.5倍放大到1倍
        const scaleStart = 0.5;
        const scaleEnd = 1.0;
        const scaleExpr = `${scaleStart}+(${scaleEnd}-${scaleStart})*min(1,t/${transitionDuration})`;
        filter += `,scale=iw*${scaleExpr}:ih*${scaleExpr},pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2:color=${bgColorHex}`;
      } else if (transition === 'zoomOut') {
        // 从1.5倍缩小到1倍
        const scaleStart = 1.5;
        const scaleEnd = 1.0;
        const scaleExpr = `${scaleStart}+(${scaleEnd}-${scaleStart})*min(1,t/${transitionDuration})`;
        filter += `,scale=iw*${scaleExpr}:ih*${scaleExpr},pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2:color=${bgColorHex}`;
      }
      
      return filter;
    }

    // 处理图片：转换为视频片段
    images.forEach((img) => {
      const duration = img.duration || 3;
      const transition = img.transition || 'none';
      const transitionDuration = img.transitionDuration || 0.5;
      const normalizedPath = path.resolve(img.path);
      
      // 验证文件是否存在
      if (!fs.existsSync(normalizedPath)) {
        throw new Error(`图片文件不存在: ${normalizedPath}`);
      }
      
      // 添加输入选项（对于图片，直接读取，不设置循环）
      // 图片只有1帧，我们需要通过 filter 来让它显示指定时长
      args.push('-i', normalizedPath);
      
      // 构建基础filter（缩放、位置、旋转、透明度）
      // 使用 loop filter 来循环图片，确保图片在整个时长内显示
      // loop=-1 表示无限循环，size=1 表示循环1帧，start=0 表示从第0帧开始
      // 然后用 fps filter 来设置输出帧率，并通过 trim 限制总时长
      let filter = `[${inputIndex}:v]loop=-1:size=1:start=0`;
      
      // 构建缩放和位置filter（传入空字符串作为inputLabel，因为已经在上面添加了输入）
      const scaleFilter = buildScaleAndPositionFilter('', img, width, height);
      // scaleFilter 会以空字符串开头，然后直接是 scale=...，需要添加逗号分隔符
      if (scaleFilter && scaleFilter.trim()) {
        // 移除开头的空字符串，直接添加 filter 操作
        const filterOps = scaleFilter.trim();
        filter += ',' + filterOps;
      }
      
      // 设置帧率和像素格式，并限制总时长（避免无限循环）
      filter += `,setsar=1,fps=${fps}:round=up,trim=duration=${duration}`;
      
      // 应用过渡效果
      if (transition !== 'none' && transitionDuration > 0) {
        // 获取当前filter处理后的尺寸（通常是目标尺寸）
        const currentWidth = width;
        const currentHeight = height;
        filter += buildTransitionFilter(transition, transitionDuration, duration, currentWidth, currentHeight);
      }
      
      filter += `[v${inputIndex}]`;
      filterComplex.push(filter);
      videoInputs.push({ index: inputIndex, duration: duration });
      inputIndex++;
    });

    // 处理视频：调整大小和帧率
    videos.forEach((vid) => {
      const normalizedPath = path.resolve(vid.path);
      
      // 添加输入选项（-ss 和 -t 必须在 -i 之前）
      if (vid.startTime !== undefined && vid.startTime > 0) {
        args.push('-ss', String(vid.startTime));
      }
      const vidDuration = vid.duration;
      if (vidDuration !== undefined && vidDuration > 0) {
        args.push('-t', String(vidDuration));
      }
      args.push('-i', normalizedPath);
      
      const transition = vid.transition || 'none';
      const transitionDuration = vid.transitionDuration || 0.5;
      
      // 构建基础filter（缩放、位置、旋转、透明度）
      let filter = buildScaleAndPositionFilter(`[${inputIndex}:v]`, vid, width, height);
      
      // 设置帧率和像素格式
      filter += `,setsar=1,fps=${fps}`;
      
      // 应用过渡效果
      if (transition !== 'none' && transitionDuration > 0) {
        // 获取当前filter处理后的尺寸（通常是目标尺寸）
        const currentWidth = width;
        const currentHeight = height;
        filter += buildTransitionFilter(transition, transitionDuration, vidDuration || 5, currentWidth, currentHeight);
      }
      
      filter += `[v${inputIndex}]`;
      filterComplex.push(filter);
      videoInputs.push({ index: inputIndex, duration: vidDuration });
      inputIndex++;
    });

    // 处理音频
    audios.forEach((aud) => {
      const normalizedPath = path.resolve(aud.path);
      
      // 添加输入选项（-ss 和 -t 必须在 -i 之前）
      if (aud.startTime !== undefined && aud.startTime > 0) {
        args.push('-ss', String(aud.startTime));
      }
      if (aud.duration !== undefined && aud.duration > 0) {
        args.push('-t', String(aud.duration));
      }
      args.push('-i', normalizedPath);
      
      // 应用音频效果
      const fade = aud.fade || 'none';
      const fadeDuration = aud.fadeDuration || 1;
      const volume = aud.volume !== undefined ? aud.volume : 100;
      const audioFilters = [];
      
      // 音量调整
      if (volume !== 100) {
        const volumeMultiplier = volume / 100;
        audioFilters.push(`volume=${volumeMultiplier}`);
      }
      
      // 淡入淡出
      if (fade !== 'none' && fadeDuration > 0) {
        if (fade === 'fadein' || fade === 'both') {
          audioFilters.push(`afade=t=in:st=0:d=${fadeDuration}`);
        }
        if (fade === 'fadeout' || fade === 'both') {
          const audioDuration = aud.duration || 10;
          const fadeOutStart = Math.max(0, audioDuration - fadeDuration);
          audioFilters.push(`afade=t=out:st=${fadeOutStart}:d=${fadeDuration}`);
        }
      }
      
      if (audioFilters.length > 0) {
        const audioFilterStr = audioFilters.join(',');
        filterComplex.push(`[${inputIndex}:a]${audioFilterStr}[a${inputIndex}]`);
        audioInputs.push({ index: inputIndex, filterIndex: inputIndex });
      } else {
        audioInputs.push({ index: inputIndex, filterIndex: null });
      }
      inputIndex++;
    });

    // 连接所有视频片段
    if (videoInputs.length > 0) {
      if (videoInputs.length === 1) {
        // 如果只有一个视频片段，不需要 concat，直接修改最后一个 filter 的输出标签
        const idx = typeof videoInputs[0] === 'object' ? videoInputs[0].index : videoInputs[0];
        for (let i = filterComplex.length - 1; i >= 0; i--) {
          if (filterComplex[i].endsWith(`[v${idx}]`)) {
            filterComplex[i] = filterComplex[i].replace(`[v${idx}]`, '[outv]');
            break;
          }
        }
      } else {
        // 多个视频片段，使用 concat
        const concatInputs = videoInputs.map(item => {
          const idx = typeof item === 'object' ? item.index : item;
          return `[v${idx}]`;
        }).join('');
        filterComplex.push(`${concatInputs}concat=n=${videoInputs.length}:v=1:a=0[outv]`);
      }
    }

    // 合并所有音频
    if (audioInputs.length > 0) {
      const audioLabels = audioInputs.map(item => {
        if (typeof item === 'object' && item.filterIndex !== null) {
          return `[a${item.filterIndex}]`;
        } else if (typeof item === 'object') {
          return `[${item.index}:a]`;
        }
        return `[${item}:a]`;
      }).join('');
      filterComplex.push(`${audioLabels}amix=inputs=${audioInputs.length}:duration=longest:dropout_transition=2[outa]`);
    }

    // 添加 filter_complex
    if (filterComplex.length > 0) {
      console.log('Filter Complex:', JSON.stringify(filterComplex, null, 2));
      args.push('-filter_complex', filterComplex.join(';'));
    }

    // 添加输出选项
    args.push('-vcodec', videoCodec);
    
    // 如果使用libx264或libx265，添加preset和CRF
    if (videoCodec === 'libx264' || videoCodec === 'libx265') {
      args.push('-preset', videoPreset);
      // 如果设置了CRF，使用CRF（质量模式），否则使用码率模式
      if (videoCrf !== undefined && videoCrf >= 0 && videoCrf <= 51) {
        args.push('-crf', String(videoCrf));
      } else {
        args.push('-b:v', videoBitrate);
      }
    } else {
      // 其他编码器使用码率
      args.push('-b:v', videoBitrate);
    }
    
    args.push('-pix_fmt', 'yuv420p');
    args.push('-shortest');

    // 映射输出流
    if (videoInputs.length > 0) {
      args.push('-map', '[outv]');
    }
    
    // 音频编码参数
    if (audioInputs.length > 0) {
      if (audioCodec !== 'copy') {
        args.push('-acodec', audioCodec);
        args.push('-b:a', audioBitrate);
        args.push('-ar', String(audioSampleRate));
        args.push('-ac', String(audioChannels));
      } else {
        args.push('-acodec', 'copy');
      }
      args.push('-map', '[outa]');
    } else if (videos.length > 0) {
      // 如果有视频但没有单独添加的音频，尝试复制视频中的音频
      const firstVideoIndex = images.length;
      args.push('-map', `${firstVideoIndex}:a?`);
      if (audioCodec !== 'copy') {
        args.push('-acodec', audioCodec);
        args.push('-b:a', audioBitrate);
        args.push('-ar', String(audioSampleRate));
        args.push('-ac', String(audioChannels));
      } else {
        args.push('-acodec', 'copy');
      }
    }

    // 添加输出文件路径
    args.push(normalizedOutputPath);

    // 计算总时长（用于进度显示）
    const totalDuration = images.reduce((sum, img) => sum + (img.duration || 3), 0) + 
                           videos.reduce((sum, vid) => sum + (vid.duration || 5), 0);

    console.log('FFmpeg 合成视频命令:', `"${this.ffmpegPath}" ${args.join(' ')}`);
    console.log('输出路径:', normalizedOutputPath);

    // 执行命令
    try {
      const result = await this.executeFFmpeg(args, {
        duration: totalDuration,
        onProgress: (progress) => {
          if (progress.percent) {
            console.log(`进度: ${progress.percent.toFixed(2)}%`);
          }
        }
      });

      console.log('合成完成:', normalizedOutputPath);
      return { command: result.command, outputPath: normalizedOutputPath };
    } catch (error) {
      console.error('FFmpeg 错误详情:', error);
      console.error('输出路径:', normalizedOutputPath);
      console.error('输出目录:', path.dirname(normalizedOutputPath));
      console.error('输出目录是否存在:', fs.existsSync(path.dirname(normalizedOutputPath)));
      throw new Error(`FFmpeg 合成视频失败: ${error.message}`);
    }
  }
}

module.exports = new FFmpeg();
