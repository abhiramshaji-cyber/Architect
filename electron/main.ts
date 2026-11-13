import path from 'node:path'
import { app, BrowserWindow, dialog, Menu, nativeImage, safeStorage, Tray } from 'electron'
import { SOCKET_PATH } from '../shared/socket'
import { errorText } from '../shared/text/error'
import type { Architecture, CodeMap, HistoryEntry, ProjectSummary, ReviewState } from '../shared/types'
import { wireIpc } from './app/ipc'
import { launchArgs } from './app/launch'
import { opensAtLogin } from './app/login'
import { broadcast, createWindow, killEveryPty, openFolders, openRoot, tabs, watchClaims } from './app/windows'
import { createDaemon } from './daemon'
import { loginPath } from './env'
import { createJev } from './jev'
import { wireJevIpc } from './jev/ipc'

const TRAY_ICON = nativeImage.createFromPath(
  path.join(import.meta.dirname, '../../assets/trayTemplate.png'),
)
TRAY_ICON.setTemplateImage(true)

const socketPath = process.env.ARCHITECT_SOCKET ?? (app.isPackaged ? SOCKET_PATH : `${SOCKET_PATH}-dev`)
let shown: string[] = []
const daemon = createDaemon({ socketPath, behavior: (root, file, symbol) => jev.similarBehavior(root, file, symbol), jevStatus: (root) => jev.status(root) })
const jev = createJev({
  dir: path.join(app.getPath('userData'), 'jev'),
  settings: path.join(path.dirname(socketPath), 'settings.json'),
  crypt: safeStorage,
  load: async (root) => {
    if (!daemon.projects().some((project) => project.root === root)) throw new Error(`${root} is not open in Architect`)
    return { map: daemon.codeMap(root) ?? (await daemon.rescan(root)), architecture: (await daemon.open(root)).architecture }
  },
  windows: () => shown.filter((root) => daemon.projects().some((project) => project.root === root)),
  onProgress: (progress) => broadcast('architect:jev', progress),
})
let tray: Tray | null = null

// dev and screenshot runs share userData with the installed app, so a lock there would quit them
const primary = socketPath !== SOCKET_PATH || app.requestSingleInstanceLock()
if (!primary) app.exit(0)

const pending: { cwd: string; args: string[] }[] = [{ cwd: process.cwd(), args: launchArgs(process.argv, process.defaultApp) }]
let started = false

function arrive(cwd: string, args: string[]): void {
  if (started) openFolders([{ cwd, args }])
  else pending.push({ cwd, args })
}

app.on('open-file', (event, file) => {
  event.preventDefault()
  arrive('/', [file])
})

app.on('second-instance', (_event, argv, cwd) => {
  arrive(cwd, launchArgs(argv, process.defaultApp))
  if (started) app.focus({ steal: true })
})

function createTray() {
  tray = new Tray(TRAY_ICON)
  tray.setContextMenu(Menu.buildFromTemplate([{ role: 'quit' }]))
  tray.setToolTip('Architect')
}

app.whenReady().then(async () => {
  if (!primary) return
  if (process.platform !== 'win32') process.env.PATH = await loginPath(process.env)
  wireIpc(daemon, path.dirname(socketPath))
  wireJevIpc(jev)
  watchClaims((roots) => {
    shown = roots
    jev.windowsChanged()
  })
  createTray()

  daemon.onChange((root: string, architecture: Architecture) => {
    broadcast('architect:change', root, architecture)
  })
  daemon.onHistory((entry: HistoryEntry) => {
    broadcast('architect:history', entry)
  })
  daemon.onProjects((projects: ProjectSummary[]) => {
    broadcast('architect:projects-update', projects)
    jev.indexOpen()
  })
  daemon.onCodeMap((root: string, map: CodeMap) => {
    broadcast('architect:code-map-update', root, map)
    if (jev.ready()) jev.index(root)
  })
  daemon.onSession((root: string, file: string) => void openRoot(root, file))
  daemon.onReview((state: ReviewState) => {
    tray?.setTitle(state.items.length > 0 ? String(state.items.length) : '')
    broadcast('architect:review', state)
  })

  try {
    await daemon.listen()
  } catch (err) {
    dialog.showErrorBox('Architect could not start', errorText(err))
    app.quit()
    return
  }

  const loginRun = {
    packaged: app.isPackaged,
    exePath: process.execPath,
    socketPath,
    platform: process.platform,
    localAppData: process.env.LOCALAPPDATA,
  }
  if (opensAtLogin(loginRun)) app.setLoginItemSettings({ openAtLogin: true })
  started = true
  openFolders(pending.splice(0))
})

app.on('will-quit', killEveryPty)
process.on('exit', killEveryPty)

app.on('new-window-for-tab', () => {
  createWindow(BrowserWindow.getFocusedWindow())
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

app.on('activate', () => {
  if (started && tabs.length === 0) createWindow(null)
})
