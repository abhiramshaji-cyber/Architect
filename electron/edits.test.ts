import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Architecture } from '../shared/types'
import { createEdit, deleteEdit, handEdit, listEdits, readEdit, updateEdit } from './edits'

const architecture: Architecture = {
  title: 'Storefront',
  summary: 'The storefront serves product pages and checkout.',
  components: [
    { id: 'api', purpose: 'Handles HTTP requests.', owns: ['src/api/**'] },
    { id: 'db', purpose: 'Persists orders.', owns: ['src/db/**'] },
  ],
  edges: [{ from: 'api', to: 'db' }],
  forbidden: [{ from: 'db', to: 'api', reason: 'db must not depend on api' }],
  packages: ['express'],
}

let root: string

function editsDir() {
  return path.join(root, '.architect', 'edits')
}

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'architect-edits-'))
})

afterEach(() => {
  vi.restoreAllMocks()
  fs.rmSync(root, { recursive: true, force: true })
})

describe('edits', () => {
  it('round trips an architecture through the architect.md grammar', () => {
    const created = createEdit(root, architecture)
    expect(readEdit(root, created.id)).toEqual({ id: created.id, status: 'draft', architecture })
  })

  it('creates the edits directory on demand when .architect does not exist', () => {
    expect(fs.existsSync(path.join(root, '.architect'))).toBe(false)
    const created = createEdit(root, architecture)
    expect(fs.existsSync(path.join(editsDir(), `draft-${created.id}.md`))).toBe(true)
  })

  it('lists an empty array when no edits directory exists', () => {
    expect(listEdits(root)).toEqual([])
  })

  it('lists drafts and handed edits sorted by creation', () => {
    const first = createEdit(root, architecture)
    const second = createEdit(root, architecture)
    handEdit(root, second.id)

    const listed = listEdits(root)
    expect(listed.find((e) => e.id === first.id)).toEqual({ id: first.id, status: 'draft', title: 'Storefront' })
    expect(listed.find((e) => e.id === second.id)).toEqual({ id: second.id, status: 'handed', title: 'Storefront' })
    expect([...listed].sort((a, b) => a.id.localeCompare(b.id))).toEqual(listed)
  })

  it('rejects a traversing id instead of escaping the edits directory', () => {
    const outside = path.join(root, 'secret.md')
    fs.writeFileSync(outside, '# Secret\n')

    for (const id of ['../../etc/passwd', '../secret', '..', 'a/b', 'draft-x']) {
      expect(() => readEdit(root, id)).toThrow(/invalid edit id/)
      expect(() => handEdit(root, id)).toThrow(/invalid edit id/)
      expect(() => updateEdit(root, id, architecture)).toThrow(/invalid edit id/)
      expect(() => deleteEdit(root, id)).toThrow(/invalid edit id/)
    }

    expect(fs.existsSync(outside)).toBe(true)
  })

  it('gives distinct ids to edits created in the same millisecond', () => {
    vi.spyOn(Date, 'now').mockReturnValue(1_700_000_000_000)

    const ids = new Set([createEdit(root, architecture).id, createEdit(root, architecture).id])
    expect(ids.size).toBe(2)
    expect(fs.readdirSync(editsDir())).toHaveLength(2)
  })

  it('hands a draft over by renaming it and refuses a second handover', () => {
    const created = createEdit(root, architecture)

    expect(handEdit(root, created.id)).toEqual({ id: created.id, status: 'handed', architecture })
    expect(fs.readdirSync(editsDir())).toEqual([`handed-${created.id}.md`])
    expect(() => handEdit(root, created.id)).toThrow(/already handed over/)
  })

  it('refuses to edit a handed edit', () => {
    const created = createEdit(root, architecture)
    handEdit(root, created.id)
    expect(() => updateEdit(root, created.id, architecture)).toThrow(/no longer be edited/)
  })

  it('updates a draft in place', () => {
    const created = createEdit(root, architecture)
    const next: Architecture = { ...architecture, title: 'Storefront v2', packages: [] }

    updateEdit(root, created.id, next)
    expect(readEdit(root, created.id).architecture).toEqual(next)
  })

  it('deletes an edit', () => {
    const created = createEdit(root, architecture)
    deleteEdit(root, created.id)

    expect(listEdits(root)).toEqual([])
    expect(() => readEdit(root, created.id)).toThrow(/no such edit/)
  })

  it('fails cleanly on an id that does not exist', () => {
    const missing = '00000000-abcdef12'
    expect(() => readEdit(root, missing)).toThrow(/no such edit/)
    expect(() => handEdit(root, missing)).toThrow(/no such edit/)
    expect(() => deleteEdit(root, missing)).toThrow(/no such edit/)
  })

  it('refuses to act on an id that exists as both a draft and a handed edit', () => {
    const created = createEdit(root, architecture)
    fs.copyFileSync(path.join(editsDir(), `draft-${created.id}.md`), path.join(editsDir(), `handed-${created.id}.md`))

    expect(() => readEdit(root, created.id)).toThrow(/both a draft and a handed edit/)
    expect(() => handEdit(root, created.id)).toThrow(/both a draft and a handed edit/)
    expect(fs.readdirSync(editsDir())).toHaveLength(2)
  })

  it('reports a malformed edit without hiding the others', () => {
    const good = createEdit(root, architecture)
    const broken = createEdit(root, architecture)
    fs.writeFileSync(
      path.join(editsDir(), `draft-${broken.id}.md`),
      '# Broken\n\nbad\n\n## Components\n\n### api\ndoes things\n\n### api\ndoes things\n',
    )
    fs.writeFileSync(path.join(editsDir(), 'notes.txt'), 'ignored')

    const listed = listEdits(root)
    expect(listed).toHaveLength(2)
    expect(listed.find((e) => e.id === good.id)).toEqual({ id: good.id, status: 'draft', title: 'Storefront' })
    expect(listed.find((e) => e.id === broken.id)?.error).toMatch(/duplicate component/)
    expect(() => readEdit(root, broken.id)).toThrow(/duplicate component/)
  })
})
