import path from 'node:path'
import { app, BrowserWindow, ipcMain, Menu, nativeImage, Tray } from 'electron'
import { SOCKET_PATH, type Architecture, type Pending } from '../shared/types'
import { createDaemon } from './daemon'

const TRAY_ICON = nativeImage.createFromPath(
  path.join(import.meta.dirname, '../../assets/trayTemplate.png'),
)
TRAY_ICON.setTemplateImage(true)

const daemon = createDaemon({
  socketPath: process.env.ARCHITECT_SOCKET ?? (app.isPackaged ? SOCKET_PATH : `${SOCKET_PATH}-dev`),
})
let mainWindow: BrowserWindow | null = null
let tray: Tray | null = null

function createWindow(): BrowserWindow {
  const window = new BrowserWindow({
    width: 1200,
    height: 800,
    webPreferences: {
      preload: path.join(import.meta.dirname, '../preload/preload.mjs'),
      sandbox: false,
    },
  })

  if (process.env.ELECTRON_RENDERER_URL) {
    window.loadURL(process.env.ELECTRON_RENDERER_URL)
  } else {
    window.loadFile(path.join(import.meta.dirname, '../renderer/index.html'))
  }

  return window
}

function updateTray(pending: Pending[]) {
  tray?.setTitle(pending.length > 0 ? String(pending.length) : '')
  tray?.setToolTip(`Architect (${pending.length} pending)`)
}

function createTray() {
  tray = new Tray(TRAY_ICON)
  tray.setContextMenu(Menu.buildFromTemplate([{ role: 'quit' }]))
  updateTray(daemon.pending())
}

function wireIpc() {
  ipcMain.handle('architect:projects', () => daemon.projects())
  ipcMain.handle('architect:open', (_event, root: string) => daemon.open(root))
  ipcMain.handle('architect:pending', () => daemon.pending())
  ipcMain.handle('architect:decide', (_event, id: string, approved: boolean, reason?: string, component?: string) =>
    daemon.decide(id, approved, reason, component),
  )
  ipcMain.handle('architect:move', (_event, id: string, x: number, y: number) => daemon.move(id, x, y))
}

app.whenReady().then(async () => {
  wireIpc()
  createTray()

  daemon.onChange((architecture: Architecture) => {
    mainWindow?.webContents.send('architect:change', architecture)
  })
  daemon.onPending((pending: Pending[]) => {
    updateTray(pending)
    mainWindow?.webContents.send('architect:pending-update', pending)
  })

  await daemon.listen()
  app.setLoginItemSettings({ openAtLogin: true })
  mainWindow = createWindow()
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) mainWindow = createWindow()
})
