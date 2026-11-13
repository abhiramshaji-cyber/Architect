export function plural(count: number, word: string, shown = String(count)): string {
  return `${shown} ${word}${count === 1 ? '' : 's'}`
}
