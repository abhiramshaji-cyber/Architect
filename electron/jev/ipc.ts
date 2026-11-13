import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { ipcMain, type IpcMainInvokeEvent } from 'electron'
import type { IpcResult } from '../../shared/types'
import type { Jev } from '.'

const text = (value: unknown) => (typeof value === 'string' ? value : '')

const root = (value: unknown) => (typeof value === 'string' && value !== '' ? value : undefined)

export function trustedSender(url: string, rendererUrl = process.env.ELECTRON_RENDERER_URL, page = path.join(import.meta.dirname, '../renderer/index.html')): boolean {
  if (rendererUrl) {
    try {
      return new URL(url).origin === new URL(rendererUrl).origin
    } catch {
      return false
    }
  }
  return url.split(/[?#]/)[0] === pathToFileURL(page).href
}

export function wireJevIpc(jev: Jev): void {
  const handle = (channel: string, fn: (...args: unknown[]) => unknown) => {
    ipcMain.handle(channel, async (event: IpcMainInvokeEvent, ...args: unknown[]): Promise<IpcResult<unknown>> => {
      if (!trustedSender(event.senderFrame?.url ?? '')) return { ok: false, error: 'this request did not come from an Architect window' }
      try {
        return { ok: true, value: await fn(...args) }
      } catch (err) {
        return { ok: false, error: err instanceof Error ? err.message : 'the request failed' }
      }
    })
  }

  handle('architect:jev-state', (at) => jev.state(root(at)))
  handle('architect:jev-set-key', (key) => jev.setKey(key))
  handle('architect:jev-remove-key', () => jev.removeKey())
  handle('architect:jev-set', (on, at) => jev.setEnabled(on === true, root(at)))
  handle('architect:jev-index', (at) => jev.index(text(at)))
  handle('architect:jev-cancel', (at) => jev.cancel(text(at)))
  handle('architect:jev-same', (at, file, symbol) => jev.same(text(at), text(file), text(symbol)))
}
