import path from 'node:path'

export type Declared = { reason: 'main' | 'exports' | 'module' | 'bin' | 'script'; file: string; subpath?: string }

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

export function declaredIn(manifest: unknown): Declared[] {
  if (typeof manifest !== 'object' || manifest === null) return []
  const { main, exports, module, bin, scripts } = manifest as Record<string, unknown>
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
    ...bins.map((file) => ({ reason: 'bin' as const, file: clean(file) })),
    ...words.map((file) => ({ reason: 'script' as const, file: clean(file) })),
  ].flatMap(({ file, ...rest }) => (file === null ? [] : [{ ...rest, file }]))
}
