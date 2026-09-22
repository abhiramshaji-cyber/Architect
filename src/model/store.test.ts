import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Architecture, ArchitectApi } from '../../shared/types'

function arch(title: string): Architecture {
  return { title, summary: 's', components: [], edges: [], forbidden: [], packages: [] }
}

function deferred<T>() {
  let resolve!: (v: T) => void
  let reject!: (e: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

function mockArchitect(overrides: Partial<ArchitectApi> = {}): ArchitectApi {
  return {
    projects: vi.fn().mockResolvedValue([]),
    open: vi.fn().mockResolvedValue(null),
    pending: vi.fn().mockResolvedValue([]),
    decide: vi.fn().mockResolvedValue(undefined),
    mcpBridgeInfo: vi.fn().mockResolvedValue({ path: '', exists: false }),
    edits: vi.fn().mockResolvedValue([]),
    edit: vi.fn(),
    createEdit: vi.fn(),
    updateEdit: vi.fn(),
    handEdit: vi.fn(),
    deleteEdit: vi.fn(),
    getCodeMap: vi.fn(),
    rescan: vi.fn(),
    ownership: vi.fn().mockResolvedValue(null),
    readSource: vi.fn(),
    onChange: vi.fn(),
    onPending: vi.fn(),
    onProjects: vi.fn(),
    onCodeMap: vi.fn(),
    ptySpawn: vi.fn(),
    ptyWrite: vi.fn(),
    ptyResize: vi.fn(),
    ptyKill: vi.fn(),
    onPtyEvent: vi.fn().mockReturnValue(() => {}),
    ...overrides,
  }
}

let architect: ArchitectApi

beforeEach(() => {
  vi.resetModules()
  architect = mockArchitect()
  ;(globalThis as unknown as { window: { architect: ArchitectApi } }).window = { architect }
  ;(globalThis as unknown as { confirm: (msg?: string) => boolean }).confirm = vi.fn().mockReturnValue(true)
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('no project open', () => {
  it('has an empty, safe snapshot', async () => {
    const { getSnapshot } = await import('./store')
    const s = getSnapshot()
    expect(s.currentRoot).toBeNull()
    expect(s.entries).toEqual({})
    expect(s.architecture).toBeNull()
    expect(s.draft).toBeNull()
    expect(s.busy).toBe(false)
  })
})

describe('openProject', () => {
  it('populates the entry and activates the root', async () => {
    architect.open = vi.fn().mockResolvedValue(arch('A'))
    const { openProject, getSnapshot } = await import('./store')
    openProject('/a')
    await vi.waitFor(() => expect(getSnapshot().entries['/a']?.status).toBe('ready'))
    const s = getSnapshot()
    expect(s.currentRoot).toBe('/a')
    expect(s.architecture?.title).toBe('A')
    expect(architect.edits).toHaveBeenCalledWith('/a')
    expect(architect.ownership).toHaveBeenCalledWith('/a')
  })

  it('keeps a second project loaded alongside the first', async () => {
    architect.open = vi.fn().mockImplementation((root: string) => Promise.resolve(arch(root)))
    const { openProject, getSnapshot } = await import('./store')
    openProject('/a')
    await vi.waitFor(() => expect(getSnapshot().entries['/a']?.status).toBe('ready'))
    openProject('/b')
    await vi.waitFor(() => expect(getSnapshot().entries['/b']?.status).toBe('ready'))

    const s = getSnapshot()
    expect(s.currentRoot).toBe('/b')
    expect(s.entries['/a']?.architecture?.title).toBe('/a')
    expect(s.entries['/b']?.architecture?.title).toBe('/b')
  })

  it('does not refetch edits or ownership when switching back to an already loaded project', async () => {
    architect.open = vi.fn().mockImplementation((root: string) => Promise.resolve(arch(root)))
    const { openProject, getSnapshot } = await import('./store')
    openProject('/a')
    await vi.waitFor(() => expect(getSnapshot().entries['/a']?.status).toBe('ready'))
    openProject('/b')
    await vi.waitFor(() => expect(getSnapshot().entries['/b']?.status).toBe('ready'))

    vi.mocked(architect.edits).mockClear()
    vi.mocked(architect.ownership).mockClear()

    openProject('/a')
    await vi.waitFor(() => expect(getSnapshot().currentRoot).toBe('/a'))
    expect(architect.edits).not.toHaveBeenCalled()
    expect(architect.ownership).not.toHaveBeenCalled()
  })

  it('marks a project that fails to open as unavailable instead of throwing', async () => {
    architect.open = vi.fn().mockRejectedValue(new Error('ENOENT'))
    const { openProject, getSnapshot } = await import('./store')
    openProject('/gone')
    await vi.waitFor(() => expect(getSnapshot().entries['/gone']?.status).toBe('error'))

    const s = getSnapshot()
    expect(s.entries['/gone']?.error).toBe('ENOENT')
    expect(s.currentRoot).toBe('/gone')
    expect(s.architecture).toBeNull()
  })

  it('opening the same project twice does not duplicate its secondary loads', async () => {
    architect.open = vi.fn().mockResolvedValue(arch('A'))
    const { openProject, getSnapshot } = await import('./store')
    openProject('/a')
    openProject('/a')
    await vi.waitFor(() => expect(getSnapshot().entries['/a']?.status).toBe('ready'))
    await vi.waitFor(() => expect(getSnapshot().entries['/a']?.status).toBe('ready'))

    expect(architect.edits).toHaveBeenCalledTimes(1)
    expect(architect.ownership).toHaveBeenCalledTimes(1)
    expect(Object.keys(getSnapshot().entries)).toEqual(['/a'])
  })
})

describe('closeProject', () => {
  it('closing the active project falls back to another open one', async () => {
    architect.open = vi.fn().mockImplementation((root: string) => Promise.resolve(arch(root)))
    const { openProject, closeProject, getSnapshot } = await import('./store')
    openProject('/a')
    await vi.waitFor(() => expect(getSnapshot().entries['/a']?.status).toBe('ready'))
    openProject('/b')
    await vi.waitFor(() => expect(getSnapshot().entries['/b']?.status).toBe('ready'))

    closeProject('/b')

    const s = getSnapshot()
    expect(s.entries['/b']).toBeUndefined()
    expect(s.currentRoot).toBe('/a')
    expect(s.architecture?.title).toBe('/a')
  })

  it('closing the last open project leaves no project open', async () => {
    architect.open = vi.fn().mockResolvedValue(arch('A'))
    const { openProject, closeProject, getSnapshot } = await import('./store')
    openProject('/a')
    await vi.waitFor(() => expect(getSnapshot().entries['/a']?.status).toBe('ready'))

    closeProject('/a')

    const s = getSnapshot()
    expect(s.currentRoot).toBeNull()
    expect(s.entries).toEqual({})
  })

  it('closing a non-active project leaves the active one untouched', async () => {
    architect.open = vi.fn().mockImplementation((root: string) => Promise.resolve(arch(root)))
    const { openProject, closeProject, getSnapshot } = await import('./store')
    openProject('/a')
    await vi.waitFor(() => expect(getSnapshot().entries['/a']?.status).toBe('ready'))
    openProject('/b')
    await vi.waitFor(() => expect(getSnapshot().entries['/b']?.status).toBe('ready'))

    closeProject('/a')

    const s = getSnapshot()
    expect(s.entries['/a']).toBeUndefined()
    expect(s.currentRoot).toBe('/b')
    expect(s.architecture?.title).toBe('/b')
  })

  it('asks before closing a project with unsaved edits, and keeps it open on cancel', async () => {
    const confirmMock = vi.fn().mockReturnValue(false)
    ;(globalThis as unknown as { confirm: typeof confirmMock }).confirm = confirmMock
    architect.open = vi.fn().mockResolvedValue(arch('A'))
    architect.createEdit = vi.fn().mockResolvedValue({ id: 'e1', status: 'draft', architecture: arch('A') })
    const { openProject, newEdit, applyEdit, closeProject, getSnapshot } = await import('./store')
    openProject('/a')
    await vi.waitFor(() => expect(getSnapshot().entries['/a']?.status).toBe('ready'))

    newEdit()
    await vi.waitFor(() => expect(getSnapshot().draft).not.toBeNull())
    applyEdit((a) => ({ ok: true, architecture: { ...a, title: 'changed' } }))
    expect(getSnapshot().dirty).toBe(true)

    closeProject('/a')

    expect(confirmMock).toHaveBeenCalled()
    expect(getSnapshot().entries['/a']).toBeDefined()
  })
})

describe('in-flight responses', () => {
  it('discards a response for a project that was closed while it was loading', async () => {
    const open = deferred<Architecture | null>()
    architect.open = vi.fn().mockReturnValue(open.promise)
    const { openProject, closeProject, getSnapshot } = await import('./store')

    openProject('/a')
    expect(getSnapshot().entries['/a']?.status).toBe('loading')
    closeProject('/a')
    expect(getSnapshot().entries['/a']).toBeUndefined()

    open.resolve(arch('A'))
    await Promise.resolve()
    await Promise.resolve()

    expect(getSnapshot().entries['/a']).toBeUndefined()
    expect(getSnapshot().currentRoot).toBeNull()
  })

  it('stores a background project response instead of dropping it for not matching the active root', async () => {
    const editsA = deferred<never[]>()
    architect.open = vi.fn().mockImplementation((root: string) => Promise.resolve(arch(root)))
    architect.edits = vi
      .fn()
      .mockImplementation((root: string) => (root === '/a' ? editsA.promise : Promise.resolve([])))
    const { openProject, getSnapshot } = await import('./store')

    openProject('/a')
    await vi.waitFor(() => expect(getSnapshot().entries['/a']?.status).toBe('ready'))

    openProject('/b')
    await vi.waitFor(() => expect(getSnapshot().entries['/b']?.status).toBe('ready'))
    expect(getSnapshot().currentRoot).toBe('/b')

    editsA.resolve([{ id: 'e1', status: 'draft', title: 'first' }] as never)
    await vi.waitFor(() => expect(getSnapshot().entries['/a']?.edits.length).toBe(1))

    const s = getSnapshot()
    expect(s.entries['/a']?.edits[0]?.id).toBe('e1')
    expect(s.currentRoot).toBe('/b')
    expect(s.edits).toEqual([])
  })

  it('drops a background response for a project closed while its edits were still loading', async () => {
    const editsA = deferred<never[]>()
    architect.open = vi.fn().mockImplementation((root: string) => Promise.resolve(arch(root)))
    architect.edits = vi
      .fn()
      .mockImplementation((root: string) => (root === '/a' ? editsA.promise : Promise.resolve([])))
    const { openProject, closeProject, getSnapshot } = await import('./store')

    openProject('/a')
    await Promise.resolve()
    await Promise.resolve()
    openProject('/b')
    await vi.waitFor(() => expect(getSnapshot().entries['/b']?.status).toBe('ready'))

    closeProject('/a')
    expect(getSnapshot().entries['/a']).toBeUndefined()

    editsA.resolve([{ id: 'e1', status: 'draft', title: 'first' }] as never)
    await Promise.resolve()
    await Promise.resolve()

    expect(getSnapshot().entries['/a']).toBeUndefined()
  })
})
