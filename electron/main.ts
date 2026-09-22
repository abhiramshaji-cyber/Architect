import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { app, BrowserWindow, dialog, ipcMain, Menu, nativeImage, Tray } from 'electron'
import { spawn as spawnPty } from 'node-pty'
import { SOCKET_PATH } from '../shared/socket'
import { type Architecture, type Pending, type ProjectSummary, type PtyEvent, type PtySpec } from '../shared/types'
import { createDaemon } from './daemon'
import { createPtyHost } from './pty/pty'

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

const ptyHost = createPtyHost(spawnPty, (event: PtyEvent) => {
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('architect:pty-event', event)
})

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

  window.on('closed', () => ptyHost.killAll())
  window.webContents.on('render-process-gone', () => ptyHost.killAll())
  window.webContents.on('did-start-navigation', (details) => {
    if (details.isMainFrame && !details.isSameDocument) ptyHost.killAll()
  })

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
  ipcMain.handle('architect:code-map', (_event, root: string) => daemon.codeMap(root))
  ipcMain.handle('architect:rescan', (_event, root: string) => daemon.rescan(root))
  ipcMain.handle('architect:ownership', (_event, root: string) => daemon.ownership(root))
  ipcMain.handle(
    'architect:read-source',
    (_event, root: string, file: string, from: number, length: number) =>
      daemon.readSource(root, file, from, length),
  )

  ipcMain.handle('architect:pty-spawn', (_event, spec: PtySpec) => ptyHost.spawn(spec))
  ipcMain.handle('architect:pty-write', (_event, id: string, data: string) => ptyHost.write(id, data))
  ipcMain.handle('architect:pty-resize', (_event, id: string, cols: number, rows: number) =>
    ptyHost.resize(id, cols, rows),
  )
  ipcMain.handle('architect:pty-kill', (_event, id: string) => ptyHost.kill(id))
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
  daemon.onProjects((projects: ProjectSummary[]) => {
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

app.on('will-quit', () => {
  ptyHost.killAll()
})

process.on('exit', () => {
  ptyHost.killAll()
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) mainWindow = createWindow()
})
