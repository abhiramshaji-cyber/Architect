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
Asks the connected AI CLI, through ai, for a first `architect.md`, from a bounded summary of the scan: one entry per top level source folder with a sample of its functions and their own doc comments, and candidate edges aggregated from real call refs. Also asks it for a commit title and description from a staged diff, and for a pull request title and body from the account's own `pr` instructions read off disk. Also asks it, only when the engineer clicks for it, for conventions the code follows, from the scanned file paths and function names, the components and the rules in force; a suggestion is kept only when it names files the scan found, and it carries at most one rule line. Every reply is a JSON object that is parsed, scrubbed of attribution and validated before it is offered, and nothing it writes is ever submitted on its own.
owns: `electron/draft/**`

### ai
Runs every AI prompt through a subscription CLI already signed in on the machine, Claude Code (`claude --print`) or Codex (`codex exec`), with the prompt on stdin, and never through an API key: the API key variables are stripped from every run, and a CLI signed in with an API key instead of a subscription is refused before anything is sent. Nothing runs until the engineer connects one; the provider and a model per provider are one setting, haiku and gpt-6-luna by default. Reports for each CLI whether it is installed, signed in by subscription and which models it lists, and the last run that failed, so no failure is silent.
owns: `electron/ai/**`

### functions
Lists every function in a project with facts measured from the scan (its signature as written, line count, how many functions call it, how many it calls, whether it calls itself, whether it is exported, and why it is a starting point when it is one), the author's own doc comment copied verbatim when there is one, the calls between the listed functions, and an importance from 1 to 5. Importance comes from how much of the call graph depends on the function, bucketed against the rest of the same project. Nothing is worded from a function's name. A function is a starting point only for a reason it can name: the package.json main, any target of its exports map under every condition and subpath pattern minus the subpaths it maps to null unless an exact or longer subpath names the file, `index.js` for a named package with neither main nor exports, its module field, bin or a script that runs its file, read from every package.json in the project, the Electron main, preload or renderer entry or a page script read from the vite or electron-vite build config, a preload bridge member, an MCP tool handler, an IPC handler or a CLI command, each found in the parse. Being unimported never makes a starting point, and test files never are. It also arranges the functions into a call tree for the indented outline view: starting points sit at the top, grouped by their reason and the file that declares it, each function appears once under its shallowest and most important caller, and cycles are cut. A function the parse saw used as a value instead of called (passed, stored, bound, a member of a constructed class or of an object that escapes, an export of a module loaded through `import()`, `require()` or `import.meta.glob`, with a template or concatenated path matched as a pattern, or through a namespace used as a value), or called from code outside any listed function, or exported from a package one of whose published entries maps back to no source file through its build configs or any of its tsconfig files, has callers nobody can trace, so it and what it calls go into a reach unknown bucket and are never reported unreached. So does every export of a non test file no other non test file imports and no starting point names, since a framework may load it by its path. So does every export in a package that loads a module through `import()` or `require()` with a computed path, every member of a class rendered as a JSX tag, passed as a value or registered by a decorator, and every export in a package holding .vue, .svelte, .astro or .mdx files the scan does not parse. Functions in test files and declarations without a body go there too, without pulling in the code they call. Imports resolve through every tsconfig in the folder nearest the importing file, then the root one. In a folder view a function called from outside the folder sits at the top like an uncalled one. Everything else no starting point reaches goes into the unreached bucket, each with its file:line and its caller count, none of those callers reached. Nothing is ever deleted. Given a folder inside the project it narrows all of this to the functions under that folder: importance and the tree are worked out again from only the calls between them, callers from outside the folder are counted apart, and the folders inside it come back with their function counts so the renderer can drill in. It also maps each file in scope to the component that owns it in `architect.md`, so the renderer can bucket a wide level of the tree by component. A folder that is missing or outside the project falls back to the whole project. Each list also carries the split suggestions the rules component makes for the project. Fully deterministic, no model calls, computed in one pass over the code map.
owns: `electron/functions/**`

