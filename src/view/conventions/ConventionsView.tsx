import { useCallback, useRef } from 'react'
import { folderName } from '../../model/layout'
import { openFile, useProject } from '../../model/store'
import type { ViewProps } from '../../shell/views'
import { plural } from '../functions/Mark'
import Card from './Card'
import { useConventions } from './useConventions'

export default function ConventionsView({ show }: ViewProps) {
  const { currentRoot, architecture, codeMap } = useProject()
  const { state, error, ai, toggle, suggest, promote } = useConventions(currentRoot, architecture, codeMap)

  const showLatest = useRef(show)
  showLatest.current = show
  const onOpen = useCallback((file: string) => {
    openFile(file)
    showLatest.current('files')
  }, [])

  if (!currentRoot) return null

  return (
    <section className="conventions">
      <header className="canvas-header">
        <h2>Conventions</h2>
        <p className="canvas-path">{folderName(currentRoot)}</p>
      </header>

      <div className="fn-bar">
        <p className="fn-count" aria-live="polite">
          {state === null ? 'Reading…' : state.enabled ? plural(state.measured.length, 'measured convention') : 'Learned conventions are off'}
        </p>
        {state?.enabled && (
          <button className="ghost" disabled={ai.busy} onClick={suggest}>
            {ai.busy ? 'Asking Claude Code…' : 'Suggest with AI'}
          </button>
        )}
        {state && (
          <button className={state.enabled ? 'ghost' : 'primary'} onClick={toggle}>
            {state.enabled ? 'Turn off' : 'Turn on'}
          </button>
        )}
      </div>

      {error && (
        <p className="fn-notice" role="status">
          {error}
        </p>
      )}

      {state && !state.enabled && (
        <p className="cv-note">
          Off by default. When on, this page counts the size each component already keeps to, and on request asks Claude Code for conventions that need reading to spot. Nothing is
          counted and no model is called while it is off, and nothing here ever reaches the Functions page or the Tree.
        </p>
      )}

      {state?.enabled && (
        <>
          <h3 className="cv-heading">Measured</h3>
          <p className="cv-note">Counted from the parse: each component whose files all sit below the limit in force, with the rule that would hold them there.</p>
          {state.measured.length === 0 ? (
            <p className="fn-empty">No component sits below its limits.</p>
          ) : (
            <ol className="cv-list">
              {state.measured.map((convention) => (
                <Card key={convention.rule ?? convention.title} convention={convention} onOpen={onOpen} onPromote={promote} />
              ))}
            </ol>
          )}

          <h3 className="cv-heading">AI suggestions</h3>
          <p className="cv-note">
            Written by Claude Code from file and function names. They are suggestions only: check each one, nothing is added to the Rules unless you add it.
          </p>
          {ai.error && (
            <p className="fn-notice" role="status">
              {ai.error}
            </p>
          )}
          {ai.found === null ? (
            <p className="fn-empty">{ai.busy ? 'Waiting for Claude Code…' : 'Nothing asked yet.'}</p>
          ) : ai.found.length === 0 ? (
            <p className="fn-empty">Claude Code suggested nothing the files back up.</p>
          ) : (
            <ol className="cv-list">
              {ai.found.map((convention) => (
                <Card key={`${convention.title}\0${convention.rule ?? ''}`} convention={convention} onOpen={onOpen} onPromote={promote} />
              ))}
            </ol>
          )}
        </>
      )}
    </section>
  )
}
