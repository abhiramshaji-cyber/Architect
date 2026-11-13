const ESCAPES: Record<string, number> = { a: 7, b: 8, t: 9, n: 10, v: 11, f: 12, r: 13, '"': 34, '\\': 92 }

export function unquote(text: string): { value: string; end: number } | null {
  if (!text.startsWith('"')) return null
  const bytes: number[] = []
  for (let i = 1; i < text.length; i++) {
    const char = String.fromCodePoint(text.codePointAt(i) ?? 0)
    if (char === '"') return { value: Buffer.from(bytes).toString('utf8'), end: i + 1 }
    if (char !== '\\') {
      bytes.push(...Buffer.from(char))
      i += char.length - 1
      continue
    }
    const octal = /^[0-3][0-7]{2}/.exec(text.slice(i + 1, i + 4))
    const escaped = ESCAPES[text[i + 1] ?? '']
    if (octal) bytes.push(parseInt(octal[0], 8))
    else if (escaped !== undefined) bytes.push(escaped)
    else return null
    i += octal ? 3 : 1
  }
  return null
}

export function unquotePath(raw: string): string {
  const quoted = unquote(raw)
  return quoted?.end === raw.length ? quoted.value : raw
}
