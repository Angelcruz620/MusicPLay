const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('musicplayDesktop', Object.freeze({
  getSettings: () => ipcRenderer.invoke('settings:get'),
  chooseMusicFolder: () => ipcRenderer.invoke('settings:music'),
  setYoutubeKey: value => ipcRenderer.invoke('settings:youtube', value)
}));
