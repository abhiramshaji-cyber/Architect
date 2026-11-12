import path from 'node:path'

export function globbed(file: string, spec: string, files: string[]): string[] {
  if (!spec.startsWith('.') && !spec.startsWith('/')) return []
  const pattern = spec.startsWith('/') ? spec.slice(1) : path.posix.join(path.posix.dirname(file), spec)
  const source = pattern
    .split(/(\*\*\/|\*|\?|\[[^\]]*\]|\{[^}]*\})/)
    .map((part) =>
      part === '**/' ? '(?:.*/)?' : part === '*' ? '.*' : part === '?' ? '[^/]' : part.startsWith('[') ? part : part.startsWith('{') ? `(?:${part.slice(1, -1).split(',').join('|')})` : part.replace(/[.+?^${}()|[\]\\]/g, '\\$&'),
    )
    .join('')
  const test = new RegExp(`^${source}(\\.[cm]?[jt]sx?)?$`)
  return files.filter((one) => one !== file && test.test(one))
}
