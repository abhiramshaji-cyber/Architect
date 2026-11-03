import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { ReviewItem } from '../../shared/types'
import { createQueue } from './queue'

let dir: string
let file: string

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'architect-queue-'))
  file = path.join(dir, 'nested', 'pending.json')
})

afterEach(() => fs.rmSync(dir, { recursive: true, force: true }))

const edge = { kind: 'edge' as const, from: 'api', to: 'db' }
const texts = { before: 'a', after: 'b' }

describe('createQueue', () => {
  it('queues a proposal once per project and tells the listener', () => {
    const seen: ReviewItem[][] = []
    const queue = createQueue(file, (items) => seen.push(items))

    const first = queue.propose('/p', edge, 'because')
    expect(queue.propose('/p', edge, 'again')).toBe(first)
    expect(queue.propose('/q', edge, 'because').id).not.toBe(first.id)
    expect(seen.map((items) => items.length)).toEqual([1, 2])
  })

  it('persists proposals but never code edits, and restores only valid proposals', () => {
    const queue = createQueue(file, () => {})
    const kept = queue.propose('/p', edge, 'because')
    queue.edit('/p', 'src/a.ts', 'Edit', texts)

    const stored = JSON.parse(fs.readFileSync(file, 'utf8')) as ReviewItem[]
    expect(stored.map((item) => item.id)).toEqual([kept.id])

    fs.writeFileSync(file, JSON.stringify([...stored, { kind: 'proposal', id: 'junk' }, 'nope']))
    expect(createQueue(file, () => {}).list()).toEqual([kept])
  })

  it('starts empty when the file is missing or not JSON', () => {
    expect(createQueue(file, () => {}).list()).toEqual([])
    fs.mkdirSync(path.dirname(file), { recursive: true })
    fs.writeFileSync(file, '{')
    expect(createQueue(file, () => {}).list()).toEqual([])
  })

  it('wakes every waiter with the decision and forgets the item', async () => {
    const queue = createQueue(file, () => {})
    const item = queue.propose('/p', edge, 'because')
    const waiting = [queue.wait(item.id, 10_000), queue.wait(item.id, 10_000)]

    expect(queue.settle(item.id, { status: 'approved' })).toBe(true)
    await expect(Promise.all(waiting)).resolves.toEqual([{ status: 'approved' }, { status: 'approved' }])
    expect(queue.list()).toEqual([])
    expect(queue.settle(item.id, { status: 'approved' })).toBe(false)
  })

  it('stops waiting on a timeout or an abort and keeps the item', async () => {
    const queue = createQueue(file, () => {})
    const item = queue.propose('/p', edge, 'because')
    await expect(queue.wait(item.id, 5)).resolves.toBeUndefined()

    const gone = new AbortController()
    const waiting = queue.wait(item.id, 10_000, gone.signal)
    gone.abort()
    await expect(waiting).resolves.toBeUndefined()

    const aborted = new AbortController()
    aborted.abort()
    await expect(queue.wait(item.id, 10_000, aborted.signal)).resolves.toBeUndefined()
    expect(queue.list()).toEqual([item])
  })

  it('refuses to wait on an id it does not hold', async () => {
    await expect(createQueue(file, () => {}).wait('missing', 5)).rejects.toThrow(/missing/)
  })

  it('releases code edits with no answer and keeps proposals', async () => {
    const queue = createQueue(file, () => {})
    const proposal = queue.propose('/p', edge, 'because')
    const code = queue.edit('/p', 'src/a.ts', 'Write', texts)
    const waiting = queue.wait(code.id, 10_000)

    queue.release()
    await expect(waiting).resolves.toBeNull()
    expect(queue.list()).toEqual([proposal])
    expect(queue.get(proposal.id)?.texts).toBeNull()
  })
})
