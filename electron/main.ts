import path from 'node:path'
import { app, BrowserWindow, dialog, ipcMain, Menu, nativeImage, Tray } from 'electron'
import { spawn as spawnPty } from 'node-pty'
import { SOCKET_PATH } from '../shared/socket'
import {
  type Architecture,
  type ChangedFile,
  type CodeMap,
  type CommitDraft,
  type DiffSection,
  type DraftResult,
  type GithubCompare,
  type GithubResult,
  type IpcResult,
  type OpenChoice,
  type OpenResult,
  type OpenedBranch,
  type Pending,
  type ProjectSummary,
  type PtyEvent,
  type PtySpec,
  type PullDraft,
} from '../shared/types'
import { createDaemon } from './daemon'
import * as message from './draft/message'
import * as diff from './git/diff'
import * as git from './git/git'
import * as open from './git/open'
import * as github from './github/github'
import { createPtyHost } from './pty/pty'
import { TAB_DIGITS, TAB_GROUP, claim, owner, tabIndex } from './tabs'

const TRAY_ICON = nativeImage.createFromPath(
  path.join(import.meta.dirname, '../../assets/trayTemplate.png'),
)
TRAY_ICON.setTemplateImage(true)

const daemon = createDaemon({
  socketPath: process.env.ARCHITECT_SOCKET ?? (app.isPackaged ? SOCKET_PATH : `${SOCKET_PATH}-dev`),
})
let tray: Tray | null = null

const TABBED = process.platform === 'darwin'

const tabs: BrowserWindow[] = []
const hosts = new Map<number, ReturnType<typeof createPtyHost>>()
const claims = new Map<number, string>()
const compares = new Map<number, AbortController>()

function broadcast(channel: string, ...args: unknown[]): void {
  for (const tab of tabs) if (!tab.isDestroyed()) tab.webContents.send(channel, ...args)
}

function hostOf(window: BrowserWindow) {
  const host = hosts.get(window.id)
  if (!host) throw new Error('this window has no terminal host')
  return host
}

function stopCompare(window: BrowserWindow): void {
  compares.get(window.id)?.abort()
  compares.delete(window.id)
}

function forget(window: BrowserWindow): void {
  hosts.get(window.id)?.killAll()
  hosts.delete(window.id)
  claims.delete(window.id)
  stopCompare(window)

  const index = tabs.indexOf(window)
  if (index >= 0) tabs.splice(index, 1)
}

function onChord(window: BrowserWindow, event: Electron.Event, input: Electron.Input): void {
  if (input.type !== 'keyDown' || input.alt || input.shift) return
  const command = TABBED ? input.meta && !input.control : input.control && !input.meta
  if (!command) return

  if (input.code === 'KeyT') {
    event.preventDefault()
    createWindow(window)
    return
  }

  const digit = TAB_DIGITS.indexOf(input.code) + 1
  if (digit < 1) return

  event.preventDefault()
  const index = tabIndex(digit, tabs.length)
  if (index !== null) tabs[index]?.focus()
}

function createWindow(sibling: BrowserWindow | null): BrowserWindow {
  const window = new BrowserWindow({
    width: 1200,
    height: 800,
    tabbingIdentifier: TABBED ? TAB_GROUP : undefined,
    webPreferences: {
      preload: path.join(import.meta.dirname, '../preload/preload.mjs'),
      sandbox: false,
    },
  })

  tabs.push(window)
  hosts.set(
    window.id,
    createPtyHost(spawnPty, (event: PtyEvent) => {
      if (!window.isDestroyed()) window.webContents.send('architect:pty-event', event)
    }),
  )

  if (TABBED && sibling && !sibling.isDestroyed()) sibling.addTabbedWindow(window)

  if (process.env.ELECTRON_RENDERER_URL) {
    window.loadURL(process.env.ELECTRON_RENDERER_URL)
  } else {
    window.loadFile(path.join(import.meta.dirname, '../renderer/index.html'))
  }

  window.on('closed', () => forget(window))
  window.webContents.on('render-process-gone', () => hosts.get(window.id)?.killAll())
  window.webContents.on('did-start-navigation', (details) => {
    if (details.isMainFrame && !details.isSameDocument) hosts.get(window.id)?.killAll()
  })
  window.webContents.on('before-input-event', (event, input) => onChord(window, event, input))

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

function handleIn<A extends unknown[], R>(
  channel: string,
  fn: (window: BrowserWindow, ...args: A) => R | Promise<R>,
) {
  ipcMain.handle(channel, async (event, ...args: A): Promise<IpcResult<Awaited<R>>> => {
    const window = BrowserWindow.fromWebContents(event.sender)
    if (!window) return { ok: false, error: 'no window for this request' }

    try {
      return { ok: true, value: await fn(window, ...args) }
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) }
    }
  })
}

function handle<A extends unknown[], R>(channel: string, fn: (...args: A) => R | Promise<R>) {
  handleIn<A, R>(channel, (_window, ...args) => fn(...args))
}

async function openRepoBranch(
  repo: string,
  branch: string,
  choice: OpenChoice,
  pr?: number,
): Promise<OpenResult<OpenedBranch>> {
  const planned = await open.plan(open.GITHUB_DIR, repo, branch, pr)
  if (!planned.ok) return { ok: false, error: { source: 'git', error: planned.error } }

  const target = planned.value
  if (target.kind === 'clone') {
    const cloned = await github.clone(repo, target.basePath)
    if (!cloned.ok) return { ok: false, error: { source: 'github', error: cloned.error } }
  }

  const opened =
    target.kind !== 'existing'
      ? await open.create(target.basePath, target.worktreePath, branch, repo, pr)
      : choice === 'keep'
        ? await open.keep(target.existing, branch, repo)
        : await open.clean(target.basePath, target.existing, target.worktreePath, branch, repo, pr)

  return opened.ok ? opened : { ok: false, error: { source: 'git', error: opened.error } }
}

