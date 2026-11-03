import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { CodeChange, ReviewState } from '../../shared/types'
import { createReview, rejection } from '.'

let dir: string
let project: string
let file: string

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'architect-review-'))
  project = path.join(dir, 'project')
  file = path.join(project, 'src', 'a.ts')
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, 'const a = 1\n')
})

afterEach(() => fs.rmSync(dir, { recursive: true, force: true }))

const settingsOf = () => JSON.parse(fs.readFileSync(path.join(dir, 'settings.json'), 'utf8'))

const edit = (old: string, next: string): CodeChange => ({ tool: 'Edit', file, edits: [{ old, new: next, all: false }] })

async function queued(review: ReturnType<typeof createReview>) {
  await vi.waitFor(() => expect(review.state().items).toHaveLength(1))
  return review.state().items[0]!
}

describe('settings', () => {
  it('is off by default and keeps other keys when switched', () => {
    expect(createReview(dir, () => {}).enabled()).toBe(false)

    fs.writeFileSync(path.join(dir, 'settings.json'), JSON.stringify({ theme: 'dark' }))
    const seen: ReviewState[] = []
    const review = createReview(dir, (state) => seen.push(state))
    expect(review.setEnabled(true)).toEqual({ enabled: true, items: [] })
    expect(settingsOf()).toEqual({ theme: 'dark', review: true })
    expect(seen.at(-1)?.enabled).toBe(true)
    expect(createReview(dir, () => {}).enabled()).toBe(true)
  })

  it('reads a broken settings file as off', () => {
    fs.writeFileSync(path.join(dir, 'settings.json'), '[1')
    expect(createReview(dir, () => {}).enabled()).toBe(false)
  })
})

describe('gate', () => {
  it('passes every edit straight through while review is off', async () => {
    await expect(createReview(dir, () => {}).gate([project], edit('1', '2'))).resolves.toBeNull()
  })

  it('passes edits outside a known project and edits it cannot reproduce', async () => {
    const review = createReview(dir, () => {})
    review.setEnabled(true)
    const outside = { ...edit('1', '2'), file: path.join(dir, 'elsewhere.ts') }

    await expect(review.gate([project], outside)).resolves.toBeNull()
    await expect(review.gate([project], edit('missing', '2'))).resolves.toBeNull()
    await expect(review.gate([project], edit('1', '1'))).resolves.toBeNull()
    expect(review.state().items).toEqual([])
  })

  it('holds an edit until approved', async () => {
    const review = createReview(dir, () => {})
    review.setEnabled(true)
    const waiting = review.gate([project], edit('1', '2'))
    const item = await queued(review)

    expect(item).toMatchObject({ kind: 'code', root: project, file: 'src/a.ts', tool: 'Edit' })
    await expect(review.detail(item.id, () => null, async () => [])).resolves.toMatchObject({ file: 'src/a.ts' })
    review.decide(item.id, true, undefined, () => ({ status: 'rejected', reason: 'unused' }))
    await expect(waiting).resolves.toEqual({ status: 'approved' })
  })

  it('denies with the feedback the user typed', async () => {
    const review = createReview(dir, () => {})
    review.setEnabled(true)
    const waiting = review.gate([project], { tool: 'Write', file: path.join(project, 'new.ts'), content: 'x' })

    review.decide((await queued(review)).id, false, '  use the existing helper ', () => ({ status: 'approved' }))
    await expect(waiting).resolves.toEqual(rejection('use the existing helper'))
    expect(rejection('use the existing helper')).toEqual({
      status: 'rejected',
      reason: 'The user rejected this change: use the existing helper',
    })
    expect(rejection(' ')).toEqual({ status: 'rejected', reason: 'The user rejected this change.' })
  })

  it('gives up after the timeout and drops the edit', async () => {
    const review = createReview(dir, () => {}, { edit: 5 })
    review.setEnabled(true)
    const decision = await review.gate([project], edit('1', '2'))

    expect(decision).toMatchObject({ status: 'pending' })
    expect(review.state().items).toEqual([])
  })

  it('lets a waiting edit through when review is switched off', async () => {
    const review = createReview(dir, () => {})
    review.setEnabled(true)
    const waiting = review.gate([project], edit('1', '2'))
    await queued(review)

    review.setEnabled(false)
    await expect(waiting).resolves.toBeNull()
  })

  it('drops an edit whose hook went away', async () => {
    const review = createReview(dir, () => {})
    review.setEnabled(true)
    const gone = new AbortController()
    const waiting = review.gate([project], edit('1', '2'), gone.signal)
    await queued(review)

    gone.abort()
    await expect(waiting).resolves.toBeNull()
    expect(review.state().items).toEqual([])
  })
})

describe('proposals', () => {
  const proposal = { kind: 'edge' as const, from: 'api', to: 'db' }

  it('applies an approved proposal through the daemon and answers with its result', async () => {
    const review = createReview(dir, () => {})
    const waiting = review.propose(project, proposal, 'because')
    const item = await queued(review)
    const adopt = vi.fn(() => ({ status: 'approved' as const }))

    review.decide(item.id, true, undefined, adopt)
    await expect(waiting).resolves.toEqual({ status: 'approved' })
    expect(adopt).toHaveBeenCalledWith(project, proposal)
  })

  it('reports a failed apply as a rejection', async () => {
    const review = createReview(dir, () => {})
    const waiting = review.propose(project, proposal, 'because')

    review.decide((await queued(review)).id, true, undefined, () => {
      throw new Error('disk full')
    })
    await expect(waiting).resolves.toEqual({ status: 'rejected', reason: 'disk full' })
  })

  it('answers pending after the timeout and can be awaited again', async () => {
    const review = createReview(dir, () => {}, { proposal: 5 })
    const first = await review.propose(project, proposal, 'because')
    expect(first.status).toBe('pending')

    const id = first.status === 'pending' ? first.id : ''
    const again = createReview(dir, () => {}, { proposal: 10_000 })
    const waiting = again.resume(id)
    again.decide(id, false, 'draw it the other way', () => ({ status: 'approved' }))
    await expect(waiting).resolves.toEqual(rejection('draw it the other way'))
    await expect(again.resume(id)).rejects.toThrow(/no pending proposal/)
  })
})
