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
Shells out to the git binary and returns typed results for branch, dirty state, worktrees, the remote default branch and a file at a ref. Also resolves where a GitHub repo's clone and per branch worktrees live on disk, and opens a branch by replaying it onto its upstream or by wiping and rebuilding it. No git library, no domain logic.
owns: `electron/git/**`

### github
Shells out to the gh CLI for the GitHub credential, reads the account's repos, a repo's branches and its open pull requests, and clones a repo with that credential. No token is stored by us and none crosses the preload bridge.
owns: `electron/github/**`

### draft
Asks the Claude Code binary for a first `architect.md`, from a bounded summary of the scan: one entry per top level source folder with a sample of its generated function descriptions, and candidate edges aggregated from real call refs. Also asks it for a commit title and description from a staged diff, and for a pull request title and body from the account's own `pr` instructions read off disk. Every reply is a JSON object that is parsed, scrubbed of attribution and validated before it is offered, and nothing it writes is ever submitted on its own.
owns: `electron/draft/**`

### daemon
Socket server, project resolution by cwd, file watching, the pending proposal queue, and the guarded read, write and directory listing of project files.
owns: `electron/daemon.ts`

### app
Electron lifecycle, tray and the preload bridge to the renderer. Every window is a native macOS tab in one group, holding its own pty host and a claim on at most one project root, so a project is open in at most one tab and closing a tab tears down only its terminals.
owns: `electron/main.ts`

### pty
Spawns and owns pty processes in the main process, keyed by session id, and batches their output into a single streaming channel. A session runs `tmux new-session -A -s <name derived from its cwd>` when tmux is available, so tearing the pty down detaches rather than kills, and falls back to a plain shell otherwise.
owns: `electron/pty/**`

### canvas
React Flow diagram, the file tree and CodeMirror editor, the contract rail holding edits and the approval inbox, and the ghost proposal preview. The project store in `src/model/store.ts` holds the per project state and the panels subscribe to it. The shell in `src/shell` is a binary pane tree, a leaf holding one registered view or a split of two, persisted per project root.
owns: `src/**`

### cli
Headless `architect check` binary. Reads the contract, scans the code and exits nonzero when the drawing is violated.
owns: `cli/**`

### bridge
MCP stdio server that Claude spawns. Translates tool calls into socket requests.
owns: `mcp/**`

### lsp
Language server for `architect.md` over stdio. Turns the positioned scan into diagnostics, completion, go to definition and rename for any editor.
owns: `lsp/**`

## Dependencies

- graph -> types
- daemon -> types
- daemon -> graph
- daemon -> draft
- draft -> types
- draft -> graph
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
