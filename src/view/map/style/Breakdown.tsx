import type { StyleFile } from '../../../../shared/types'
import type { MapNode } from '../layout/nest'
import { RULES, scoreOf } from './score'

type Props = {
  path: MapNode[]
  style: Map<string, StyleFile['failing']> | null
  error: string | null
  onOpen: (file: string, line?: number) => void
}

export default function Breakdown({ path, style, error, onOpen }: Props) {
  const root = path[0]
  const groups = path[1] ? [path[1]] : (root?.children ?? [])
  const scored = style
    ? groups
        .map((group) => ({ group, score: scoreOf(group, style) }))
        .filter(({ score }) => score.files > 0)
        .sort((a, b) => a.score.percent - b.score.percent || a.group.label.localeCompare(b.group.label))
    : []

  return (
    <aside className="map-style" aria-label="Style by component">
      {error && <p className="fn-notice">Style could not be read: {error}</p>}
      {!style && !error && <p className="fn-empty">Checking the rules…</p>}
      {scored.map(({ group, score }) => (
        <section key={group.id} className="map-style-group">
          <h3>
            <span>{group.label}</span>
            <span className="map-style-score">{score.percent}%</span>
          </h3>
          <p className="map-style-rules">
            {score.passing} of {score.files} files pass. Per rule:{' '}
            {RULES.map((rule) => `${rule} ${score.rules[rule]}`).join(', ')}
          </p>
          <ul>
            {score.failing.map((file) => (
              <li key={file.path}>
                {file.failing.map((failure, at) => (
                  <button key={at} className="map-style-fail" onClick={() => onOpen(file.path, failure.line)}>
                    <code>
                      {file.path}
                      {failure.line === undefined ? '' : `:${failure.line}`}
                    </code>
                    <span>
                      {failure.rule}: {failure.message}
                      {failure.grandfathered ? ', allowed only by a grandfathered limit' : ''}
                    </span>
                  </button>
                ))}
              </li>
            ))}
          </ul>
        </section>
      ))}
    </aside>
  )
}
