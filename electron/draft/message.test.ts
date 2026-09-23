import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import process from 'node:process'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import type { BranchPatch } from '../../shared/types'
import type { ClaudeOutput } from './draft'
import { body, commitMessage, pullRequest, reply, scrub, skillText } from './message'

const roots: string[] = []

function tmp(prefix: string): string {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), `architect-${prefix}-`)))
  roots.push(root)
  return root
}

function withSkill(name: string, body: string): string {
  const root = tmp('skill')
  const dir = path.join(root, '.claude', 'commands')
  fs.mkdirSync(dir, { recursive: true })
  fs.writeFileSync(path.join(dir, `${name}.md`), body)
  return root
}

function accountSkill(name: string, body: string): void {
  const dir = path.join(process.env.CLAUDE_CONFIG_DIR ?? '', 'commands')
  fs.mkdirSync(dir, { recursive: true })
  fs.writeFileSync(path.join(dir, `${name}.md`), body)
}

beforeEach(() => {
  process.env.CLAUDE_CONFIG_DIR = tmp('account')
})

function says(stdout: string, code: ClaudeOutput['code'] = 0) {
  const prompts: string[] = []
  const run = async (prompt: string): Promise<ClaudeOutput> => {
    prompts.push(prompt)
    return { code, stdout, stderr: '' }
  }
  return { run, prompts }
}

const PATCH = 'diff --git a/a.ts b/a.ts\n+++ b/a.ts\n+const a = 1\n'

const work: BranchPatch = {
  base: 'main',
  branch: 'feat/thing',
  commits: 2,
  log: 'add the thing\n',
  patch: PATCH,
}

afterAll(() => {
  for (const root of roots) fs.rmSync(root, { recursive: true, force: true })
})

describe('scrub', () => {
  it('drops a co-author trailer', () => {
    expect(scrub('add a\n\nCo-Authored-By: Someone <s@example.com>')).toBe('add a')
  })

  it('drops a generated with footer by its tooling link', () => {
    expect(scrub('add a\n\nGenerated with [Claude Code](https://claude.com/claude-code)')).toBe('add a')
  })

  it('keeps a body line that merely mentions an author', () => {
    expect(scrub('add a\n\nThe author of the file asked for this.')).toBe('add a\n\nThe author of the file asked for this.')
  })
})

describe('reply', () => {
  it('reads a bare json object', () => {
    expect(reply('{"title":"a"}')).toEqual({ title: 'a' })
  })

  it('reads a json object inside a fence', () => {
    expect(reply('here you go\n```json\n{"title":"a"}\n```\n')).toEqual({ title: 'a' })
  })

  it('has nothing to read in prose', () => {
    expect(reply('I cannot help with that request.')).toBe(null)
  })
})

describe('commitMessage', () => {
  it('splits the reply into an editable title and description', async () => {
    const claude = says('{"title":"add the parser","description":"The old one could not read a fence."}')
    const out = await commitMessage('/repo', PATCH, claude.run)

    expect(out).toEqual({
      ok: true,
      value: { title: 'add the parser', description: 'The old one could not read a fence.' },
    })
    expect(claude.prompts[0]).toContain(PATCH)
  })

  it('strips an attribution footer the model added anyway', async () => {
    const stdout = JSON.stringify({
      title: 'add the parser',
      description: 'Why it changed.\n\nCo-Authored-By: Claude <noreply@anthropic.com>',
    })
    const out = await commitMessage('/repo', PATCH, says(stdout).run)

    expect(out).toEqual({ ok: true, value: { title: 'add the parser', description: 'Why it changed.' } })
  })

  it('never calls claude when nothing is staged', async () => {
    const claude = says('{"title":"nope"}')
    const out = await commitMessage('/repo', '   \n', claude.run)

    expect(out).toEqual({ ok: false, error: { kind: 'nothing-to-draft' } })
    expect(claude.prompts).toEqual([])
  })

  it('reports an unusable reply rather than writing prose into the title', async () => {
    const out = await commitMessage('/repo', PATCH, says('I will not write that.').run)

    expect(out).toMatchObject({ ok: false, error: { kind: 'unusable' } })
  })

  it('reports an empty title as unusable', async () => {
    const out = await commitMessage('/repo', PATCH, says('{"title":"  ","description":"x"}').run)

    expect(out).toMatchObject({ ok: false, error: { kind: 'unusable' } })
  })

  it('reports a missing binary and a kill as their own kinds', async () => {
    expect(await commitMessage('/repo', PATCH, says('', 'missing').run)).toEqual({
      ok: false,
      error: { kind: 'not-installed' },
    })
    expect(await commitMessage('/repo', PATCH, says('', 'timeout').run)).toEqual({
      ok: false,
      error: { kind: 'timed-out' },
    })
  })
})

