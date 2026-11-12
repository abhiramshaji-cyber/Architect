import type { DraftResult } from '../types'
import type { RuleViolation } from './rules'

export type ConventionImpact = {
  flags: RuleViolation[]
  clears: RuleViolation[]
}

export type Convention = {
  source: 'measured' | 'ai'
  title: string
  detail: string
  files: string[]
  rule?: string
  unusable?: string
  impact?: ConventionImpact
}

export type Conventions = { enabled: false } | { enabled: true; measured: Convention[] }

export type ConventionsApi = {
  conventions(root: string): Promise<Conventions>
  setConventions(root: string, enabled: boolean): Promise<Conventions>
  suggestConventions(root: string): Promise<DraftResult<Convention[]>>
  promoteConvention(root: string, rule: string): Promise<void>
}
