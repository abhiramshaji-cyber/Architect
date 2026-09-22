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
Shells out to the git binary and returns typed results for branch, dirty state, worktrees, the remote default branch and a file at a ref. No git library, no domain logic.
owns: `electron/git/**`

### daemon
Socket server, project resolution by cwd, file watching and the pending proposal queue.
owns: `electron/daemon.ts`

### app
Electron lifecycle, window, tray and the preload bridge to the renderer.
owns: `electron/main.ts`

### canvas
React Flow diagram, project sidebar, approval inbox and the ghost proposal preview. The project store in `src/model/store.ts` holds the per project state and the panels subscribe to it. The shell in `src/shell` is a binary pane tree, a leaf holding one registered view or a split of two, persisted per project root.
owns: `src/**`

### bridge
MCP stdio server that Claude spawns. Translates tool calls into socket requests.
owns: `mcp/**`

## Dependencies

- graph -> types
- daemon -> types
- daemon -> graph
- app -> types
- app -> daemon
- canvas -> types
- bridge -> types

## Forbidden

- canvas -> graph : the renderer never parses architect.md, it receives an Architecture over IPC
- canvas -> daemon : the renderer reaches the daemon only through the preload bridge in app
- bridge -> graph : the bridge holds no domain logic, it only translates and forwards
- bridge -> daemon : they communicate over the socket, never by import

## Packages

- @modelcontextprotocol/sdk
- @xyflow/react
- chokidar
- react
- react-dom
- electron
