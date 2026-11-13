import { CONFIRMED, POSSIBLE, type BehaviorMatch, type SameBehavior } from '../../../shared/jev/types'

const percent = (value: number) => `${Math.round(value * 100)}%`

function row(match: BehaviorMatch): string {
  const joined = match.via ? ` (joined through \`${match.via}\`)` : ''
  const part = match.responsibility ? `, component ${match.responsibility}` : ''
  return `- \`${match.name}\` at ${match.file}:${match.line}, ${percent(match.probability)} same${joined}${part}, ${match.structural ? 'also a structural match' : 'found by Jev only'}. ${match.io}`
}

export function behaviorMarkdown(found: SameBehavior): string {
  if (found.status !== 'done') return found.reason
  const part = found.responsibility ? `, component ${found.responsibility}` : ''
  const head = `## Same behavior group of \`${found.name}\` (${found.file}:${found.line}${part})`
  const checked = `Jev compared ${found.candidates} candidates pairwise this time: ${found.rejected} rejected. The group joins every confirmed pair (above ${percent(CONFIRMED)}) that shares a function, from this search and earlier ones.`
  const none = found.matches.length === 0 ? ['No other function was confirmed to implement the same behavior.'] : []
  const possible = found.possible.length > 0 ? ['', `### Possible, not confirmed (${percent(POSSIBLE)} to ${percent(CONFIRMED)})`, ...found.possible.map(row)] : []
  const notes = found.notes.length > 0 ? ['', 'Notes:', ...found.notes.map((note) => `- ${note}`)] : []
  return [head, '', checked, '', ...found.matches.map(row), ...none, ...possible, ...notes].join('\n')
}
