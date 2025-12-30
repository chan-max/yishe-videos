// 等待 Vue 加载完成
function waitForVue(callback) {
  if (typeof Vue !== 'undefined') {
    callback();
  } else {
    setTimeout(function() {
      waitForVue(callback);
    }, 50);
  }
}

function initApp() {
  if (typeof Vue === 'undefined') {
    console.error('Vue 未加载');
    return;
  }
  
  const { createApp, reactive, watch, onMounted, computed, ref } = Vue;

  const BASE_URL = 'http://localhost:1571';

  createApp({
    setup() {
      const state = reactive({
        currentView: 'home',
        currentDebugTab: 'all',
        healthOk: null,
        ffmpegStatus: null,
        // 资源合成相关
        resources: [],
        newResourceUrl: '',
        editingResourceIndex: null,
        composeOptions: {
          width: 1280,
          height: 720,
          fps: 25,
          videoCodec: 'libx264',
          videoPreset: 'medium',
          videoCrf: 23,
          videoBitrate: '2000k',
          audioCodec: 'aac',
          audioBitrate: '192k',
          audioSampleRate: 44100,
          audioChannels: 2,
          backgroundColor: '#000000'
        },
        videoSizePresets: [
          { name: '自定义', width: null, height: null },
          { name: '手机竖屏 (1080x1920)', width: 1080, height: 1920 },
          { name: '手机横屏 (1920x1080)', width: 1920, height: 1080 },
          { name: '手机竖屏 (720x1280)', width: 720, height: 1280 },
          { name: '手机横屏 (1280x720)', width: 1280, height: 720 },
          { name: '平板 (2048x1536)', width: 2048, height: 1536 },
          { name: '平板横屏 (1920x1080)', width: 1920, height: 1080 },
          { name: '标准 720p (1280x720)', width: 1280, height: 720 },
          { name: '标准 1080p (1920x1080)', width: 1920, height: 1080 },
          { name: '2K (2560x1440)', width: 2560, height: 1440 },
          { name: '4K (3840x2160)', width: 3840, height: 2160 },
          { name: '8K (7680x4320)', width: 7680, height: 4320 },
          { name: '方形 (1080x1080)', width: 1080, height: 1080 },
          { name: '方形 (1920x1920)', width: 1920, height: 1920 },
          { name: '宽屏 21:9 (2560x1080)', width: 2560, height: 1080 },
          { name: '宽屏 21:9 (3440x1440)', width: 3440, height: 1440 }
        ],
        composeResultFile: null,
        composeResultFilename: null,
        // 文件管理
        filesCurrentDirectory: 'uploads',
        filesList: {
          uploads: [],
          output: []
        },
        filesLoading: {
          uploads: false,
          output: false
        },
        debugLogs: [],
        loading: {
          health: false,
          checkFfmpeg: false,
          addResource: false,
          compose: false
        }
      });

      const menuItems = [
        { id: 'home', name: '首页', icon: 'home' },
        { id: 'config', name: '服务配置', icon: 'cog' },
        { id: 'compose', name: '资源合成视频', icon: 'film' },
        { id: 'files', name: '文件管理', icon: 'folder' }
      ];


      const debugTabs = reactive([
        { id: 'all', name: '全部', count: 0 },
        { id: 'success', name: '成功', count: 0 },
        { id: 'error', name: '错误', count: 0 },
        { id: 'info', name: '信息', count: 0 }
      ]);

      function switchView(viewId) {
        state.currentView = viewId;
        if (viewId === 'files') {
          loadFilesList(state.filesCurrentDirectory);
        }
      }

      function addDebugLog(content, type = 'info') {
        const now = new Date();
        const time = now.toLocaleTimeString('zh-CN', { hour12: false });
        state.debugLogs.unshift({
          time,
          content,
          type
        });
        if (state.debugLogs.length > 200) {
          state.debugLogs = state.debugLogs.slice(0, 200);
        }
      }

      function clearDebugLog() {
        state.debugLogs = [];
        addDebugLog('调试日志已清空', 'info');
      }

      const filteredDebugLogs = computed(() => {
        if (state.currentDebugTab === 'all') {
          return state.debugLogs;
        }
        return state.debugLogs.filter(log => log.type === state.currentDebugTab);
      });

      watch(() => state.debugLogs, () => {
        debugTabs.forEach(tab => {
          if (tab.id === 'all') {
            tab.count = state.debugLogs.length;
          } else {
            tab.count = state.debugLogs.filter(log => log.type === tab.id).length;
          }
        });
      }, { immediate: true, deep: true });

      async function checkHealth() {
        state.loading.health = true;
        addDebugLog('开始健康检查...', 'info');
        try {
          const { data } = await axios.get(`${BASE_URL}/api/health`);
          state.healthOk = data?.status === 'healthy';
          addDebugLog(`健康检查: ${JSON.stringify(data, null, 2)}`, state.healthOk ? 'success' : 'error');
        } catch (e) {
          state.healthOk = false;
          addDebugLog(`健康检查失败: ${e.response?.data?.error || e.message}`, 'error');
        } finally {
          state.loading.health = false;
        }
      }

      async function checkFFmpeg() {
        state.loading.checkFfmpeg = true;
        addDebugLog('开始检测 FFmpeg...', 'info');
        try {
          const { data } = await axios.get(`${BASE_URL}/api/ffmpeg-status`);
          state.ffmpegStatus = data;
          addDebugLog(`FFmpeg 检测: ${data.message}`, data.installed ? 'success' : 'error');
        } catch (e) {
          state.ffmpegStatus = { installed: false, message: '检测失败' };
          addDebugLog(`FFmpeg 检测失败: ${e.response?.data?.error || e.message}`, 'error');
        } finally {
          state.loading.checkFfmpeg = false;
        }
      }

      // 资源合成相关函数
      function detectResourceType(filename) {
        const ext = filename.toLowerCase().split('.').pop();
        const imageExts = ['jpg', 'jpeg', 'png', 'gif', 'bmp', 'webp'];
        const videoExts = ['mp4', 'avi', 'mov', 'mkv', 'flv', 'webm', 'm4v', '3gp', 'wmv'];
        const audioExts = ['mp3', 'wav', 'aac', 'ogg', 'm4a', 'flac'];
        
        if (imageExts.includes(ext)) return 'image';
        if (videoExts.includes(ext)) return 'video';
        if (audioExts.includes(ext)) return 'audio';
        return 'unknown';
      }

      function getResourceIcon(type) {
        const icons = {
          image: 'image',
          video: 'video',
          audio: 'music',
          unknown: 'file'
        };
        return icons[type] || 'file';
      }

      function getResourceColor(type) {
        const colors = {
          image: '#2185d0',
          video: '#db2828',
          audio: '#21ba45',
          unknown: '#999'
        };
        return colors[type] || '#999';
      }

      function getResourceTypeName(type) {
        const names = {
          image: '图片',
          video: '视频',
          audio: '音频',
          unknown: '未知'
        };
        return names[type] || '未知';
      }

      function getTransitionName(transition) {
        const names = {
          none: '无',
          fade: '淡入淡出',
          fadein: '淡入',
          fadeout: '淡出',
          slideLeft: '从左滑入',
          slideRight: '从右滑入',
          slideUp: '从下滑入',
          slideDown: '从上滑入',
          zoomIn: '放大',
          zoomOut: '缩小'
        };
        return names[transition] || transition;
      }

      async function addResourceFromUrl() {
        if (!state.newResourceUrl || !state.newResourceUrl.trim()) {
          addDebugLog('请输入有效的资源 URL', 'error');
          return;
        }

        const url = state.newResourceUrl.trim();
        
        // 验证 URL 格式
        try {
          new URL(url);
        } catch (e) {
          addDebugLog('无效的 URL 格式', 'error');
          return;
        }

        state.loading.addResource = true;
        addDebugLog(`添加资源 URL: ${url}`, 'info');

        try {
          // 从 URL 推断资源类型
          const urlObj = new URL(url);
          const pathname = urlObj.pathname.toLowerCase();
          let resourceType = detectResourceType(pathname);
          
          // 如果无法从扩展名推断，尝试通过 HEAD 请求获取 Content-Type
          if (resourceType === 'unknown') {
            try {
              const headResponse = await axios.head(url, { timeout: 5000 });
              const contentType = headResponse.headers['content-type'] || '';
              if (contentType.startsWith('image/')) {
                resourceType = 'image';
              } else if (contentType.startsWith('video/')) {
                resourceType = 'video';
              } else if (contentType.startsWith('audio/')) {
                resourceType = 'audio';
              }
            } catch (e) {
              // HEAD 请求失败，尝试使用默认类型
              addDebugLog('无法确定资源类型，将尝试自动识别', 'info');
            }
          }

          // 如果仍然无法确定类型，要求用户选择
          if (resourceType === 'unknown') {
            const userChoice = confirm('无法自动识别资源类型，请选择：\n确定 = 图片\n取消 = 视频\n\n或者在 URL 中包含文件扩展名以便自动识别');
            resourceType = userChoice ? 'image' : 'video';
          }

          const originalName = pathname.split('/').pop() || url.split('/').pop() || 'resource';
          
          const resource = {
            id: Date.now() + Math.random(),
            url: url, // 直接存储 URL
            originalName: originalName,
            type: resourceType,
            duration: resourceType === 'image' ? 3 : undefined, // 图片默认3秒
            startTime: undefined,
            // 图片和视频的过渡效果
            transition: 'none',
            transitionDuration: 0.5,
            // 图片和视频的显示控制
            position: 'center', // center, top-left, top-right, bottom-left, bottom-right
            scaleMode: 'fit', // fit(适应), fill(填充), crop(裁剪)
            rotation: 0, // 旋转角度（度）
            opacity: 100, // 透明度（0-100）
            // 音频的淡入淡出和音量
            fade: 'none',
            fadeDuration: 1,
            volume: 100,
            source: 'url' // 标记资源来源为 URL
          };

          state.resources.push(resource);
          addDebugLog(`添加资源成功: ${originalName} (${getResourceTypeName(resourceType)}) [URL]`, 'success');
          state.newResourceUrl = '';
        } catch (e) {
          addDebugLog(`添加资源错误: ${e.response?.data?.error || e.message}`, 'error');
        } finally {
          state.loading.addResource = false;
        }
      }

      function removeResource(index) {
        const resource = state.resources[index];
        state.resources.splice(index, 1);
        addDebugLog(`删除资源: ${resource.originalName}`, 'info');
        if (state.editingResourceIndex === index) {
          state.editingResourceIndex = null;
        } else if (state.editingResourceIndex > index) {
          state.editingResourceIndex--;
        }
      }

      function editResource(index) {
        state.editingResourceIndex = index;
      }

      function saveResourceEdit() {
        if (state.editingResourceIndex !== null) {
          const resource = state.resources[state.editingResourceIndex];
          addDebugLog(`保存资源编辑: ${resource.originalName}`, 'info');
          state.editingResourceIndex = null;
        }
      }

      function cancelResourceEdit() {
        state.editingResourceIndex = null;
      }

      function applyVideoSizePreset(preset) {
        if (preset.width && preset.height) {
          state.composeOptions.width = preset.width;
          state.composeOptions.height = preset.height;
        }
      }

      function clearResources() {
        state.resources = [];
        state.editingResourceIndex = null;
        addDebugLog('已清空所有资源', 'info');
      }

      async function handleCompose() {
        if (state.resources.length === 0) {
          addDebugLog('请至少添加一个资源', 'error');
          return;
        }

        // 验证图片资源必须有 duration
        for (const resource of state.resources) {
          if (resource.type === 'image' && (!resource.duration || resource.duration <= 0)) {
            addDebugLog(`图片资源 "${resource.originalName}" 必须设置显示时长`, 'error');
            return;
          }
        }

        state.loading.compose = true;
        const payload = {
          resources: state.resources.map(r => {
            const resourceData = {
              type: r.type,
              duration: r.duration,
              startTime: r.startTime,
              transition: r.transition || 'none',
              transitionDuration: r.transitionDuration || 0.5,
              position: r.position || 'center',
              scaleMode: r.scaleMode || 'fit',
              rotation: r.rotation || 0,
              opacity: r.opacity !== undefined ? r.opacity : 100,
              fade: r.fade || 'none',
              fadeDuration: r.fadeDuration || 1,
              volume: r.volume !== undefined ? r.volume : 100
            };
            
            // 如果资源有 URL，优先使用 URL；否则使用 filename
            if (r.url) {
              resourceData.url = r.url;
            } else if (r.filename) {
              resourceData.filename = r.filename;
            }
            
            return resourceData;
          }),
          options: state.composeOptions
        };
        
        addDebugLog(`开始合成视频，资源数量: ${state.resources.length}`, 'info');
        const urlCount = state.resources.filter(r => r.url).length;
        if (urlCount > 0) {
          addDebugLog(`其中 ${urlCount} 个资源为线上URL，将在合成时自动下载`, 'info');
        }

        try {
          const { data } = await axios.post(`${BASE_URL}/api/compose`, payload);
          
          if (data.success) {
            state.composeResultFile = `${BASE_URL}${data.path}`;
            state.composeResultFilename = data.outputFile;
            addDebugLog(`合成成功: ${data.outputFile}`, 'success');
            if (data.command) {
              addDebugLog(`执行的命令: ${data.command}`, 'info');
            }
            if (data.downloadedFiles && data.downloadedFiles.length > 0) {
              addDebugLog(`已下载的文件: ${data.downloadedFiles.join(', ')}`, 'info');
            }
          } else {
            addDebugLog(`合成失败: ${data.error}`, 'error');
          }
        } catch (e) {
          addDebugLog(`合成错误: ${e.response?.data?.error || e.message}`, 'error');
        } finally {
          state.loading.compose = false;
        }
      }

      function switchFilesDirectory(directory) {
        state.filesCurrentDirectory = directory;
        loadFilesList(directory);
      }

      async function loadFilesList(directory) {
        state.filesLoading[directory] = true;
        addDebugLog(`加载 ${directory} 目录文件列表...`, 'info');
        
        try {
          const { data } = await axios.get(`${BASE_URL}/api/files/list`, {
            params: { directory }
          });
          
          if (data.success) {
            state.filesList[directory] = data.files;
            addDebugLog(`加载成功: ${data.files.length} 个文件`, 'success');
          } else {
            addDebugLog(`加载失败: ${data.error}`, 'error');
          }
        } catch (e) {
          addDebugLog(`加载错误: ${e.response?.data?.error || e.message}`, 'error');
        } finally {
          state.filesLoading[directory] = false;
        }
      }

      async function deleteFile(directory, filename) {
        if (!confirm(`确定要删除文件 ${filename} 吗？`)) {
          return;
        }
        
        addDebugLog(`删除文件: ${filename}`, 'info');
        try {
          const { data } = await axios.delete(`${BASE_URL}/api/files/delete`, {
            data: { directory, filename }
          });
          
          if (data.success) {
            addDebugLog(`删除成功: ${filename}`, 'success');
            loadFilesList(directory);
          } else {
            addDebugLog(`删除失败: ${data.error}`, 'error');
          }
        } catch (e) {
          addDebugLog(`删除错误: ${e.response?.data?.error || e.message}`, 'error');
        }
      }

      function formatFileSize(bytes) {
        if (bytes === 0) return '0 B';
        const k = 1024;
        const sizes = ['B', 'KB', 'MB', 'GB'];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        return Math.round(bytes / Math.pow(k, i) * 100) / 100 + ' ' + sizes[i];
      }

      onMounted(() => {
        addDebugLog('应用已加载', 'info');
      });

      return {
        state,
        menuItems,
        debugTabs,
        switchView,
        applyVideoSizePreset,
        checkHealth,
        checkFFmpeg,
        addResourceFromUrl,
        removeResource,
        editResource,
        saveResourceEdit,
        cancelResourceEdit,
        clearResources,
        handleCompose,
        getResourceIcon,
        getResourceColor,
        getResourceTypeName,
        getTransitionName,
        switchFilesDirectory,
        loadFilesList,
        deleteFile,
        formatFileSize,
        addDebugLog,
        clearDebugLog,
        filteredDebugLogs
      };
    }
  }).mount('#app');
}

waitForVue(initApp);

