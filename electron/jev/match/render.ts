import type { SameBehavior } from '../../../shared/jev/types'

const percent = (value: number) => `${Math.round(value * 100)}%`

export function behaviorMarkdown(found: SameBehavior): string {
  if (found.status !== 'done') return found.reason
  const head = `## Same behavior as \`${found.name}\` (${found.file}:${found.line})`
  const checked = `Jev compared ${found.candidates} candidates pairwise: ${found.matches.length} confirmed, ${found.rejected} rejected.`
  const rows = found.matches.map((match) => `- \`${match.name}\` at ${match.file}:${match.line}, ${percent(match.probability)} same, ${match.structural ? 'also a structural match' : 'found by Jev only'}. ${match.io}`)
  const none = found.matches.length === 0 ? ['No other function was confirmed to implement the same behavior.'] : []
  const notes = found.notes.map((note) => `- ${note}`)
  return [head, '', checked, '', ...rows, ...none, ...(notes.length > 0 ? ['', 'Notes:', ...notes] : [])].join('\n')
}
