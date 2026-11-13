import { useEffect, useMemo, useState } from 'react'
import { errorText } from '../../../shared/text/error'
import type { ReviewDetail, ReviewItem } from '../../../shared/types'
import { describeItem, overlay } from '../../model/review'
import Canvas from '../Canvas'
import { flatten, SplitDiff } from '../SplitDiff'
import Actions from './Actions'
import Impact from './Impact'
import { chipClass } from './chip'

const MAX_ROWS = 2000

const LEGEND = ['added', 'removed', 'changed', 'touched'] as const

function whereText(item: ReviewItem, detail: ReviewDetail): string {
  if (item.kind === 'proposal') return 'How the contract looks once this lands.'
  if (detail.owners.length === 0) return `${detail.file} is not owned by any component yet.`
  if (detail.owners.length === 1) return `${detail.file} belongs to ${detail.owners[0]}.`
  return `${detail.file} is claimed by ${detail.owners.join(', ')}.`
}

export default function Detail({ item, theme }: { item: ReviewItem; theme: string }) {
  const [detail, setDetail] = useState<ReviewDetail | null>(null)
  const [failure, setFailure] = useState<string | null>(null)
  const [selectedId, setSelectedId] = useState<string | null>(null)

  useEffect(() => {
    let live = true
    window.architect.reviewDetail(item.id).then(
      (found) => live && setDetail(found),
      (err: unknown) => live && setFailure(errorText(err)),
    )
    return () => {
      live = false
    }
  }, [item.id])

  const shown = useMemo(() => detail && overlay(detail.before, detail.after, detail.owners), [detail])
  const entries = useMemo(() => flatten(detail?.hunks ?? []), [detail])

  return (
    <section className="review-detail">
      <header className="review-head">
        <h2>{describeItem(item)}</h2>
        {item.kind === 'proposal' && item.rationale && <p className="review-rationale">{item.rationale}</p>}
      </header>

      <Actions id={item.id} />

      {failure && <p className="review-error">{failure}</p>}
      {detail?.error && <p className="review-error">{detail.error}</p>}
      {!detail && !failure && <p className="review-note">Working out the impact…</p>}

      {detail && (
        <>
          <h3>Architecture</h3>
          <p className="review-note">{whereText(item, detail)}</p>
          {shown && (
            <>
              <div className="review-legend">
                {LEGEND.map((mark) => (
                  <span key={mark} className={chipClass(mark)}>
                    {mark}
                  </span>
                ))}
              </div>
              <div className="review-canvas">
                <Canvas
                  architecture={shown.architecture}
                  marks={shown.marks}
                  ownership={null}
                  recent={{}}
                  theme={theme}
                  selectedId={selectedId}
                  onSelect={setSelectedId}
                />
              </div>
            </>
          )}

          {item.kind === 'code' && (
            <>
              <h3>Functions</h3>
              <Impact functions={detail.functions} />
            </>
          )}

          <h3>
            Diff <span className="review-file">{detail.file}</span>
          </h3>
          {entries.length === 0 ? (
            <p className="review-note">No line changes.</p>
          ) : (
            <div className="review-diff">
              <SplitDiff entries={entries} shown={MAX_ROWS} />
            </div>
          )}
          {entries.length > MAX_ROWS && <p className="review-note">{entries.length - MAX_ROWS} more lines not shown.</p>}
        </>
      )}
    </section>
  )
}
