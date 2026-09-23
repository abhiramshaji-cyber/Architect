import { renderToStaticMarkup } from 'react-dom/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ArchitectApi, WriteError } from '../../shared/types'

const WRITE_ERRORS: WriteError[] = ['closed', 'outside', 'unreadable', 'binary', 'large', 'stale', 'denied']

let architect: ArchitectApi

beforeEach(() => {
  vi.resetModules()
  architect = {
    open: vi.fn().mockResolvedValue({ contract: { status: 'ready' }, architecture: null }),
    edits: vi.fn().mockResolvedValue([]),
    ownership: vi.fn().mockResolvedValue(null),
    openSource: vi.fn().mockResolvedValue({ text: 'one\ntwo\n', hash: 'h1', error: null }),
    writeSource: vi.fn(),
    readTree: vi.fn().mockResolvedValue({ entries: [], error: null }),
  } as unknown as ArchitectApi
  ;(globalThis as unknown as { window: { architect: ArchitectApi } }).window = { architect }
})

async function opened() {
  const store = await import('../model/store')
  store.openProject('/a')
  await vi.waitFor(() => expect(store.getSnapshot().entries['/a']?.status).toBe('ready'))
  store.openFile('a.ts')
  await vi.waitFor(() => expect(store.getSnapshot().file?.path).toBe('a.ts'))
  return store
}

async function markup() {
  const { default: FilesView } = await import('./FilesView')
  return renderToStaticMarkup(<FilesView />)
}

describe('the files pane after a save', () => {
  it('keeps the editor on screen and puts the confirmation in the bar', async () => {
    architect.writeSource = vi.fn().mockResolvedValue({ hash: 'h2', error: null })
    const { editFile, saveFile, getSnapshot } = await opened()

    editFile('one\nTWO\n')
    saveFile()
    await vi.waitFor(() => expect(getSnapshot().fileNotice?.text).toBe('Saved'))

    const html = await markup()
    expect(html).toContain('editor-host')
    expect(html).toContain('a.ts')
    expect(html.indexOf('files-notice')).toBeLessThan(html.indexOf('files-actions'))
    expect(html.indexOf('files-notice')).toBeLessThan(html.indexOf('editor-host'))
    expect(html).not.toContain('edit-bar-message')
  })

  it.each(WRITE_ERRORS)('keeps the editor and the unsaved text when the save refuses with %s', async (error) => {
    architect.writeSource = vi.fn().mockResolvedValue({ hash: '', error })
    const { editFile, saveFile, getSnapshot } = await opened()
    const { isDirty, refusalOf } = await import('../model/buffer')

    editFile('mine\n')
    saveFile()
    await vi.waitFor(() => expect(getSnapshot().fileNotice?.error).toBe(true))

    expect(getSnapshot().file?.draft).toBe('mine\n')
    expect(isDirty(getSnapshot().file)).toBe(true)
    expect(getSnapshot().fileBusy).toBe(false)

    const html = await markup()
    expect(html).toContain('editor-host')
    expect(html).toContain(refusalOf(error))
    expect(html.indexOf('files-notice')).toBeLessThan(html.indexOf('editor-host'))
  })

  it('keeps Reload and Close reachable when the file itself could not be read', async () => {
    architect.openSource = vi.fn().mockResolvedValue({ text: '', hash: '', error: 'binary' })
    const store = await import('../model/store')
    store.openProject('/a')
    await vi.waitFor(() => expect(store.getSnapshot().entries['/a']?.status).toBe('ready'))
    store.openFile('logo.png')
    await vi.waitFor(() => expect(store.getSnapshot().file?.error).toBe('binary'))

    const html = await markup()
    expect(html).toContain('files-bar')
    expect(html).toContain('>Reload</button>')
    expect(html).toContain('>Close</button>')
    expect(html).not.toContain('editor-host')
  })
})
