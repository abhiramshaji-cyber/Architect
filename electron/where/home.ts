import type { Architecture, Verdict } from '../../shared/types'
import { check, ownership } from '../contract/graph'
import { folderOf } from '../rules/audit'
import type { Resolved } from './refs'

export type Blocked = { ref: string; from: string; to: string; verdict: Verdict['status'] }

export type Candidate = { component: string; neighbours: number; evidence: string[]; blocked: Blocked[] }

export type ComponentPick = {
  status: 'found' | 'tied' | 'blocked' | 'unowned' | 'no-contract' | 'no-match'
  id: string | null
  reason: string
  candidates: Candidate[]
}

export type FolderVote = { path: string; neighbours: number; evidence: string[] }

export type FolderPick = { status: 'found' | 'tied' | 'none'; path: string | null; reason: string; candidates: FolderVote[] }

type Side = { ref: Resolved; calls: boolean }

export const counted = (ref: Resolved) => ref.status === 'function' || ref.status === 'file'

function ownersOf(architecture: Architecture, files: string[]): Map<string, string[]> {
  const { owned, multi } = ownership(files, architecture.components)
  return new Map([...owned.map(({ path, owner }): [string, string[]] => [path, [owner]]), ...multi.map(({ path, owners }): [string, string[]] => [path, owners])])
}

function blockedFor(architecture: Architecture, owners: Map<string, string[]>, sides: Side[], id: string): Blocked[] {
  return sides.flatMap(({ ref, calls }) =>
    [...new Set(ref.files.flatMap((file) => owners.get(file) ?? []))]
      .filter((other) => other !== id)
      .flatMap((other) => {
        const [from, to] = calls ? [id, other] : [other, id]
        const verdict = check(architecture, from, to).status
        return verdict === 'allowed' ? [] : [{ ref: ref.ref, from, to, verdict }]
      }),
  )
}

function votesOf(sides: Side[], keysOf: (ref: Resolved) => string[]): { key: string; neighbours: number; evidence: string[] }[] {
  const votes = new Map<string, string[]>()
  for (const { ref } of sides) for (const key of new Set(keysOf(ref))) votes.set(key, [...(votes.get(key) ?? []), ...ref.matches.map((match) => `${ref.ref} at ${match}`)])
  const neighbours = (key: string) => sides.filter(({ ref }) => keysOf(ref).includes(key)).length
  return [...votes].map(([key, evidence]) => ({ key, neighbours: neighbours(key), evidence })).sort((a, b) => b.neighbours - a.neighbours || a.key.localeCompare(b.key))
}

function componentOf(architecture: Architecture | null, owners: Map<string, string[]>, sides: Side[]): ComponentPick {
  const total = sides.length
  const none = (status: ComponentPick['status'], reason: string): ComponentPick => ({ status, id: null, reason, candidates: [] })
  if (total === 0) return none('no-match', 'none of the calls or callers matched a function or file in the scan')
  if (!architecture) return none('no-contract', 'there is no architect.md, so the answer is placed by folder only')

  const candidates = votesOf(sides, (ref) => ref.files.flatMap((file) => owners.get(file) ?? [])).map(({ key, neighbours, evidence }) => ({
    component: key,
    neighbours,
    evidence,
    blocked: blockedFor(architecture, owners, sides, key),
  }))
  if (candidates.length === 0) return none('unowned', `no component in architect.md owns the files of the ${total} matched neighbours`)

  const legal = candidates.filter((candidate) => candidate.blocked.length === 0)
  const best = legal[0]
  if (!best) return { status: 'blocked', id: null, reason: 'every component owning a neighbour would need a dependency architect.md does not allow', candidates }

  const tied = legal.filter((candidate) => candidate.neighbours === best.neighbours)
  const skipped = candidates.filter((candidate) => candidate.neighbours > best.neighbours).map((candidate) => candidate.component)
  const passed = skipped.length === 0 ? '' : `; ${skipped.join(', ')} own more but would need a dependency architect.md does not allow`
  if (tied.length > 1) return { status: 'tied', id: null, reason: `${tied.map((c) => c.component).join(', ')} each own ${best.neighbours} of ${total} matched neighbours${passed}`, candidates }
  return { status: 'found', id: best.component, reason: `owns ${best.neighbours} of ${total} matched neighbours and every call to and from it is allowed${passed}`, candidates }
}

function folderPick(sides: Side[], keep: (file: string) => boolean): FolderPick {
  const candidates = votesOf(sides, (ref) => ref.files.filter(keep).map((file) => folderOf(file) || '.')).map(({ key, neighbours, evidence }) => ({ path: key, neighbours, evidence }))
  const best = candidates[0]
  if (!best) return { status: 'none', path: null, reason: 'no matched neighbour lives in a folder of the picked component', candidates }

  const tied = candidates.filter((candidate) => candidate.neighbours === best.neighbours)
  if (tied.length > 1) return { status: 'tied', path: null, reason: `${tied.map((c) => c.path).join(', ')} each hold ${best.neighbours} neighbours`, candidates }
  return { status: 'found', path: best.path, reason: `holds ${best.neighbours} of the ${sides.length} matched neighbours`, candidates }
}

export function homeOf(architecture: Architecture | null, files: string[], calls: Resolved[], callers: Resolved[]): { component: ComponentPick; folder: FolderPick } {
  const sides = [...calls.map((ref) => ({ ref, calls: true })), ...callers.map((ref) => ({ ref, calls: false }))].filter((side) => counted(side.ref))
  const owners = architecture ? ownersOf(architecture, files) : new Map<string, string[]>()
  const component = componentOf(architecture, owners, sides)

  if (component.id !== null) return { component, folder: folderPick(sides, (file) => owners.get(file)?.includes(component.id as string) === true) }
  if (component.status === 'no-contract' || component.status === 'unowned') return { component, folder: folderPick(sides, () => true) }
  return { component, folder: { status: 'none', path: null, reason: `no folder is picked while the component is ${component.status}`, candidates: [] } }
}
