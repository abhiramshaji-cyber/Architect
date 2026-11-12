import type { CardData } from './Card'

export default function Pill({ id, data }: { id: string; data: CardData }) {
  const { row } = data
  const act = data.count > 0 ? () => data.onToggle(id) : row ? () => data.onOpen(row) : undefined

  return (
    <button
      className="fn-pill"
      onClick={act}
      disabled={!act}
      aria-expanded={data.count > 0 ? data.open : undefined}
      title={`${data.title} · ${data.pill}`}
    >
      <span className="fn-pill-name">{data.title}</span>
      <span className="fn-pill-count">{data.pill}</span>
    </button>
  )
}
