const ffmpeg = require('fluent-ffmpeg');
const path = require('path');
const fs = require('fs');

// 可选：通过环境变量指定 ffmpeg 路径（例如 C:\ffmpeg\bin\ffmpeg.exe）
if (process.env.FFMPEG_PATH) {
  ffmpeg.setFfmpegPath(process.env.FFMPEG_PATH);
}

const inputImage = path.resolve(__dirname, 'test.jpg');
const outputVideo = path.resolve(__dirname, 'output.mp4');

const durationSeconds = 5; // 输出视频时长
const fps = 25; // 帧率
const resolution = '1280x720'; // 输出分辨率

if (!fs.existsSync(inputImage)) {
  throw new Error(`找不到输入图片: ${inputImage}`);
}

ffmpeg()
  .addInput(inputImage)
  .loop(durationSeconds) // 让这张图片持续显示指定秒数
  .inputOptions(['-framerate', String(fps)])
  .videoCodec('libx264')
  .size(resolution)
  .fps(fps)
  .outputOptions(['-pix_fmt', 'yuv420p']) // 提高兼容性
  .duration(durationSeconds)
  .on('start', (cmd) => console.log('ffmpeg 命令:', cmd))
  .on('progress', (p) => p.percent && console.log(`进度: ${p.percent.toFixed(2)}%`))
  .on('end', () => console.log('完成，生成文件:', outputVideo))
  .on('error', (err) => console.error('出错:', err.message))
  .save(outputVideo);

