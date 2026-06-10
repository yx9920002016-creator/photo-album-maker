const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  scanPhotos: (rootDir) => ipcRenderer.invoke('scan-photos', rootDir),
  getThumbnail: (filePath, maxSize) => ipcRenderer.invoke('get-thumbnail', filePath, maxSize),
  getFullImage: (filePath) => ipcRenderer.invoke('get-full-image', filePath),
  selectDirectory: () => ipcRenderer.invoke('select-directory'),
  exportPdf: (options) => ipcRenderer.invoke('export-pdf', options),
  exportImages: (options) => ipcRenderer.invoke('export-images', options),
  saveProject: (data) => ipcRenderer.invoke('save-project', data),
  openProject: () => ipcRenderer.invoke('open-project')
});
