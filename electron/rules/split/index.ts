import fs from 'node:fs'
import path from 'node:path'
import type { Architecture, CodeMap, RuleEntry, SplitSuggestion } from '../../../shared/types'
import { consideredOf, effective, folderOf } from '../audit'
import { sourcesIn, type SourceFacts } from '../facts'
import { fileSplit } from './files'
import { functionSplits } from './functions'

export function splitSuggestions(declared: RuleEntry[] | undefined, sources: SourceFacts[], read: (file: string) => string | undefined, scope?: string): SplitSuggestion[] {
  const entries = effective(declared)
  const considered = consideredOf(entries, sources, scope)
  const filesIn = (folder: string) => considered.flatMap((file) => (folderOf(file.path) === folder ? [file.path] : []))
  const files = considered.flatMap((file) => fileSplit(entries, file, filesIn) ?? [])
  const suggestions: SplitSuggestion[] = [...files, ...functionSplits(entries, considered, read)]
  return suggestions.sort((a, b) => a.path.localeCompare(b.path) || (a.kind === 'file' ? 0 : a.line) - (b.kind === 'file' ? 0 : b.line))
}

export function splitsIn(root: string, map: CodeMap, architecture: Architecture | null | undefined, within = ''): SplitSuggestion[] {
  const read = (file: string) => {
    try {
      return fs.readFileSync(path.join(root, file), 'utf8')
    } catch {
      return undefined
    }
  }
  const found = splitSuggestions(architecture?.rules, sourcesIn(root, map, () => []), read, architecture?.scope)
  return within === '' ? found : found.filter((split) => split.path === within || split.path.startsWith(`${within}/`))
}
