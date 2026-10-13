import type { EditorView } from '@codemirror/view'
import { useEffect, useRef, useState } from 'react'
import type { CodeMap } from '../../../shared/types'
import { baseName } from '../../model/codemap'
import { openFile } from '../../model/store'
import { scrollToLine } from '../Editor'
import type { EditorAction } from './keymap'
import QuickPick, { type PickItem } from './QuickPick'
import { definitionOf, definitionsIn, outlineOf, wordAt } from './symbols'
import { advance, EMPTY_TRAIL, leave, retreat, type Spot } from './trail'

type Target = PickItem & { to: Spot }

type Picker = { placeholder: string; items: Target[] }

function spotOf(view: EditorView, path: string): Spot {
  return { path, line: view.state.doc.lineAt(view.state.selection.main.head).number }
}

function filesIn(map: CodeMap | null | undefined): Target[] {
  return (map?.folders ?? [])
    .flatMap((folder) => folder.files)
    .map((file) => ({ key: file.path, label: baseName(file.path), detail: file.path, to: { path: file.path, line: 1 } }))
}

function functionsNamed(map: CodeMap | null | undefined, name: string, besides: string): Target[] {
  return (map?.folders ?? [])
    .flatMap((folder) => folder.files)
    .filter((file) => file.path !== besides)
    .flatMap((file) =>
      file.functions
        .filter((fn) => fn.name === name)
        .map((fn) => ({ key: `${file.path}#${fn.line}`, label: fn.name, detail: `${file.path}:${fn.line}`, to: { path: file.path, line: fn.line } }))
    )
}

export function useNavigator(root: string | null, path: string | null, map: CodeMap | null | undefined) {
  const trail = useRef(EMPTY_TRAIL)
  const editor = useRef<EditorView | null>(null)
  const [picker, setPicker] = useState<Picker | null>(null)

  useEffect(() => {
    trail.current = EMPTY_TRAIL
  }, [root])

  const live = () => (editor.current?.dom.isConnected ? editor.current : null)

  const go = (to: Spot) => {
    const view = live()
    if (view && to.path === path) {
      scrollToLine(view, to.line)
      view.focus()
    } else openFile(to.path, to.line)
  }

  const jump = (to: Spot) => {
    const view = live()
    if (view && path) trail.current = leave(trail.current, spotOf(view, path))
    go(to)
  }

  const offer = (placeholder: string, items: Target[]) => {
    const [only, ...rest] = items
    if (only && rest.length === 0) jump(only.to)
    else setPicker({ placeholder, items })
  }

  const onAction = (action: EditorAction, view: EditorView) => {
    editor.current = view
    if (!path) return
    const here = spotOf(view, path)

    if (action === 'symbols') {
      const items = outlineOf(definitionsIn(view.state)).map((d) => ({
        key: String(d.from),
        label: d.name,
        detail: `${d.kind} ${d.line}`,
        to: { path, line: d.line },
      }))
      setPicker({ placeholder: 'Go to symbol in file', items })
    } else if (action === 'definition') {
      const word = wordAt(view.state, view.state.selection.main.head)
      if (!word) return
      const local = definitionOf(definitionsIn(view.state), word.name, word.from)
      if (local && !local.imported) {
        if (local.from !== word.from) jump({ path, line: local.line })
      } else offer(`Definitions of ${word.name}`, functionsNamed(map, word.name, path))
    } else if (action === 'back' || action === 'forward') {
      const moved = action === 'back' ? retreat(trail.current, here) : advance(trail.current, here)
      if (!moved) return
      trail.current = moved.trail
      go(moved.to)
    }
  }

  const quickOpen = () => setPicker({ placeholder: map ? 'Go to file' : 'Go to file (code map not scanned yet)', items: filesIn(map) })

  const close = () => {
    setPicker(null)
    live()?.focus()
  }

  const overlay = picker && (
    <QuickPick placeholder={picker.placeholder} items={picker.items} onPick={(item) => jump(item.to)} onClose={close} />
  )

  return { onAction, quickOpen, overlay }
}
