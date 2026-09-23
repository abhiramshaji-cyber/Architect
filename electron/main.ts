import path from 'node:path'
import { app, BrowserWindow, dialog, ipcMain, Menu, nativeImage, Tray } from 'electron'
import { spawn as spawnPty } from 'node-pty'
import { SOCKET_PATH } from '../shared/socket'
import { type Architecture, type CodeMap, type IpcResult, type Pending, type ProjectSummary, type PtyEvent, type PtySpec } from '../shared/types'
import { createDaemon } from './daemon'
import * as git from './git/git'
import * as github from './github/github'
import { createPtyHost } from './pty/pty'

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

function handle<A extends unknown[], R>(channel: string, fn: (...args: A) => R | Promise<R>) {
  ipcMain.handle(channel, async (_event, ...args: A): Promise<IpcResult<Awaited<R>>> => {
    try {
      return { ok: true, value: await fn(...args) }
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) }
    }
  })
}

function wireIpc() {
  handle('architect:projects', () => daemon.projects())
  handle('architect:choose-directory', async () => {
    const { canceled, filePaths } = await dialog.showOpenDialog({ properties: ['openDirectory'] })
    return canceled ? null : filePaths[0] ?? null
  })
  handle('architect:create-contract', (root: string) => daemon.createContract(root))
  handle('architect:open', (root: string) => daemon.open(root))
  handle('architect:close-project', (root: string) => daemon.closeProject(root))
  handle('architect:pending', () => daemon.pending())
  handle('architect:decide', (id: string, approved: boolean, reason?: string, component?: string) =>
    daemon.decide(id, approved, reason, component),
  )
  handle('architect:edits', (root: string) => daemon.edits(root))
  handle('architect:edit', (root: string, id: string) => daemon.edit(root, id))
  handle('architect:create-edit', (root: string, architecture: Architecture) =>
    daemon.createEdit(root, architecture),
  )
  handle('architect:update-edit', (root: string, id: string, architecture: Architecture) =>
    daemon.updateEdit(root, id, architecture),
  )
  handle('architect:hand-edit', (root: string, id: string) => daemon.handEdit(root, id))
  handle('architect:delete-edit', (root: string, id: string) => daemon.deleteEdit(root, id))
  handle('architect:code-map', (root: string) => daemon.codeMap(root))
  handle('architect:rescan', (root: string) => daemon.rescan(root))
  handle('architect:ownership', (root: string) => daemon.ownership(root))
  handle('architect:read-source', (root: string, file: string, from: number, length: number) =>
    daemon.readSource(root, file, from, length),
  )

  handle('architect:pty-spawn', (spec: PtySpec) => ptyHost.spawn(spec))
  handle('architect:pty-write', (id: string, data: string) => ptyHost.write(id, data))
  handle('architect:pty-resize', (id: string, cols: number, rows: number) =>
    ptyHost.resize(id, cols, rows),
  )
  handle('architect:pty-kill', (id: string) => ptyHost.kill(id))

  handle('architect:git-status', (root: string) => git.status(root))
  handle('architect:git-default-branch', (root: string) => git.defaultBranch(root))
  handle('architect:git-local-branches', (root: string) => git.localBranches(root))
  handle('architect:git-remote-branches', (root: string) => git.remoteBranches(root))
  handle('architect:git-worktrees', (root: string) => git.worktrees(root))
  handle('architect:git-fetch', (root: string) => git.fetch(root))
  handle('architect:git-create-worktree', (root: string, target: string, name: string, base?: string) =>
    git.createWorktree(root, target, name, base),
  )
  handle('architect:git-remove-worktree', (root: string, target: string) =>
    git.removeWorktree(root, target),
  )
  handle('architect:git-prune-worktrees', (root: string) => git.pruneWorktrees(root))

  handle('architect:github-auth', () => github.auth())
  handle('architect:github-repos', (limit?: number) => github.repos(limit))
  handle('architect:github-branches', (owner: string, repo: string) => github.branches(owner, repo))
  handle('architect:github-rates', () => github.rates())
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
  daemon.onCodeMap((root: string, map: CodeMap) => {
    mainWindow?.webContents.send('architect:code-map-update', root, map)
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
