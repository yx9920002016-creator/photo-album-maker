const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const path = require('path');
const fs = require('fs');

let mainWindow;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 1200,
    minHeight: 700,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.js')
    },
    title: '成长相册排版软件',
    icon: path.join(__dirname, 'assets', 'icon.png'),
    autoHideMenuBar: true
  });

  mainWindow.loadFile('index.html');
  mainWindow.maximize();
}

// 扫描照片目录
ipcMain.handle('scan-photos', async (event, rootDir) => {
  const result = [];
  
  function scanDir(dirPath, yearFolder, monthFolder) {
    try {
      const entries = fs.readdirSync(dirPath, { withFileTypes: true });
      const photos = [];
      
      for (const entry of entries) {
        const fullPath = path.join(dirPath, entry.name);
        if (entry.isDirectory()) {
          scanDir(fullPath, yearFolder || entry.name, monthFolder || entry.name);
        } else {
          const ext = path.extname(entry.name).toLowerCase();
          if (['.jpg', '.jpeg', '.png', '.webp', '.bmp', '.gif'].includes(ext)) {
            const stat = fs.statSync(fullPath);
            photos.push({
              name: entry.name,
              path: fullPath,
              size: stat.size,
              mtime: stat.mtime.toISOString(),
              yearFolder: yearFolder,
              monthFolder: monthFolder
            });
          }
        }
      }
      
      if (photos.length > 0 && yearFolder && monthFolder) {
        result.push({
          yearFolder,
          monthFolder,
          photos: photos.sort((a, b) => a.name.localeCompare(b.name, 'zh'))
        });
      }
    } catch (e) {
      // skip inaccessible dirs
    }
  }

  scanDir(rootDir, null, null);
  
  // 按年份分组
  const grouped = {};
  for (const month of result) {
    const yf = month.yearFolder;
    if (!grouped[yf]) grouped[yf] = [];
    grouped[yf].push(month);
  }
  
  // 排序
  for (const key of Object.keys(grouped)) {
    grouped[key].sort((a, b) => a.monthFolder.localeCompare(b.monthFolder));
  }
  
  return grouped;
});

// 获取缩略图（读取文件buffer给前端）
ipcMain.handle('get-thumbnail', async (event, filePath, maxSize) => {
  try {
    const sharp = require('sharp');
    const buffer = await sharp(filePath)
      .resize(maxSize || 300, maxSize || 300, { fit: 'inside', withoutEnlargement: true })
      .jpeg({ quality: 80 })
      .toBuffer();
    return buffer.toString('base64');
  } catch (e) {
    return null;
  }
});

// 获取原图
ipcMain.handle('get-full-image', async (event, filePath) => {
  try {
    const buffer = fs.readFileSync(filePath);
    return buffer.toString('base64');
  } catch (e) {
    return null;
  }
});

// 选择目录对话框
ipcMain.handle('select-directory', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ['openDirectory'],
    title: '选择照片根目录'
  });
  return result.canceled ? null : result.filePaths[0];
});

// 导出PDF
ipcMain.handle('export-pdf', async (event, options) => {
  const result = await dialog.showSaveDialog(mainWindow, {
    title: '导出相册PDF',
    defaultPath: '成长相册.pdf',
    filters: [{ name: 'PDF文件', extensions: ['pdf'] }]
  });
  if (result.canceled) return null;
  return result.filePath;
});

// 导出图片包
ipcMain.handle('export-images', async (event, options) => {
  const result = await dialog.showSaveDialog(mainWindow, {
    title: '导出打印图片包',
    defaultPath: '成长相册-打印包.zip',
    filters: [{ name: 'ZIP压缩包', extensions: ['zip'] }]
  });
  if (result.canceled) return null;
  return result.filePath;
});

// 保存排版项目
ipcMain.handle('save-project', async (event, data) => {
  const result = await dialog.showSaveDialog(mainWindow, {
    title: '保存排版项目',
    defaultPath: '成长相册-排版.album',
    filters: [{ name: '相册项目文件', extensions: ['album'] }]
  });
  if (result.canceled) return null;
  try {
    fs.writeFileSync(result.filePath, JSON.stringify(data, null, 2), 'utf-8');
    return result.filePath;
  } catch (e) {
    return null;
  }
});

// 打开排版项目
ipcMain.handle('open-project', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    title: '打开排版项目',
    filters: [{ name: '相册项目文件', extensions: ['album'] }],
    properties: ['openFile']
  });
  if (result.canceled) return null;
  try {
    const data = fs.readFileSync(result.filePaths[0], 'utf-8');
    return JSON.parse(data);
  } catch (e) {
    return null;
  }
});

app.whenReady().then(createWindow);
app.on('window-all-closed', () => app.quit());
