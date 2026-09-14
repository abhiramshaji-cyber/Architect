# Architect V1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task by task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A local Electron app for macOS and Windows with a drag and drop architecture canvas, plus an MCP server that forces Claude to read the drawn architecture and to get structural changes approved on that canvas.

**Architecture:** One TypeScript codebase, three processes. The Electron main process is a daemon that owns the graph and serves a local socket. The renderer is a React Flow canvas that renders proposals as ghost nodes. A tiny stdio MCP bridge, spawned by Claude, forwards tool calls to the daemon with its cwd. Source of truth is `architect.md` in the target repo.

**Tech Stack:** TypeScript, Electron, Vite, React, React Flow, `@modelcontextprotocol/sdk`, chokidar, vitest.

## Global Constraints

- Node 20 or later. TypeScript strict mode on. ESM throughout.
- **Only the master session edits `package.json`.** An agent that needs a dependency reports it and stops. It never runs `npm install`.
- **Every file has exactly one owner.** No agent touches a file outside its own Files block, including test files.
- `shared/types.ts` is written by the master before any agent starts and is **read only** to every agent. It is the protocol. If an agent believes it is wrong, it stops and reports rather than editing it.
- Zero prose comments. One lowercase word labelling a block, or nothing.
- No class where a function works. No Manager, Helper, Service, Factory, or Base. No interface with one implementation. No options object for one option.
- Every agent invokes `sr-eng` and `anti-bloat` before writing code and reports both gates in its final message.
- **Loop guard: if a test still fails after 3 fix attempts, the agent stops and reports the failure.** It never rewrites the test to pass, never deletes an assertion, and never widens scope to make a failure go away.
- Commit at the end of each task. Never commit on `main`.

## File ownership map

- `package.json`, `tsconfig.json`, `vite.config.ts`, `.gitignore`, `LICENSE`, `NOTICE` belong to the master: build and legal.
- `shared/types.ts` belongs to the master: the wire protocol and the domain types.
- `electron/graph.ts`, `electron/graph.test.ts` belong to Task 1: parse, serialize, and query `architect.md`.
- `mcp/bridge.ts`, `mcp/bridge.test.ts` belong to Task 2: MCP stdio server to socket client.
- `src/main.tsx`, `src/App.tsx`, `src/Canvas.tsx`, `src/index.css` belong to Task 3: canvas, sidebar, approval inbox, ghost preview.
- `electron/daemon.ts`, `electron/daemon.test.ts`, `electron/main.ts`, `electron/preload.ts` belong to Task 4: socket server, project resolution, proposal queue, app lifecycle.
- `architect.md`, `README.md`, `CONTRIBUTING.md` belong to the master: dogfood and repo surface.

No two entries share a file. Tasks 1, 2 and 3 have no dependency on each other and run in parallel. Task 4 depends on Task 1.

---

## Task 0: Scaffold and protocol (master, no subagent)

**Files:**
- Create: `package.json`, `tsconfig.json`, `vite.config.ts`, `.gitignore`, `LICENSE`, `NOTICE`, `shared/types.ts`

This task exists so that the three parallel agents compile against a fixed protocol and never race on configuration.

`shared/types.ts` in full:

