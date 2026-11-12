# Architecture

Architect is a drag and drop architecture canvas with an MCP server that makes the drawn architecture binding on a coding agent.

## Components

### types
The wire protocol and the domain types, shared by all three processes.
owns: `shared/**`

### graph
Parses, serializes and queries `architect.md`. Fully deterministic, no model calls.
owns: `electron/contract/graph.ts`

### git
Shells out to the git binary and returns typed results for branch, dirty state, the remote default branch and a file at a ref. Also resolves where a GitHub repo's clone and per branch worktrees live on disk, and opens a branch by replaying it onto its upstream or by wiping and rebuilding it. Also blames files line by line, batched and cached per HEAD. No git library, no domain logic.
owns: `electron/git/**`

### github
Shells out to the gh CLI for the GitHub credential, reads the account's repos, a repo's branches and its open pull requests, and clones a repo with that credential. No token is stored by us and none crosses the preload bridge.
owns: `electron/github/**`

### draft
Asks the Claude Code binary for a first `architect.md`, from a bounded summary of the scan: one entry per top level source folder with a sample of its generated function descriptions, and candidate edges aggregated from real call refs. Also asks it for a commit title and description from a staged diff, and for a pull request title and body from the account's own `pr` instructions read off disk. Every reply is a JSON object that is parsed, scrubbed of attribution and validated before it is offered, and nothing it writes is ever submitted on its own.
owns: `electron/draft/**`

### functions
Lists every function in a project with facts measured from the scan (line count, how many functions call it, how many it calls, whether it is exported, whether its file is a starting point), an importance from 1 to 5 and a one line plain English summary. Importance comes from how much of the call graph depends on the function, bucketed against the rest of the same project. The summary is the author's own comment when there is one, otherwise a sentence built from the function's name, its kind and who uses it. It also arranges the functions into a call tree for the org chart view: starting points that nothing calls sit at the top, each function appears once under its shallowest and most important caller, cycles are cut and anything unreachable goes into its own bucket. Given a folder inside the project it narrows all of this to the functions under that folder: importance and the tree are worked out again from only the calls between them, callers from outside the folder are counted apart, and the folders inside it come back with their function counts so the renderer can drill in. A folder that is missing or outside the project falls back to the whole project. Fully deterministic, no model calls, computed in one pass over the code map.
owns: `electron/functions/**`

### recency
Works out when each function and each component last changed. Each function gets the newest commit across its own lines from git blame, each component the newest change across the files it owns and the functions it covers, and lines nobody has committed yet count as the newest of all. Fully deterministic, no model calls.
owns: `electron/recency/**`

### daemon
Socket server, project resolution by cwd, file watching, applying proposals to architect.md (straight away, or once the engineer approves them when change review is on), answering check_change for a dependency or a proposed file, the per project change history, and the guarded read, write and directory listing of project files.
owns: `electron/daemon.ts`

### rules
Reads the Rules section of `architect.md`, falling back to the defaults when it is absent, and checks code against it: lines per file, code files per folder, banned words in file, class and function names, and how many unrelated groups of exported functions a file holds, two exported functions being related when one reaches the other through calls or nesting inside that file. A later rule line whose globs match a path overrides an earlier one. A proposed file is checked against the same file on disk, so only a violation that is new or worse is reported. Keeps a capped pass and fail history per rule for each project. Fully deterministic, no model calls.
owns: `electron/rules/**`

### review
Opt in change review. Persists the on or off switch, holds contract proposals and Claude Code edits waiting on the engineer, keeps proposals across a restart, wakes the waiting caller with approve, deny or the engineer's feedback, and drops an edit whose hook went away. Rebuilds the file an edit would produce and works out its impact: the components that own it, the functions added, removed or changed in it, and the before and after diff, or for a proposal the architecture it would leave behind. A switch that is off answers every edit at once.
owns: `electron/review/**`

### app
Electron lifecycle, tray and the preload bridge to the renderer. Every window is a native macOS tab in one group, holding its own pty host and a claim on at most one project root, so a project is open in at most one tab and closing a tab tears down only its terminals. Runs as a single instance and opens a folder handed to it from outside, by `open -a Architect <folder>`, a path on the command line or a second launch, as a tab of its own, or brings forward the tab that already holds it.
owns: `electron/main.ts`
owns: `electron/app/**`

### pty
Spawns and owns pty processes in the main process, keyed by session id, and batches their output into a single streaming channel. A session runs `tmux new-session -A -s <name derived from its cwd>` when tmux is available, so tearing the pty down detaches rather than kills, and falls back to a plain shell otherwise.
owns: `electron/pty/**`

### canvas
React Flow diagram, the file tree and CodeMirror editor, the contract rail holding edits and the change history, and the live highlighting of what just changed. The project store in `src/model/store.ts` holds the per project state and the panels subscribe to it. The shell in `src/shell` is a binary pane tree, a leaf holding one registered view or a split of two, persisted per project root.
owns: `src/**`

### cli
Headless `architect check` binary. Reads the contract, scans the code and exits nonzero when the drawing or a rule is violated, printing each rule violation with its file and line. Records every run in the rule history and lists it with `--history`.
owns: `cli/**`

### bridge
MCP stdio server that Claude spawns. Translates tool calls into socket requests.
owns: `mcp/**`

### lsp
Language server for `architect.md` over stdio. Turns the positioned scan into diagnostics, completion, go to definition and rename for any editor.
owns: `lsp/**`

