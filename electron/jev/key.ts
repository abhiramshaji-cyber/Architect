import fs from 'node:fs'
import path from 'node:path'

export type Crypt = {
  isEncryptionAvailable(): boolean
  encryptString(text: string): Buffer
  decryptString(data: Buffer): string
}

const LONGEST_KEY = 512

const KEY_SHAPE = /^[\x21-\x7e]+$/

const fileIn = (dir: string) => path.join(dir, 'key.bin')

export function hasKey(dir: string): boolean {
  return fs.existsSync(fileIn(dir))
}

export function storeKey(dir: string, crypt: Crypt, key: unknown): void {
  const text = typeof key === 'string' ? key.trim() : ''
  if (text === '') throw new Error('paste a TypeSafe API key first')
  if (text.length > LONGEST_KEY || !KEY_SHAPE.test(text)) throw new Error('that does not look like a TypeSafe API key')
  if (!crypt.isEncryptionAvailable()) throw new Error('the system keychain is not available, so the key was not stored')

  fs.mkdirSync(dir, { recursive: true, mode: 0o700 })
  const file = fileIn(dir)
  const temp = `${file}.${process.pid}.tmp`
  fs.writeFileSync(temp, crypt.encryptString(text), { mode: 0o600 })
  fs.renameSync(temp, file)
}

export function removeKey(dir: string): void {
  fs.rmSync(fileIn(dir), { force: true })
}

export function readKey(dir: string, crypt: Crypt): string | null {
  if (!hasKey(dir) || !crypt.isEncryptionAvailable()) return null
  try {
    return crypt.decryptString(fs.readFileSync(fileIn(dir)))
  } catch {
    return null
  }
}
