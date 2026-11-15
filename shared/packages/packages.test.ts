import { describe, expect, it } from 'vitest'
import { packageDirOf, packageOf } from './group'
import { packagesIn } from './list'

describe('packagesIn', () => {
  it('lists every folder holding a package.json, the root always as the empty folder', () => {
    expect(packagesIn(['package.json', 'packages/a/package.json', 'packages/a/src/x.ts', 'packages/a/package.json.bak', 'mypackage.json'])).toEqual(['', 'packages/a'])
    expect(packagesIn([])).toEqual([''])
  })
})

describe('packageOf', () => {
  it('treats the root package.json as no package and falls back to the top level folder', () => {
    expect(packageOf('packages/client/src/x.ts', [''])).toBe('packages')
    expect(packageOf('main.ts', [''])).toBe('.')
  })

  it('picks the deepest package holding the file', () => {
    const packages = ['', 'packages/a', 'packages/a/sub', 'packages/ab']
    expect(packageOf('packages/a/src/x.ts', packages)).toBe('packages/a')
    expect(packageOf('packages/a/sub/x.ts', packages)).toBe('packages/a/sub')
    expect(packageOf('packages/ab/x.ts', packages)).toBe('packages/ab')
    expect(packageOf('packages/abc/x.ts', packages)).toBe('packages')
    expect(packageOf('packages/a', packages)).toBe('packages')
  })

  it('handles no packages at all', () => {
    expect(packageOf('src/x.ts')).toBe('src')
    expect(packageOf('src/x.ts', [])).toBe('src')
    expect(packageDirOf('src/x.ts', undefined)).toBeUndefined()
  })

  it('ignores a package.json under a test or fixture folder', () => {
    const packages = ['', 'packages/a', 'packages/a/test/fixtures/app', 'fixtures/b', 'src/__tests__/c', 'src/__mocks__/d', 'tests/e2e']
    expect(packageOf('packages/a/test/fixtures/app/index.ts', packages)).toBe('packages/a')
    expect(packageOf('fixtures/b/x.ts', packages)).toBe('fixtures')
    expect(packageOf('src/__tests__/c/x.ts', packages)).toBe('src')
    expect(packageOf('src/__mocks__/d/x.ts', packages)).toBe('src')
    expect(packageOf('tests/e2e/x.ts', packages)).toBe('tests')
    expect(packageOf('packages/latest/x.ts', ['', 'packages/latest'])).toBe('packages/latest')
  })
})
