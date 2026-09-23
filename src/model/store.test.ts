import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Architecture, ArchitectApi, OpenedProject } from '../../shared/types'

function arch(title: string): Architecture {
  return { title, summary: 's', components: [], edges: [], forbidden: [], packages: [] }
}

function opened(title: string): OpenedProject {
  return { contract: { status: 'ready' }, architecture: arch(title) }
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
    open: vi.fn().mockResolvedValue({ contract: { status: 'missing' }, architecture: null }),
    closeProject: vi.fn().mockResolvedValue(undefined),
    pending: vi.fn().mockResolvedValue([]),
    decide: vi.fn().mockResolvedValue(undefined),
    createContract: vi.fn(),
    draftContract: vi.fn(),
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
    gitStatus: vi.fn(),
    gitDefaultBranch: vi.fn(),
    gitLocalBranches: vi.fn(),
    gitRemoteBranches: vi.fn(),
    gitWorktrees: vi.fn(),
    gitFetch: vi.fn(),
    gitCreateWorktree: vi.fn(),
    gitRemoveWorktree: vi.fn(),
    gitPruneWorktrees: vi.fn(),
    githubAuth: vi.fn(),
    githubRepos: vi.fn(),
    githubBranches: vi.fn(),
    githubRates: vi.fn(),
    githubPulls: vi.fn(),
    repoPlan: vi.fn(),
    repoOpen: vi.fn(),
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
    architect.open = vi.fn().mockResolvedValue(opened('A'))
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
    architect.open = vi.fn().mockImplementation((root: string) => Promise.resolve(opened(root)))
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
    architect.open = vi.fn().mockImplementation((root: string) => Promise.resolve(opened(root)))
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
    architect.open = vi.fn().mockResolvedValue(opened('A'))
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
    architect.open = vi.fn().mockImplementation((root: string) => Promise.resolve(opened(root)))
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
    architect.open = vi.fn().mockResolvedValue(opened('A'))
    const { openProject, closeProject, getSnapshot } = await import('./store')
    openProject('/a')
    await vi.waitFor(() => expect(getSnapshot().entries['/a']?.status).toBe('ready'))

    closeProject('/a')

    const s = getSnapshot()
    expect(s.currentRoot).toBeNull()
    expect(s.entries).toEqual({})
  })

  it('closing a non-active project leaves the active one untouched', async () => {
    architect.open = vi.fn().mockImplementation((root: string) => Promise.resolve(opened(root)))
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
    architect.open = vi.fn().mockResolvedValue(opened('A'))
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
    expect(architect.closeProject).not.toHaveBeenCalled()
  })

  it('tells the daemon to stop watching the closed root', async () => {
    architect.open = vi.fn().mockResolvedValue(opened('A'))
    const { openProject, closeProject, getSnapshot } = await import('./store')
    openProject('/a')
    await vi.waitFor(() => expect(getSnapshot().entries['/a']?.status).toBe('ready'))

    closeProject('/a')

    expect(architect.closeProject).toHaveBeenCalledWith('/a')
  })

  it('closes a remembered root that the renderer never opened', async () => {
    const { closeProject, getSnapshot } = await import('./store')

    closeProject('/a')

    expect(architect.closeProject).toHaveBeenCalledWith('/a')
    expect(getSnapshot().entries).toEqual({})
  })

  it('reports a daemon that refuses to close', async () => {
    architect.open = vi.fn().mockResolvedValue(opened('A'))
    architect.closeProject = vi.fn().mockRejectedValue(new Error('socket gone'))
    const { openProject, closeProject, getSnapshot } = await import('./store')
    openProject('/a')
    await vi.waitFor(() => expect(getSnapshot().entries['/a']?.status).toBe('ready'))

    closeProject('/a')

    await vi.waitFor(() => expect(getSnapshot().message).toEqual({ text: 'socket gone', error: true }))
  })
})

