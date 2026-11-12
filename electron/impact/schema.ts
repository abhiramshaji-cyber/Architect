import { z } from 'zod'

const touchSchema = z.object({ name: z.string(), change: z.enum(['added', 'changed', 'removed']), at: z.string(), in: z.enum(['disk', 'proposed']) })

const callerSchema = z.object({ name: z.string(), at: z.string(), depth: z.number().int().positive(), calls: z.string() })

const depthSchema = z.object({ depth: z.number().int().positive(), count: z.number().int().positive(), first: z.string() })

const entrySchema = z.object({ kind: z.string(), file: z.string(), depth: z.number().int().positive(), calls: z.string() })

const componentSchema = z.object({ id: z.string().nullable(), functions: z.number().int().nonnegative(), entries: z.number().int().nonnegative(), first: z.string() })

const testSchema = z.object({ file: z.string(), via: z.enum(['call', 'import']), at: z.string(), reaches: z.string() })

export const impactSchema = z.object({
  touched: z.object({ total: z.number().int().nonnegative(), listed: z.array(touchSchema) }),
  callers: z.object({
    total: z.number().int().nonnegative(),
    depths: z.array(depthSchema),
    listedThrough: z.number().int().positive(),
    listed: z.array(callerSchema),
    unlisted: z.number().int().nonnegative(),
  }),
  entries: z.object({ total: z.number().int().nonnegative(), listed: z.array(entrySchema) }),
  components: z.array(componentSchema),
  tests: z.object({ total: z.number().int().nonnegative(), listed: z.array(testSchema) }),
  notes: z.array(z.string()),
})

export type Impact = z.infer<typeof impactSchema>

export type Touch = z.infer<typeof touchSchema>

export type Caller = z.infer<typeof callerSchema>

export type Entry = z.infer<typeof entrySchema>

export type TestReach = z.infer<typeof testSchema>
