import { BrowserWindow, ipcMain } from 'electron'
import {
  type Architecture,
  type ChangedFile,
  type CommitDraft,
  type DiffSection,
  type DraftResult,
  type GithubCompare,
  type GithubResult,
  type IpcResult,
  type OpenChoice,
  type PtySpec,
  type PullDraft,
} from '../../shared/types'
import type { createDaemon } from '../daemon'
import * as message from '../draft/message'
import * as diff from '../git/diff'
import * as git from '../git/git'
import { commitsSince } from '../git/log'
import * as open from '../git/open'
import { readTabTitle } from '../git/title'
import * as github from '../github/github'
import { search } from '../search/search'
import { openRepoBranch } from './repo'
import { claimFor, claims, compares, holderOf, hostOf, stopCompare } from './windows'

function handleIn<A extends unknown[], R>(
  channel: string,
  fn: (window: BrowserWindow, ...args: A) => R | Promise<R>,
) {
  ipcMain.handle(channel, async (event, ...args: A): Promise<IpcResult<Awaited<R>>> => {
    const window = BrowserWindow.fromWebContents(event.sender)
    if (!window) return { ok: false, error: 'no window for this request' }

    try {
      return { ok: true, value: await fn(window, ...args) }
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) }
    }
  })
}

function handle<A extends unknown[], R>(channel: string, fn: (...args: A) => R | Promise<R>) {
  handleIn<A, R>(channel, (_window, ...args) => fn(...args))
}

