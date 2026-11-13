import type { AiState, CliStatus } from '../../../shared/settings'
import { CLI_NAMES, LOGIN_STEPS } from '../../model/picker'

function chosenCli(state: AiState): CliStatus | undefined {
  return state.clis.find((cli) => cli.provider === state.choice.provider)
}

export function loginText(cli: CliStatus): string {
  const name = CLI_NAMES[cli.provider]
  if (cli.login === 'ready') return `${name} is signed in${cli.detail ? ` with a ${cli.detail}` : ''}`
  if (cli.login === 'missing') return `${name} is not installed`
  if (cli.login === 'logged-out') return `${name} is not signed in: ${LOGIN_STEPS[cli.provider]}`
  if (cli.login === 'api-key') return `${name} is signed in with an API key, which Architect never uses: sign in with your subscription instead`
  return `${name} did not say whether it is signed in${cli.detail ? ` (${cli.detail})` : ''}`
}

export function summariesOff(state: AiState | null): string | null {
  if (!state) return null
  if (!state.choice.connected) return 'No AI is connected'
  const cli = chosenCli(state)
  return cli && cli.login !== 'ready' ? loginText(cli) : null
}
