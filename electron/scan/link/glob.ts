import path from 'node:path'

const literal = (text: string) => text.replace(/[.+?^${}()|[\]\\*]/g, '\\$&')

function sourceOf(part: string): string {
  if (part.startsWith('\\')) return literal(part.slice(1))
  if (part === '**/') return '(?:.*/)?'
  if (part === '*') return '.*'
  if (part === '?') return '[^/]'
  if (part.startsWith('[')) return part
  if (part.startsWith('{')) return `(?:${part.slice(1, -1).split(',').map(literal).join('|')})`
  return literal(part)
}

export function globbed(file: string, spec: string, files: string[]): string[] | undefined {
  if (!spec.startsWith('.') && !spec.startsWith('/')) return []
  const pattern = spec.startsWith('/') ? spec.slice(1) : path.posix.join(path.posix.dirname(file), spec)
  const source = pattern.split(/(\\.|\*\*\/|\*|\?|\[[^\]]*\]|\{[^}]*\})/).map(sourceOf).join('')
  try {
    const test = new RegExp(`^${source}(\\.[cm]?[jt]sx?)?$`)
    return files.filter((one) => one !== file && test.test(one))
  } catch {
    return undefined
  }
}
