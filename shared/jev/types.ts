export type JevRun = {
  status: 'queued' | 'running' | 'done' | 'partial' | 'paused' | 'stopped' | 'failed'
  total: number
  done: number
  sent: number
  failed: number
  error?: string
}

export type JevUsage = { indexed: number; total: number; tokens: number; requests: number; cost: number }

export type JevBudget = { limit: number | null; tokens: number; cost: number }

export type JevState = { enabled: boolean; key: { set: boolean }; encryption: boolean; paused: string | null; budget: JevBudget; run: JevRun | null; usage: JevUsage | null }

export type JevProgress = { root: string; run: JevRun; usage: JevUsage; paused: string | null; budget: JevBudget }

export type JevStatus = {
  enabled: boolean
  key: { set: boolean }
  root: string
  paused: string | null
  index: { status: JevRun['status'] | 'idle'; indexed: number; total: number; failed: number; error?: string }
  usage: { tokens: number; requests: number; cost: number; pricePerMillionInputTokens: number }
  budget: JevBudget
}

export const CONFIRMED = 0.5

export const POSSIBLE = 0.3

export type BehaviorMatch = { name: string; file: string; line: number; probability: number; structural: boolean; io: string; responsibility: string | null; via: string | null }

export type SameBehavior =
  | { status: 'disabled' | 'unindexed' | 'unknown' | 'paused'; reason: string }
  | {
      status: 'done'
      name: string
      file: string
      line: number
      responsibility: string | null
      matches: BehaviorMatch[]
      possible: BehaviorMatch[]
      candidates: number
      rejected: number
      notes: string[]
    }

export type JevApi = {
  jevState(root?: string): Promise<JevState>
  setJevKey(key: string): Promise<JevState>
  removeJevKey(): Promise<JevState>
  setJev(enabled: boolean, root?: string): Promise<JevState>
  indexJev(root: string): Promise<JevState>
  cancelJev(root: string): Promise<JevState>
  setJevBudget(tokens: number | null): Promise<JevState>
  sameBehavior(root: string, file: string, symbol: string): Promise<SameBehavior>
  onJev(fn: (progress: JevProgress) => void): () => void
}
