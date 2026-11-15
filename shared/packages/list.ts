const MANIFEST = 'package.json'

export function packagesIn(paths: Iterable<string>): string[] {
  const dirs = [...paths].filter((file) => file === MANIFEST || file.endsWith(`/${MANIFEST}`)).map((file) => file.slice(0, -MANIFEST.length - 1))
  return [...new Set(['', ...dirs])]
}
