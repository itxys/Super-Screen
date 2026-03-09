const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('electronAPI', {
  getDesktopSources: () => ipcRenderer.invoke('get-sources'),
  getAppPath: () => ipcRenderer.invoke('get-app-path')
})
