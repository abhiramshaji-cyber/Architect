import { useEffect, useState } from 'react'
import { settingsMessage } from '../../model/picker'
import type { SettingsProblem, WorktreeSettings } from '../../../shared/types'

export default function Locations({ onSaved }: { onSaved: () => void }) {
  const [settings, setSettings] = useState<WorktreeSettings | null>(null)
  const [depth, setDepth] = useState('')
  const [folder, setFolder] = useState('')
  const [problems, setProblems] = useState<string[]>([])

  useEffect(() => {
    window.architect.worktreeSettings().then(
      (loaded) => {
        setSettings(loaded)
        setDepth(String(loaded.worktreeScanDepth))
      },
      (err: unknown) => setProblems([String(err)]),
    )
  }, [])

  async function save(next: WorktreeSettings): Promise<boolean> {
    const saved = await window.architect.saveWorktreeSettings(next).catch((err: unknown) => ({ ok: false as const, error: String(err) }))
    if (!saved.ok) {
      setProblems(typeof saved.error === 'string' ? [saved.error] : saved.error.map((problem: SettingsProblem) => settingsMessage(problem)))
      return false
    }

    setProblems([])
    setSettings(saved.value)
    setDepth(String(saved.value.worktreeScanDepth))
    onSaved()
    return true
  }

  if (!settings) return problems.length > 0 ? <p className="picker-error">{problems[0]}</p> : null

  async function addRoot(current: WorktreeSettings): Promise<void> {
    const picked = await window.architect.pickFolder()
    if (picked) await save({ ...current, worktreeRoots: [...current.worktreeRoots, picked] })
  }

  async function addFolder(current: WorktreeSettings): Promise<void> {
    if (await save({ ...current, worktreeFolders: [...current.worktreeFolders, folder.trim()] })) setFolder('')
  }

  function commitDepth(current: WorktreeSettings): void {
    const next = depth.trim() === '' ? Number.NaN : Number(depth)
    if (next !== current.worktreeScanDepth) void save({ ...current, worktreeScanDepth: next })
  }

  return (
    <section className="picker-locations" aria-label="Worktree locations">
      <p className="goto-hint">Scan these folders for git repos, then list every worktree git reports for each repo.</p>
      <ul className="picker-locations-list">
        {settings.worktreeRoots.map((root) => (
          <li key={root}>
            <code>{root}</code>
            <button className="pane-action" onClick={() => void save({ ...settings, worktreeRoots: settings.worktreeRoots.filter((item) => item !== root) })}>
              Remove
            </button>
          </li>
        ))}
        {settings.worktreeRoots.length === 0 && <li className="goto-hint">No scan folders, so only open projects are checked</li>}
      </ul>
      <div className="picker-locations-row">
        <button className="pane-action" onClick={() => void addRoot(settings)}>
          Add scan folder…
        </button>
        <label className="goto-hint">
          Depth{' '}
          <input
            className="picker-prompt picker-depth"
            type="number"
            min={0}
            step={1}
            value={depth}
            onChange={(event) => setDepth(event.target.value)}
            onBlur={() => commitDepth(settings)}
            onKeyDown={(event) => event.key === 'Enter' && commitDepth(settings)}
          />
        </label>
      </div>

      <p className="goto-hint">Worktrees inside these folders count as Claude worktrees. A relative folder is inside each repo.</p>
      <ul className="picker-locations-list">
        {settings.worktreeFolders.map((item) => (
          <li key={item}>
            <code>{item}</code>
            <button className="pane-action" onClick={() => void save({ ...settings, worktreeFolders: settings.worktreeFolders.filter((other) => other !== item) })}>
              Remove
            </button>
          </li>
        ))}
      </ul>
      <form
        className="picker-locations-row"
        onSubmit={(event) => {
          event.preventDefault()
          void addFolder(settings)
        }}
      >
        <input
          className="picker-prompt"
          placeholder=".claude/worktrees or an absolute path"
          value={folder}
          onChange={(event) => setFolder(event.target.value)}
          aria-label="Worktree folder"
        />
        <button className="pane-action" type="submit">
          Add
        </button>
      </form>

      {problems.map((problem) => (
        <p key={problem} className="picker-error">
          {problem}
        </p>
      ))}
    </section>
  )
}
