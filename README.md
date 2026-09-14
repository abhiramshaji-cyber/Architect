<div align="center">

# Architect

**Draw your architecture. Make your AI follow it.**

Coding agents generate structure faster than anyone reviews it. Architect puts the engineer back in control: you draw the system, the agent has to read it, and every structural change it wants comes back to you for approval on the canvas.

[![License](https://img.shields.io/badge/license-Apache--2.0-blue.svg)](LICENSE)
[![MCP](https://img.shields.io/badge/MCP-server-8A2BE2.svg)](https://modelcontextprotocol.io)

</div>

---

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
        -> UNKNOWN            no such component, it has to ask you

claude: propose_change({ kind: 'component', id: 'search', ... })
        -> blocks
```

At that moment a dashed ghost node appears on your canvas, sitting exactly where the new component would live, with its edges drawn in. If it would create a cycle, the cycle lights up red. You approve or reject in one click, and the blocked call returns.

**You never approve a text diff. You approve a picture of your system with the change in it.**

## What needs your approval

- **A new component.** The largest source of sprawl.
- **A new edge.** How a clean graph quietly becomes a mesh.
- **A new third party package.** The bloatware vector.
- **A file outside every glob.** Sprawl that never shows up as an import.

## The file

Everything lives in one `architect.md` at your repo root. It is readable with no tooling, diffs cleanly, and gets reviewed in a pull request like any other file. Layout positions hide in an HTML comment so they never pollute the prose.

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

Architect ships with its own [`architect.md`](architect.md) describing Architect. It is the demo, the test fixture, and the proof the tool survives contact with itself.

## Install

Coming with the first release. Architect is an installed desktop app for macOS and Windows, not a browser tab, because it runs in your tray and has to answer the agent the moment it asks.

```json
{
  "mcpServers": {
    "architect": { "command": "architect-mcp" }
  }
}
```

One line, and every project you register is covered. The bridge sends its working directory with each call, so Architect resolves the right repo automatically.

## Status

V1 is in active development. It is deliberately small:

**In:** the canvas, the four gated operations, ghost previews, cycle detection, multi project, and the four MCP tools that close the read plus approve loop.

**Out, on purpose:** no import verification yet, no drift report, no decision log, no cloud, no accounts. Those are V2, and they are tracked as issues.

## Contributing

Ideas are wanted, especially on the open design questions in the issues. See [CONTRIBUTING.md](CONTRIBUTING.md).

## License

Apache 2.0, copyright Abhiram Shaji. Contributions under DCO.
