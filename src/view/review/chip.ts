const VARIANT: Record<string, string> = { added: ' cyber-badge--green', removed: ' cyber-badge--magenta' }

export const chipClass = (mark: string) => `cyber-badge cyber-badge--sm review-chip mark-${mark}${VARIANT[mark] ?? ''}`
