import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { git } from './git'

export type Repo = { top: string; common: string }

export type SessionPlace = {
  cwd: string
  cwdRepo: Repo | null
  file: string | null
  fileRepo: Repo | null
  home: string
}

export function within(parent: string, child: string): boolean {
  const rel = path.relative(parent, child)
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel))
}

export function sessionRoot(place: SessionPlace, exists: (dir: string) => boolean): string | null {
  const { cwd, cwdRepo, file, fileRepo, home } = place
  const broad = (dir: string) => dir === home || path.dirname(dir) === dir
  const root = pick()
  if (!broad(root)) return root
  return fileRepo && !broad(fileRepo.top) ? fileRepo.top : null

  function pick(): string {
    if (!file || within(cwd, file) || !fileRepo) return cwd
    if (!cwdRepo || cwdRepo.common !== fileRepo.common) return fileRepo.top
    if (cwdRepo.top === fileRepo.top) return cwd

    const mirrored = path.join(fileRepo.top, path.relative(cwdRepo.top, cwd))
    return exists(mirrored) ? mirrored : fileRepo.top
  }
}

function real(target: string): string | null {
  let at = path.resolve(target)
  while (true) {
    try {
      return fs.realpathSync.native(at)
    } catch {
      const parent = path.dirname(at)
      if (parent === at) return null
      at = parent
    }
  }
}

function isDir(dir: string): boolean {
  return fs.statSync(dir, { throwIfNoEntry: false })?.isDirectory() === true
}

async function repoOf(dir: string): Promise<Repo | null> {
  const probed = await git(dir, ['rev-parse', '--show-toplevel', '--git-common-dir'])
  if (!probed.ok) return null

  const [top, common] = probed.value.split('\n')
  if (!top || !common) return null
  return { top: real(top) ?? top, common: real(path.resolve(dir, common)) ?? common }
}

export async function locateSession(cwd: string, file: string | null): Promise<{ root: string; file: string | null } | null> {
  const here = isDir(cwd) ? real(cwd) : null
  if (!here) return null

  const edited = file ? real(path.resolve(here, file)) : null
  const editedDir = edited && !isDir(edited) ? path.dirname(edited) : edited
  const [cwdRepo, fileRepo] = await Promise.all([repoOf(here), editedDir ? repoOf(editedDir) : null])
  const home = real(os.homedir()) ?? os.homedir()

  const root = sessionRoot({ cwd: here, cwdRepo, file: edited, fileRepo, home }, isDir)
  return root ? { root, file: edited && within(root, edited) ? edited : null } : null
}
