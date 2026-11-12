import fs from 'node:fs'
import path from 'node:path'
import type { Architecture, RuleEntry, RuleViolation } from '../../shared/types'
import { functionsIn } from '../scan/scan'
import { auditRules, folderOf } from './audit'
import { factsOf, type SourceFacts } from './facts'
import { recordRuns } from './runs'

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

function filesBeside(root: string, file: string): string[] {
  const folder = folderOf(file)
  try {
    return fs
      .readdirSync(path.join(root, folder), { withFileTypes: true })
      .filter((entry) => entry.isFile())
      .map((entry) => (folder ? `${folder}/${entry.name}` : entry.name))
  } catch {
    return []
  }
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

export function checkFile(cacheDir: string, root: string, architecture: Architecture, file: string, content: string): RuleViolation[] {
  const relative = path.relative(onDisk(root), onDisk(path.resolve(root, file))).split(path.sep).join('/')
  if (relative === '' || relative.startsWith('../') || relative === '..' || path.isAbsolute(relative)) {
    throw new Error(`${file} is outside the project at ${root}`)
  }

  const parse = (text: string) => functionsIn(text, relative)
  const before = factsOf(relative, () => readText(path.join(root, relative)), parse)
  const after = factsOf(relative, () => content, parse)
  const violations = after ? proposedViolations(architecture.rules, architecture.scope, filesBeside(root, relative), before, after) : []

  recordRuns(cacheDir, root, 'check_change', violations, relative)
  return violations
}
