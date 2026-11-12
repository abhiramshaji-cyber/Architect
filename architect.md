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
Shells out to the git binary and returns typed results for branch, dirty state, the remote default branch and a file at a ref. Also resolves where a GitHub repo's clone and per branch worktrees live on disk, and opens a branch by replaying it onto its upstream or by wiping and rebuilding it. Also blames files line by line, batched and cached per HEAD, and reads the per commit line counts and changed line ranges of a window of history, streamed so a large history never sits in memory and cached per HEAD. No git library, no domain logic.
owns: `electron/git/**`

### github
Shells out to the gh CLI for the GitHub credential, reads the account's repos, a repo's branches and its open pull requests, and clones a repo with that credential. No token is stored by us and none crosses the preload bridge.
owns: `electron/github/**`

### draft
Asks the Claude Code binary for a first `architect.md`, from a bounded summary of the scan: one entry per top level source folder with a sample of its functions and their own doc comments, and candidate edges aggregated from real call refs. Also asks it for a commit title and description from a staged diff, and for a pull request title and body from the account's own `pr` instructions read off disk. Every reply is a JSON object that is parsed, scrubbed of attribution and validated before it is offered, and nothing it writes is ever submitted on its own.
owns: `electron/draft/**`

### functions
Lists every function in a project with facts measured from the scan (its signature as written, line count, how many functions call it, how many it calls, whether it calls itself, whether it is exported, and why it is a starting point when it is one), the author's own doc comment copied verbatim when there is one, the calls between the listed functions, and an importance from 1 to 5. Importance comes from how much of the call graph depends on the function, bucketed against the rest of the same project. Nothing is worded from a function's name. A function is a starting point only for a reason it can name: the package.json main, bin or a script that runs its file, the Electron main, preload or renderer entry or a page script read from the vite or electron-vite build config, a preload bridge member, an MCP tool handler, an IPC handler or a CLI command, each found in the parse. Being unimported never makes a starting point, and test files never are. It also arranges the functions into a call tree for the org chart view: starting points sit at the top, grouped by their reason and the file that declares it, each function appears once under its shallowest and most important caller, cycles are cut and anything unreachable goes into its own bucket. Given a folder inside the project it narrows all of this to the functions under that folder: importance and the tree are worked out again from only the calls between them, callers from outside the folder are counted apart, and the folders inside it come back with their function counts so the renderer can drill in. It also maps each file in scope to the component that owns it in `architect.md`, so the renderer can bucket a wide level of the tree by component. A folder that is missing or outside the project falls back to the whole project. Fully deterministic, no model calls, computed in one pass over the code map.
owns: `electron/functions/**`

### layers
Builds the Layers matrix: every call from a function in a file owned by one component to a file owned by another, each with the caller's and the callee's name and line, grouped into one cell per pair of components. A cell is allowed, forbidden or undrawn by the same check `architect check` applies to those calls, and a contract edge with no calls is a stale cell. Components are levelled by the longest path down the call graph from the components that call nobody, with every strongly connected group of components folded into one block on one level, so a cycle is the only thing above the diagonal. Without an `architect.md` the top level folders stand in for components. Fully deterministic, no model calls.
owns: `electron/layers/**`

### recency
Works out when each function and each component last changed. Each function gets the newest commit across its own lines from git blame, each component the newest change across the files it owns and the functions it covers, and lines nobody has committed yet count as the newest of all. Fully deterministic, no model calls.
owns: `electron/recency/**`

### churn
Works out how often each file and each function changed over a window of days, 90 unless asked otherwise. A file gets the commits that touched it and the lines added and removed, read from git numstat along the first parent line of HEAD and followed across renames. A function gets the commits that changed its lines, found the way `git log -L` finds them: its current lines are traced back through any uncommitted edit and then one commit at a time, so each step costs only that commit's changes. Files deleted since, and older files that once had the same name, are left out, and a read that git could not finish is flagged rather than cached. Fully deterministic, no model calls.
owns: `electron/churn/**`

