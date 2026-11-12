import fs from 'node:fs'
import path from 'node:path'
import { readSettings, saveSettings } from '../../shared/settings'
import {
  EDIT_TIMEOUT_MS,
  PROPOSAL_TIMEOUT_MS,
  type Architecture,
  type CodeChange,
  type Decision,
  type FunctionRow,
  type Proposal,
  type ReviewDetail,
  type ReviewItem,
  type ReviewState,
} from '../../shared/types'
import { applyChange, rootOf } from './change'
import { detailOf } from './impact'
import { createQueue } from './queue'

export { applyChange, rootOf } from './change'
export { functionImpact, ownersOf } from './impact'

type Timeouts = { proposal?: number; edit?: number }

function real(target: string): string {
  try {
    return fs.realpathSync.native(target)
  } catch {
    const parent = path.dirname(target)
    return parent === target ? target : path.join(real(parent), path.basename(target))
  }
}

async function current(file: string): Promise<string | null> {
  try {
    return await fs.promises.readFile(file, 'utf8')
  } catch (err) {
    return (err as NodeJS.ErrnoException).code === 'ENOENT' ? '' : null
  }
}

export function rejection(feedback?: string): Decision {
  const said = feedback?.trim()
  return { status: 'rejected', reason: said ? `The user rejected this change: ${said}` : 'The user rejected this change.' }
}

function adopted(item: Extract<ReviewItem, { kind: 'proposal' }>, adopt: (root: string, proposal: Proposal) => Decision): Decision {
  try {
    return adopt(item.root, item.proposal)
  } catch (err) {
    return { status: 'rejected', reason: err instanceof Error ? err.message : String(err) }
  }
}

export function createReview(dir: string, notify: (state: ReviewState) => void, timeouts: Timeouts = {}) {
  const settingsFile = path.join(dir, 'settings.json')
  let enabled = readSettings(settingsFile).review
  const queue = createQueue(path.join(dir, 'pending.json'), () => notify(state()))

  function state(): ReviewState {
    return { enabled, items: queue.list() }
  }

  function setEnabled(on: boolean): ReviewState {
    saveSettings(settingsFile, { review: on })
    enabled = on
    if (!on) queue.release()
    notify(state())
    return state()
  }

  async function settled(item: ReviewItem, ms: number, signal?: AbortSignal): Promise<Decision> {
    const answer = await queue.wait(item.id, ms, signal)
    return answer ?? { status: 'pending', id: item.id }
  }

  function propose(root: string, proposal: Proposal, rationale: string, signal?: AbortSignal): Promise<Decision> {
    return settled(queue.propose(root, proposal, rationale), timeouts.proposal ?? PROPOSAL_TIMEOUT_MS, signal)
  }

  function resume(id: string, signal?: AbortSignal): Promise<Decision> {
    const entry = queue.get(id)
    if (!entry || entry.item.kind !== 'proposal') return Promise.reject(new Error(`no pending proposal with id ${id}`))
    return settled(entry.item, timeouts.proposal ?? PROPOSAL_TIMEOUT_MS, signal)
  }

  async function gate(roots: string[], change: CodeChange, signal?: AbortSignal): Promise<Decision | null> {
    if (!enabled) return null

    const aliases = new Map(roots.flatMap((root) => [[real(root), root] as const, [root, root] as const]))
    const place = rootOf(aliases, [path.resolve(change.file), real(path.resolve(change.file))])
    if (!place) return null

    const before = await current(place.file)
    const after = before === null ? null : applyChange(before, change)
    if (before === null || after === null || after === before) return null

    const item = queue.edit(place.root, place.relative, change.tool, { before, after })
    const answer = await queue.wait(item.id, timeouts.edit ?? EDIT_TIMEOUT_MS, signal)
    if (answer !== undefined) return answer

    queue.settle(item.id, null)
    return signal?.aborted ? null : { status: 'pending', id: item.id }
  }

  function decide(id: string, approved: boolean, feedback: string | undefined, adopt: (root: string, proposal: Proposal) => Decision) {
    const item = queue.get(id)?.item
    if (!item) return

    queue.settle(id, !approved ? rejection(feedback) : item.kind === 'proposal' ? adopted(item, adopt) : { status: 'approved' })
  }

  async function detail(id: string, architecture: (root: string) => Architecture | null, rows: (root: string) => Promise<FunctionRow[]>): Promise<ReviewDetail> {
    const entry = queue.get(id)
    if (!entry) throw new Error(`no pending change with id ${id}`)

    const { item, texts } = entry
    return detailOf(item, texts, architecture(item.root), item.kind === 'code' ? await rows(item.root) : [])
  }

  return { enabled: () => enabled, state, setEnabled, propose, resume, gate, decide, detail }
}
