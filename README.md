<div align="center">

# Architect

**Draw your architecture. Make your AI follow it.**

Coding agents generate structure faster than anyone reviews it. Architect puts the engineer back in control: you draw the system, the agent has to read it, and every structural change it makes lands on your canvas live, highlighted as it arrives and kept in a history.

[![License](https://img.shields.io/badge/license-Apache--2.0-blue.svg)](LICENSE)
[![MCP](https://img.shields.io/badge/MCP-server-8A2BE2.svg)](https://modelcontextprotocol.io)

</div>

---

## What you get

Open a project and Architect starts on **Functions**. Every page reads the same parse of the repo, its git history and `architect.md`.

### Functions

Every function in the repo, as a **List**, a **Tree** or a **Focus** view. Each card shows only facts: the signature, `file:line`, the line count, callers and callees, whether it is exported, and the author's own doc comment when there is one. Nothing on this page or in the Tree is written by a model or guessed from a name.

- **Importance** is a score from 1 to 5: PageRank over the call graph, plus fan in, whether the function is exported, and whether it is a starting point.
- **List.** Sort by importance, lines, name or most recent change, and filter by name, file or doc comment. It also shows the split suggestions read from the parse: how to split a file over the `lines` or `jobs` rule, and where to cut a long function with many callers.
- **Tree.** An indented outline that grows down the page. It starts from **named starting points**: functions with a stated reason, such as an MCP tool, an IPC handler, a CLI command, an Electron entry, or a `bin`, `main`, `exports`, `module` or `script` entry in any `package.json`. In a folder view, a function with no callers or called from outside the folder also sits at the top. A level with more than 12 cards folds into counted buckets by component, folder, file or name range. Below half zoom each card becomes a pill with its name and one count.
- **Focus.** One function in the middle, its callers on the left and its callees on the right. Click any of them to move the focus, and step back and forward through the trail.

The Tree ends with two buckets:

- **Reach unknown.** Functions the parse cannot trace, each with the fact why: used as a value, in a test file, exported by a package entry not mapped to source, and so on. They are kept out of the dead code list.
- **Not reached from a starting point.** Functions no starting point reaches through calls. This is the dead code list.

### Map

A treemap of the repo by component (top level folder when there is no `architect.md`), folder, file and function, each tile sized by its lines. The same layout can be coloured five ways:

- **Importance**, from the Functions score.
- **Churn**, commits in the last 90 days.
- **AI touched**, files a Claude Code session added or changed.
- **Unreached**, code no starting point reaches.
- **Style**, the share of files failing a rule in `architect.md`. A side panel scores each component and lists every failing `file:line`. A limit that only a path specific line relaxes still counts as a failure.

Click a tile to zoom in, hover it for its facts.

### Layers

A matrix of the real calls between components, levelled so leaves sit at the top. Each cell is checked against the contract: allowed, forbidden, undrawn, or a stale edge with no calls or imports behind it. Components that call each other are outlined as a cycle. Click a cell to list every call with its `file:line`. Without `architect.md`, the rows are the top level folders.

### Flow

Pick a starting point and Flow draws its call chain as a sequence diagram, three levels deep by default. Open any cut branch with `+`, and click an arrow to open the call site.

### Hotspots

Lines against commits for every file or function, on log scales, over 30, 90 or 365 days. The score is `(lines ÷ most lines) × (commits ÷ most commits)`, printed above the chart, and the top 20 are listed.

### Coupling

Pairs of files that keep changing together but never import each other, directly or through a re export. Each pair shows its shared commits and Claude Code sessions, with the evidence one click away. The thresholds are fields on the page.

### Replay

A timeline of commits and recorded changes over 30, 90 or 365 days, played across the Map. Each step lights the files it changed, and `check_change` verdicts that rejected something are marked in red.

### Conventions

Off by default. Nothing is counted and no model is called until you turn it on. Then it shows:

- **Measured** conventions, counted from the parse: a component (or top level folder without `architect.md`) whose files all sit below a limit gets a tighter rule line that would hold them there.
- **AI suggestions**, only when you click **Suggest with AI**. Claude Code is asked, files the scan did not find are removed from each suggestion, and a suggestion left with none is dropped.

Every card is labelled Measured or AI suggestion, and nothing is added to `architect.md` until you click **Add to Rules**.

### The rest

**Contract** is the architecture you drew, as boxes and arrows. **Code** reads the repo folder by folder down to the calls inside a file. **Review**, **Diff**, **Files**, **Terminal** and **Shell** sit beside them.

Architect never drafts an `architect.md` on its own. **Draft with Claude** on the Contract page does it when you ask.

## The problem

Left alone, an agent invents a new service, a new util layer, a new dependency and a new folder nobody asked for. Each one is defensible on its own. Together they are how a clean codebase becomes unreviewable in a week.

Telling the agent "follow the architecture" in a prompt does not hold. Prompts are advice. Architect makes it a gate.

## How it works

You draw the architecture once, as boxes and arrows. Each box claims part of the repo with a glob, which is what turns a drawing into a contract.

Then the agent has to live inside it:

```
claude: check_change({ from: 'api', to: 'billing' })
        -> ALLOWED            the edge is drawn, answered instantly, you are not interrupted

claude: check_change({ from: 'ui', to: 'db' })
        -> FORBIDDEN          "the ui goes through api, it never touches the database directly"

claude: check_change({ from: 'api', to: 'search' })
        -> UNKNOWN-COMPONENT  'search' is not on the canvas, it proposes the component

claude: propose_change({ kind: 'component', id: 'search', ... })
        -> APPROVED           written to architect.md at once

claude: check_change({ from: 'ui', to: 'billing' })
        -> UNDRAWN-EDGE       both components exist, no edge between them, it proposes the edge

claude: propose_change({ kind: 'edge', from: 'ui', to: 'billing', ... })
        -> APPROVED           written to architect.md at once
```

By default there is no approval step (turn on [change review](#change-review) if you want one). The change lands in `architect.md` immediately and shows up on your canvas as it happens, with new components and edges highlighted as they arrive. Every change, to the contract or to the code, is kept in a history you can scroll back through. A change that would close a cycle, name an unknown component or cross a forbidden rule is rejected with the reason, and the file is left alone.

**You never read a text diff. You watch a picture of your system change.**

Every `check_change` answer also carries the impact of the change, worked out from the scan with no model call: the functions it adds, changes or removes, their callers at each depth, the entry code that reaches them (such as an MCP tool or an IPC handler), the components they belong to, and the test files that reach them, each with `file:line` evidence. A slow scan is cut at a time limit and says so.

## Change review

Change review is off by default. Turn it on with the **Review** switch in the status bar, or **Toggle change review** in the command palette (Space), and Claude has to wait for you:

- Every `propose_change` waits in Architect instead of being written. Proposals that would close a cycle, name an unknown component or cross a forbidden rule are still rejected at once, without bothering you.
- Every `Edit`, `Write` and `MultiEdit` Claude Code makes to a file inside a project open in Architect waits too, through a `PreToolUse` hook.

The **Review** tab lists what is waiting. For each change it shows where it lands on the architecture (new components and edges dashed, removed ones struck through in red, and the component that owns an edited file highlighted), which functions in that file are added, removed or changed and how many other functions call them, and the before and after diff. You can **Approve**, **Deny**, or **Suggest a better way**: what you type goes back to Claude as the reason, so it can try again your way.

A contract proposal nobody answers in 5 minutes comes back to Claude as pending with an id it can keep waiting on with `await_proposal`, and pending proposals survive a restart in `~/.architect/pending.json`. A code edit nobody answers in 9 minutes falls back to Claude Code's own permission prompt. The setting lives in `~/.architect/settings.json`. When review is off, or Architect is not running, or the file is outside every open project, the hook exits at once with no output and Claude Code behaves exactly as it does without Architect.

## What shows up on the canvas

- **A new component.** The largest source of sprawl.
- **A new edge.** How a clean graph quietly becomes a mesh.
- **A new third party package.** The bloatware vector.
- **A file outside every glob.** Sprawl that never shows up as an import.

## The file

Everything lives in one `architect.md` at your repo root. It is readable with no tooling, diffs cleanly, and gets reviewed in a pull request like any other file. The prose above the fold is the whole contract: everything the tool enforces is spelled out in it.

```markdown
## Components

### api

HTTP layer, request validation, auth.
owns: `src/api/**`

## Dependencies

- api -> billing

## Forbidden

- ui -> db : the ui goes through api, it never touches the database directly
```

Node positions trail the document in an HTML comment, one `id: x,y` per line. They are a hint and nothing else. Anything the block cannot answer for, the graph lays out automatically, so deleting the block or garbling it costs you an arrangement and never a file.

```markdown
<!-- architect:layout
api: 320,40
billing: 320,220
-->
```

An optional `## Rules` section sets code standards that `architect check` and `check_change` enforce. Without it the defaults below apply; with it, any rule it leaves out keeps its default.

```markdown
## Rules

- skip: `**/*.test.*`, `**/*.spec.*`
- lines: 200
- files: 5
- names: Manager, Helper, Service, Factory, Base
- jobs: 1
- split: 50 lines, 3 callers
- lines: 600 `src/legacy/big.ts`
- names: off `vendor/**`
```

- `lines` is the most lines one code file may have.
- `files` is the most code files one folder may hold. Its globs match folder paths, with `.` for the repo root.
- `names` lists words no file, class or function name may contain as a whole word, so `UserService` and `baseUrl` break it but `Database` does not.
- `jobs` is how many unrelated groups of exported top level functions one file may hold. Two exported functions are related when one reaches the other through calls inside that file, through a function they both call, or by nesting.
- `split` sets when a function gets a suggestion of where to cut it: more lines than the first number and at least as many callers as the second. It only suggests and never fails a check.
- `skip` lists files no rule looks at, and they do not count toward a folder. Declaring it replaces the default.

Any rule can be `off`. Backticked globs after the value limit a line to those paths, and the last line that matches a path wins, so a file that already breaks a rule can get its own limit while new code is held to the default. `check_change` given a `file` and its full proposed `content` rejects a change only when it adds a violation or makes one worse, naming the rule, the file and the line. Every check records a pass or fail per rule, which `architect check --history` lists.

`architect agents` (or the `write_agents` MCP tool) writes an `AGENTS.md` into the folder each component's globs share, so an agent editing that folder reads its contract without calling a tool: what the component owns, what it may call, what it must never call and why, and the rule lines that reach that folder. Everything in it is copied from `architect.md`. A component gets a file only when one of its globs takes in that whole folder (`src/api/**`); one that owns only some files in a folder, or shares its folder with another component, is listed instead of guessed. Each file starts with a marker comment: only files carrying it are ever rewritten or deleted, a hand written `AGENTS.md` is left alone, and a run with an unchanged contract writes nothing. Once a project has generated files, Architect rewrites them whenever `architect.md` changes and deletes the ones for removed components.

`architect where` (or the `where` MCP tool) answers where a new function belongs before it is written. Pass the functions it will call and the ones that will call it, plus an optional name and file. It returns the component that owns most of those neighbours and that `architect.md` allows, the folder most of them live in, whether a new file there fits the `files` rule, the leading word most names in that folder start with, and the most similar function to copy. Every answer comes from the scan and `architect.md` with counts and `file:line` evidence, and no model is called.

`architect check --suggest` adds split suggestions to the check: for a file over the `lines` or `jobs` rule, a folder of files behind the same entry file, one per group of related exported functions; for a function over the `split` threshold, the points in its body where it can be cut.

Architect ships with its own [`architect.md`](architect.md) describing Architect. It is the demo, the test fixture, and the proof the tool survives contact with itself.

## Install

Architect is an installed desktop app for macOS and Windows, not a browser tab, because it runs in your tray and has to answer the agent the moment it asks.

Until the first packaged release, build and install it from source:

```bash
npm install
npm run install:local
```

That installs the app and writes the MCP bridge to `~/.architect/bin/architect-mcp.mjs`, outside the app bundle, because Node cannot execute a file inside `app.asar`. If that file is missing, `npm run install:local` has not run yet and no client can reach Architect.

For Claude Code, the install also registers the bridge (`claude mcp add --scope user architect`) when the `claude` CLI is present, and merges three hooks into `~/.claude/settings.json`: `SessionStart`, `PostToolUse` on `Edit|Write|MultiEdit|NotebookEdit`, and `PreToolUse` on `Edit|Write|MultiEdit` with a 600 second timeout for [change review](#change-review). All three run `node ~/.architect/bin/architect-mcp.mjs hook`. Existing hooks are kept and reinstalling never duplicates them. With these in place every Claude Code session opens an Architect tab bound to the folder it works in (or the matching folder of a worktree it edits), and that tab rescans and marks each edited file live. The hook exits at once and stays silent when Architect is not running.

Other clients register the bridge by hand.

Claude Code, if the CLI was not on your PATH during install:

```bash
claude mcp add --scope user architect -- node ~/.architect/bin/architect-mcp.mjs
```

Claude Desktop, merged into `claude_desktop_config.json`, then restart it. Neither it nor Codex expands `~`, so write the absolute path:

```json
{
  "mcpServers": {
    "architect": {
      "command": "node",
      "args": ["/Users/you/.architect/bin/architect-mcp.mjs"]
    }
  }
}
```

Codex, appended to `~/.codex/config.toml`:

```toml
[mcp_servers.architect]
command = "node"
args = ["/Users/you/.architect/bin/architect-mcp.mjs"]
```

One registration covers every repo. The bridge sends its working directory with each call, and Architect walks up from there to find `architect.md`, so the right project resolves automatically. A repo with no `architect.md` gets a clear error rather than silently passing.

The app must be running for the bridge to reach it. It launches at login and lives in your tray.

## Editing architect.md

`npm run build` also produces a language server at `out/lsp/server.js`. Point any LSP client at it and `architect.md` gets diagnostics as you type, completion of component ids on dependency and forbidden lines, go to definition from an edge endpoint to the component that defines it, and rename across every reference including the layout hint.

The server speaks stdio and needs the `--stdio` flag:

```bash
node /path/to/architect/out/lsp/server.js --stdio
```

In Neovim that is `vim.lsp.start({ cmd = { 'node', '/path/to/architect/out/lsp/server.js', '--stdio' }, filetypes = { 'markdown' } })`. In VS Code it is the `serverOptions.command` of a `LanguageClient`. The server only answers for a document named `architect.md`, so pointing it at markdown in general is safe.

## Status

V1 is in active development. No cloud, no accounts: everything runs on your machine, from your repo, its git history and `architect.md`.

## Feedback

I would like to hear what worked and what did not. Reply in the [feedback discussion](https://github.com/abhiramshaji-cyber/Architect/discussions/209), or fill in the short [feedback form](https://github.com/abhiramshaji-cyber/Architect/issues/new?template=feedback.yml).

## Contributing

Ideas are wanted, especially on the open design questions in the issues. See [CONTRIBUTING.md](CONTRIBUTING.md).

## License

Apache 2.0, copyright Abhiram Shaji. Contributions under DCO.
