import type { FunctionFacts, FunctionRank, Importance } from '../../shared/types'

const HAIKU_CONTEXT_TOKENS = 200_000
const PROMPT_SHARE = 0.4
const CHARS_PER_TOKEN = 3

export const FUNCTIONS_PER_CALL = 50
export const LINE_CHARS = 160
export const SOURCE_LINES = Math.floor(
  (HAIKU_CONTEXT_TOKENS * PROMPT_SHARE * CHARS_PER_TOKEN) / (FUNCTIONS_PER_CALL * LINE_CHARS),
)

export type Ask = { id: string; facts: FunctionFacts; source: string }

export function sourceOf(lines: string[], facts: FunctionFacts): string {
  const start = Math.max(0, facts.line - 1)
  return lines
    .slice(start, start + Math.min(facts.lines, SOURCE_LINES))
    .map((line) => line.slice(0, LINE_CHARS))
    .join('\n')
}

const yesNo = (value: boolean) => (value ? 'yes' : 'no')

export function promptFor(project: string, file: string, asks: Ask[]): string {
  const entry = asks[0]?.facts.entry ?? false
  const blocks = asks.map(({ id, facts, source }) => {
    const head = `<function id="${id}" name="${facts.name.replaceAll('"', "'")}" lines="${facts.lines}" called-by="${facts.fanIn}" calls="${facts.fanOut}" exported="${yesNo(facts.exported)}">`
    return `${head}\n${source}\n</function>`
  })

  return [
    `These functions come from ${file} in the project "${project}".`,
    entry
      ? 'No other file in the project loads this file, so it is a starting point or a stand alone piece.'
      : 'Other files in the project load this file.',
    '',
    `Each block gives facts measured from the code (its length in lines, how many other functions call it, how many it calls, whether the file exports it) and the first ${SOURCE_LINES} lines of its source.`,
    '',
    blocks.join('\n\n'),
    '',
    'For every block, give:',
    '- importance: a whole number from 1 to 5 for how central it is to what this project does. 5 means the project cannot do its main job without it, 1 means small glue nobody would miss. The facts are evidence, not a formula; judge by what the code means for the project.',
    '- summary: one short sentence, under 20 words, that someone who has never written code would understand, saying what it does for the project and its users. Use everyday words. Do not use programming terms such as handler, callback, IPC, async, AST, memoize, function, parameter, return, object, array, string, or the name of the code itself.',
    '',
    'Reply with only a JSON array holding one object per block, in any order, and nothing else:',
    '[{"id": "f0", "importance": 3, "summary": "Saves your drawing to disk so it is there next time."}]',
  ].join('\n')
}

function importanceOf(value: unknown): Importance | null {
  const n = typeof value === 'string' ? Number(value.trim()) : value
  return n === 1 || n === 2 || n === 3 || n === 4 || n === 5 ? n : null
}

export function parseRanks(text: string, ids: string[]): Map<string, FunctionRank> {
  const out = new Map<string, FunctionRank>()
  const start = text.indexOf('[')
  const end = text.lastIndexOf(']')
  if (start === -1 || end <= start) return out

  let parsed: unknown
  try {
    parsed = JSON.parse(text.slice(start, end + 1))
  } catch {
    return out
  }
  if (!Array.isArray(parsed)) return out

  const wanted = new Set(ids)
  for (const item of parsed) {
    if (typeof item !== 'object' || item === null) continue
    const { id, importance, summary } = item as {
      id?: unknown
      importance?: unknown
      summary?: unknown
    }
    if (typeof id !== 'string' || !wanted.has(id) || out.has(id)) continue

    const level = importanceOf(importance)
    const sentence = typeof summary === 'string' ? summary.replace(/\s+/g, ' ').trim() : ''
    if (level === null || sentence === '') continue
    out.set(id, { importance: level, summary: sentence })
  }
  return out
}
