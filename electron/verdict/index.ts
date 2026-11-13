import path from 'node:path'
import type { Architecture, Request, Verdict } from '../../shared/types'
import { check } from '../contract/graph'
import { checkFile } from '../rules/proposed'

export function verdictFor(architecture: Architecture, parseError: string | null, from: string, to: string): Verdict {
  const verdict = check(architecture, from, to)
  if (parseError === null) return verdict

  const note =
    `the architecture is stale: ${parseError}. ` +
    `This ${verdict.status} verdict comes from the last version of architect.md that parsed ` +
    `and may not match the file on disk. Fix architect.md and check again before relying on it.`

  if (verdict.status === 'forbidden') return { status: 'forbidden', reason: `${verdict.reason} — ${note}` }
  return { status: 'unknown', reason: note }
}

export function changeVerdict(cacheDir: string, root: string, architecture: Architecture, stale: string | null, req: Extract<Request, { op: 'check_change' }>): Verdict {
  const { from, to, file, content } = req
  if ((from === undefined) !== (to === undefined)) throw new Error('check_change needs both from and to')

  const edge = from !== undefined && to !== undefined ? verdictFor(architecture, stale, from, to) : null
  if (edge && (file === undefined || (edge.status !== 'allowed' && edge.status !== 'unknown'))) return edge
  if (file === undefined || content === undefined) throw new Error('check_change needs from and to, or a file with its proposed content')

  const violations = checkFile(cacheDir, root, architecture, path.resolve(req.cwd, file), content)
  if (violations.length > 0) return { status: 'rule-violation', violations }
  if (edge) return edge
  if (stale === null) return { status: 'allowed' }
  return { status: 'unknown', reason: `the architecture is stale: ${stale}. These rules come from the last version of architect.md that parsed. Fix architect.md and check again before relying on it.` }
}
