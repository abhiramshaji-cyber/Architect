# Architecture

Architect is a drag and drop architecture canvas with an MCP server that makes the drawn architecture binding on a coding agent.

## Components

### types
The wire protocol and the domain types, shared by all three processes.
owns: `shared/**`

### graph
Parses, serializes and queries `architect.md`. Fully deterministic, no model calls.
owns: `electron/graph.ts`

### daemon
Socket server, project resolution by cwd, file watching and the pending proposal queue.
owns: `electron/daemon.ts`

### app
Electron lifecycle, window, tray and the preload bridge to the renderer.
owns: `electron/main.ts`

### canvas
React Flow diagram, project sidebar, approval inbox and the ghost proposal preview.
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

<!-- architect:layout
types: 400,40
graph: 60.77579000432593,-84.84003856319958
daemon: 350.8004671443859,593.4854357014382
app: 237.3683815123985,408.85239644200664
canvas: 620,320
bridge: 620,180
-->
