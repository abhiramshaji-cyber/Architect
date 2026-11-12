import path from 'node:path'

export type Declared = { reason: 'main' | 'exports' | 'module' | 'bin' | 'script'; file: string; subpath?: string; excluded?: true }

function clean(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const trimmed = path.posix.normalize(value.trim().replace(/^\.\//, ''))
  return trimmed === '' || trimmed === '.' || trimmed.startsWith('../') ? null : trimmed
}

function targetsOf(value: unknown): unknown[] {
  if (Array.isArray(value)) return value.flatMap(targetsOf)
  if (typeof value === 'object' && value !== null) return Object.values(value).flatMap(targetsOf)
  return [value]
}

function subpathsOf(exports: unknown): [string, unknown][] {
  const keys = typeof exports === 'object' && exports !== null && !Array.isArray(exports) ? Object.keys(exports) : []
  return keys.length > 0 && keys.every((key) => key.startsWith('.')) ? Object.entries(exports as object) : [['.', exports]]
}

function excludedOf(exports: unknown): [string, unknown][] {
  const subpaths = subpathsOf(exports)
  return subpaths.flatMap(([hidden, value]) => {
    if (value !== null) return []
    return subpaths.flatMap(([key, target]) => {
      const [head = '', tail = ''] = key.split('*')
      const fits = key.includes('*') && hidden.startsWith(head) && hidden.endsWith(tail) && hidden.length >= key.length - 1
      const captured = hidden.slice(head.length, hidden.length - tail.length)
      return fits ? targetsOf(target).map((file): [string, unknown] => [hidden, typeof file === 'string' ? file.replaceAll('*', captured) : file]) : []
    })
  })
}

export function declaredIn(manifest: unknown): Declared[] {
  if (typeof manifest !== 'object' || manifest === null) return []
  const fields = manifest as Record<string, unknown>
  const { exports, module, bin, scripts } = fields
  const main = fields.main ?? (exports === undefined && typeof fields.name === 'string' ? 'index.js' : undefined)
  const bins = typeof bin === 'object' && bin !== null ? Object.values(bin) : [bin]
  const words = (typeof scripts === 'object' && scripts !== null ? Object.values(scripts) : [])
    .flatMap((command) => (typeof command === 'string' ? command.split(/[\s;&|()]+/) : []))
    .map((word) => word.replace(/^["']|["']$/g, ''))
  return [
    ...[main].map((file) => ({ reason: 'main' as const, file: clean(file), subpath: '.' })),
    ...subpathsOf(exports).flatMap(([subpath, value]) =>
      targetsOf(value).map((file) => ({ reason: 'exports' as const, file: clean(file), subpath })),
    ),
    ...[module].map((file) => ({ reason: 'module' as const, file: clean(file), subpath: '.' })),
    ...excludedOf(exports).map(([subpath, file]) => ({ reason: 'exports' as const, file: clean(file), subpath, excluded: true as const })),
    ...bins.map((file) => ({ reason: 'bin' as const, file: clean(file) })),
    ...words.map((file) => ({ reason: 'script' as const, file: clean(file) })),
  ].flatMap(({ file, ...rest }) => (file === null ? [] : [{ ...rest, file }]))
}