describe('contract state', () => {
  it('opens a directory with no architect.md as a contract-less project', async () => {
    architect.open = vi.fn().mockResolvedValue({ contract: { status: 'missing' }, architecture: null })
    const { openProject, getSnapshot, loadErrorOf, parseErrorOf } = await import('./store')

    openProject('/plain')

    await vi.waitFor(() => expect(getSnapshot().entries['/plain']?.status).toBe('ready'))
    const s = getSnapshot()
    expect(s.contract).toEqual({ status: 'missing' })
    expect(s.architecture).toBeNull()
    expect(loadErrorOf(s)).toBeNull()
    expect(parseErrorOf(s)).toBeNull()
    expect(architect.edits).toHaveBeenCalledWith('/plain')
  })

  it('tells a broken contract apart from a missing one and from a load failure', async () => {
    architect.open = vi
      .fn()
      .mockImplementation((root: string) =>
        root === '/broken'
          ? Promise.resolve({ contract: { status: 'invalid', error: 'architect.md: bad line 3' }, architecture: null })
          : Promise.reject(new Error('EACCES')),
      )
    const { openProject, getSnapshot, loadErrorOf, parseErrorOf } = await import('./store')

    openProject('/broken')
    await vi.waitFor(() => expect(getSnapshot().entries['/broken']?.status).toBe('ready'))
    expect(parseErrorOf(getSnapshot())).toBe('architect.md: bad line 3')
    expect(loadErrorOf(getSnapshot())).toBeNull()

    openProject('/gone')
    await vi.waitFor(() => expect(getSnapshot().entries['/gone']?.status).toBe('error'))
    expect(loadErrorOf(getSnapshot())).toBe('EACCES')
    expect(parseErrorOf(getSnapshot())).toBeNull()
  })

  it('writes a starter contract for a project that has none', async () => {
    architect.open = vi.fn().mockResolvedValue({ contract: { status: 'missing' }, architecture: null })
    architect.createContract = vi.fn().mockResolvedValue(arch('Plain'))
    const { openProject, createContract, getSnapshot } = await import('./store')
    openProject('/plain')
    await vi.waitFor(() => expect(getSnapshot().entries['/plain']?.status).toBe('ready'))

    createContract()

    await vi.waitFor(() => expect(getSnapshot().architecture?.title).toBe('Plain'))
    expect(getSnapshot().contract).toEqual({ status: 'ready' })
    expect(architect.createContract).toHaveBeenCalledWith('/plain')
  })

  it('does not write a starter contract over one that already exists', async () => {
    architect.open = vi.fn().mockResolvedValue(opened('A'))
    const { openProject, createContract, getSnapshot } = await import('./store')
    openProject('/a')
    await vi.waitFor(() => expect(getSnapshot().entries['/a']?.status).toBe('ready'))

    createContract()

    expect(architect.createContract).not.toHaveBeenCalled()
  })

  it('asks for a drafted contract and leaves the project empty until the draft is approved', async () => {
    architect.open = vi.fn().mockResolvedValue({ contract: { status: 'missing' }, architecture: null })
    architect.draftContract = vi.fn().mockResolvedValue({ ok: true, value: '# drafted' })
    const { openProject, draftContract, getSnapshot } = await import('./store')
    openProject('/plain')
    await vi.waitFor(() => expect(getSnapshot().entries['/plain']?.status).toBe('ready'))

    draftContract()

    expect(getSnapshot().drafting).toBe(true)
    await vi.waitFor(() => expect(getSnapshot().drafting).toBe(false))
    expect(architect.draftContract).toHaveBeenCalledWith('/plain')
    expect(getSnapshot().draftError).toBeNull()
    expect(getSnapshot().architecture).toBeNull()
    expect(getSnapshot().contract).toEqual({ status: 'missing' })
  })

  it('keeps the failure so the empty state can say plainly why there is no draft', async () => {
    architect.open = vi.fn().mockResolvedValue({ contract: { status: 'missing' }, architecture: null })
    architect.draftContract = vi.fn().mockResolvedValue({ ok: false, error: { kind: 'not-installed' } })
    const { openProject, draftContract, getSnapshot } = await import('./store')
    openProject('/plain')
    await vi.waitFor(() => expect(getSnapshot().entries['/plain']?.status).toBe('ready'))

    draftContract()

    await vi.waitFor(() => expect(getSnapshot().draftError).toEqual({ kind: 'not-installed' }))
    expect(getSnapshot().drafting).toBe(false)
  })

  it('turns a broken bridge call into a reported draft failure rather than an unhandled rejection', async () => {
    architect.open = vi.fn().mockResolvedValue({ contract: { status: 'missing' }, architecture: null })
    architect.draftContract = vi.fn().mockRejectedValue(new Error('bridge is gone'))
    const { openProject, draftContract, getSnapshot } = await import('./store')
    openProject('/plain')
    await vi.waitFor(() => expect(getSnapshot().entries['/plain']?.status).toBe('ready'))

    draftContract()

    await vi.waitFor(() =>
      expect(getSnapshot().draftError).toEqual({ kind: 'failed', code: 1, stderr: 'bridge is gone' }),
    )
  })

  it('never asks for a draft for a project that already has a contract', async () => {
    architect.open = vi.fn().mockResolvedValue(opened('A'))
    const { openProject, draftContract, getSnapshot } = await import('./store')
    openProject('/a')
    await vi.waitFor(() => expect(getSnapshot().entries['/a']?.status).toBe('ready'))

    draftContract()

    expect(architect.draftContract).not.toHaveBeenCalled()
  })
})

describe('in-flight responses', () => {
  it('discards a response for a project that was closed while it was loading', async () => {
    const open = deferred<OpenedProject>()
    architect.open = vi.fn().mockReturnValue(open.promise)
    const { openProject, closeProject, getSnapshot } = await import('./store')

    openProject('/a')
    expect(getSnapshot().entries['/a']?.status).toBe('loading')
    closeProject('/a')
    expect(getSnapshot().entries['/a']).toBeUndefined()

    open.resolve(opened('A'))
    await Promise.resolve()
    await Promise.resolve()

    expect(getSnapshot().entries['/a']).toBeUndefined()
    expect(getSnapshot().currentRoot).toBeNull()
  })

  it('stores a background project response instead of dropping it for not matching the active root', async () => {
    const editsA = deferred<never[]>()
    architect.open = vi.fn().mockImplementation((root: string) => Promise.resolve(opened(root)))
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
    architect.open = vi.fn().mockImplementation((root: string) => Promise.resolve(opened(root)))
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
