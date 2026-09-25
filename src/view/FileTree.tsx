import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { TreeError } from '../../shared/types'
import { hue, parentPath, rows, slice, step, type Listings, type TreeRow } from '../model/tree'

const ROW_H = 22

const TREE_REFUSALS: Record<TreeError, string> = {
  closed: 'This project is not open',
  outside: 'That folder is outside the project',
  unreadable: 'This folder could not be read',
}

const OPEN_KEY = 'architect.tree.open:'

function storedOpen(root: string): Set<string> {
  try {
    const saved = JSON.parse(localStorage.getItem(OPEN_KEY + root) ?? '[]') as unknown
    return new Set(Array.isArray(saved) ? saved.filter((at): at is string => typeof at === 'string') : [])
  } catch {
    return new Set()
  }
}

function rememberOpen(root: string, open: ReadonlySet<string>): void {
  try {
    localStorage.setItem(OPEN_KEY + root, JSON.stringify([...open]))
  } catch {
    return
  }
}

function Owner({ owners }: { owners: string[] }) {
  if (owners.length === 0) return <span className="tree-owner unowned">unowned</span>
  return (
    <span className="tree-owner" style={{ '--owner-hue': hue(owners[0] as string) } as React.CSSProperties}>
      {owners.join(' + ')}
    </span>
  )
}

function Row({ row, active, onOpen, onToggle }: {
  row: TreeRow
  active: boolean
  onOpen: (row: TreeRow) => void
  onToggle: (row: TreeRow) => void
}) {
  return (
    <div
      className={active ? 'tree-row active' : 'tree-row'}
      style={{ height: ROW_H, paddingLeft: 6 + row.depth * 12 }}
      role="treeitem"
      aria-selected={active}
      aria-expanded={row.dir ? row.open : undefined}
      onClick={() => (row.dir ? onToggle(row) : onOpen(row))}
    >
      <span className="tree-twist">{row.dir ? (row.open ? '▾' : '▸') : ''}</span>
      <span className={row.dir ? 'tree-name dir' : 'tree-name'}>{row.name}</span>
      {row.dir ? null : <Owner owners={row.owners} />}
      {row.pending && <span className="tree-owner">…</span>}
    </div>
  )
}

export default function FileTree({ root, current, onOpen }: {
  root: string
  current: string | null
  onOpen: (path: string) => void
}) {
  const [listings, setListings] = useState<Listings>({})
  const [open, setOpen] = useState<ReadonlySet<string>>(() => storedOpen(root))
  const [error, setError] = useState<TreeError | null>(null)
  const [focus, setFocus] = useState<string | null>(null)
  const [scrollTop, setScrollTop] = useState(0)
  const [height, setHeight] = useState(600)
  const stage = useRef<HTMLDivElement | null>(null)
  const wanted = useRef(new Set<string>())

  useEffect(() => {
    setListings({})
    setOpen(storedOpen(root))
    setError(null)
    setFocus(null)
    wanted.current = new Set()
  }, [root])

  useEffect(() => {
    const element = stage.current
    if (!element) return
    const observer = new ResizeObserver(() => setHeight(element.clientHeight))
    observer.observe(element)
    setHeight(element.clientHeight)
    return () => observer.disconnect()
  }, [])

  const load = useCallback(
    (dir: string) => {
      if (wanted.current.has(dir)) return
      wanted.current.add(dir)
      window.architect
        .readTree(root, dir)
        .then((listing) => {
          if (listing.error !== null) {
            wanted.current.delete(dir)
            if (dir === '') setError(listing.error)
            return
          }
          setListings((was) => ({ ...was, [dir]: listing.entries }))
        })
        .catch(() => {
          wanted.current.delete(dir)
          if (dir === '') setError('unreadable')
        })
    },
    [root]
  )

  useEffect(() => {
    load('')
    for (const dir of open) load(dir)
  }, [load, open])

  const all = useMemo(() => rows(listings, open), [listings, open])
  const shown = useMemo(() => slice(all, scrollTop, height, ROW_H), [all, scrollTop, height])

  const toggle = useCallback(
    (at: string) => {
      setOpen((was) => {
        const next = new Set(was)
        if (next.has(at)) next.delete(at)
        else next.add(at)
        rememberOpen(root, next)
        return next
      })
      setFocus(at)
    },
    [root]
  )

  const openRow = useCallback(
    (row: TreeRow) => {
      setFocus(row.path)
      if (!row.dir) onOpen(row.path)
    },
    [onOpen]
  )

  const onKey = (e: React.KeyboardEvent<HTMLDivElement>) => {
    const row = all.find((candidate) => candidate.path === focus) ?? null

    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault()
      setFocus(step(all, focus, e.key === 'ArrowDown' ? 1 : -1))
      return
    }

    if (e.key === 'ArrowRight' && row?.dir && !row.open) {
      e.preventDefault()
      toggle(row.path)
      return
    }

    if (e.key === 'ArrowLeft' && row) {
      e.preventDefault()
      if (row.dir && row.open) toggle(row.path)
      else setFocus(parentPath(row.path) === '' ? null : parentPath(row.path))
      return
    }

    if ((e.key === 'Enter' || e.key === ' ') && row) {
      e.preventDefault()
      if (row.dir) toggle(row.path)
      else onOpen(row.path)
    }
  }

  useEffect(() => {
    if (focus === null) return
    const at = all.findIndex((row) => row.path === focus)
    if (at === -1) return
    const top = at * ROW_H
    const element = stage.current
    if (!element) return
    if (top < element.scrollTop) element.scrollTop = top
    else if (top + ROW_H > element.scrollTop + element.clientHeight) element.scrollTop = top + ROW_H - element.clientHeight
  }, [focus, all])

  if (error !== null) return <div className="tree-empty">{TREE_REFUSALS[error]}</div>

  return (
    <div
      ref={stage}
      className="tree"
      role="tree"
      aria-label="Project files"
      tabIndex={0}
      onKeyDown={onKey}
      onScroll={(e) => setScrollTop(e.currentTarget.scrollTop)}
    >
      <div style={{ height: shown.before }} />
      {shown.rows.map((row) => (
        <Row
          key={row.path}
          row={row}
          active={row.path === focus || row.path === current}
          onOpen={openRow}
          onToggle={(target) => toggle(target.path)}
        />
      ))}
      <div style={{ height: shown.after }} />
      {all.length === 0 && listings[''] !== undefined && <div className="tree-empty">This project has no visible files</div>}
    </div>
  )
}
