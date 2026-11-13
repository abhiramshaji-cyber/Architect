import { z } from 'zod'

const edgeSchema = z.object({ from: z.string(), to: z.string(), calls: z.number().int().nonnegative(), proposed: z.boolean() })

const callSchema = z.object({ caller: z.string(), site: z.string(), callee: z.string() })

const moveSchema = z.object({ fn: z.string(), component: z.string().nullable(), status: z.string(), folder: z.string().nullable(), reason: z.string() })

export const cutSchema = z.object({
  path: z.array(z.string()),
  edges: z.array(edgeSchema),
  cheapest: z.object({ from: z.string(), to: z.string(), calls: z.number().int().nonnegative(), tie: z.string().nullable(), listed: z.array(callSchema) }).nullable(),
  also: z.array(edgeSchema.omit({ proposed: true })),
  moves: z.array(moveSchema),
  notes: z.array(z.string()),
})

export type Cut = z.infer<typeof cutSchema>

export type CutCall = z.infer<typeof callSchema>

export type Move = z.infer<typeof moveSchema>
