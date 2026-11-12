import path from 'node:path'

export type Declared = { reason: 'main' | 'bin' | 'script'; file: string }

function clean(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const trimmed = path.posix.normalize(value.trim().replace(/^\.\//, ''))
  return trimmed === '' || trimmed === '.' || trimmed.startsWith('../') ? null : trimmed
}

export function declaredIn(manifest: unknown): Declared[] {
  if (typeof manifest !== 'object' || manifest === null) return []
  const { main, bin, scripts } = manifest as { main?: unknown; bin?: unknown; scripts?: unknown }
  const bins = typeof bin === 'object' && bin !== null ? Object.values(bin) : [bin]
  const words = (typeof scripts === 'object' && scripts !== null ? Object.values(scripts) : [])
    .flatMap((command) => (typeof command === 'string' ? command.split(/[\s;&|()]+/) : []))
    .map((word) => word.replace(/^["']|["']$/g, ''))
  return [
    ...[main].map((file) => ({ reason: 'main' as const, file: clean(file) })),
    ...bins.map((file) => ({ reason: 'bin' as const, file: clean(file) })),
    ...words.map((file) => ({ reason: 'script' as const, file: clean(file) })),
  ].flatMap(({ reason, file }) => (file === null ? [] : [{ reason, file }]))
}
