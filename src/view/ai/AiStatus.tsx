import { useEffect } from 'react'
import { CLI_NAMES, draftMessage } from '../../model/picker'
import { summariesOff } from './login'
import { refreshAi, useAi } from './useAi'

export default function AiStatus({ stamp, onOpen }: { stamp: unknown; onOpen: () => void }) {
  const { state, error } = useAi()

  useEffect(() => {
    refreshAi()
  }, [stamp])

  const off = summariesOff(state)
  const reason = state?.failure?.reason
  const failure = reason && !off && (reason.kind === 'failed' || reason.kind === 'timed-out') && reason.cli === state?.choice.provider ? draftMessage(reason) : null
  const said = error ?? (off ? `AI summaries off: ${off}` : state ? `AI summaries by ${CLI_NAMES[state.choice.provider]}, ${state.choice.models[state.choice.provider]}` : null)
  if (!said) return null

  return (
    <div className={off || error || failure ? 'ai-status off' : 'ai-status'} role="status">
      <span>{failure ? `${said}. Last run failed: ${failure}` : said}</span>
      <button className="ghost" onClick={onOpen}>
        AI settings
      </button>
    </div>
  )
}
