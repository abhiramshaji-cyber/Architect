import { useState } from 'react'
import { folderName } from '../../model/layout'
import { describeItem, toggleReview, useReview } from '../../model/review'
import { useProject } from '../../model/store'
import type { ViewProps } from '../../shell/views'
import Detail from './Detail'

export default function ReviewView({ theme }: ViewProps) {
  const { enabled, items, error } = useReview()
  const { currentRoot } = useProject()
  const [picked, setPicked] = useState<string | null>(null)
  const selected = items.find((item) => item.id === picked) ?? items[0] ?? null

  if (items.length === 0) {
    return (
      <div className="empty-state review-empty">
        <h2>{enabled ? 'Nothing waiting' : 'Change review is off'}</h2>
        <p>
          {enabled
            ? 'Code edits and contract changes Claude proposes wait here for you to approve or deny.'
            : 'Turn it on to see each change Claude proposes before it lands, and approve it, deny it or suggest a better way.'}
        </p>
        <button className={enabled ? undefined : 'primary'} onClick={toggleReview}>
          {enabled ? 'Turn off change review' : 'Turn on change review'}
        </button>
        {error && <p className="review-error">{error}</p>}
      </div>
    )
  }

  return (
    <div className="review">
      <aside className="review-list">
        <h2>{items.length === 1 ? '1 change waiting' : `${items.length} changes waiting`}</h2>
        {!enabled && <p className="review-note">Review is off, so new changes go straight through.</p>}
        {error && <p className="review-error">{error}</p>}
        <ul>
          {items.map((item) => (
            <li key={item.id}>
              <button
                className={item.id === selected?.id ? 'review-pick active' : 'review-pick'}
                aria-current={item.id === selected?.id ? 'true' : undefined}
                onClick={() => setPicked(item.id)}
              >
                <span className="review-kind">{item.kind === 'code' ? 'Code' : 'Contract'}</span>
                <span className="review-what">{describeItem(item)}</span>
                {item.root !== currentRoot && <span className="review-root">{folderName(item.root)}</span>}
              </button>
            </li>
          ))}
        </ul>
      </aside>
      {selected && <Detail key={selected.id} item={selected} theme={theme} />}
    </div>
  )
}
