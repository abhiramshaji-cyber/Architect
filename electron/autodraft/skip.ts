import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import type { CodeMap } from '../../shared/types'
import { succeeds } from '../git/git'
import { IGNORED_DIRS } from '../scan/scan'

export const AUTO_DRAFT_MODEL = 'haiku'

export const MAX_AUTO_DRAFT_FILES = 2000

export const MAX_NESTED_REPOS = 2

export type Place = { root: string; home: string; inRepo: boolean; nestedRepos: number }

export type SkipReason = 'broad' | 'container' | 'too-big'

export function placeSkip({ root, home, inRepo, nestedRepos }: Place): SkipReason | null {
  if (root === home || path.dirname(root) === root) return 'broad'
  if (!inRepo && nestedRepos >= MAX_NESTED_REPOS) return 'container'
  return null
}

export function sizeSkip(map: CodeMap): SkipReason | null {
  const files = map.folders.reduce((sum, folder) => sum + folder.files.length, 0)
  return files > MAX_AUTO_DRAFT_FILES ? 'too-big' : null
}

function childDirs(dir: string): string[] {
  try {
    return fs
      .readdirSync(dir, { withFileTypes: true })
      .filter((entry) => entry.isDirectory() && !entry.name.startsWith('.') && !IGNORED_DIRS.has(entry.name))
      .map((entry) => path.join(dir, entry.name))
  } catch {
    return []
  }
}

function isRepo(dir: string): boolean {
  return fs.existsSync(path.join(dir, '.git'))
}

function countRepos(root: string): number {
  let found = 0
  for (const child of childDirs(root)) {
    found += isRepo(child) ? 1 : childDirs(child).filter(isRepo).length
    if (found >= MAX_NESTED_REPOS) return found
  }
  return found
}

function real(dir: string): string {
  try {
    return fs.realpathSync.native(dir)
  } catch {
    return path.resolve(dir)
  }
}

export async function placeOf(root: string): Promise<Place> {
  const inRepo = await succeeds(root, ['rev-parse', '--is-inside-work-tree'])
  return { root: real(root), home: real(os.homedir()), inRepo, nestedRepos: inRepo ? 0 : countRepos(root) }
}
