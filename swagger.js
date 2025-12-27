const swaggerJsdoc = require('swagger-jsdoc');

const options = {
  definition: {
    openapi: '3.0.0',
    info: {
      title: 'FFmpeg 视频处理 API',
      version: '1.0.0',
      description: '基于 FFmpeg 的全面视频处理服务 API 文档',
      contact: {
        name: 'API Support',
      },
    },
    servers: [
      {
        url: 'http://localhost:1571',
        description: '开发服务器',
      },
    ],
    tags: [
      {
        name: 'Health',
        description: '健康检查和状态检测',
      },
      {
        name: 'Upload',
        description: '文件上传',
      },
      {
        name: 'Info',
        description: '视频信息',
      },
      {
        name: 'Process',
        description: '视频处理',
      },
      {
        name: '文件管理',
        description: '文件管理',
      },
    ],
    components: {
      schemas: {
        Error: {
          type: 'object',
          properties: {
            error: {
              type: 'string',
              description: '错误信息',
            },
          },
        },
        Success: {
          type: 'object',
          properties: {
            success: {
              type: 'boolean',
              description: '是否成功',
            },
          },
        },
        UploadResponse: {
          type: 'object',
          properties: {
            success: {
              type: 'boolean',
            },
            filename: {
              type: 'string',
              description: '服务器保存的文件名',
            },
            originalName: {
              type: 'string',
              description: '原始文件名',
            },
            path: {
              type: 'string',
              description: '文件访问路径',
            },
            size: {
              type: 'integer',
              description: '文件大小（字节）',
            },
          },
        },
        VideoInfo: {
          type: 'object',
          properties: {
            format: {
              type: 'string',
              description: '视频格式',
            },
            duration: {
              type: 'number',
              description: '时长（秒）',
            },
            size: {
              type: 'integer',
              description: '文件大小（字节）',
            },
            bitrate: {
              type: 'integer',
              description: '比特率',
            },
            video: {
              type: 'object',
              properties: {
                codec: { type: 'string' },
                width: { type: 'integer' },
                height: { type: 'integer' },
                fps: { type: 'number' },
                bitrate: { type: 'integer' },
                pixelFormat: { type: 'string' },
              },
            },
            audio: {
              type: 'object',
              properties: {
                codec: { type: 'string' },
                sampleRate: { type: 'integer' },
                channels: { type: 'integer' },
                bitrate: { type: 'integer' },
              },
            },
          },
        },
        ProcessResponse: {
          type: 'object',
          properties: {
            success: {
              type: 'boolean',
            },
            outputFile: {
              type: 'string',
              description: '输出文件名',
            },
            path: {
              type: 'string',
              description: '输出文件访问路径',
            },
            commands: {
              type: 'array',
              items: { type: 'string' },
            },
          },
        },
        HealthResponse: {
          type: 'object',
          properties: {
            status: {
              type: 'string',
              enum: ['healthy', 'unhealthy'],
            },
            ffmpeg: {
              type: 'object',
              properties: {
                installed: {
                  type: 'boolean',
                },
                version: {
                  type: 'string',
                  nullable: true,
                },
                message: {
                  type: 'string',
                },
              },
            },
          },
        },
        FFmpegStatus: {
          type: 'object',
          properties: {
            success: {
              type: 'boolean',
            },
            installed: {
              type: 'boolean',
            },
            version: {
              type: 'string',
              nullable: true,
            },
            message: {
              type: 'string',
            },
          },
        },
      },
    },
  },
  apis: ['./server.js'],
};

const swaggerSpec = swaggerJsdoc(options);

module.exports = swaggerSpec;

