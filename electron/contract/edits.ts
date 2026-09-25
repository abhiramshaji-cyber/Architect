import { randomUUID } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import type { Architecture, Edit, EditStatus, EditSummary } from '../../shared/types'
import { parse, serialize } from './graph'

const ID = /^[0-9a-z]+-[0-9a-f]{8}$/

function editsDir(root: string) {
  return path.join(root, '.architect', 'edits')
}

function editPath(root: string, status: EditStatus, id: string) {
  return path.join(editsDir(root), `${status}-${id}.md`)
}

function newId() {
  return `${Date.now().toString(36).padStart(9, '0')}-${randomUUID().slice(0, 8)}`
}

function locate(root: string, id: string): { status: EditStatus; file: string } {
  if (!ID.test(id)) throw new Error(`invalid edit id: ${id}`)

  const found = (['draft', 'handed'] as const)
    .map((status) => ({ status, file: editPath(root, status, id) }))
    .filter((candidate) => fs.existsSync(candidate.file))

  if (found.length > 1) throw new Error(`edit ${id} exists as both a draft and a handed edit`)
  const only = found[0]
  if (!only) throw new Error(`no such edit: ${id}`)
  return only
}

export function createEdit(root: string, architecture: Architecture): Edit {
  fs.mkdirSync(editsDir(root), { recursive: true })
  const content = serialize(architecture)

  while (true) {
    const id = newId()
    try {
      fs.writeFileSync(editPath(root, 'draft', id), content, { flag: 'wx' })
      return { id, status: 'draft', architecture }
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'EEXIST') throw err
    }
  }
}

export function listEdits(root: string): EditSummary[] {
  const dir = editsDir(root)

  let names: string[]
  try {
    names = fs.readdirSync(dir)
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return []
    throw err
  }

  const summaries: EditSummary[] = []
  for (const name of names) {
    const match = name.match(/^(draft|handed)-(.+)\.md$/)
    if (!match) continue
    const id = match[2] ?? ''
    if (!ID.test(id)) continue
    const status: EditStatus = match[1] === 'handed' ? 'handed' : 'draft'

    try {
      summaries.push({ id, status, title: parse(fs.readFileSync(path.join(dir, name), 'utf8')).title })
    } catch (err) {
      summaries.push({ id, status, title: '', error: err instanceof Error ? err.message : String(err) })
    }
  }

  return summaries.sort((a, b) => a.id.localeCompare(b.id))
}

export function readEdit(root: string, id: string): Edit {
  const { status, file } = locate(root, id)
  return { id, status, architecture: parse(fs.readFileSync(file, 'utf8')) }
}

export function updateEdit(root: string, id: string, architecture: Architecture): Edit {
  const { status, file } = locate(root, id)
  if (status === 'handed') throw new Error(`edit ${id} was already handed over and can no longer be edited`)

  fs.writeFileSync(file, serialize(architecture))
  return { id, status, architecture }
}

export function handEdit(root: string, id: string): Edit {
  const { status, file } = locate(root, id)
  if (status === 'handed') throw new Error(`edit ${id} was already handed over`)

  const target = editPath(root, 'handed', id)
  fs.renameSync(file, target)
  return { id, status: 'handed', architecture: parse(fs.readFileSync(target, 'utf8')) }
}

export function deleteEdit(root: string, id: string): void {
  fs.unlinkSync(locate(root, id).file)
}
