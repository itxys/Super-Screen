const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('electronAPI', {
  getDesktopSources: () => ipcRenderer.invoke('get-sources'),
  getAppPath: () => ipcRenderer.invoke('get-app-path'),
  getScreenSize: () => ipcRenderer.invoke('get-screen-size'),
  
  updateFloatingState: (state) => ipcRenderer.send('update-floating-state', state),
  showMainWindow: () => ipcRenderer.send('show-main-window'),
  moveFloatingWindow: (x, y) => ipcRenderer.send('floating-window-move', x, y),
  
  onFloatingStateUpdate: (callback) => {
    ipcRenderer.on('floating-state-update', (event, state) => callback(state))
  },
  onToggleRecording: (callback) => {
    ipcRenderer.on('toggle-recording', () => callback())
  },
  
  removeAllListeners: (channel) => {
    ipcRenderer.removeAllListeners(channel)
  }
})