## Dependencies

- graph -> types
- graph -> rules
- rules -> types
- daemon -> rules
- cli -> rules
- daemon -> types
- daemon -> graph
- daemon -> draft
- daemon -> functions
- daemon -> review
- daemon -> recency
- recency -> types
- recency -> graph
- recency -> git
- review -> types
- review -> graph
- review -> git
- functions -> types
- daemon -> git
- draft -> types
- draft -> graph
- draft -> git
- draft -> functions
- app -> types
- app -> daemon
- app -> draft
- app -> pty
- app -> git
- app -> github
- git -> types
- github -> types
- pty -> types
- canvas -> types
- bridge -> types
- cli -> types
- cli -> graph
- lsp -> types
- lsp -> graph

## Forbidden

- canvas -> graph : the renderer never parses architect.md, it receives an Architecture over IPC
- canvas -> daemon : the renderer reaches the daemon only through the preload bridge in app
- bridge -> graph : the bridge holds no domain logic, it only translates and forwards
- bridge -> daemon : they communicate over the socket, never by import
- canvas -> pty : node-pty never reaches the renderer, terminal output arrives over the preload bridge
- canvas -> git : the renderer never shells out to git, results arrive over the preload bridge
- canvas -> github : the renderer never shells out to gh and never holds a token, repos and branches arrive over the preload bridge
- canvas -> draft : the renderer never spawns the claude binary, a drafted contract arrives over the preload bridge
- canvas -> functions : the renderer never ranks or arranges functions itself, the ranked list and its call tree arrive over the preload bridge
- canvas -> recency : the renderer never reads git history, when each function and component last changed arrives over the preload bridge
- canvas -> review : the renderer never decides a change or reads the queue itself, pending changes and their impact arrive over the preload bridge
- bridge -> review : the hook only forwards an edit over the socket and prints the answer, the queue lives in the app

## Packages

- @modelcontextprotocol/sdk
- @xyflow/react
- chokidar
- react
- react-dom
- electron
- node-pty
- @xterm/xterm
- @xterm/addon-fit
- vscode-languageserver
- vscode-languageserver-textdocument
- @codemirror/state
- @codemirror/view
- @codemirror/language
- @codemirror/commands
- @codemirror/lang-javascript
- @codemirror/lang-json
- @codemirror/lang-markdown
- @codemirror/lang-css
- @lezer/highlight

## Rules

- skip: `**/*.test.*`, `**/*.spec.*`
- lines: 200
- files: 5
- names: Manager, Helper, Service, Factory, Base
- jobs: 1
- lines: 250 `electron/pty/pty.ts`, `mcp/bridge.ts`, `src/view/ContractView.tsx`, `src/view/FileTree.tsx`
- lines: 300 `electron/git/open.ts`, `src/model/codemap.ts`
- lines: 350 `src/view/Canvas.tsx`, `src/view/CodeCanvas.tsx`, `src/view/Inspector.tsx`
- lines: 450 `electron/contract/graph.ts`, `src/view/RepoPicker.tsx`
- lines: 500 `electron/github/github.ts`
- lines: 550 `electron/git/git.ts`
- lines: 600 `shared/types.ts`, `src/model/store.ts`
- lines: 650 `electron/scan/scan.ts`, `src/model/demo-mock.ts`
- lines: 1050 `electron/daemon.ts`
- files: 6 `scripts`
- files: 7 `shared`
- files: 9 `src/shell`
- files: 13 `src/model`
- files: 22 `src/view`
- jobs: 2 `electron/contract/history.ts`, `electron/contract/infer.ts`, `electron/draft/flow/evidence.ts`, `electron/functions/facts.ts`, `electron/functions/summary/verbs.ts`, `electron/git/diff/file.ts`, `electron/git/diff/hunks.ts`, `electron/git/diff/parse.ts`, `electron/github/github.ts`, `electron/review/change.ts`, `electron/tabs.ts`, `shared/folders.ts`, `shared/recency.ts`, `src/model/buffer.ts`, `src/model/language.ts`, `src/model/recency.ts`, `src/shell/chords.ts`, `src/shell/leaderKey.ts`, `src/shell/views.ts`, `src/view/diff/BranchBox.tsx`, `src/view/functions/Mark.tsx`, `src/view/SplitDiff.tsx`
- jobs: 3 `electron/app/launch.ts`, `electron/functions/scope.ts`, `electron/scan/traits.ts`, `lsp/features.ts`, `src/shell/pane-tree.ts`, `src/view/editor/trail.ts`, `src/view/segments.ts`
- jobs: 4 `electron/app/windows.ts`, `src/model/codemap.ts`, `src/model/live/recent.ts`, `src/view/editor/symbols.ts`, `src/view/functions/scope/pick.ts`
- jobs: 5 `electron/contract/graph.ts`, `electron/git/diff/changes.ts`, `src/model/layout.ts`, `src/model/live/history.ts`, `src/model/store.ts`, `src/model/tree.ts`
- jobs: 6 `src/model/review.ts`, `src/view/functions/tree/outline.ts`
- jobs: 7 `src/shell/commands.ts`
- jobs: 11 `src/model/picker.ts`
- names: Manager, Helper, Service, Factory `electron/git/diff/changes.ts`, `src/model/codemap.ts`, `src/view/functions/tree/Card.tsx`
