import { closeBrackets, closeBracketsKeymap } from '@codemirror/autocomplete'
import { defaultKeymap, historyKeymap, indentWithTab, selectLine } from '@codemirror/commands'
import { foldAll, foldKeymap, unfoldAll } from '@codemirror/language'
import { gotoLine, highlightSelectionMatches, openSearchPanel, search, searchKeymap } from '@codemirror/search'
import { EditorSelection, type Extension, type StateCommand } from '@codemirror/state'
import { EditorView, keymap, rectangularSelection, type Command } from '@codemirror/view'

export type EditorAction = 'symbols' | 'definition' | 'back' | 'forward' | 'search'

const insertLineAbove: StateCommand = ({ state, dispatch }) => {
  if (state.readOnly) return false
  const edit = state.changeByRange((range) => {
    const line = state.doc.lineAt(range.head)
    const indent = line.text.slice(0, line.text.length - line.text.trimStart().length)
    return {
      changes: { from: line.from, insert: indent + state.lineBreak },
      range: EditorSelection.cursor(line.from + indent.length),
    }
  })
  dispatch(state.update(edit, { scrollIntoView: true, userEvent: 'input' }))
  return true
}

const openReplace: Command = (view) => {
  openSearchPanel(view)
  view.dom.querySelector<HTMLInputElement>('.cm-search input[name=replace]')?.focus()
  return true
}

function goToDefinitionAt(view: EditorView, event: MouseEvent, run: (action: EditorAction) => void): boolean {
  const at = view.posAtCoords({ x: event.clientX, y: event.clientY })
  if (at === null) return false
  view.dispatch({ selection: { anchor: at } })
  run('definition')
  return true
}

export function vscodeKeys(run: (action: EditorAction, view: EditorView) => void): Extension {
  const act = (action: EditorAction): Command => (view) => {
    run(action, view)
    return true
  }

  return [
    search({ top: true }),
    highlightSelectionMatches(),
    closeBrackets(),
    rectangularSelection({ eventFilter: (e) => e.altKey && e.shiftKey }),
    EditorView.clickAddsSelectionRange.of((e) => e.altKey && !e.shiftKey),
    EditorView.domEventHandlers({
      mousedown: (e, view) => e.metaKey && !e.altKey && goToDefinitionAt(view, e, (action) => run(action, view)),
    }),
    keymap.of([
      { key: 'Mod-l', run: selectLine, preventDefault: true },
      { key: 'Mod-Alt-f', run: openReplace, preventDefault: true },
      { key: 'Ctrl-g', run: gotoLine, preventDefault: true },
      { key: 'Shift-Mod-Enter', run: insertLineAbove },
      { key: 'Mod-k Mod-0', run: foldAll },
      { key: 'Mod-k Mod-j', run: unfoldAll },
      { key: 'Shift-Mod-o', run: act('symbols'), preventDefault: true },
      { key: 'Shift-Mod-f', run: act('search'), preventDefault: true },
      { key: 'F12', run: act('definition'), preventDefault: true },
      { key: 'Ctrl--', run: act('back'), preventDefault: true },
      { key: 'Ctrl-Shift--', run: act('forward'), preventDefault: true },
      ...closeBracketsKeymap,
      ...searchKeymap,
      ...foldKeymap,
      ...defaultKeymap,
      ...historyKeymap,
      indentWithTab,
    ]),
  ]
}