function wireIpc() {
  handle('architect:projects', () => daemon.projects())
  handle('architect:create-contract', (root: string) => daemon.createContract(root))
  handle('architect:draft-contract', (root: string) => daemon.draftContract(root))
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
  handle('architect:open-source', (root: string, file: string) => daemon.openSource(root, file))
  handle('architect:write-source', (root: string, file: string, text: string, baseline: string) =>
    daemon.writeSource(root, file, text, baseline),
  )
  handle('architect:read-tree', (root: string, dir: string) => daemon.readTree(root, dir))

  handleIn('architect:claim-root', (window, root: string) =>
    claim(claims, (id) => tabs.some((tab) => tab.id === id), window.id, root),
  )
  handleIn('architect:release-root', (window) => {
    claims.delete(window.id)
  })
  handle('architect:focus-root', (root: string) => {
    const held = owner(claims, root)
    const holder = held === null ? undefined : tabs.find((tab) => tab.id === held)
    holder?.focus()
    return holder !== undefined
  })

  handleIn('architect:pty-spawn', (window, spec: PtySpec) => hostOf(window).spawn(spec))
  handleIn('architect:pty-write', (window, id: string, data: string) => hostOf(window).write(id, data))
  handleIn('architect:pty-resize', (window, id: string, cols: number, rows: number) =>
    hostOf(window).resize(id, cols, rows),
  )
  handleIn('architect:pty-kill', (window, id: string) => hostOf(window).kill(id))

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
  handle('architect:git-changes', (root: string) => diff.changes(root))
  handle('architect:git-file-diff', (root: string, section: DiffSection, file: ChangedFile, full?: boolean) =>
    diff.fileDiff(root, section, file, full),
  )
  handle('architect:git-stage-file', (root: string, file: ChangedFile) => diff.stageFile(root, file))
  handle('architect:git-unstage-file', (root: string, file: ChangedFile) => diff.unstageFile(root, file))
  handle('architect:git-commit', (root: string, title: string, description: string) =>
    git.commit(root, title, description),
  )
  handle('architect:git-push', (root: string) => git.push(root))
  handle('architect:git-pull', (root: string) => git.pull(root))

  handle('architect:draft-commit-message', async (root: string): Promise<DraftResult<CommitDraft>> => {
    const staged = await diff.stagedPatch(root)
    if (!staged.ok) return { ok: false, error: { kind: 'git', error: staged.error } }

    return message.commitMessage(root, staged.value)
  })
  handle('architect:draft-pull-request', async (root: string): Promise<DraftResult<PullDraft>> => {
    const work = await diff.branchPatch(root)
    if (!work.ok) return { ok: false, error: { kind: 'git', error: work.error } }

    return message.pullRequest(root, work.value)
  })

  handle('architect:github-auth', () => github.auth())
  handle('architect:github-repos', (limit?: number) => github.allRepos(limit))
  handle('architect:github-branches', (owner: string, repo: string) => github.branches(owner, repo))
  handle('architect:github-rates', () => github.rates())
  handle('architect:github-pulls', (owner: string, repo: string) => github.pulls(owner, repo))
  handle('architect:github-pull-for', (root: string, head: string) => github.pullFor(root, head))
  handle('architect:github-create-pull', (root: string, base: string, head: string, title: string, body: string) =>
    github.createPull(root, base, head, title, body),
  )

  handleIn('architect:github-compare', async (window, owner: string, repo: string, base: string, heads: string[]) => {
    stopCompare(window)
    const run = new AbortController()
    compares.set(window.id, run)

    const emit = (head: string, result: GithubResult<GithubCompare>) => {
      if (!window.isDestroyed()) {
        window.webContents.send('architect:github-compared', { repo: `${owner}/${repo}`, head, result })
      }
    }

    try {
      await github.compareAll(owner, repo, base, heads, emit, run.signal)
    } finally {
      if (compares.get(window.id) === run) compares.delete(window.id)
    }
  })
  handleIn('architect:github-compare-cancel', (window) => stopCompare(window))

  handle('architect:repo-plan', (repo: string, branch: string, pr?: number) =>
    open.plan(open.GITHUB_DIR, repo, branch, pr),
  )
  handle('architect:repo-open', (repo: string, branch: string, choice: OpenChoice, pr?: number) =>
    openRepoBranch(repo, branch, choice, pr),
  )
}

app.whenReady().then(async () => {
  wireIpc()
  createTray()

  daemon.onChange((architecture: Architecture) => {
    broadcast('architect:change', architecture)
  })
  daemon.onPending((pending: Pending[]) => {
    updateTray(pending)
    broadcast('architect:pending-update', pending)
  })
  daemon.onProjects((projects: ProjectSummary[]) => {
    broadcast('architect:projects-update', projects)
  })
  daemon.onCodeMap((root: string, map: CodeMap) => {
    broadcast('architect:code-map-update', root, map)
  })

  try {
    await daemon.listen()
  } catch (err) {
    dialog.showErrorBox('Architect could not start', err instanceof Error ? err.message : String(err))
    app.quit()
    return
  }

  app.setLoginItemSettings({ openAtLogin: true })
  createWindow(null)
})

function killEveryPty(): void {
  for (const host of hosts.values()) host.killAll()
}

app.on('will-quit', killEveryPty)
process.on('exit', killEveryPty)

app.on('new-window-for-tab', () => {
  createWindow(BrowserWindow.getFocusedWindow())
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

app.on('activate', () => {
  if (tabs.length === 0) createWindow(null)
})
