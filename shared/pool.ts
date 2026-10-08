const LANES = 8

export async function pooled<T, R>(items: T[], fn: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = []
  let next = 0

  const lane = async (): Promise<void> => {
    while (next < items.length) {
      const at = next++
      out[at] = await fn(items[at] as T)
    }
  }

  await Promise.all(Array.from({ length: Math.min(LANES, items.length) }, lane))
  return out
}
