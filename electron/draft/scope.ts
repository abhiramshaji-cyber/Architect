import fs from 'node:fs'
import path from 'node:path'
import { changes } from '../git/diff'
import { git } from '../git/git'

const MARKERS = [
  'package.json',
  'agent.config.ts',
  'Cargo.toml',
  'go.mod',
  'pyproject.toml',
  'setup.py',
  'pom.xml',
  'build.gradle',
  'build.gradle.kts',
  'Gemfile',
  'composer.json',
  'deno.json',
  'pubspec.yaml',
  'mix.exs',
]

function projectOf(file: string, isProject: (dir: string) => boolean): string {
  const parts = file.split('/').slice(0, -1)
  for (let end = parts.length; end > 0; end--) {
    const dir = parts.slice(0, end).join('/')
    if (isProject(dir)) return dir
  }
  return ''
}

export function scopeFor(changed: string[], isProject: (dir: string) => boolean): string {
  const projects = [...new Set(changed.map((file) => projectOf(file, isProject)))]
  const [first, ...rest] = projects
  if (first === undefined || projects.includes('')) return ''

  let shared = first.split('/')
  for (const project of rest) {
    const parts = project.split('/')
    const same = shared.findIndex((part, i) => part !== parts[i])
    if (same !== -1) shared = shared.slice(0, same)
  }
  return shared.join('/')
}

export async function scopeOf(root: string): Promise<string> {
  const [found, prefix] = await Promise.all([changes(root), git(root, ['rev-parse', '--show-prefix'])])
  if (!found.ok || !prefix.ok) return ''

  const under = prefix.value.trim()
  const changed = [found.value.branch, found.value.staged, found.value.unstaged]
    .flatMap((listed) => (listed.ok ? listed.value : []))
    .map((file) => file.path)
    .filter((file) => file.startsWith(under))
    .map((file) => file.slice(under.length))

  return scopeFor(changed, (dir) => MARKERS.some((marker) => fs.existsSync(path.join(root, dir, marker))))
}
