import type { Architecture, CodeMap } from '../../shared/types'
import { whereOf } from '../where'
import type { Move } from './schema'

const LISTED = 5

type Spot = { file: string; name: string; line: number }

export function movesOf(map: CodeMap, root: string, after: Architecture, callees: Spot[]): { moves: Move[]; more: number } {
  const files = map.folders.flatMap((folder) => folder.files)
  const byFile = new Map(files.map((file) => [file.path, file.functions.map((fn): Spot => ({ file: file.path, name: fn.name, line: fn.line }))]))
  const ref = (spot: Spot) => `${spot.file}:${spot.name}`
  const moves = callees.slice(0, LISTED).map((callee): Move => {
    const entry = files.find((file) => file.path === callee.file)?.functions.find((fn) => fn.line === callee.line && fn.name === callee.name)
    const calls = (entry?.calls ?? []).flatMap((call) => {
      const target = byFile.get(call.file)?.[call.fn]
      return target ? [ref(target)] : []
    })
    const callers = files.flatMap((file) => file.functions.filter((fn) => fn.calls.some((call) => call.file === callee.file && byFile.get(call.file)?.[call.fn]?.line === callee.line)).map((fn) => `${file.path}:${fn.name}`))
    const found = whereOf({ calls, callers, name: callee.name }, { root, cwd: root, map, architecture: after, stale: null })
    return { fn: `${callee.file}:${callee.line} ${callee.name}`, component: found.component.id, status: found.component.status, folder: found.folder.path, reason: found.component.reason }
  })
  return { moves, more: Math.max(0, callees.length - LISTED) }
}
