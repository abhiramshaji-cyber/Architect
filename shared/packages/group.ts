const TEST_DIR = /(^|\/)(__tests__|__mocks__|__fixtures__|fixtures?|tests?)(\/|$)/

export function packageDirOf(file: string, packages: readonly string[] = []): string | undefined {
  const held = packages.filter((dir) => dir !== '' && !TEST_DIR.test(dir) && file.startsWith(`${dir}/`))
  return held.reduce<string | undefined>((best, dir) => (dir.length > (best?.length ?? 0) ? dir : best), undefined)
}

export function packageOf(file: string, packages: readonly string[] = []): string {
  const slash = file.indexOf('/')
  return packageDirOf(file, packages) ?? (slash > 0 ? file.slice(0, slash) : '.')
}
