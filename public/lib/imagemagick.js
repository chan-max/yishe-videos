const { exec } = require('child_process');
const { promisify } = require('util');
const execAsync = promisify(exec);
const path = require('path');
const fs = require('fs');

class ImageMagick {
  constructor() {
    // 检测 ImageMagick 命令（magick 用于 v7+, convert 用于 v6）
    this.magickCmd = 'magick';
    this.version = null;
    this.isInstalled = false;
    // 注意：构造函数中不能等待异步方法，所以延迟到首次使用时检测
    this._checkPromise = null;
  }

  /**
   * 检查可用的 ImageMagick 命令
   * 优先使用 magick 命令（ImageMagick 7+）
   */
  async checkCommand() {
    try {
      // 尝试使用 magick 命令（ImageMagick 7+）
      const { stdout, stderr } = await execAsync('magick --version', {
        encoding: 'utf8'
      });
      console.log('stdout', stdout);
      // ImageMagick 可能将版本信息输出到 stdout 或 stderr
      const output = (stdout || stderr || '').trim();
      
      if (output) {
        this.magickCmd = 'magick';
        this.isInstalled = true;
        
        // 提取版本信息（支持多种格式）
        let versionMatch = output.match(/Version: ImageMagick ([\d.]+)/i);
        if (!versionMatch) {
          versionMatch = output.match(/ImageMagick ([\d.]+)/i);
        }
        if (!versionMatch) {
          versionMatch = output.match(/Version ([\d.]+)/i);
        }
        
        if (versionMatch) {
          this.version = versionMatch[1];
        }
        
        console.log(`ImageMagick ${this.version || 'unknown'} 已检测到，使用 magick 命令`);
        return;
      }
      
      throw new Error('magick 命令无输出');
    } catch (error) {
      console.log(`magick 命令检测失败: ${error.message}`);
      
      // 如果 magick 命令不可用，尝试 convert（ImageMagick 6）
      try {
        const { stdout, stderr } = await execAsync('convert --version', {
          encoding: 'utf8'
        });
        
        const output = (stdout || stderr || '').trim();
        
        if (output) {
          this.magickCmd = 'convert';
          this.isInstalled = true;
          
          // 提取版本信息
          let versionMatch = output.match(/Version: ImageMagick ([\d.]+)/i);
          if (!versionMatch) {
            versionMatch = output.match(/ImageMagick ([\d.]+)/i);
          }
          if (!versionMatch) {
            versionMatch = output.match(/Version ([\d.]+)/i);
          }
          
          if (versionMatch) {
            this.version = versionMatch[1];
          }
          
          console.warn(`警告: 检测到 ImageMagick 6 (使用 convert 命令)，建议升级到 ImageMagick 7+ 使用 magick 命令`);
          return;
        }
        
        throw new Error('convert 命令无输出');
      } catch (err) {
        this.isInstalled = false;
        console.warn('警告: 未检测到 ImageMagick，请确保已安装并在 PATH 中');
        console.warn('提示: ImageMagick 7+ 使用 magick 命令，请确保安装正确版本');
        console.warn(`错误详情: ${err.message}`);
      }
    }
  }

  /**
   * 确保已检测 ImageMagick（延迟检测）
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
   * 检查 ImageMagick 安装状态
   */
  async checkInstallation() {
    try {
      // 确保已经检测过
      await this.ensureChecked();
      
      if (!this.isInstalled) {
        return {
          installed: false,
          command: null,
          version: null,
          message: 'ImageMagick 未安装或不在 PATH 中'
        };
      }

      // 再次验证（使用 --version 参数）
      const { stdout, stderr } = await execAsync(`${this.magickCmd} --version`, {
        encoding: 'utf8'
      });
      
      const output = (stdout || stderr || '').trim();
      
      // 提取版本信息（支持多种格式）
      let versionMatch = output.match(/Version: ImageMagick ([\d.]+)/i);
      if (!versionMatch) {
        versionMatch = output.match(/ImageMagick ([\d.]+)/i);
      }
      if (!versionMatch) {
        versionMatch = output.match(/Version ([\d.]+)/i);
      }
      
      const version = versionMatch ? versionMatch[1] : (this.version || 'unknown');

      return {
        installed: true,
        command: this.magickCmd,
        version: version,
        message: `ImageMagick ${version} 已安装 (使用命令: ${this.magickCmd})`
      };
    } catch (error) {
      // 如果验证失败，尝试重新检测
      this._checkPromise = null;
      this.isInstalled = false;
      await this.checkCommand();
      
      if (this.isInstalled) {
        return {
          installed: true,
          command: this.magickCmd,
          version: this.version || 'unknown',
          message: `ImageMagick ${this.version || 'unknown'} 已安装 (使用命令: ${this.magickCmd})`
        };
      }
      
      return {
        installed: false,
        command: null,
        version: null,
        message: `检测失败: ${error.message}`
      };
    }
  }