### daemon
Socket server, project resolution by cwd, file watching, applying proposals to architect.md (straight away, or once the engineer approves them when change review is on), answering check_change for a dependency or a proposed file, writing AGENTS.md on request and rewriting them on a contract change when the old or new contract has a generated one in place, the per project change history (a code change a Claude Code hook reported carries that hook's session id, and one nobody reported carries none), the per project record of every check_change verdict, and the guarded read, write and directory listing of project files, and answering where a new function belongs.
owns: `electron/daemon.ts`

### journal
A capped, newest first list of records per project kept as one JSON file each in the cache directory. Rows are validated against a schema on load and any that fail are dropped, and every write replaces the file whole so a crash never leaves half a list. Holds the change history, the check_change verdicts and the rule runs.
owns: `electron/journal/**`

### rules
Reads the Rules section of `architect.md`, falling back to the defaults when it is absent, and checks code against it: lines per file, code files per folder, banned words in file, class and function names, and how many unrelated groups of exported functions a file holds, two exported functions being related when one reaches the other through calls or nesting inside that file. A later rule line whose globs match a path overrides an earlier one. A proposed file is checked against the same file on disk, so only a violation that is new or worse is reported. Records every run with a pass or fail per rule in the journal. Also suggests splits, never applying them: a file over its lines or jobs limit, or over the project wide one when a later line grandfathers it, gets one file per connected group of exported functions in a folder named after it behind the same entry file, each file named after the most common leading word of its group's names or left unnamed with the tie that stopped it, and a function longer and more called than the split thresholds gets the extraction points its parse shows: compound statements, block callbacks and inner functions at the top of its body. Fully deterministic, no model calls.
owns: `electron/rules/**`

### agents
Writes an `AGENTS.md` into the folder each component's globs share, copied from `architect.md`: the component's purpose and owned globs, the components it may call with their labels, the ones it must never call with their reasons, and the rule lines that reach that folder. A component is placed only when one of its globs is exactly that folder followed by `/**` and no `!` glob carves anything out of it; one that owns only some files there, whose globs share no folder below the root, climb out with `..`, sit in a folder the scan ignores, or share a folder with another component, is reported and gets no file. It never writes through a link: not into a folder whose real path leads outside the project, and not through an `AGENTS.md` that is itself a link. Every file it writes starts with a marker line, so it only ever rewrites or deletes files carrying that marker, never one written by hand, and leaves a file untouched when its text is unchanged. Fully deterministic, no model calls.
owns: `electron/agents/**`

### where
Answers where a new function belongs, from the functions it will call and the functions or files that will call it, each named by function, file or file:name. The component is the one owning the most of those neighbours among the components whose calls to and from the new function the drawing allows, the folder is where most of its neighbours live along with whether a new file there still fits the files rule, the naming word is the leading word most function names in that folder start with, and the closest function is the one sharing the most callees, then callers. A proposed file is checked against the Rules with a stub of the function. Every part carries its counts and file:line evidence, a tie or a reference that matches nothing or several files is reported rather than picked, and a project with no `architect.md` is answered by folder only. Fully deterministic, no model calls.
owns: `electron/where/**`

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
React Flow diagram, the file tree and CodeMirror editor, the contract rail holding edits and the change history, and the live highlighting of what just changed. The Layers page draws the component matrix it is handed as a grid, outlines each cycle block, and lists a cell's calls to open them. The Functions page lists, arranges as a call tree, or focuses on one function with its callers to the left and its callees to the right, all from the call edges it is handed. The project store in `src/model/store.ts` holds the per project state and the panels subscribe to it. The shell in `src/shell` is a binary pane tree, a leaf holding one registered view or a split of two, persisted per project root.
owns: `src/**`

### cli
Headless `architect check` binary. Reads the contract, scans the code and exits nonzero when the drawing or a rule is violated, printing each rule violation with its file and line. With `--suggest` it also prints the split suggestions with their evidence. Records every run in the rule history and lists it with `--history`. `architect agents` writes the AGENTS.md files. `architect where` answers where a new function belongs.
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
- cli -> agents
- daemon -> agents
- daemon -> where
- cli -> where
- where -> types
- where -> graph
- where -> rules
- where -> functions
- agents -> types
- agents -> rules
- rules -> journal
- daemon -> types
- daemon -> graph
- daemon -> draft
- daemon -> functions
- daemon -> review
- daemon -> recency
- daemon -> layers
- cli -> layers
- layers -> types
- layers -> graph
- daemon -> churn
- churn -> types
- churn -> git
- daemon -> journal
- recency -> types
- recency -> graph
- recency -> git
- review -> types
- review -> graph
- review -> git
- functions -> types
- functions -> graph
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
- canvas -> churn : the renderer never reads git history, how often each file and function changed arrives over the preload bridge
- canvas -> review : the renderer never decides a change or reads the queue itself, pending changes and their impact arrive over the preload bridge
- bridge -> review : the hook only forwards an edit over the socket and prints the answer, the queue lives in the app
- canvas -> journal : the renderer never reads the cache directory, history and verdicts arrive over the preload bridge
- canvas -> agents : the renderer never writes AGENTS.md, the daemon writes them
- canvas -> layers : the renderer never maps calls to components or levels them, the matrix arrives over the preload bridge

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
- typescript

## Rules

- skip: `**/*.test.*`, `**/*.spec.*`
- lines: 200
- files: 5
- names: Manager, Helper, Service, Factory, Base
- jobs: 1
- split: 50 lines, 3 callers
- lines: 206 `src/view/ContractView.tsx`
- lines: 216 `electron/pty/pty.ts`, `src/view/FileTree.tsx`
- lines: 272 `electron/git/open.ts`
- lines: 279 `src/model/codemap.ts`
- lines: 328 `src/view/Inspector.tsx`
- lines: 332 `src/view/Canvas.tsx`
- lines: 339 `src/view/CodeCanvas.tsx`
- lines: 405 `electron/contract/graph.ts`
- lines: 425 `src/view/RepoPicker.tsx`
- lines: 469 `electron/github/github.ts`
- lines: 537 `electron/git/git.ts`
- lines: 597 `src/model/store.ts`
- lines: 630 `electron/scan/scan.ts`
- lines: 649 `shared/types.ts`
- lines: 653 `src/model/demo-mock.ts`
- lines: 1049 `electron/daemon.ts`
- files: 6 `scripts`
- files: 7 `shared`
- files: 9 `src/shell`
- files: 13 `src/model`
- files: 22 `src/view`
- jobs: 2 `electron/contract/history.ts`, `electron/contract/infer.ts`, `electron/draft/flow/evidence.ts`, `electron/functions/facts.ts`, `electron/functions/summary/verbs.ts`, `electron/git/diff/file.ts`, `electron/git/diff/hunks.ts`, `electron/git/diff/parse.ts`, `electron/github/github.ts`, `electron/review/change.ts`, `electron/rules/syntax.ts`, `electron/tabs.ts`, `shared/folders.ts`, `shared/recency.ts`, `src/model/buffer.ts`, `src/model/language.ts`, `src/model/recency.ts`, `src/shell/chords.ts`, `src/shell/leaderKey.ts`, `src/shell/views.ts`, `src/view/SplitDiff.tsx`, `src/view/diff/BranchBox.tsx`, `src/view/functions/Mark.tsx`, `src/view/functions/facts/Related.tsx`, `src/view/functions/facts/calls.ts`, `src/view/focus/history.ts`
- jobs: 3 `electron/app/launch.ts`, `electron/functions/scope.ts`, `electron/scan/traits.ts`, `lsp/features.ts`, `src/shell/pane-tree.ts`, `src/view/editor/trail.ts`, `src/view/segments.ts`
- jobs: 4 `electron/app/windows.ts`, `src/model/codemap.ts`, `src/model/live/recent.ts`, `src/view/editor/symbols.ts`, `src/view/functions/scope/pick.ts`
- jobs: 5 `electron/contract/graph.ts`, `electron/git/diff/changes.ts`, `src/model/layout.ts`, `src/model/live/history.ts`, `src/model/store.ts`, `src/model/tree.ts`
- jobs: 6 `src/model/review.ts`, `src/view/functions/tree/outline.ts`
- jobs: 7 `src/shell/commands.ts`
- jobs: 11 `src/model/picker.ts`
- names: Manager, Helper, Service, Factory `electron/git/diff/changes.ts`, `src/model/codemap.ts`, `src/view/functions/tree/Card.tsx`
