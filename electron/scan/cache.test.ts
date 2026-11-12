import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import type { CodeMap } from '../../shared/types'
import { readStoredMap, writeStoredMap } from './cache'

const roots: string[] = []

afterEach(() => {
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true })
})

function temp(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'architect-cache-'))
  roots.push(dir)
  return dir
}

const mapOf = (root: string, starts: unknown): CodeMap =>
  ({
    root,
    scannedAt: 1,
    folders: [{ path: '', folders: [], files: [{ path: 'a.ts', functions: [], starts }] }],
  }) as CodeMap

describe('stored code map', () => {
  it('keeps starting point records and drops a map whose records are malformed', () => {
    const dir = temp()
    const root = temp()
    const good = mapOf(root, [{ kind: 'load', calls: [{ file: 'a.ts', fn: 0 }] }])
    writeStoredMap(dir, root, { map: good, cache: {} })
    expect(readStoredMap(dir, root)?.map).toEqual(good)

    for (const bad of ['nope', [{ kind: 'load' }], [{ kind: 1, calls: [] }], [{ kind: 'load', calls: [{ file: 1 }] }]]) {
      writeStoredMap(dir, root, { map: mapOf(root, bad), cache: {} })
      expect(readStoredMap(dir, root)?.map).toBeNull()
    }
  })
})