describe('body', () => {
  it('drops the yaml frontmatter a command file opens with', () => {
    expect(body('---\ndescription: do a thing\n---\n\nStep one.\n')).toBe('Step one.')
  })

  it('leaves a file that has no frontmatter alone', () => {
    expect(body('Step one.\n')).toBe('Step one.')
  })

  it('keeps a horizontal rule that is not frontmatter', () => {
    expect(body('Step one.\n\n---\n\nStep two.')).toBe('Step one.\n\n---\n\nStep two.')
  })
})

describe('skillText', () => {
  it('prefers the project copy over the account copy', async () => {
    accountSkill('pr', 'account rules')
    const root = withSkill('pr', 'project rules')

    expect(await skillText(root, 'pr')).toBe('project rules')
  })

  it('falls back to the account copy when the project has none', async () => {
    accountSkill('pr', 'account rules')

    expect(await skillText(tmp('bare'), 'pr')).toBe('account rules')
  })

  it('has nothing for a skill nobody wrote', async () => {
    expect(await skillText(tmp('bare'), 'pr')).toBe(null)
  })
})

describe('pullRequest', () => {
  it('sends the skill, the branch, the base, the log and the diff, and returns an editable title and body', async () => {
    const root = withSkill('pr', '---\ndescription: open a pr\n---\n\nTitle under 70 characters. Body in seven parts.')
    const claude = says('{"title":"feat: add the thing","body":"## What\\n\\nIt adds the thing."}')

    const out = await pullRequest(root, work, claude.run)

    expect(out).toEqual({ ok: true, value: { title: 'feat: add the thing', body: '## What\n\nIt adds the thing.' } })

    const prompt = claude.prompts[0] ?? ''
    expect(prompt).toContain('Body in seven parts.')
    expect(prompt).toContain('<branch>feat/thing</branch>')
    expect(prompt).toContain('<base>main</base>')
    expect(prompt).toContain('add the thing')
    expect(prompt).toContain(PATCH)
    expect(prompt).toContain('Do not branch, stage, commit, push, or create or edit a pull request.')
    expect(prompt.startsWith('-')).toBe(false)
    expect(prompt).not.toContain('description: open a pr')
  })

  it('says so when the account has no pr instructions, without calling claude', async () => {
    const root = tmp('no-skill')
    const claude = says('{"title":"a","body":"b"}')
    const out = await pullRequest(root, work, claude.run)

    expect(out).toEqual({ ok: false, error: { kind: 'no-skill', name: 'pr' } })
    expect(claude.prompts).toEqual([])
  })

  it('never calls claude on a branch with no commits of its own', async () => {
    const root = withSkill('pr', 'rules')
    const claude = says('{"title":"a","body":"b"}')

    const out = await pullRequest(root, { ...work, commits: 0 }, claude.run)

    expect(out).toEqual({ ok: false, error: { kind: 'nothing-to-draft' } })
    expect(claude.prompts).toEqual([])
  })

  it('strips an attribution footer from the body', async () => {
    const root = withSkill('pr', 'rules')
    const stdout = JSON.stringify({
      title: 'feat: add the thing',
      body: 'It adds the thing.\n\nGenerated with [Claude Code](https://claude.com/claude-code)',
    })

    const out = await pullRequest(root, work, says(stdout).run)

    expect(out).toEqual({ ok: true, value: { title: 'feat: add the thing', body: 'It adds the thing.' } })
  })

  it('leaves the fields empty when the reply is unusable', async () => {
    const root = withSkill('pr', 'rules')
    const out = await pullRequest(root, work, says('sorry, no').run)

    expect(out).toMatchObject({ ok: false, error: { kind: 'unusable' } })
  })
})
