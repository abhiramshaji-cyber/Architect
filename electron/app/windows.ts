import path from 'node:path'
import { BrowserWindow, dialog } from 'electron'
import { spawn as spawnPty } from 'node-pty'
import type { PtyEvent } from '../../shared/types'
import { createPtyHost } from '../pty/pty'
import { TAB_DIGITS, TAB_GROUP, claim, owner, tabIndex } from '../tabs'
import { sameFolder, sortLaunch } from './launch'

const TABBED = process.platform === 'darwin'

export const tabs: BrowserWindow[] = []
export const claims = new Map<number, string>()
export const compares = new Map<number, AbortController>()
const hosts = new Map<number, ReturnType<typeof createPtyHost>>()
const focusedAt = new Map<number, number>()
let focuses = 0
let listener: (roots: string[]) => void = () => {}

function windowsChange(): void {
  const live = [...claims].filter(([id]) => tabs.some((tab) => tab.id === id && !tab.isDestroyed()))
  listener(live.sort(([a], [b]) => (focusedAt.get(b) ?? 0) - (focusedAt.get(a) ?? 0)).map(([, root]) => root))
}

export function watchClaims(fn: (roots: string[]) => void): void {
  listener = fn
  windowsChange()
}

export function broadcast(channel: string, ...args: unknown[]): void {
  for (const tab of tabs) if (!tab.isDestroyed()) tab.webContents.send(channel, ...args)
}

export function hostOf(window: BrowserWindow) {
  const host = hosts.get(window.id)
  if (!host) throw new Error('this window has no terminal host')
  return host
}

export function stopCompare(window: BrowserWindow): void {
  compares.get(window.id)?.abort()
  compares.delete(window.id)
}

export function killEveryPty(): void {
  for (const host of hosts.values()) host.killAll()
}

export function claimFor(window: number, root: string): boolean {
  const won = claim(claims, (id) => tabs.some((tab) => tab.id === id), window, root)
  windowsChange()
  return won
}

export function releaseRoot(window: number): void {
  claims.delete(window)
  windowsChange()
}

export function holderOf(root: string): BrowserWindow | undefined {
  const held = owner(claims, root)
  return tabs.find((tab) => tab.id === held && !tab.isDestroyed())
}

function forget(window: BrowserWindow): void {
  hosts.get(window.id)?.killAll()
  hosts.delete(window.id)
  claims.delete(window.id)
  focusedAt.delete(window.id)
  stopCompare(window)

  const index = tabs.indexOf(window)
  if (index >= 0) tabs.splice(index, 1)
  windowsChange()
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

export function createWindow(sibling: BrowserWindow | null, bound?: { root: string; touch?: string }): BrowserWindow {
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
    const url = new URL(process.env.ELECTRON_RENDERER_URL)
    for (const [key, value] of Object.entries(bound ?? {})) url.searchParams.set(key, value)
    window.loadURL(url.toString())
  } else {
    window.loadFile(path.join(import.meta.dirname, '../renderer/index.html'), { query: bound ?? {} })
  }

  window.on('closed', () => forget(window))
  window.on('focus', () => {
    focusedAt.set(window.id, ++focuses)
    windowsChange()
  })
  window.webContents.on('render-process-gone', () => hosts.get(window.id)?.killAll())
  window.webContents.on('did-start-navigation', (details) => {
    if (details.isMainFrame && !details.isSameDocument) hosts.get(window.id)?.killAll()
  })
  window.webContents.on('before-input-event', (event, input) => onChord(window, event, input))

  return window
}

export function openRoot(given: string, touch?: string): BrowserWindow {
  const root = sameFolder(claims.values(), given)
  const holder = holderOf(root)
  if (holder) {
    if (touch) holder.webContents.send('architect:touch', { root, file: touch })
    return holder
  }

  const window = createWindow(tabs.filter((tab) => !tab.isDestroyed()).at(-1) ?? null, touch ? { root, touch } : { root })
  claimFor(window.id, root)
  return window
}

export function openFolders(requests: { cwd: string; args: string[] }[]): void {
  const { folders, errors } = sortLaunch(requests)
  const front = folders.map((folder) => openRoot(folder)).at(-1)

  const parent = front ?? tabs.at(-1) ?? createWindow(null)
  parent.focus()
  if (errors.length === 0) return

  // a parentless box runs a nested modal loop that stalls second-instance acks until chromium kills this process
  void dialog.showMessageBox(parent, {
    type: 'warning',
    message: errors.length === 1 ? 'Architect could not open this folder' : 'Architect could not open these folders',
    detail: errors.join('\n'),
  })
}
