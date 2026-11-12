export type Way = 'callers' | 'callees'

export type Asked = { at: number; way: Way }

export function callersOf(calls: number[][]): number[][] {
  const callers = calls.map((): number[] => [])
  calls.forEach((out, from) => {
    for (const to of out) callers[to]?.push(from)
  })
  return callers
}
