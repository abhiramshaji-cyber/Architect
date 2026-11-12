import type { CallRef, CallSite, FileStart, FunctionEntry } from '../../../shared/types'

export type Raw = { line: number; ref: CallRef } | { line: number; spec: string; key: string } | { line: number; bridge: string }

type Placed = { functions: FunctionEntry[]; starts: FileStart[]; raw: Map<number, Raw[]> }

function placed(site: Raw, resolve: (spec: string, key: string) => CallRef | undefined): CallSite[] {
  if ('ref' in site) return [{ ...site.ref, line: site.line }]
  if ('bridge' in site) return [{ bridge: site.bridge, line: site.line }]
  const hit = resolve(site.spec, site.key)
  return hit === undefined ? [] : [{ ...hit, line: site.line }]
}

export function placeSites(at: Placed, resolve: (spec: string, key: string) => CallRef | undefined): void {
  for (const [from, raw] of at.raw) {
    const entry = at.functions[from] ?? at.starts[from - at.functions.length]
    const sites = raw.flatMap((site) => placed(site, resolve))
    if (entry !== undefined && sites.length > 0) entry.sites = sites
  }
}
