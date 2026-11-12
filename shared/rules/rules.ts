import { z } from 'zod'
import { fileSplitSchema, type SplitThreshold } from './split'

export type LimitRule = 'lines' | 'files' | 'jobs'

export type RuleEntry =
  | { rule: LimitRule; limit: number | 'off'; globs: string[] }
  | { rule: 'names'; banned: string[] | 'off'; globs: string[] }
  | { rule: 'split'; threshold: SplitThreshold | 'off'; globs: string[] }
  | { rule: 'skip'; globs: string[] }

const checkedRuleSchema = z.enum(['lines', 'files', 'names', 'jobs'])

export type CheckedRule = z.infer<typeof checkedRuleSchema>

export const ruleViolationSchema = z.object({
  rule: checkedRuleSchema,
  path: z.string(),
  line: z.number().optional(),
  key: z.string(),
  amount: z.number(),
  message: z.string(),
  split: fileSplitSchema.optional(),
})

export type RuleViolation = z.infer<typeof ruleViolationSchema>

export const ruleRunSchema = z.object({
  at: z.number(),
  source: z.enum(['check', 'check_change']),
  file: z.string().optional(),
  results: z.array(z.object({ rule: checkedRuleSchema, pass: z.boolean(), violations: z.number().int().nonnegative() })),
})

export type RuleRun = z.infer<typeof ruleRunSchema>

export type StyleFile = { path: string; failing: { rule: CheckedRule; line?: number; message: string; grandfathered: boolean }[] }