```ts
export type Component = {
  id: string
  purpose: string
  owns: string
  position: { x: number; y: number }
}

export type Edge = { from: string; to: string }

export type Forbidden = { from: string; to: string; reason: string }

export type Architecture = {
  title: string
  summary: string
  components: Component[]
  edges: Edge[]
  forbidden: Forbidden[]
  packages: string[]
}

export type Proposal =
  | { kind: 'component'; id: string; purpose: string; owns: string }
  | { kind: 'edge'; from: string; to: string }
  | { kind: 'package'; name: string; component: string }
  | { kind: 'file'; path: string }

export type Pending = {
  id: string
  projectRoot: string
  proposal: Proposal
  rationale: string
  createdAt: number
}

export type Verdict =
  | { status: 'allowed' }
  | { status: 'forbidden'; reason: string }
  | { status: 'unknown' }

export type Decision =
  | { status: 'approved' }
  | { status: 'rejected'; reason: string }
  | { status: 'pending'; id: string }

export type Request =
  | { id: string; op: 'get_architecture'; cwd: string }
  | { id: string; op: 'check_change'; cwd: string; from: string; to: string }
  | { id: string; op: 'propose_change'; cwd: string; proposal: Proposal; rationale: string }
  | { id: string; op: 'await_proposal'; cwd: string; proposalId: string }

export type Response =
  | { id: string; ok: true; result: unknown }
  | { id: string; ok: false; error: string }

export const SOCKET_PATH =
  process.platform === 'win32'
    ? '\\\\.\\pipe\\architect'
    : `${process.env.HOME}/.architect/sock`

export const PROPOSAL_TIMEOUT_MS = 5 * 60 * 1000
```

- [ ] **Step 1:** Write the files above, run `npx tsc --noEmit`, commit as `chore: scaffold and wire protocol`.

---

## Task 1: The graph core

**Files:**
- Create: `electron/graph.ts`, `electron/graph.test.ts`

**Interfaces:**
- Consumes: every type in `shared/types.ts`.
- Produces, and Task 4 depends on these exact signatures:

```ts
export function parse(markdown: string): Architecture
export function serialize(architecture: Architecture): string
export function check(architecture: Architecture, from: string, to: string): Verdict
export function apply(architecture: Architecture, proposal: Proposal): Architecture
```

**The grammar of `architect.md`.** Parsing is fully deterministic. No model call anywhere in this file.

- The first `# ` heading is `title`. The first non empty paragraph after it is `summary`.
- Under `## Components`, each `### <id>` opens a component. The next non empty line that does not start with `owns:` is `purpose`. The line starting with `owns:` carries the glob, in backticks.
- Under `## Dependencies`, each `- a -> b` is an edge.
- Under `## Forbidden`, each `- a -> b : reason` is a forbidden edge.
- Under `## Packages`, each `- name` is an approved package.
- A trailing `<!-- architect:layout` block holds `id: x,y` lines, one per component.

**Correctness requirements, all of which need a test.** These are the input regions where a naive parser silently corrupts the architecture:

- An edge or forbidden entry naming a component that does not exist throws with the offending id in the message. Silently dropping it would let Claude read an architecture that is missing a constraint.
- A duplicate `### id` throws.
- A component absent from the layout block gets a deterministic fallback position rather than `undefined`, so the canvas never renders a node at NaN.
- `check` returns `forbidden` when a forbidden entry matches, `allowed` when an edge matches, and `unknown` otherwise. Forbidden is checked before allowed, so an entry in both is refused.
- `check` on an unknown component id returns `unknown`, never `allowed`.
- `serialize(parse(x))` round trips: parsing the output yields a deeply equal `Architecture`. This is the test that protects every future edit to the format.
- `apply` is pure and returns a new object. It never mutates its input.
- `apply` of a duplicate component or a duplicate edge is a no op rather than an error, so a double approve cannot corrupt the file.

- [ ] **Step 1:** Write `electron/graph.test.ts` covering every bullet above, including a fixture `architect.md` string that uses all five sections.
- [ ] **Step 2:** Run `npx vitest run electron/graph.test.ts`. Expected: fail, `parse is not a function`.
- [ ] **Step 3:** Implement `electron/graph.ts` with the four exported functions and nothing else.
- [ ] **Step 4:** Run `npx vitest run electron/graph.test.ts`. Expected: all pass.
- [ ] **Step 5:** Commit as `feat: architect.md parser, serializer and graph query`.

---

## Task 2: The MCP bridge

**Files:**
- Create: `mcp/bridge.ts`, `mcp/bridge.test.ts`