### layers
Builds the Layers matrix: every call from a function in a file owned by one component to a file owned by another, each with the caller's and the callee's name and line, grouped into one cell per pair of components. A cell is allowed, forbidden or undrawn by the same check `architect check` applies to those calls, and a contract edge with no calls is a stale cell. Components are levelled by the longest path down the call graph from the components that call nobody, with every strongly connected group of components folded into one block on one level, so a cycle is the only thing above the diagonal. Without an `architect.md` the top level folders stand in for components. Fully deterministic, no model calls.
owns: `electron/layers/**`

### flow
Draws the static call chain from one starting point as a sequence: each call site the scan recorded, in the order it appears in the caller's source, with the file and line it sits on. Lifelines are the `architect.md` components owning each file, or the top level folders without one. A function's calls are drawn once, the first time it is reached; reaching it again is marked as drawn above, reaching one still on the chain is marked as a cycle, and nothing is looped. The depth is capped, and a call cut by the cap is marked so it can be opened one more level. A call between two components whose edge is forbidden carries the reason. A renderer call through the preload bridge is joined to the ipcMain handler registered on the channel the bridge member sends on, as one hop, when the scan found both channel names as literals; anything else that crosses a process, and dynamic dispatch, is not followed. Only a function with a starting point reason can be drawn. Fully deterministic, no model calls.
owns: `electron/flow/**`

### recency
Works out when each function and each component last changed. Each function gets the newest commit across its own lines from git blame, each component the newest change across the files it owns and the functions it covers, and lines nobody has committed yet count as the newest of all. Fully deterministic, no model calls.
owns: `electron/recency/**`

### churn
Works out how often each file and each function changed over a window of days, 90 unless asked otherwise. A file gets the commits that touched it and the lines added and removed, read from git numstat along the first parent line of HEAD and followed across renames. A function gets the commits that changed its lines, found the way `git log -L` finds them: its current lines are traced back through any uncommitted edit and then one commit at a time, so each step costs only that commit's changes. Files deleted since, and older files that once had the same name, are left out, and a read that git could not finish is flagged rather than cached. Fully deterministic, no model calls.
owns: `electron/churn/**`

### coupling
Finds pairs of files that change together with no import between them. Co-change is counted twice, apart: from git commits in a window of 1 to 36500 days, 90 unless asked, skipping commits that touch more than a set number of files, 30 unless asked; and from the change history grouped by Claude Code session, which reaches only as far back as the history keeps. Each source gives a pair its shared changes and a confidence of shared changes over the fewer changes of the two files, and a pair is kept when either source reaches the minimum shared count and confidence, 3 and 50% unless asked. A pair is dropped when either file imports the other, directly or through a file that re-exports it, as the scan resolves them. Each kept pair carries the commits and sessions it shares. Fully deterministic, no model calls.
owns: `electron/coupling/**`

### conventions
Learned conventions, optional and off unless the engineer turns them on, persisted as one setting. While off it reads no code and calls no model. When on, it measures each component (or top level folder without a contract) and offers a lines, jobs or files rule set to the largest count found there whenever every file or folder in it sits below the limit in force, with the count and the files behind it; on request it passes the AI suggestions from draft through the same checks. Every rule line, measured or suggested, is parsed by the rules syntax and audited against the code, listing the violations it would add and the ones it would lift. A suggestion is only ever added to the Rules section of `architect.md`, as its last line, when the engineer adds it, and nothing it finds reaches the Functions page or the Tree.
owns: `electron/conventions/**`

