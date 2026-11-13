import path from 'node:path'
import { readText } from '../../../shared/disk/read'
import type { Architecture, CodeMap, RuleEntry, SplitSuggestion } from '../../../shared/types'
import { consideredOf, effective, folderOf } from '../audit'
import { sourcesIn, type SourceFacts } from '../facts'
import { fileSplit } from './files'
import { functionSplits } from './functions'

export function splitSuggestions(declared: RuleEntry[] | undefined, sources: SourceFacts[], read: (file: string) => string | undefined, scope?: string): SplitSuggestion[] {
  const entries = effective(declared)
  const considered = consideredOf(entries, sources, scope)
  const filesIn = (folder: string) => sources.flatMap((file) => (folderOf(file.path) === folder ? [file.path] : []))
  const files = considered.flatMap((file) => fileSplit(entries, file, filesIn) ?? [])
  const suggestions: SplitSuggestion[] = [...files, ...functionSplits(entries, considered, read)]
  return suggestions.sort((a, b) => a.path.localeCompare(b.path) || (a.kind === 'file' ? 0 : a.line) - (b.kind === 'file' ? 0 : b.line))
}

export function splitsIn(root: string, map: CodeMap, architecture: Architecture | null | undefined): SplitSuggestion[] {
  return splitSuggestions(architecture?.rules, sourcesIn(root, map, () => []), (file) => readText(path.join(root, file)), architecture?.scope)
}
