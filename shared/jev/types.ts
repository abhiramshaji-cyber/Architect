export type JevRun = {
  status: 'running' | 'done' | 'stopped' | 'failed'
  total: number
  done: number
  sent: number
  failed: number
  error?: string
}

export type JevState = { enabled: boolean; key: { set: boolean }; encryption: boolean; run: JevRun | null }

export type JevProgress = { root: string; run: JevRun }

export type BehaviorMatch = { name: string; file: string; line: number; probability: number; structural: boolean; io: string }

export type SameBehavior =
  | { status: 'disabled' | 'unindexed' | 'unknown'; reason: string }
  | { status: 'done'; name: string; file: string; line: number; matches: BehaviorMatch[]; candidates: number; rejected: number; notes: string[] }

export type JevApi = {
  jevState(root?: string): Promise<JevState>
  setJevKey(key: string): Promise<JevState>
  removeJevKey(): Promise<JevState>
  setJev(enabled: boolean, root?: string): Promise<JevState>
  indexJev(root: string): Promise<JevState>
  cancelJev(root: string): Promise<JevState>
  sameBehavior(root: string, file: string, symbol: string): Promise<SameBehavior>
  onJev(fn: (progress: JevProgress) => void): () => void
}
