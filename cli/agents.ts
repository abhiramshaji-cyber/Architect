import type { AgentsReport } from '../shared/types'

export function agentsText(report: AgentsReport): string {
  const lines = [
    ...report.written.map((file) => `  wrote      ${file}`),
    ...report.unchanged.map((file) => `  unchanged  ${file}`),
    ...report.removed.map((file) => `  removed    ${file}`),
    ...report.kept.map((file) => `  kept       ${file}  written by hand, not overwritten`),
    ...report.unplaced.map(({ component, reason }) => `  unplaced   ${component}  ${reason}`),
  ]
  return [`architect: ${report.written.length} AGENTS.md written, ${report.unchanged.length} unchanged, ${report.removed.length} removed`, ...lines].join('\n')
}
