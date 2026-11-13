import path from 'node:path'
import { folderShaped } from '../../shared/folders'
import type { CodeMap, DraftResult } from '../../shared/types'
import { parse } from '../contract/graph'
import { entryFiles } from '../functions'
import { validate } from './flow/build'
import { evidence } from './flow/evidence'
import { promptFor } from './flow/prompt'
import { type AiRun, failureOf } from '../ai'

export { validate } from './flow/build'
export { type Evidence, evidence, skeleton } from './flow/evidence'
export { promptFor } from './flow/prompt'
export type { AiOutput, AiRun } from '../ai'

const ATTEMPTS = 2

function verdictOf(result: DraftResult<string>, tops: string[]): { result: DraftResult<string>; feedback: string } {
  if (!result.ok) {
    const detail = result.error.kind === 'unusable' ? result.error.detail : result.error.kind
    return { result, feedback: `Your last reply could not be used because ${detail}. Follow the format exactly.` }
  }

  const drawn = parse(result.value)
  if (!folderShaped(drawn, tops)) return { result, feedback: '' }

  const ids = drawn.components.map((c) => c.id).join(', ')
  return {
    result: {
      ok: false,
      error: { kind: 'unusable', detail: `Claude drew the top level folders (${ids}) instead of the runtime flow` },
    },
    feedback: `Your last reply was rejected because its components were just the top level folders (${ids}). That is a folder tree, not a flow chart. Group the functions by the runtime job they do and draw how a request moves between those jobs.`,
  }
}

export async function draft(
  root: string,
  map: CodeMap,
  run: AiRun,
  scope = '',
): Promise<DraftResult<string>> {
  const found = evidence(map, scope, entryFiles(root, map))
  if (found.functions.length === 0 && scope !== '') return draft(root, map, run)
  if (found.functions.length === 0) return { ok: false, error: { kind: 'nothing-to-draft' } }

  const title = path.basename(scope || root)
  let feedback = ''
  let last: DraftResult<string> = { ok: false, error: { kind: 'nothing-to-draft' } }

  for (let attempt = 0; attempt < ATTEMPTS; attempt++) {
    const out = await run(promptFor(found, title, scope, feedback), root)
    const failed = failureOf(out)
    if (failed) return { ok: false, error: failed }

    const judged = verdictOf(validate(out.stdout, found, title, scope), found.tops)
    if (judged.feedback === '') return judged.result
    last = judged.result
    feedback = judged.feedback
  }

  return last
}
