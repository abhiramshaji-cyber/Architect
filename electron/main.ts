import path from 'node:path'
import { app, BrowserWindow, dialog, Menu, nativeImage, Tray } from 'electron'
import { SOCKET_PATH } from '../shared/socket'
import { errorText } from '../shared/text/error'
import type { Architecture, CodeMap, HistoryEntry, ProjectSummary, ReviewState } from '../shared/types'
import { handle, wireIpc } from './app/ipc'
import { launchArgs } from './app/launch'
import { opensAtLogin } from './app/login'
import { broadcast, createWindow, killEveryPty, openFolders, openRoot, tabs } from './app/windows'
import { sameBehavior } from './clones'
import { forgetJev } from './clones/forget'
import { behaviorMarkdown } from './clones/render'
import { createDaemon } from './daemon'
import { loginPath } from './env'

const TRAY_ICON = nativeImage.createFromPath(
  path.join(import.meta.dirname, '../../assets/trayTemplate.png'),
)
TRAY_ICON.setTemplateImage(true)

const socketPath = process.env.ARCHITECT_SOCKET ?? (app.isPackaged ? SOCKET_PATH : `${SOCKET_PATH}-dev`)
const behaviorOf = async (root: string, file: string, symbol: string) => sameBehavior(root, daemon.codeMap(root) ?? (await daemon.rescan(root)), file, symbol)
const daemon = createDaemon({ socketPath, behavior: async (root, file, symbol) => behaviorMarkdown(await behaviorOf(root, file, symbol)) })
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
  forgetJev(app.getPath('userData'))
  handle('architect:same-behavior', behaviorOf)
  createTray()

  daemon.onChange((root: string, architecture: Architecture) => {
    broadcast('architect:change', root, architecture)
  })
  daemon.onHistory((entry: HistoryEntry) => {
    broadcast('architect:history', entry)
  })
  daemon.onProjects((projects: ProjectSummary[]) => {
    broadcast('architect:projects-update', projects)
  })
  daemon.onCodeMap((root: string, map: CodeMap) => {
    broadcast('architect:code-map-update', root, map)
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
