import fs from 'node:fs'
import path from 'node:path'
import type { Architecture, RuleEntry, RuleViolation } from '../../shared/types'
import { functionsIn, IGNORED_DIRS } from '../scan/scan'
import { auditRules, effective, folderOf } from './audit'
import { factsOf, type SourceFacts } from './facts'
import { recordRuns } from './runs'
import { fileSplit } from './split/files'

const SPLITTABLE = new Set(['lines', 'jobs'])

export function proposedViolations(
  declared: RuleEntry[] | undefined,
  scope: string | undefined,
  siblings: string[],
  before: SourceFacts | null,
  after: SourceFacts,
): RuleViolation[] {
  const others = siblings.filter((sibling) => sibling !== after.path).flatMap((sibling) => factsOf(sibling, () => '', () => []) ?? [])
  const subjects = new Set([after.path, folderOf(after.path) || '.'])
  const touching = (found: RuleViolation[]) => found.filter((violation) => subjects.has(violation.path))

  const was = touching(auditRules(declared, before ? [...others, before] : others, scope))
  const now = touching(auditRules(declared, [...others, after], scope))
  return now.filter((violation) => !was.some((old) => old.key === violation.key && old.amount >= violation.amount))
}

function readText(file: string): string | undefined {
  try {
    return fs.readFileSync(file, 'utf8')
  } catch {
    return undefined
  }
}

function filesIn(root: string, folder: string): string[] {
  try {
    return fs
      .readdirSync(path.join(root, folder), { withFileTypes: true })
      .filter((entry) => entry.isFile())
      .map((entry) => (folder ? `${folder}/${entry.name}` : entry.name))
  } catch {
    return []
  }
}

function codeIn(root: string, folder: string): string[] {
  return filesIn(root, folder).filter((file) => factsOf(file, () => '', () => []) !== null)
}

function onDisk(target: string): string {
  const rest: string[] = []
  let dir = target
  while (!fs.existsSync(dir) && path.dirname(dir) !== dir) {
    rest.unshift(path.basename(dir))
    dir = path.dirname(dir)
  }
  try {
    return path.join(fs.realpathSync.native(dir), ...rest)
  } catch {
    return target
  }
}

export function proposedFile(
  root: string,
  rules: RuleEntry[] | undefined,
  scope: string | undefined,
  file: string,
  content: string,
): { relative: string; violations: RuleViolation[] } {
  const relative = path.relative(onDisk(root), onDisk(path.resolve(root, file))).split(path.sep).join('/')
  if (relative === '' || relative.startsWith('../') || relative === '..' || path.isAbsolute(relative)) {
    throw new Error(`${file} is outside the project at ${root}`)
  }

  const parse = (text: string) => functionsIn(text, relative)
  const before = factsOf(relative, () => readText(path.join(root, relative)), parse)
  const scanned = relative.split('/').slice(0, -1).every((part) => !IGNORED_DIRS.has(part) && !part.startsWith('.'))
  const after = scanned ? factsOf(relative, () => content, parse) : null
  const found = after ? proposedViolations(rules, scope, filesIn(root, folderOf(relative)), before, after) : []
  const splittable = (violation: RuleViolation) => violation.path === relative && SPLITTABLE.has(violation.rule)
  const split = after && found.some(splittable) ? fileSplit(effective(rules), after, (folder) => codeIn(root, folder)) : null
  return { relative, violations: found.map((violation) => (split && splittable(violation) ? { ...violation, split } : violation)) }
}

export function checkFile(cacheDir: string, root: string, architecture: Architecture, file: string, content: string): RuleViolation[] {
  const { relative, violations } = proposedFile(root, architecture.rules, architecture.scope, file, content)
  recordRuns(cacheDir, root, 'check_change', violations, relative)
  return violations
}
