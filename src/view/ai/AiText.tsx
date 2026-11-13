import { summariesOff } from './login'
import { useAi } from './useAi'

type Tag = 'span' | 'div' | 'p'

export function AiText({ text, className, as: Element = 'span' }: { text: string; className: string; as?: Tag }) {
  if (text === '') return null
  return (
    <Element className={className}>
      <abbr className="cyber-badge cyber-badge--sm cyber-badge--yellow ai-tag" title="Written by the connected AI, not read from the code">
        AI
      </abbr>{' '}
      {text}
    </Element>
  )
}

export function AiSummary({ text }: { text: string }) {
  const off = summariesOff(useAi().state)
  if (text === '' && !off) return null

  return (
    <section className="inspector-section">
      <h3>Summary</h3>
      {text === '' ? <p className="inspector-purpose">No AI summary: {off}. Connect one on the AI page.</p> : <AiText as="p" className="inspector-purpose" text={text} />}
    </section>
  )
}