export function wireIpc(daemon: ReturnType<typeof createDaemon>) {
  handle('architect:projects', () => daemon.projects())
  handle('architect:create-contract', (root: string) => daemon.createContract(root))
  handle('architect:draft-contract', (root: string) => daemon.draftContract(root))
  handle('architect:open', (root: string) => daemon.open(root))
  handle('architect:close-project', (root: string) => daemon.closeProject(root))
  handle('architect:history', (root: string) => daemon.history(root))
  handle('architect:verdicts', (root: string) => daemon.verdicts(root))
  handle('architect:edits', (root: string) => daemon.edits(root))
  handle('architect:edit', (root: string, id: string) => daemon.edit(root, id))
  handle('architect:create-edit', (root: string, architecture: Architecture) =>
    daemon.createEdit(root, architecture),
  )
  handle('architect:update-edit', (root: string, id: string, architecture: Architecture) =>
    daemon.updateEdit(root, id, architecture),
  )
  handle('architect:hand-edit', (root: string, id: string) => daemon.handEdit(root, id))
  handle('architect:delete-edit', (root: string, id: string) => daemon.deleteEdit(root, id))
  handle('architect:code-map', (root: string) => daemon.codeMap(root))
  handle('architect:rescan', (root: string) => daemon.rescan(root))
  handle('architect:list-functions', (root: string, scope?: unknown) => daemon.listFunctions(root, scope))
  handle('architect:ownership', (root: string) => daemon.ownership(root))
  handle('architect:recency', (root: string) => daemon.recency(root))
  handle('architect:churn', (root: string, days?: unknown) => daemon.churn(root, days))
  handle('architect:read-source', (root: string, file: string, from: number, length: number) =>
    daemon.readSource(root, file, from, length),
  )
  handle('architect:open-source', (root: string, file: string) => daemon.openSource(root, file))
  handle('architect:write-source', (root: string, file: string, text: string, baseline: string) =>
    daemon.writeSource(root, file, text, baseline),
  )
  handle('architect:read-tree', (root: string, dir: string) => daemon.readTree(root, dir))
  handle('architect:review', () => daemon.review())
  handle('architect:set-review', (enabled: boolean) => daemon.setReview(enabled === true))
  handle('architect:review-detail', (id: string) => daemon.reviewDetail(id))
  handle('architect:decide', (id: string, approved: boolean, feedback?: string) =>
    daemon.decide(id, approved === true, typeof feedback === 'string' ? feedback : undefined),
  )

  handleIn('architect:claim-root', (window, root: string) => claimFor(window.id, root))
  handleIn('architect:search', (window, query: string) => {
    const root = claims.get(window.id)
    if (!root) throw new Error('no project open in this tab')
    return search(root, query)
  })
  handleIn('architect:release-root', (window) => {
    claims.delete(window.id)
  })
  handle('architect:focus-root', (root: string) => {
    const holder = holderOf(root)
    holder?.focus()
    return holder !== undefined
  })

  handleIn('architect:pty-spawn', (window, spec: PtySpec) => hostOf(window).spawn(spec))
  handleIn('architect:pty-write', (window, id: string, data: string) => hostOf(window).write(id, data))
  handleIn('architect:pty-resize', (window, id: string, cols: number, rows: number) =>
    hostOf(window).resize(id, cols, rows),
  )
  handleIn('architect:pty-kill', (window, id: string) => hostOf(window).kill(id))

  handle('architect:git-status', (root: string) => git.status(root))
  handle('architect:tab-title', (root: string) => readTabTitle(root))
  handle('architect:git-default-branch', (root: string) => git.defaultBranch(root))
  handle('architect:git-local-branches', (root: string) => git.localBranches(root))
  handle('architect:git-remote-branches', (root: string) => git.remoteBranches(root))
  handle('architect:git-fetch', (root: string) => git.fetch(root))
  handle('architect:git-distance', (root: string) => git.distance(root))
  handle('architect:git-commits', (root: string, since: number) => commitsSince(root, since))
  handle('architect:git-changes', (root: string) => diff.changes(root))
  handle('architect:git-file-diff', (root: string, section: DiffSection, file: ChangedFile, full?: boolean) =>
    diff.fileDiff(root, section, file, full),
  )
  handle('architect:git-stage-file', (root: string, file: ChangedFile) => diff.stageFile(root, file))
  handle('architect:git-unstage-file', (root: string, file: ChangedFile) => diff.unstageFile(root, file))
  handle('architect:git-stage-all', (root: string) => diff.stageAll(root))
  handle('architect:git-commit', (root: string, title: string, description: string) =>
    git.commit(root, title, description),
  )
  handle('architect:git-push', (root: string) => git.push(root))
  handle('architect:git-pull', (root: string) => git.pull(root))

  handle('architect:draft-commit-message', async (root: string): Promise<DraftResult<CommitDraft>> => {
    const staged = await diff.stagedPatch(root)
    if (!staged.ok) return { ok: false, error: { kind: 'git', error: staged.error } }

    return message.commitMessage(root, staged.value)
  })
  handle('architect:draft-pull-request', async (root: string): Promise<DraftResult<PullDraft>> => {
    const work = await diff.branchPatch(root)
    if (!work.ok) return { ok: false, error: { kind: 'git', error: work.error } }

    return message.pullRequest(root, work.value)
  })

  handle('architect:github-auth', () => github.auth())
  handle('architect:github-repos', (limit?: number) => github.allRepos(limit))
  handle('architect:github-branches', (owner: string, repo: string) => github.branches(owner, repo))
  handle('architect:github-rates', () => github.rates())
  handle('architect:github-pulls', (owner: string, repo: string) => github.pulls(owner, repo))
  handle('architect:github-pull-for', (root: string, head: string) => github.pullFor(root, head))
  handle('architect:github-create-pull', (root: string, base: string, head: string, title: string, body: string) =>
    github.createPull(root, base, head, title, body),
  )

  handleIn('architect:github-compare', async (window, owner: string, repo: string, base: string, heads: string[]) => {
    stopCompare(window)
    const run = new AbortController()
    compares.set(window.id, run)

    const emit = (head: string, result: GithubResult<GithubCompare>) => {
      if (!window.isDestroyed()) {
        window.webContents.send('architect:github-compared', { repo: `${owner}/${repo}`, head, result })
      }
    }

    try {
      await github.compareAll(owner, repo, base, heads, emit, run.signal)
    } finally {
      if (compares.get(window.id) === run) compares.delete(window.id)
    }
  })
  handleIn('architect:github-compare-cancel', (window) => stopCompare(window))

  handle('architect:repo-plan', (repo: string, branch: string, pr?: number) =>
    open.plan(open.GITHUB_DIR, repo, branch, pr),
  )
  handle('architect:repo-open', (repo: string, branch: string, choice: OpenChoice, pr?: number) =>
    openRepoBranch(repo, branch, choice, pr),
  )
}
