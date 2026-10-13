import { useEffect, useMemo, useState } from 'react'
import type { Extension } from '@codemirror/state'
import { StyleModule } from 'style-mod'

import type { SourceWindow } from '../../../shared/types'
import { hangingIndent } from '../../model/codemap'
import { highlightLines, highlightStyle, languageFor } from '../../model/language'

export default function Listing({ path, window }: { path: string; window: SourceWindow }) {
  const { from, lines, total } = window
  const last = from + lines.length - 1
  const gutter = `${String(Math.max(last, total)).length}ch`
  const beyond = total - last
  const [language, setLanguage] = useState<Extension | null>(null)
  const spans = useMemo(() => highlightLines(lines, language), [lines, language])

  useEffect(() => {
    if (highlightStyle.module) StyleModule.mount(document, highlightStyle.module)
  }, [])

  useEffect(() => {
    let live = true
    setLanguage(null)
    void languageFor(path).then((grammar) => {
      if (live) setLanguage(grammar)
    })
    return () => {
      live = false
    }
  }, [path])

  return (
    <div className="inspector-src">
      {lines.map((line, i) => (
        <div key={i} className="inspector-src-line">
          <span className="inspector-src-no" style={{ width: gutter }}>
            {from + i}
          </span>
          <span
            className="inspector-src-text"
            style={{
              paddingLeft: `${hangingIndent(line)}ch`,
              textIndent: `-${hangingIndent(line)}ch`
            }}
          >
            {line === ''
              ? ' '
              : (spans[i] ?? [{ text: line, classes: '' }]).map((span, j) => (
                  <span key={j} className={span.classes || undefined}>
                    {span.text}
                  </span>
                ))}
          </span>
        </div>
      ))}
      {beyond > 0 && (
        <p className="inspector-src-more">
          {beyond} more {beyond === 1 ? 'line' : 'lines'} below, {total} in the file
        </p>
      )}
    </div>
  )
}
