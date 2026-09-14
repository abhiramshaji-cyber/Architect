# Contributing

Thanks for looking. Architect is early and the design questions are still open, so ideas are as welcome as code.

## Before you write code

Open an issue first if the change is structural. Architect is a tool about not letting structure drift, so it would be strange to let its own structure drift.

The repo describes itself in [`architect.md`](architect.md). Read it before you start. If your change adds a component, an edge, a dependency or a file outside every glob, update `architect.md` in the same pull request. A pull request that changes the shape of the system without changing the diagram will be sent back.

## Standards

- TypeScript strict. ESM. Node 20 or later.
- Native built ins and the standard library before anything hand rolled.
- A pure function beats a class. No Manager, Helper, Service, Factory or Base. No interface with one implementation. No options object for one option.
- Zero prose comments. One lowercase word labelling a block, or nothing. The exceptions are a genuine landmine, a guard against a library bug, or a tooling directive.
- Tests for anything with branches. The parser and the daemon in particular: they are where a silent bug corrupts someone's architecture.

## Developing

```bash
npm install
npm run dev        # electron app with hot reload
npm test           # vitest
npm run typecheck
```

## Sign your commits

Architect uses the Developer Certificate of Origin. You keep the copyright on your own work. Signing off certifies you have the right to contribute it.

```bash
git commit -s -m "your message"
```

That adds a `Signed-off-by` line. Commits without it cannot be merged.

## Pull requests

One concern per pull request. Explain what changed and why in plain language, not in terms only someone who already read the diff would follow. If it changes the UI, include a screenshot.
