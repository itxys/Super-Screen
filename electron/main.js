const { app, BrowserWindow, ipcMain, desktopCapturer, screen, globalShortcut, Tray, Menu, nativeImage } = require('electron')
const path = require('path')

let mainWindow = null
let floatingWindow = null
let tray = null

const isDev = process.env.NODE_ENV === 'development'

function createMainWindow() {
  const { width, height } = screen.getPrimaryDisplay().workAreaSize
  
  mainWindow = new BrowserWindow({
    width: 900,
    height: 700,
    minWidth: 800,
    minHeight: 600,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.js')
    },
    frame: true,
    show: false,
    backgroundColor: '#1a1a2e',
    title: 'Super Screen'
  })

  mainWindow.once('ready-to-show', () => {
    mainWindow.show()
  })

  if (isDev) {
    mainWindow.loadURL('http://localhost:5173')
    mainWindow.webContents.openDevTools()
  } else {
    mainWindow.loadFile(path.join(__dirname, '../dist/index.html'))
  }

  mainWindow.on('closed', () => {
    mainWindow = null
    if (floatingWindow) {
      floatingWindow.close()
    }
  })
}

function createFloatingWindow() {
  const display = screen.getPrimaryDisplay()
  const { width: screenWidth, height: screenHeight } = display.workAreaSize

  floatingWindow = new BrowserWindow({
    width: 280,
    height: 50,
    x: screenWidth - 300,
    y: 20,
    frame: false,
    transparent: true,
    alwaysOnTop: true,
    skipTaskbar: true,
    resizable: false,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.js')
    }
  })

  if (isDev) {
    floatingWindow.loadURL('http://localhost:5173/#/floating')
  } else {
    floatingWindow.loadFile(path.join(__dirname, '../dist/index.html'), { hash: '/floating' })
  }

  floatingWindow.setVisibleOnAllWorkspaces(true)
}

app.whenReady().then(() => {
  createMainWindow()
  createFloatingWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createMainWindow()
    }
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})

ipcMain.handle('get-sources', async () => {
  try {
    const sources = await desktopCapturer.getSources({
      types: ['window', 'screen'],
      thumbnailSize: { width: 320, height: 180 }
    })
    
    return sources.map(source => ({
      id: source.id,
      name: source.name,
      thumbnail: source.thumbnail.toDataURL()
    }))
  } catch (error) {
    console.error('获取屏幕源失败:', error)
    return []
  }
})

ipcMain.handle('get-app-path', () => {
  return app.getPath('userData')
})

ipcMain.on('update-floating-state', (event, state) => {
  if (floatingWindow) {
    floatingWindow.webContents.send('floating-state-update', state)
  }
})

ipcMain.on('show-main-window', () => {
  if (mainWindow) {
    mainWindow.show()
    mainWindow.focus()
  }
})

ipcMain.on('floating-window-move', (event, x, y) => {
  if (floatingWindow) {
    floatingWindow.setPosition(x, y)
  }
})

ipcMain.handle('get-screen-size', () => {
  const display = screen.getPrimaryDisplay()
  return {
    width: display.workAreaSize.width,
    height: display.workAreaSize.height
  }
})

globalShortcut.register('CommandOrControl+Shift+R', () => {
  if (mainWindow) {
    mainWindow.webContents.send('toggle-recording')
  }
  if (floatingWindow) {
    floatingWindow.webContents.send('toggle-recording')
  }
})