### daemon
Socket server, project resolution by cwd, file watching, applying proposals to architect.md (straight away, or once the engineer approves them when change review is on), answering check_change for a dependency or a proposed file along with its impact, writing AGENTS.md on request and rewriting them on a contract change when the old or new contract has a generated one in place, the per project change history (a code change a Claude Code hook reported carries that hook's session id, and one nobody reported carries none), the per project record of every check_change verdict, and the guarded read, write and directory listing of project files, and answering where a new function belongs.
owns: `electron/daemon.ts`
owns: `electron/watch/**`

### journal
A capped, newest first list of records per project kept as one JSON file each in the cache directory. Rows are validated against a schema on load and any that fail are dropped, and every write replaces the file whole so a crash never leaves half a list. Holds the change history, the check_change verdicts and the rule runs.
owns: `electron/journal/**`

### rules
Reads the Rules section of `architect.md`, falling back to the defaults when it is absent, and checks code against it: lines per file, code files per folder, banned words in file, class and function names, and how many unrelated groups of exported functions a file holds, two exported functions being related when one reaches the other through calls or nesting inside that file. A later rule line whose globs match a path overrides an earlier one. A proposed file is checked against the same file on disk, so only a violation that is new or worse is reported. Records every run with a pass or fail per rule in the journal. Also scores style per file for the Map: every checked file with each rule it fails and the file:line evidence, where a limit only a path specific rule line relaxes counts as a failure and is marked grandfathered, so drift stays visible. Also suggests splits, never applying them: a file over its lines or jobs limit, or over the project wide one when a later line grandfathers it, gets one file per connected group of exported functions in a folder named after it behind the same entry file, each file named after the most common leading word of its group's names or left unnamed with the tie that stopped it, and a function longer and more called than the split thresholds gets the extraction points its parse shows: compound statements, block callbacks and inner functions at the top of its body. Fully deterministic, no model calls.
owns: `electron/rules/**`

### agents
Writes an `AGENTS.md` into the folder each component's globs share, copied from `architect.md`: the component's purpose and owned globs, the components it may call with their labels, the ones it must never call with their reasons, and the rule lines that reach that folder. A component is placed only when one of its globs is exactly that folder followed by `/**` and no `!` glob carves anything out of it; one that owns only some files there, whose globs share no folder below the root, climb out with `..`, sit in a folder the scan ignores, or share a folder with another component, is reported and gets no file. It never writes through a link: not into a folder whose real path leads outside the project, and not through an `AGENTS.md` that is itself a link. Every file it writes starts with a marker line, so it only ever rewrites or deletes files carrying that marker, never one written by hand, and leaves a file untouched when its text is unchanged. Fully deterministic, no model calls.
owns: `electron/agents/**`

### where
Answers where a new function belongs, from the functions it will call and the functions or files that will call it, each named by function, file or file:name. The component is the one owning the most of those neighbours among the components whose calls to and from the new function the drawing allows, the folder is where most of its neighbours live along with whether a new file there still fits the files rule, the naming word is the leading word most function names in that folder start with, and the closest function is the one sharing the most callees, then callers. A proposed file is checked against the Rules with a stub of the function. Every part carries its counts and file:line evidence, a tie or a reference that matches nothing or several files is reported rather than picked, and a project with no `architect.md` is answered by folder only. Fully deterministic, no model calls.
owns: `electron/where/**`

### verdict
Answers check_change for a dependency or a proposed file: the drawn verdict for the edge, softened to unknown when architect.md no longer parses, and the Rules check of the proposed file, the edge answering first when both are given.
owns: `electron/verdict/**`

### impact
Works out what a change given to check_change could break before it is made. For a file and its proposed content it compares each function the scan lists, on the TypeScript syntax tree with comments, formatting and quote style ignored and with the declaration around an arrow function included, to find the functions added, changed or removed; code outside every function is compared by the top level names it declares or imports, and the files that import a changed name, directly or through a re-export, count as callers. For an edge it starts from every function the calling component owns. From there it walks the call graph backwards to every transitive caller, counted per depth, listing the nearest ones up to a fixed depth and count and saying how many it left out, adds the code outside any function that calls in as entries, then names the components those functions belong to and the test files that call them or import one of them by name. Every count carries file:line evidence, the notes are capped, and it keeps its own scan of each project, reused while no code file has changed and bounded by a timeout. Deterministic apart from that timeout, no model calls.
owns: `electron/impact/**`

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
React Flow diagram, the file tree and CodeMirror editor, the contract rail holding edits and the change history, and the live highlighting of what just changed. The Layers page draws the component matrix it is handed as a grid, outlines each cycle block, and lists a cell's calls to open them. The Flow page picks a starting point and draws the flow it is handed as a plain SVG sequence diagram, one lifeline per component and one arrow per call, opening the call site when an arrow is clicked. The Functions page lists, arranges as a call tree, or focuses on one function with its callers to the left and its callees to the right, all from the call edges it is handed. The Hotspots page plots each file or function by its lines against its commits over a 30, 90 or 365 day churn window, on log scales, and ranks the top 20 by lines over the most lines times commits over the most commits, with that formula and both maxima shown; a file opens in the editor and a function opens in Focus. The Map page is a squarified treemap of components (or top level folders when there is no contract), folders, files and functions, sized by lines of code (each file by its scanned lines, split into its functions and the lines outside them) and coloured by importance, churn, AI touched, unreached or style (the share of checked files failing a rule, with a per component breakdown of passing files over checked files and each failing file:line), with click to zoom, breadcrumbs back out and the facts on hover, laid out by a pure function and drawn on a canvas. The AI page shows whether Claude Code and Codex are installed and signed in, connects one and picks its model; function summaries on the Code page and the Inspector are always marked AI, and the Code page says when summaries are off and why. The Conventions page, off until the engineer turns it on, lists the measured conventions and, when asked, the AI suggestions, each labelled as measured or as an AI suggestion with the rule line, what it would flag or lift, and a button that adds the rule; it is the only page that shows them. The Coupling page lists the pairs it is handed with their shared commits and sessions, each file's share of its own changes and the commits and sessions behind them, and sets the window, the minimum shared count and confidence, and the bulk commit limit it asks with. The Replay page lays the git commits, the change history entries and the check_change verdicts of a 30, 90 or 365 day window (the newest 1000 commits at most) on one timeline in time order, and scrubbing or playing it lights on the Map treemap the files each step changed, or every tile of a component a contract change touched, with files changed earlier in the window faint; rejected verdicts are marks on the timeline, and when the change history or the verdict record is at its limit, the part of the timeline before its oldest kept entry is shaded. It reads only the stored git log, history and verdicts, never rescans a past revision. The project store in `src/model/store.ts` holds the per project state and the panels subscribe to it. The shell in `src/shell` is a binary pane tree, a leaf holding one registered view or a split of two, persisted per project root.
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
- daemon -> impact
- daemon -> verdict
- verdict -> types
- verdict -> graph
- verdict -> rules
- impact -> types
- impact -> graph
- impact -> functions
- impact -> where
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
- daemon -> ai
- draft -> ai
- app -> ai
- ai -> types
- daemon -> functions
- daemon -> review
- daemon -> recency
- daemon -> layers
- daemon -> flow
- flow -> types
- flow -> graph
- flow -> functions
- cli -> layers
- layers -> types
- layers -> graph
- daemon -> churn
- app -> coupling
- app -> conventions
- conventions -> types
- conventions -> rules
- conventions -> draft
- coupling -> types
- coupling -> git
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
- functions -> rules
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
- canvas -> ai : the renderer never spawns an AI CLI or reads its login, the state arrives over the preload bridge
- canvas -> functions : the renderer never ranks or arranges functions itself, the ranked list and its call tree arrive over the preload bridge
- canvas -> coupling : the renderer never counts co-changes itself, the kept pairs and their evidence arrive over the preload bridge
- canvas -> conventions : the renderer never measures conventions or writes a rule itself, both go over the preload bridge
- canvas -> recency : the renderer never reads git history, when each function and component last changed arrives over the preload bridge
- canvas -> churn : the renderer never reads git history, how often each file and function changed arrives over the preload bridge
- canvas -> review : the renderer never decides a change or reads the queue itself, pending changes and their impact arrive over the preload bridge
- bridge -> review : the hook only forwards an edit over the socket and prints the answer, the queue lives in the app
- canvas -> journal : the renderer never reads the cache directory, history and verdicts arrive over the preload bridge
- canvas -> agents : the renderer never writes AGENTS.md, the daemon writes them
- canvas -> layers : the renderer never maps calls to components or levels them, the matrix arrives over the preload bridge
- canvas -> flow : the renderer never walks the call graph, the drawn flow arrives over the preload bridge

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
- lines: 656 `src/model/demo-mock.ts`
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
- names: Manager, Helper, Service, Factory `electron/git/diff/changes.ts`, `src/model/codemap.ts`
