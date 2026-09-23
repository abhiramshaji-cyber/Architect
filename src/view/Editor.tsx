import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands'
import { bracketMatching, foldGutter, indentOnInput } from '@codemirror/language'
import { Compartment, EditorState } from '@codemirror/state'
import { EditorView, highlightActiveLine, highlightActiveLineGutter, keymap, lineNumbers } from '@codemirror/view'
import { useEffect, useRef } from 'react'
import { highlighting, languageFor } from '../model/language'

const language = new Compartment()
const writable = new Compartment()

const BASE = [
  lineNumbers(),
  foldGutter(),
  history(),
  indentOnInput(),
  bracketMatching(),
  highlightActiveLine(),
  highlightActiveLineGutter(),
  highlighting,
  EditorView.lineWrapping,
  keymap.of([...defaultKeymap, ...historyKeymap, indentWithTab]),
]

function scrollToLine(view: EditorView, line: number): void {
  const at = Math.min(Math.max(1, line), view.state.doc.lines)
  const target = view.state.doc.line(at)
  view.dispatch({
    selection: { anchor: target.from },
    effects: EditorView.scrollIntoView(target.from, { y: 'center' }),
  })
}

export default function Editor({ path, text, line, editable, onChange }: {
  path: string
  text: string
  line: number | null
  editable: boolean
  onChange: (next: string) => void
}) {
  const host = useRef<HTMLDivElement | null>(null)
  const view = useRef<EditorView | null>(null)
  const change = useRef(onChange)

  change.current = onChange

  useEffect(() => {
    if (!host.current) return
    const created = new EditorView({
      parent: host.current,
      state: EditorState.create({
        doc: text,
        extensions: [
          ...BASE,
          language.of(languageFor(path) ?? []),
          writable.of(EditorView.editable.of(editable)),
          EditorView.updateListener.of((update) => {
            if (update.docChanged) change.current(update.state.doc.toString())
          }),
        ],
      }),
    })
    view.current = created
    return () => {
      created.destroy()
      view.current = null
    }
  }, [])

  useEffect(() => {
    const current = view.current
    if (!current) return
    if (current.state.doc.toString() === text) return
    current.dispatch({ changes: { from: 0, to: current.state.doc.length, insert: text } })
  }, [text])

  useEffect(() => {
    view.current?.dispatch({ effects: language.reconfigure(languageFor(path) ?? []) })
  }, [path])

  useEffect(() => {
    view.current?.dispatch({ effects: writable.reconfigure(EditorView.editable.of(editable)) })
  }, [editable])

  useEffect(() => {
    if (line === null || !view.current) return
    scrollToLine(view.current, line)
    view.current.focus()
  }, [line, path])

  return <div ref={host} className="editor-host" />
}