  /**
   * 执行 ImageMagick 命令
   * @param {string|string[]} commandArgs - 命令参数数组
   * @returns {Promise<{output: string, command: string}>} 返回输出和完整命令
   */
  async executeCommand(commandArgs) {
    try {
      // 确保已经检测过 ImageMagick
      await this.ensureChecked();
      
      let args;
      if (Array.isArray(commandArgs)) {
        // 如果传入的是数组，直接使用
        args = commandArgs;
      } else {
        // 如果是字符串，需要解析（但更推荐使用数组形式）
        throw new Error('请使用数组形式传递命令参数');
      }
      
      // 确保使用 magick 命令（ImageMagick 7+）
      // 如果检测到 convert，说明是 ImageMagick 6，需要特殊处理
      const cmd = this.magickCmd;
      
      // 构建命令字符串，安全处理参数
      const escapeArg = (arg) => {
        // 如果参数包含空格、引号或其他特殊字符，需要转义
        if (typeof arg !== 'string') {
          arg = String(arg);
        }
        // 转义引号
        arg = arg.replace(/"/g, '\\"');
        // 如果包含空格或特殊字符，加引号
        if (arg.includes(' ') || arg.includes('(') || arg.includes(')') || arg.includes('&') || arg.includes('|')) {
          return `"${arg}"`;
        }
        return arg;
      };
      
      const commandStr = `${cmd} ${args.map(escapeArg).join(' ')}`;
      
      // 打印完整命令
      console.log(`[ImageMagick] 执行命令: ${commandStr}`);
      
      const { stdout, stderr } = await execAsync(commandStr, {
        encoding: 'utf8',
        // Windows 上确保使用 UTF-8 编码
        env: { ...process.env, LANG: 'en_US.UTF-8', LC_ALL: 'en_US.UTF-8' }
      });
      
      // ImageMagick 通常将信息输出到 stderr，这是正常的
      if (stderr && !stderr.includes('warning') && !stderr.includes('Version:')) {
        // 某些情况下 stderr 包含有用信息，但不一定是错误
        console.log('ImageMagick stderr:', stderr);
      }
      
      return {
        output: stdout || stderr || '',
        command: commandStr
      };
    } catch (error) {
      const errorMsg = error.stderr || error.message || '未知错误';
      throw new Error(`ImageMagick 执行失败 (使用命令: ${this.magickCmd}): ${errorMsg}`);
    }
  }

  /**
   * 获取图片信息
   * 优先使用 magick 命令（ImageMagick 7+）
   */
  async identify(imagePath) {
    // 使用简单的 identify 命令获取基本信息（格式、尺寸）
    // ImageMagick 7+ 使用: magick identify <image>
    // ImageMagick 6 使用: identify <image>
    let output;
    
    // 首先获取文件大小（使用文件系统，更可靠）
    let fileSize = 0;
    try {
      if (fs.existsSync(imagePath)) {
        const stats = fs.statSync(imagePath);
        fileSize = stats.size;
      }
    } catch (error) {
      console.warn(`无法获取文件大小: ${error.message}`);
    }
    
    if (this.magickCmd === 'magick') {
      // ImageMagick 7+ 格式：magick identify <image>
      // 输出格式: filename format widthxheight ...
      const args = ['identify', imagePath];
      const result = await this.executeCommand(args);
      output = result.output;
    } else {
      // ImageMagick 6 格式，使用独立的 identify 命令
      try {
        // 转义路径中的特殊字符
        const escapedPath = imagePath.replace(/"/g, '\\"');
        const { stdout, stderr } = await execAsync(`identify "${escapedPath}"`, {
          encoding: 'utf8'
        });
        output = stdout || stderr || '';
      } catch (error) {
        throw new Error(`ImageMagick identify 执行失败: ${error.message}`);
      }
    }
    
    // 解析输出
    // 输出格式示例: 
    // "image.jpg JPEG 1920x1080 8-bit sRGB 123456B 0.000u 0:00.000"
    // 或: "image.jpg[0] JPEG 1920x1080 8-bit sRGB 123456B 0.000u 0:00.000"
    const info = {
      format: '',
      width: 0,
      height: 0,
      size: fileSize, // 使用文件系统获取的大小
      colorspace: '',
      depth: '',
      properties: {}
    };
    
    // 清理输出，移除换行和多余空格
    const cleanOutput = output.trim();
    
    // 尝试匹配尺寸格式: widthxheight
    // 匹配模式: 数字x数字
    const sizeMatch = cleanOutput.match(/(\d+)x(\d+)/);
    if (sizeMatch) {
      info.width = parseInt(sizeMatch[1]);
      info.height = parseInt(sizeMatch[2]);
    }
    
    // 尝试提取格式（JPEG, PNG, GIF 等）
    const formatMatch = cleanOutput.match(/\b(JPEG|PNG|GIF|BMP|WEBP|SVG|TIFF|ICO|JPG)\b/i);
    if (formatMatch) {
      info.format = formatMatch[1].toUpperCase();
    }
    
    // 尝试提取颜色空间
    const colorspaceMatch = cleanOutput.match(/\b(sRGB|RGB|CMYK|Gray|Grayscale)\b/i);
    if (colorspaceMatch) {
      info.colorspace = colorspaceMatch[1];
    }
    
    // 尝试提取位深度
    const depthMatch = cleanOutput.match(/(\d+)-bit/i);
    if (depthMatch) {
      info.depth = depthMatch[1] + '-bit';
    }
    
    // 如果简单格式没有获取到信息，尝试使用 -verbose 模式
    if (info.width === 0 || info.height === 0) {
      let verboseOutput;
      
      if (this.magickCmd === 'magick') {
        const args = ['identify', '-verbose', imagePath];
        const result = await this.executeCommand(args);
        verboseOutput = result.output;
      } else {
        try {
          const escapedPath = imagePath.replace(/"/g, '\\"');
          const { stdout, stderr } = await execAsync(`identify -verbose "${escapedPath}"`, {
            encoding: 'utf8'
          });
          verboseOutput = stdout || stderr || '';
        } catch (error) {
          // 如果 verbose 也失败，返回已有信息（包含文件大小）
          return info;
        }
      }
      
      // 解析 verbose 输出
      const lines = verboseOutput.split('\n');
      for (const line of lines) {
        // 匹配 Geometry: widthxheight+x+y 或 Image: format widthxheight
        if (line.includes('Geometry:') || line.includes('Image:')) {
          const geoMatch = line.match(/(\d+)x(\d+)/);
          if (geoMatch && info.width === 0) {
            info.width = parseInt(geoMatch[1]);
            info.height = parseInt(geoMatch[2]);
          }
        }
        if (line.includes('Colorspace:') && !info.colorspace) {
          info.colorspace = line.split(':')[1].trim();
        }
        if (line.includes('Depth:') && !info.depth) {
          info.depth = line.split(':')[1].trim();
        }
      }
    }
    
    return info;
  }

  /**
   * 调整大小
   * @returns {Promise<string>} 返回执行的命令字符串
   */
  async resize(inputPath, outputPath, options = {}) {
    const { width, height, quality = 90, maintainAspectRatio = true } = options;
    
    const args = [
      inputPath,
      '-resize',
      maintainAspectRatio ? `${width}x${height}` : `${width}x${height}!`,
      '-quality',
      quality.toString(),
      outputPath
    ];
    
    const result = await this.executeCommand(args);
    return result.command;
  }

  /**
   * 裁剪
   * @returns {Promise<string>} 返回执行的命令字符串
   */
  async crop(inputPath, outputPath, options = {}) {
    const { x, y, width, height } = options;
    
    const args = [
      inputPath,
      '-crop',
      `${width}x${height}+${x}+${y}`,
      '+repage',
      outputPath
    ];
    
    const result = await this.executeCommand(args);
    return result.command;
  }

  /**
   * 旋转
   * @returns {Promise<string>} 返回执行的命令字符串
   */
  async rotate(inputPath, outputPath, options = {}) {
    const { degrees, backgroundColor = 'transparent' } = options;
    
    const args = [
      inputPath,
      '-background',
      backgroundColor,
      '-rotate',
      degrees.toString(),
      outputPath
    ];
    
    const result = await this.executeCommand(args);
    return result.command;
  }

  /**
   * 格式转换
   * @returns {Promise<string>} 返回执行的命令字符串
   */
  async convert(inputPath, outputPath, options = {}) {
    const { format, quality = 90 } = options;
    
    const args = [
      inputPath,
      '-quality',
      quality.toString(),
      outputPath
    ];
    
    const result = await this.executeCommand(args);
    return result.command;
  }

  /**
   * 添加水印（支持文字和图片水印）
   * @returns {Promise<string>} 返回执行的命令字符串（多个命令用分号分隔）
   */
  async watermark(inputPath, outputPath, options = {}) {
    const {
      type = 'text', // 'text' 或 'image'
      // 文字水印选项
      text,
      fontSize = 24,
      fontFamily = 'Arial',
      color = 'white',
      strokeColor = null,
      strokeWidth = 0,
      // 图片水印选项
      watermarkImage = null,
      watermarkScale = 1.0, // 水印图片缩放比例
      // 通用选项
      position = 'bottom-right',
      x = null, // 自定义 X 坐标（像素）
      y = null, // 自定义 Y 坐标（像素）
      marginX = 10, // X 方向边距
      marginY = 10, // Y 方向边距
      opacity = 0.5,
      angle = 0, // 旋转角度
      repeat = false, // 是否重复平铺
      tileSize = null // 平铺时的间距
    } = options;
    
    // 位置映射
    const positionMap = {
      'top-left': 'NorthWest',
      'top-center': 'North',
      'top-right': 'NorthEast',
      'center-left': 'West',
      'center': 'Center',
      'center-right': 'East',
      'bottom-left': 'SouthWest',
      'bottom-center': 'South',
      'bottom-right': 'SouthEast',
      'custom': 'None' // 自定义位置
    };
    
    const gravity = positionMap[position] || 'SouthEast';
    const alpha = Math.round(opacity * 100);
    
    const args = [inputPath];
    
    // 如果是图片水印
    if (type === 'image' && watermarkImage) {
      // 先处理水印图片（缩放、旋转、透明度）
      const watermarkArgs = [
        watermarkImage,
        '-resize',
        `${Math.round(watermarkScale * 100)}%`
      ];
      
      if (angle !== 0) {
        watermarkArgs.push('-rotate', angle.toString());
      }
      
      if (opacity < 1.0) {
        watermarkArgs.push('-alpha', 'set', '-channel', 'A', '-evaluate', 'multiply', `${alpha}%`, '+channel');
      }
      
      // 创建临时水印文件
      const tempWatermark = path.join(path.dirname(outputPath), `temp_watermark_${Date.now()}.png`);
      const result1 = await this.executeCommand([...watermarkArgs, tempWatermark]);
      const commands = [result1.command];
      
      // 如果是重复平铺
      if (repeat) {
        args.push(
          '(',
          tempWatermark,
          '-resize', tileSize ? `${tileSize}x${tileSize}` : '100x100',
          ')',
          '-tile',
          '-gravity', gravity,
          '-geometry', `+${marginX}+${marginY}`,
          '-composite'
        );
      } else {
        // 单个水印
        if (x !== null && y !== null) {
          // 自定义坐标
          args.push(
            tempWatermark,
            '-geometry', `+${x}+${y}`,
            '-composite'
          );
        } else {
          // 使用位置和边距
          args.push(
            '-gravity', gravity,
            tempWatermark,
            '-geometry', `+${marginX}+${marginY}`,
            '-composite'
          );
        }
      }
      
      args.push(outputPath);
      const result2 = await this.executeCommand(args);
      commands.push(result2.command);
      
      // 清理临时文件
      try {
        if (fs.existsSync(tempWatermark)) {
          fs.unlinkSync(tempWatermark);
        }
      } catch (e) {
        console.warn('清理临时水印文件失败:', e.message);
      }
      
      return commands.join('; ');
    }
    
    // 文字水印
    if (type === 'text' && text) {
      // 对于包含中文的文本，使用 label: 或 caption: 方式更可靠
      // 先创建文字图片，然后合成，这样可以避免命令行编码问题
      const textImage = path.join(path.dirname(outputPath), `temp_text_${Date.now()}.png`);
      
      // 构建文字图片命令
      const textArgs = [
        '-background', 'transparent',
        '-pointsize', fontSize.toString()
      ];
      
      // 设置字体（如果支持）
      // 检测文本是否包含中文字符
      const hasChinese = /[\u4e00-\u9fa5]/.test(text);
      
      if (fontFamily && fontFamily !== 'Arial') {
        textArgs.push('-font', fontFamily);
      } else if (hasChinese) {
        // 如果包含中文且未指定字体，尝试使用常见的中文字体
        // Windows 常见中文字体：Microsoft YaHei, SimHei, SimSun, KaiTi, FangSong
        // 这里先尝试使用 Microsoft YaHei（微软雅黑），如果系统没有则 ImageMagick 会使用默认字体
        // 注意：字体名称可能需要根据系统实际情况调整
        const chineseFont = 'Microsoft YaHei';
        textArgs.push('-font', chineseFont);
      }
      
      // 设置文字颜色
      textArgs.push('-fill', color);
      
      // 设置描边
      if (strokeColor && strokeWidth > 0) {
        textArgs.push('-strokewidth', strokeWidth.toString());
        textArgs.push('-stroke', strokeColor);
      }
      
      // 使用 label: 方式创建文字图片（对于单行文本）
      // 对于多行文本，使用 caption: 方式
      const hasNewline = text.includes('\n');
      if (hasNewline) {
        // 多行文本使用 caption:，需要设置宽度
        textArgs.push('-size', '800x', `caption:${text}`);
      } else {
        // 单行文本使用 label:
        textArgs.push(`label:${text}`);
      }
      
      textArgs.push(textImage);
      
      // 创建文字图片
      const result1 = await this.executeCommand(textArgs);
      const commands = [result1.command];
      
      // 检查文字图片是否创建成功
      if (!fs.existsSync(textImage)) {
        throw new Error('创建文字图片失败，可能是字体不支持中文或文本编码问题');
      }
      
      // 设置透明度（如果需要）
      if (opacity < 1.0) {
        const opacityArgs = [
          textImage,
          '-alpha', 'set',
          '-channel', 'A',
          '-evaluate', 'multiply', `${alpha}%`,
          '+channel',
          textImage
        ];
        const result2 = await this.executeCommand(opacityArgs);
        commands.push(result2.command);
      }
      
      // 旋转文字（如果设置了角度）
      if (angle !== 0) {
        const rotateArgs = [textImage, '-rotate', angle.toString(), textImage];
        const result3 = await this.executeCommand(rotateArgs);
        commands.push(result3.command);
      }
      
      // 重置 args，准备合成
      args.length = 0;
      args.push(inputPath);
      
      // 设置位置并合成
      if (x !== null && y !== null) {
        // 自定义坐标
        args.push('-gravity', 'None', textImage, '-geometry', `+${x}+${y}`, '-composite');
      } else {
        // 使用位置和边距
        args.push('-gravity', gravity, textImage, '-geometry', `+${marginX}+${marginY}`, '-composite');
      }
      
      args.push(outputPath);
      
      // 执行合成命令
      const result4 = await this.executeCommand(args);
      commands.push(result4.command);
      
      // 清理临时文件
      try {
        if (fs.existsSync(textImage)) {
          fs.unlinkSync(textImage);
        }
      } catch (e) {
        console.warn('清理临时文字文件失败:', e.message);
      }
      
      return commands.join('; ');
    }
  }

  /**
   * 调整亮度/对比度/饱和度
   * @returns {Promise<string>} 返回执行的命令字符串
   */
  async adjust(inputPath, outputPath, options = {}) {
    const { brightness = 0, contrast = 0, saturation = 0 } = options;
    
    const args = [inputPath];
    
    if (brightness !== 0 || contrast !== 0) {
      const brightnessValue = brightness > 0 ? `+${brightness}` : brightness.toString();
      const contrastValue = contrast > 0 ? `+${contrast}` : contrast.toString();
      args.push('-brightness-contrast', `${brightnessValue}x${contrastValue}`);
    }
    
    if (saturation !== 0) {
      const saturationValue = 100 + saturation;
      args.push('-modulate', `100,100,${saturationValue}`);
    }
    
    args.push(outputPath);
    const result = await this.executeCommand(args);
    return result.command;
  }

  /**
   * 应用滤镜
   * @returns {Promise<string>} 返回执行的命令字符串
   */
  async applyFilter(inputPath, outputPath, options = {}) {
    const { filterType, intensity = 1 } = options;
    
    const args = [inputPath];
    
    switch (filterType) {
      case 'blur':
        args.push('-blur', `0x${intensity * 5}`);
        break;
      case 'sharpen':
        args.push('-sharpen', `0x${intensity * 2}`);
        break;
      case 'emboss':
        args.push('-emboss', `0x${intensity * 2}`);
        break;
      case 'edge':
        args.push('-edge', intensity.toString());
        break;
      case 'charcoal':
        args.push('-charcoal', (intensity * 2).toString());
        break;
      case 'oil-painting':
        args.push('-paint', (intensity * 2).toString());
        break;
      case 'sepia':
        args.push('-sepia-tone', `${intensity * 80}%`);
        break;
      case 'grayscale':
        args.push('-colorspace', 'Gray');
        break;
      case 'negate':
        args.push('-negate');
        break;
      default:
        throw new Error(`不支持的滤镜类型: ${filterType}`);
    }
    
    args.push(outputPath);
    const result = await this.executeCommand(args);
    return result.command;
  }

  /**
   * 批量处理
   * @returns {Promise<string>} 返回执行的命令字符串
   */
  async batchProcess(inputPath, outputPath, operations) {
    const args = [inputPath];
    
    for (const op of operations) {
      switch (op.type) {
        case 'resize':
          if (op.maintainAspectRatio) {
            args.push('-resize', `${op.width}x${op.height}`);
          } else {
            args.push('-resize', `${op.width}x${op.height}!`);
          }
          break;
        case 'crop':
          args.push('-crop', `${op.width}x${op.height}+${op.x}+${op.y}`, '+repage');
          break;
        case 'rotate':
          args.push('-background', op.backgroundColor || 'transparent', '-rotate', op.degrees.toString());
          break;
        case 'adjust':
          if (op.brightness || op.contrast) {
            const b = op.brightness || 0;
            const c = op.contrast || 0;
            const bVal = b > 0 ? `+${b}` : b.toString();
            const cVal = c > 0 ? `+${c}` : c.toString();
            args.push('-brightness-contrast', `${bVal}x${cVal}`);
          }
          if (op.saturation) {
            args.push('-modulate', `100,100,${100 + op.saturation}`);
          }
          break;
        case 'filter':
          if (op.filterType === 'blur') args.push('-blur', `0x${op.intensity * 5}`);
          if (op.filterType === 'sharpen') args.push('-sharpen', `0x${op.intensity * 2}`);
          if (op.filterType === 'grayscale') args.push('-colorspace', 'Gray');
          break;
      }
    }
    
    args.push(outputPath);
    const result = await this.executeCommand(args);
    return result.command;
  }

  /**
   * 应用图片效果（图片裂变功能）
   * 支持多种效果：黑白化、颜色调整、滤镜、马赛克、模糊、锐化、浮雕、边缘检测、油画、素描、负片、怀旧、噪点、像素化等
   */
  async applyEffects(inputPath, outputPath, effects = []) {
    if (!Array.isArray(effects) || effects.length === 0) {
      throw new Error('至少需要指定一个效果');
    }

    const args = [inputPath];

    // 按顺序应用每个效果
    for (const effect of effects) {
      const { type, ...params } = effect;

      switch (type) {
        // ========== 基础效果 ==========
        case 'grayscale':
          // 黑白化（灰度）
          const grayscaleMethod = params.method || 'Rec601Luma';
          const grayscaleIntensity = params.intensity !== undefined ? params.intensity : 100;
          
          // 如果强度小于100%，使用去饱和度法（部分灰度化）
          if (grayscaleIntensity < 100) {
            // 通过调整饱和度来实现部分灰度化
            // 饱和度 = 100 - intensity，这样 intensity=100 时饱和度为0（完全灰度），intensity=0 时饱和度为100（原图）
            const saturation = 100 - grayscaleIntensity;
            args.push('-modulate', `100,${saturation},100`);
          } else {
            // 完全灰度化，根据方法选择不同的灰度转换方式
            if (grayscaleMethod === 'desaturate') {
              // 去饱和度法（通过将饱和度设为0）
              args.push('-modulate', '100,0,100');
            } else if (grayscaleMethod === 'average') {
              // 平均法：使用 -fx 计算RGB平均值
              args.push('-fx', '(r+g+b)/3');
            } else if (grayscaleMethod === 'luminance') {
              // 亮度加权法（Rec601标准：0.299*R + 0.587*G + 0.114*B）
              args.push('-fx', '0.299*r + 0.587*g + 0.114*b');
            } else if (grayscaleMethod === 'Rec709Luma') {
              // Rec709标准（0.2126*R + 0.7152*G + 0.0722*B）
              args.push('-fx', '0.2126*r + 0.7152*g + 0.0722*b');
            } else {
              // 默认使用 Rec601Luma（标准灰度转换）
              args.push('-colorspace', 'Gray');
            }
          }
          
          break;

        case 'negate':
          // 负片效果
          args.push('-negate');
          break;

        case 'sepia':
          // 怀旧效果（棕褐色调）
          const sepiaIntensity = params.intensity !== undefined ? params.intensity : 80;
          args.push('-sepia-tone', `${sepiaIntensity}%`);
          break;

        // ========== 模糊和锐化 ==========
        case 'blur':
          // 模糊
          const blurRadius = params.radius !== undefined ? params.radius : 5;
          const blurSigma = params.sigma !== undefined ? params.sigma : blurRadius;
          args.push('-blur', `${blurRadius}x${blurSigma}`);
          break;

        case 'gaussian-blur':
          // 高斯模糊
          const gaussianRadius = params.radius !== undefined ? params.radius : 5;
          args.push('-gaussian-blur', `${gaussianRadius}x${gaussianRadius}`);
          break;

        case 'motion-blur':
          // 运动模糊
          const motionRadius = params.radius !== undefined ? params.radius : 10;
          const motionAngle = params.angle !== undefined ? params.angle : 0;
          args.push('-motion-blur', `${motionRadius}x${motionAngle}`);
          break;

        case 'sharpen':
          // 锐化
          const sharpenRadius = params.radius !== undefined ? params.radius : 1;
          const sharpenAmount = params.amount !== undefined ? params.amount : 1;
          args.push('-sharpen', `${sharpenRadius}x${sharpenAmount}`);
          break;

        case 'unsharp':
          // 非锐化遮罩
          const unsharpRadius = params.radius !== undefined ? params.radius : 1;
          const unsharpAmount = params.amount !== undefined ? params.amount : 1;
          const unsharpThreshold = params.threshold !== undefined ? params.threshold : 0.05;
          args.push('-unsharp', `${unsharpRadius}x${unsharpAmount}+${unsharpThreshold}`);
          break;

        // ========== 艺术效果 ==========
        case 'charcoal':
          // 炭笔画效果
          const charcoalRadius = params.radius !== undefined ? params.radius : 1;
          const charcoalSigma = params.sigma !== undefined ? params.sigma : 0.5;
          args.push('-charcoal', `${charcoalRadius}x${charcoalSigma}`);
          break;

        case 'oil-painting':
          // 油画效果
          const oilRadius = params.radius !== undefined ? params.radius : 3;
          args.push('-paint', oilRadius.toString());
          break;

        case 'sketch':
          // 素描效果
          const sketchRadius = params.radius !== undefined ? params.radius : 1;
          const sketchSigma = params.sigma !== undefined ? params.sigma : 0.5;
          args.push('-sketch', `${sketchRadius}x${sketchSigma}`);
          break;

        case 'emboss':
          // 浮雕效果
          const embossRadius = params.radius !== undefined ? params.radius : 1;
          const embossSigma = params.sigma !== undefined ? params.sigma : 0.5;
          args.push('-emboss', `${embossRadius}x${embossSigma}`);
          break;

        case 'edge':
          // 边缘检测
          const edgeRadius = params.radius !== undefined ? params.radius : 1;
          args.push('-edge', edgeRadius.toString());
          break;

        case 'posterize':
          // 海报化（减少颜色数量）
          const posterizeLevels = params.levels !== undefined ? params.levels : 4;
          args.push('-posterize', posterizeLevels.toString());
          break;

        // ========== 像素化和马赛克 ==========
        case 'pixelate':
          // 像素化
          const pixelateSize = params.size !== undefined ? params.size : 10;
          args.push('-scale', `${pixelateSize}%`, '-scale', `${10000 / pixelateSize}%`);
          break;

        case 'mosaic':
          // 马赛克
          const mosaicSize = params.size !== undefined ? params.size : 10;
          args.push('-scale', `${100 / mosaicSize}%`, '-scale', `${mosaicSize * 100}%`);
          break;

        // ========== 颜色调整 ==========
        case 'brightness':
          // 亮度调整
          const brightness = params.value !== undefined ? params.value : 0;
          const brightnessValue = brightness > 0 ? `+${brightness}` : brightness.toString();
          args.push('-brightness-contrast', `${brightnessValue}x0`);
          break;

        case 'contrast':
          // 对比度调整
          const contrast = params.value !== undefined ? params.value : 0;
          const contrastValue = contrast > 0 ? `+${contrast}` : contrast.toString();
          args.push('-brightness-contrast', `0x${contrastValue}`);
          break;

        case 'saturation':
          // 饱和度调整
          const saturation = params.value !== undefined ? params.value : 0;
          const saturationValue = 100 + saturation;
          args.push('-modulate', `100,100,${saturationValue}`);
          break;

        case 'hue':
          // 色相调整
          const hue = params.value !== undefined ? params.value : 0;
          const hueValue = 100 + hue;
          args.push('-modulate', `${hueValue},100,100`);
          break;

        case 'colorize':
          // 着色
          const colorizeColor = params.color || '#FF0000';
          const colorizeIntensity = params.intensity !== undefined ? params.intensity : 50;
          args.push('-fill', colorizeColor);
          args.push('-colorize', `${colorizeIntensity}%`);
          break;

        case 'tint':
          // 色调调整
          const tintColor = params.color || '#FFD700';
          const tintIntensity = params.intensity !== undefined ? params.intensity : 50;
          args.push('-tint', `${tintIntensity}%`, tintColor);
          break;

        // ========== 噪点和纹理 ==========
        case 'noise':
          // 添加噪点
          const noiseType = params.noiseType || 'Uniform';
          // ImageMagick 的噪点类型：Uniform, Gaussian, Impulse, Laplacian, Poisson, Random
          args.push('-noise', noiseType);
          break;

        case 'despeckle':
          // 去噪点
          args.push('-despeckle');
          break;

        case 'texture':
          // 纹理效果
          const textureType = params.textureType || 'Canvas';
          // 可以使用的纹理：Canvas, Burlap, Canvas2, etc.
          args.push('-texture', textureType);
          break;

        // ========== 特殊效果 ==========
        case 'vignette':
          // 晕影效果
          const vignetteRadius = params.radius !== undefined ? params.radius : 100;
          const vignetteSigma = params.sigma !== undefined ? params.sigma : 50;
          // 使用 -vignette 参数（ImageMagick 7+）或通过模糊和合成实现
          if (this.command === 'magick') {
            args.push('-vignette', `${vignetteRadius}x${vignetteSigma}`);
          } else {
            // ImageMagick 6 使用模糊和合成
            args.push('(', '-clone', '0', '-fill', 'black', '-colorize', '100%', '-blur', `${vignetteRadius}x${vignetteSigma}`, ')', '-compose', 'multiply', '-composite');
          }
          break;

        case 'solarize':
          // 曝光效果
          const solarizeThreshold = params.threshold !== undefined ? params.threshold : 50;
          args.push('-solarize', `${solarizeThreshold}%`);
          break;

        case 'swirl':
          // 漩涡效果
          const swirlDegrees = params.degrees !== undefined ? params.degrees : 90;
          args.push('-swirl', swirlDegrees.toString());
          break;

        case 'wave':
          // 波浪效果
          const waveAmplitude = params.amplitude !== undefined ? params.amplitude : 25;
          const waveWavelength = params.wavelength !== undefined ? params.wavelength : 150;
          args.push('-wave', `${waveAmplitude}x${waveWavelength}`);
          break;

        case 'implode':
          // 内爆效果（向中心收缩）
          const implodeAmount = params.amount !== undefined ? params.amount : 0.5;
          args.push('-implode', implodeAmount.toString());
          break;

        case 'explode':
          // 爆炸效果（向外扩张）- 使用负的 implode 值
          const explodeAmount = params.amount !== undefined ? params.amount : 0.5;
          args.push('-implode', (-explodeAmount).toString());
          break;

        case 'spread':
          // 扩散效果
          const spreadRadius = params.radius !== undefined ? params.radius : 3;
          args.push('-spread', spreadRadius.toString());
          break;

        case 'normalize':
          // 标准化（增强对比度）
          args.push('-normalize');
          break;

        case 'equalize':
          // 均衡化（直方图均衡）
          args.push('-equalize');
          break;

        case 'gamma':
          // 伽马校正
          const gamma = params.value !== undefined ? params.value : 1.0;
          args.push('-gamma', gamma.toString());
          break;

        case 'threshold':
          // 阈值化（二值化）
          const threshold = params.value !== undefined ? params.value : 50;
          args.push('-threshold', `${threshold}%`);
          break;

        case 'quantize':
          // 量化（减少颜色数）
          const quantizeColors = params.colors !== undefined ? params.colors : 256;
          args.push('-colors', quantizeColors.toString());
          break;

        default:
          console.warn(`未知的效果类型: ${type}，已跳过`);
          break;
      }
    }

    args.push(outputPath);
    const result = await this.executeCommand(args);
    return result.command;
  }
}

module.exports = new ImageMagick();

