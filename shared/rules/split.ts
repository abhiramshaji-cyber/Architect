import { z } from 'zod'

const overSchema = z.object({ count: z.number(), limit: z.number(), project: z.number().optional() })

const memberSchema = z.object({ name: z.string(), line: z.number(), endLine: z.number() })

export const splitGroupSchema = z.object({
  name: z.string().optional(),
  unnamed: z.string().optional(),
  file: z.string().optional(),
  exported: z.array(z.string()),
  members: z.array(memberSchema),
  lines: z.number(),
})

export type SplitGroup = z.infer<typeof splitGroupSchema>

export const fileSplitSchema = z.object({
  kind: z.literal('file'),
  path: z.string(),
  lines: z.number(),
  over: z.object({ lines: overSchema.optional(), jobs: overSchema.optional() }),
  folder: z.string(),
  entry: z.string(),
  groups: z.array(splitGroupSchema),
  stays: z.object({ lines: z.number(), functions: z.array(z.string()) }),
  files: z.object({ count: z.number(), limit: z.union([z.number(), z.literal('off')]) }),
  blocked: z.string().optional(),
})

export type FileSplit = z.infer<typeof fileSplitSchema>

export const extractPointSchema = z.object({ kind: z.string(), label: z.string(), line: z.number(), endLine: z.number(), lines: z.number() })

export type ExtractPoint = z.infer<typeof extractPointSchema>

export type FunctionSplit = {
  kind: 'function'
  path: string
  name: string
  line: number
  endLine: number
  lines: number
  callers: number
  threshold: SplitThreshold
  points: ExtractPoint[]
  blocked?: string
}

export type SplitThreshold = { lines: number; callers: number }

export type SplitSuggestion = FileSplit | FunctionSplit