**Interfaces:**
- Consumes: `Request`, `Response`, `SOCKET_PATH`, `Verdict`, `Decision`, `Proposal` from `shared/types.ts`.
- Produces: an executable entry point. Claude spawns it as `architect mcp`.

The bridge is a thin translator and holds no domain logic. It exposes exactly four MCP tools and maps each to one `Request` over the socket, tagging every call with `process.cwd()`.

- `get_architecture` maps to op `get_architecture`.
- `check_change` takes `from` and `to`, maps to op `check_change`.
- `propose_change` takes a `Proposal` and a `rationale`, maps to op `propose_change`.
- `await_proposal` takes `proposalId`, maps to op `await_proposal`.

**Correctness requirements, each needing a test against a fake socket server:**

- Requests and responses are newline delimited JSON. A response arriving split across two TCP chunks is still parsed correctly, and two responses arriving in one chunk are both delivered. Buffer by newline, never assume one chunk is one message.
- Responses are matched to requests by `id`. Out of order responses go to the right caller, because `propose_change` can block for minutes while a `check_change` issued later returns immediately.
- If the daemon is not running, the tool returns a clear instruction to open the Architect app. It does not throw an unhandled connection error.
- If the socket drops while a call is in flight, that call rejects rather than hanging forever.

- [ ] **Step 1:** Write `mcp/bridge.test.ts` with a fake `net` server asserting the four behaviours above.
- [ ] **Step 2:** Run `npx vitest run mcp/bridge.test.ts`. Expected: fail.
- [ ] **Step 3:** Implement `mcp/bridge.ts`.
- [ ] **Step 4:** Run `npx vitest run mcp/bridge.test.ts`. Expected: all pass.
- [ ] **Step 5:** Commit as `feat: mcp stdio bridge`.

---

## Task 3: The canvas

**Files:**
- Create: `src/main.tsx`, `src/App.tsx`, `src/Canvas.tsx`, `src/index.css`

**Interfaces:**
- Consumes: `Architecture`, `Component`, `Edge`, `Pending`, `Proposal` from `shared/types.ts`.
- Consumes this preload API, which Task 4 implements. Declare it and code against it. Do not implement it.

```ts
declare global {
  interface Window {
    architect: {
      projects(): Promise<{ root: string; title: string }[]>
      open(root: string): Promise<Architecture>
      pending(): Promise<Pending[]>
      decide(id: string, approved: boolean, reason?: string): Promise<void>
      move(id: string, x: number, y: number): Promise<void>
      onChange(fn: (a: Architecture) => void): void
      onPending(fn: (p: Pending[]) => void): void
    }
  }
}
```

**What it renders:**

- A left sidebar listing registered projects, and below it the approval inbox.
- A React Flow canvas of the open project. A node shows the component id, its purpose, and its glob. An edge is a directed line.
- Dragging a node calls `move`. Positions come from the architecture, never from local state alone, so an external edit to `architect.md` moves the node.
- **Ghost preview, the heart of the feature.** For every pending proposal, the canvas renders the change in place, before any decision:
  - a `component` proposal draws a dashed ghost node at a free position
  - an `edge` proposal draws a dashed edge between the two real nodes
  - a `package` proposal draws a badge on the owning component
  - a `file` proposal draws a dashed ghost attached to the component whose glob matches, or floating unattached when no glob matches, which is itself the signal that nothing owns it
- **Cycle warning.** If an `edge` proposal would introduce a cycle, the edges forming that cycle render in red and the inbox entry says so. This is the one piece of analysis the canvas does itself, because it is the thing a human cannot see at a glance.
- Approve and Reject buttons per pending item. Reject opens a one line reason field and sends it.

**Correctness requirements:**

- The canvas renders with zero projects, with a project of zero components, and with a pending proposal referencing a component that no longer exists. None of these may throw.
- Ghost elements are never persisted and never submitted as real nodes.

