import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { app, BrowserWindow, dialog, ipcMain, Menu, nativeImage, Tray } from 'electron'
import { SOCKET_PATH, type Architecture, type Pending } from '../shared/types'
import { createDaemon } from './daemon'

const MCP_BRIDGE_PATH = path.join(os.homedir(), '.architect', 'bin', 'architect-mcp.mjs')

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
  ipcMain.handle('architect:mcp-bridge-info', () => ({
    path: MCP_BRIDGE_PATH,
    exists: fs.existsSync(MCP_BRIDGE_PATH),
  }))
  ipcMain.handle('architect:pending', () => daemon.pending())
  ipcMain.handle('architect:decide', (_event, id: string, approved: boolean, reason?: string, component?: string) =>
    daemon.decide(id, approved, reason, component),
  )
  ipcMain.handle('architect:edits', (_event, root: string) => daemon.edits(root))
  ipcMain.handle('architect:edit', (_event, root: string, id: string) => daemon.edit(root, id))
  ipcMain.handle('architect:create-edit', (_event, root: string, architecture: Architecture) =>
    daemon.createEdit(root, architecture),
  )
  ipcMain.handle('architect:update-edit', (_event, root: string, id: string, architecture: Architecture) =>
    daemon.updateEdit(root, id, architecture),
  )
  ipcMain.handle('architect:hand-edit', (_event, root: string, id: string) => daemon.handEdit(root, id))
  ipcMain.handle('architect:delete-edit', (_event, root: string, id: string) => daemon.deleteEdit(root, id))
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
  daemon.onProjects((projects: { root: string; title: string }[]) => {
    mainWindow?.webContents.send('architect:projects-update', projects)
  })

  try {
    await daemon.listen()
  } catch (err) {
    dialog.showErrorBox('Architect could not start', err instanceof Error ? err.message : String(err))
    app.quit()
    return
  }

  app.setLoginItemSettings({ openAtLogin: true })
  mainWindow = createWindow()
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) mainWindow = createWindow()
})
