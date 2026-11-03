import { randomUUID } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { reviewItemSchema, type Decision, type Proposal, type ReviewItem } from '../../shared/types'

export type Answer = Decision | null

export type Texts = { before: string; after: string }

type Entry = { item: ReviewItem; texts: Texts | null; waiters: Set<(answer: Answer | undefined) => void> }

type CodeItem = Extract<ReviewItem, { kind: 'code' }>

function restored(file: string): Entry[] {
  let stored: unknown
  try {
    stored = JSON.parse(fs.readFileSync(file, 'utf8'))
  } catch {
    return []
  }

  return (Array.isArray(stored) ? stored : []).flatMap((raw): Entry[] => {
    const item = reviewItemSchema.safeParse(raw).data
    return item?.kind === 'proposal' ? [{ item, texts: null, waiters: new Set() }] : []
  })
}

export function createQueue(file: string, notify: (items: ReviewItem[]) => void) {
  const entries = new Map(restored(file).map((entry) => [entry.item.id, entry]))

  function list(): ReviewItem[] {
    return [...entries.values()].map((entry) => entry.item)
  }

  function changed() {
    try {
      fs.mkdirSync(path.dirname(file), { recursive: true })
      fs.writeFileSync(file, JSON.stringify(list().filter((item) => item.kind === 'proposal'), null, 2))
    } catch (err) {
      console.error('could not persist pending changes:', err instanceof Error ? err.message : err)
    }
    notify(list())
  }

  function add(item: ReviewItem, texts: Texts | null): ReviewItem {
    entries.set(item.id, { item, texts, waiters: new Set() })
    changed()
    return item
  }

  function propose(root: string, proposal: Proposal, rationale: string): ReviewItem {
    const same = JSON.stringify(proposal)
    const existing = list().find(
      (item) => item.kind === 'proposal' && item.root === root && JSON.stringify(item.proposal) === same,
    )
    return existing ?? add({ kind: 'proposal', id: randomUUID(), root, at: Date.now(), proposal, rationale }, null)
  }

  function edit(root: string, relative: string, tool: CodeItem['tool'], texts: Texts): ReviewItem {
    return add({ kind: 'code', id: randomUUID(), root, at: Date.now(), file: relative, tool }, texts)
  }

  function wait(id: string, ms: number, signal?: AbortSignal): Promise<Answer | undefined> {
    const entry = entries.get(id)
    if (!entry) return Promise.reject(new Error(`no pending change with id ${id}`))

    return new Promise((resolve) => {
      const done = (answer: Answer | undefined) => {
        clearTimeout(timer)
        signal?.removeEventListener('abort', gone)
        entry.waiters.delete(done)
        resolve(answer)
      }
      const gone = () => done(undefined)
      const timer = setTimeout(gone, ms)
      if (signal?.aborted) return gone()
      signal?.addEventListener('abort', gone, { once: true })
      entry.waiters.add(done)
    })
  }

  function settle(id: string, answer: Answer): boolean {
    const entry = entries.get(id)
    if (!entry) return false

    entries.delete(id)
    changed()
    for (const waiter of [...entry.waiters]) waiter(answer)
    return true
  }

  function release() {
    for (const item of list()) if (item.kind === 'code') settle(item.id, null)
  }

  return { list, get: (id: string) => entries.get(id), propose, edit, wait, settle, release }
}
