export type CloneMatch = { name: string; file: string; line: number; similarity: number; clone: 'exact' | 'near' | null; structural: boolean }

export type SameBehavior = { status: 'unknown'; reason: string } | { status: 'done'; name: string; file: string; line: number; tokens: number; least: number; matches: CloneMatch[] }

export type CloneApi = { sameBehavior(root: string, file: string, symbol: string): Promise<SameBehavior> }
