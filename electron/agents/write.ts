import fs from 'node:fs'
import path from 'node:path'
import type { AgentsReport, Architecture } from '../../shared/types'
import { IGNORED_DIRS } from '../scan/scan'
import { MARKER, renderAgents } from './render'

const NAME = 'AGENTS.md'

function readText(file: string): string | undefined {
  try {
    return fs.readFileSync(file, 'utf8')
  } catch {
    return undefined
  }
}

function generatedIn(root: string, relative = ''): string[] {
  let entries: fs.Dirent[]
  try {
    entries = fs.readdirSync(path.join(root, relative), { withFileTypes: true })
  } catch {
    return []
  }

  return entries.flatMap((entry) => {
    const child = relative ? `${relative}/${entry.name}` : entry.name
    if (entry.isDirectory()) return IGNORED_DIRS.has(entry.name) || entry.name.startsWith('.') ? [] : generatedIn(root, child)
    if (!entry.isFile() || entry.name !== NAME || relative === '') return []
    return readText(path.join(root, child))?.startsWith(MARKER) ? [child] : []
  })
}

export function hasAgents(root: string): boolean {
  return generatedIn(root).length > 0
}

export function writeAgents(root: string, architecture: Architecture): AgentsReport {
  const { placed, unplaced } = renderAgents(architecture)
  const report: AgentsReport = { written: [], unchanged: [], removed: [], kept: [], unplaced }
  const targets = new Set(placed.map(({ folder }) => `${folder}/${NAME}`))

  for (const { component, folder, text } of placed) {
    const relative = `${folder}/${NAME}`
    const target = path.join(root, relative)
    const existing = readText(target)
    if (existing === text) report.unchanged.push(relative)
    else if (existing !== undefined && !existing.startsWith(MARKER)) report.kept.push(relative)
    else if (fs.existsSync(path.join(root, folder))) {
      fs.writeFileSync(target, text)
      report.written.push(relative)
    } else report.unplaced.push({ component, reason: `${folder} does not exist` })
  }

  for (const stale of generatedIn(root).filter((file) => !targets.has(file))) {
    fs.rmSync(path.join(root, stale))
    report.removed.push(stale)
  }

  return report
}
