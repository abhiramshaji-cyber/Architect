import fs from 'node:fs'
import path from 'node:path'
import type { Head } from '../../shared/types'
import { git, head } from './git'
import { within } from './session'

export const APP_TITLE = 'Architect'

export type TitleRepo = { top: string; gitDir: string; common: string }

function repoName(common: string): string {
  const base = path.basename(common)
  return base === '.git' ? path.basename(path.dirname(common)) : base.replace(/\.git$/, '')
}

function headName(found: Head | null): string | null {
  if (!found) return null
  return found.kind === 'branch' ? found.branch : found.commit.slice(0, 8) || null
}

export function tabTitle(root: string, repo: TitleRepo | null, found: Head | null): string {
  if (!repo) return path.basename(root) || APP_TITLE

  const name = repoName(repo.common) || path.basename(repo.top) || APP_TITLE
  const sub = within(repo.top, root) ? path.relative(repo.top, root) : ''
  const label = sub ? `${name}/${sub}` : name
  if (repo.gitDir === repo.common) return label

  return `${label} · ${headName(found) ?? path.basename(repo.top)}`
}

function real(target: string): string {
  try {
    return fs.realpathSync.native(target)
  } catch {
    return target
  }
}

export async function readTabTitle(root: string): Promise<string> {
  if (typeof root !== 'string' || !root) return APP_TITLE

  const probed = await git(root, ['rev-parse', '--show-toplevel', '--absolute-git-dir', '--git-common-dir'])
  const [top, gitDir, common] = probed.ok ? probed.value.split('\n') : []
  const repo = top && gitDir && common ? { top: real(top), gitDir: real(gitDir), common: real(path.resolve(root, common)) } : null

  const found = repo && repo.gitDir !== repo.common ? await head(root) : null
  return tabTitle(real(root), repo, found?.ok ? found.value : null)
}
