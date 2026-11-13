import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { hasKey, readKey, removeKey, storeKey, type Crypt } from './key'

const KEY = 'ts-SENTINEL-key-0123456789'

const fakeCrypt = (available = true): Crypt => ({
  isEncryptionAvailable: () => available,
  encryptString: (text) => Buffer.from(`sealed:${Buffer.from(text).reverse().toString('base64')}`),
  decryptString: (data) => Buffer.from(data.toString().replace(/^sealed:/, ''), 'base64').reverse().toString(),
})

const dirs: string[] = []

const tempDir = () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jev-key-'))
  dirs.push(dir)
  return path.join(dir, 'jev')
}

afterEach(() => {
  while (dirs.length > 0) fs.rmSync(dirs.pop() as string, { recursive: true, force: true })
})

describe('key store', () => {
  it('stores the key encrypted, owner only, and decrypts it on demand', () => {
    const dir = tempDir()
    storeKey(dir, fakeCrypt(), `  ${KEY}\n`)

    const file = path.join(dir, 'key.bin')
    expect(fs.readFileSync(file).toString()).not.toContain(KEY)
    expect(fs.statSync(file).mode & 0o777).toBe(0o600)
    expect(hasKey(dir)).toBe(true)
    expect(readKey(dir, fakeCrypt())).toBe(KEY)
  })

  it('refuses to store anything when encryption is unavailable and never falls back to plaintext', () => {
    const dir = tempDir()
    expect(() => storeKey(dir, fakeCrypt(false), KEY)).toThrow(/keychain is not available/)
    expect(hasKey(dir)).toBe(false)
    expect(fs.existsSync(dir) ? fs.readdirSync(dir) : []).toEqual([])
  })

  it('rejects an empty or malformed key without echoing it', () => {
    const dir = tempDir()
    expect(() => storeKey(dir, fakeCrypt(), '   ')).toThrow(/paste a TypeSafe API key/)
    const spaced = `${KEY} ${KEY}`
    let message = ''
    try {
      storeKey(dir, fakeCrypt(), spaced)
    } catch (err) {
      message = (err as Error).message
    }
    expect(message).toMatch(/does not look like/)
    expect(message).not.toContain(KEY)
    expect(() => storeKey(dir, fakeCrypt(), 42)).toThrow(/paste/)
  })

  it('removes the key and reads nothing once it is gone or cannot be decrypted', () => {
    const dir = tempDir()
    storeKey(dir, fakeCrypt(), KEY)
    const broken: Crypt = { ...fakeCrypt(), decryptString: () => { throw new Error(`cannot open ${KEY}`) } }
    expect(readKey(dir, broken)).toBeNull()
    removeKey(dir)
    expect(hasKey(dir)).toBe(false)
    expect(readKey(dir, fakeCrypt())).toBeNull()
  })
})
