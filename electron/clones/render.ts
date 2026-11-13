import { percent } from '../../shared/text/percent'
import type { CloneMatch, SameBehavior } from '../../shared/clones/types'
import { FLOOR } from './near'

function row(match: CloneMatch): string {
  const kind = match.clone === 'exact' ? 'exact clone' : match.clone === 'near' ? `near clone, ${percent(match.similarity)} of its shape in common` : `structural match only, ${percent(match.similarity)} of its shape in common`
  const also = match.clone !== null && match.structural ? ', also a structural match' : ''
  return `- \`${match.name}\` at ${match.file}:${match.line}, ${kind}${also}`
}

export function behaviorMarkdown(found: SameBehavior): string {
  if (found.status !== 'done') return found.reason
  const head = `## Same behavior as \`${found.name}\` (${found.file}:${found.line})`
  const how = `Found locally, with no network call, by comparing the shape of each function body: names of parameters and locals, types, comments and formatting are ignored. An exact clone has the same shape; a near clone shares at least ${percent(FLOOR)} of its shape in order. Structural matches call the same functions or are called by the same callers. Test files and functions under ${found.least} shape tokens are not compared.`
  const short = found.tokens < found.least ? [`\`${found.name}\` has ${found.tokens} shape tokens, under the ${found.least} needed to compare it, so only structural matches are listed.`] : []
  const none = found.matches.length === 0 ? ['No other function has the same or a near shape, and none shares its calls or callers.'] : []
  return [head, '', how, '', ...short, ...found.matches.map(row), ...none].join('\n')
}