- [ ] **Step 1:** Build the components against the declared `window.architect` API, with a local mock in dev so the UI runs standalone.
- [ ] **Step 2:** Run `npx tsc --noEmit`. Expected: clean.
- [ ] **Step 3:** Run `npx vite build`. Expected: succeeds.
- [ ] **Step 4:** Commit as `feat: canvas, inbox and ghost proposal preview`.

---

## Task 4: The daemon and app lifecycle

**Depends on Task 1.** Do not start until `electron/graph.ts` is committed.

**Files:**
- Create: `electron/daemon.ts`, `electron/daemon.test.ts`, `electron/main.ts`, `electron/preload.ts`

**Interfaces:**
- Consumes: `parse`, `serialize`, `check`, `apply` from `electron/graph.ts`, every type from `shared/types.ts`.
- Produces: the `window.architect` API declared in Task 3, implemented over Electron IPC in `preload.ts`.

**`daemon.ts` responsibilities:**

- Listen on `SOCKET_PATH`. On macOS, unlink a stale socket file before binding, or a crashed previous run makes the app permanently unstartable.
- Resolve a `cwd` to a project by walking up parent directories for `architect.md`, stopping at the filesystem root. An unresolvable cwd returns a clear error telling Claude no architecture is defined there.
- Watch each open `architect.md` with chokidar, reparse on change, and push the new architecture to the renderer.
- Hold a queue of pending proposals. `propose_change` registers one, notifies the renderer, and waits. On approve it calls `apply`, writes `serialize` output to disk, and resolves approved. On reject it resolves rejected with the reason. After `PROPOSAL_TIMEOUT_MS` it resolves pending with the id, leaving the proposal live in the queue for `await_proposal`.

**Correctness requirements, each needing a test:**

- A `check_change` arriving while a `propose_change` is blocked is answered immediately. The daemon is never blocked by a pending proposal.
- The same proposal id can be awaited twice without duplicating it.
- A write to `architect.md` triggered by an approval does not fire the watcher back into a reparse loop. Ignore the next change event for a file the daemon itself just wrote.
- Two proposals for the same edge collapse into one pending entry rather than queueing twice.
- A malformed `architect.md` reports a parse error to the renderer and leaves the previous good architecture in place, rather than blanking the canvas mid edit while the engineer is typing.
- A client disconnecting mid proposal does not leave the queue holding a dead entry forever.

**`main.ts` responsibilities:** create the window, start the daemon, add a tray icon showing the pending count, and offer launch on login. Nothing else.

- [ ] **Step 1:** Write `electron/daemon.test.ts` covering the six bullets above, driving a real socket against a temp directory fixture.
- [ ] **Step 2:** Run `npx vitest run electron/daemon.test.ts`. Expected: fail.
- [ ] **Step 3:** Implement `electron/daemon.ts`.
- [ ] **Step 4:** Run `npx vitest run electron/daemon.test.ts`. Expected: all pass.
- [ ] **Step 5:** Implement `electron/main.ts` and `electron/preload.ts`.
- [ ] **Step 6:** Commit as `feat: daemon, project resolution and app lifecycle`.

---

## Task 5: Dogfood and repo surface (master)

**Files:**
- Create: `architect.md`, `CONTRIBUTING.md`
- Modify: `README.md`

- [ ] **Step 1:** Write `architect.md` describing Architect itself, with the five components from the ownership map and the real edges between them. This is the demo and the integration fixture.
- [ ] **Step 2:** Launch the app, confirm it renders its own architecture, register the MCP server, and drive one real `propose_change` from Claude end to end through approval.
- [ ] **Step 3:** Write the README and CONTRIBUTING with the DCO sign off instruction.
- [ ] **Step 4:** Commit and open the pull request.

---

## Not built in V1

Named so they do not creep in: no import parsing or verification of source against the diagram, no semantic `where_does_this_go`, no drift report, no decision log, no cloud or accounts, no PNG export, no theming, no plugin API, no state management library, no ORM, no HTTP server.
