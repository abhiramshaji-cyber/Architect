import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import type { CodeMap } from '../../shared/types'
import { readStoredMap, writeStoredMap } from './cache'

const dirs: string[] = []

afterEach(() => {
  for (const dir of dirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true })
})

function stored(signature: unknown): CodeMap | null {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'architect-cache-'))
  dirs.push(dir)
  const fn = { name: 'a', line: 1, endLine: 2, description: '', calls: [], signature }
  const map = { root: dir, scannedAt: 1, folders: [{ path: '', folders: [], files: [{ path: 'a.ts', functions: [fn] }] }] }
  writeStoredMap(dir, dir, { map: map as CodeMap, cache: {} })
  return readStoredMap(dir, dir)?.map ?? null
}

describe('stored signatures', () => {
  it('keeps a map whose signatures are well formed or absent', () => {
    expect(stored({ generics: 'T', params: [{ name: 'x', type: 'T', value: '1', optional: true }], returns: 'T' })).not.toBeNull()
    expect(stored({ params: [] })).not.toBeNull()
    expect(stored(undefined)).not.toBeNull()
  })

  it('drops a map holding a malformed signature', () => {
    expect(stored({})).toBeNull()
    expect(stored({ params: [{ type: 'T' }] })).toBeNull()
    expect(stored({ params: [], returns: 3 })).toBeNull()
    expect(stored('(x)')).toBeNull()
    expect(stored({ params: [{ name: 'x', optional: 'yes' }] })).toBeNull()
    expect(stored({ params: [{ name: 'x', rest: 1 }] })).toBeNull()
  })
})

describe('stored starting point records', () => {
  const withStarts = (starts: unknown): CodeMap | null => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'architect-cache-'))
    dirs.push(dir)
    const map = { root: dir, scannedAt: 1, folders: [{ path: '', folders: [], files: [{ path: 'a.ts', functions: [], starts }] }] }
    writeStoredMap(dir, dir, { map: map as CodeMap, cache: {} })
    return readStoredMap(dir, dir)?.map ?? null
  }

  it('keeps well formed records and drops a map whose records are malformed', () => {
    expect(withStarts([{ kind: 'load', calls: [{ file: 'a.ts', fn: 0 }] }])).not.toBeNull()
    expect(withStarts(undefined)).not.toBeNull()
    for (const bad of ['nope', [{ kind: 'load' }], [{ kind: 1, calls: [] }], [{ kind: 'load', calls: [{ file: 1 }] }]]) {
      expect(withStarts(bad)).toBeNull()
    }
  })
})

describe('stored call sites', () => {
  const withSites = (sites: unknown, starts?: unknown): CodeMap | null => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'architect-cache-'))
    dirs.push(dir)
    const fn = { name: 'a', line: 1, endLine: 2, description: '', calls: [], sites }
    const map = { root: dir, scannedAt: 1, folders: [{ path: '', folders: [], files: [{ path: 'a.ts', functions: [fn], starts }] }] }
    writeStoredMap(dir, dir, { map: map as CodeMap, cache: {} })
    return readStoredMap(dir, dir)?.map ?? null
  }

  it('keeps sites and routed records that are well formed or absent', () => {
    expect(withSites([{ file: 'a.ts', fn: 0, line: 3 }, { bridge: 'api.read', line: 4 }])).not.toBeNull()
    expect(withSites(undefined, [{ kind: 'ipcHandler', calls: [], channel: 'x', line: 2, sites: [{ file: 'a.ts', fn: 0, line: 2 }] }])).not.toBeNull()
    expect(withSites(undefined, [{ kind: 'bridge', calls: [{ file: 'a.ts', fn: 0 }], member: 'api.read', line: 1 }])).not.toBeNull()
  })

  it('drops a map whose sites or routed records are malformed', () => {
    for (const bad of ['x', [{ file: 'a.ts', fn: 0 }], [{ bridge: 1, line: 2 }], [{ file: 'a.ts', fn: 0, line: 1.5 }]]) {
      expect(withSites(bad)).toBeNull()
    }
    expect(withSites(undefined, [{ kind: 'ipcHandler', calls: [], channel: 3 }])).toBeNull()
    expect(withSites(undefined, [{ kind: 'ipcHandler', calls: [], line: 'two' }])).toBeNull()
    expect(withSites(undefined, [{ kind: 'bridge', calls: [], member: 'a', sites: [{}] }])).toBeNull()
  })
})
