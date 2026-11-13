export type Note = { line: number; text: string }

export type Range = { start: number; end: number }

function linesOf(text: string): string[] {
  const lines = text.split(/\r?\n/)
  return text.endsWith('\n') ? lines.slice(0, -1) : lines
}

function invalid(range: Range, count: number, notes: Note[]): string | null {
  if (range.start < 1 || range.end < range.start) return `lines ${range.start}-${range.end} is not a range: start must be at least 1 and end at least start`
  if (range.end > count) return `lines ${range.start}-${range.end} runs past the end of the file, which has ${count} lines`
  const outside = notes.filter((note) => note.line < range.start || note.line > range.end).map((note) => note.line)
  return outside.length === 0 ? null : `notes on lines ${outside.join(', ')} fall outside the excerpt ${range.start}-${range.end}`
}

export function excerptOf(text: string, range: Range, notes: Note[] = []): string {
  const lines = linesOf(text)
  const error = invalid(range, lines.length, notes)
  if (error !== null) throw new Error(error)

  const marks = new Map<number, string[]>()
  for (const note of notes) {
    const said = note.text.replace(/\s+/g, ' ').trim()
    if (said !== '') marks.set(note.line, [...(marks.get(note.line) ?? []), said])
  }

  const width = String(range.end).length
  const body = lines.slice(range.start - 1, range.end).map((code, i) => {
    const line = range.start + i
    const numbered = `${String(line).padStart(width)} | ${code.trimEnd()}`
    const mark = marks.get(line)
    return mark ? `${numbered}  // <- ${mark.join('; ')}` : numbered
  })
  return ['```', ...body, '```'].join('\n')
}
