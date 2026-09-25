import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import process from 'node:process'
import type { BranchPatch, CommitDraft, DraftFailure, DraftResult, PullDraft } from '../../shared/types'
import { type ClaudeOutput, type ClaudeRun, runClaude } from './draft'

const TIMEOUT_MS = 3 * 60 * 1000
const MAX_STDERR = 400
const MAX_PATCH = 400 * 1024
const MAX_LOG = 40 * 1024

const ATTRIBUTION = /^(?:co-authored-by|authored-by|assisted-by|generated-by|generated-with)\s*:/i
const TOOL_URL = /claude\.(?:ai|com)\/(?:code|claude-code)/i

export function scrub(text: string): string {
  return text
    .split('\n')
    .filter((line) => !ATTRIBUTION.test(line.trim()) && !TOOL_URL.test(line))
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

export function reply(stdout: string): Record<string, unknown> | null {
  const fenced = /```(?:json)?[^\S\n]*\n([\s\S]*?)```/.exec(stdout)
  const body = (fenced?.[1] ?? stdout).trim()

  const start = body.indexOf('{')
  const end = body.lastIndexOf('}')
  if (start === -1 || end <= start) return null

  try {
    const value: unknown = JSON.parse(body.slice(start, end + 1))
    return typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : null
  } catch {
    return null
  }
}

function field(row: Record<string, unknown>, key: string): string {
  const value = row[key]
  return typeof value === 'string' ? scrub(value) : ''
}

function failure(out: ClaudeOutput): DraftFailure | null {
  if (out.code === 'missing') return { kind: 'not-installed' }
  if (out.code === 'timeout') return { kind: 'timed-out' }
  if (out.code !== 0) return { kind: 'failed', code: out.code, stderr: out.stderr.trim().slice(0, MAX_STDERR) }
  return null
}

const NO_ATTRIBUTION = 'Never add a co-author line, a "Generated with" line or any other attribution.'

const COMMIT_PROMPT = [
  'Write the git commit message for the staged diff below.',
  '',
  'Reply with one JSON object and nothing else, no prose around it and no markdown fence:',
  '{"title": "...", "description": "..."}',
  '',
  '- title is a single line in the imperative mood, under 72 characters, with no trailing period',
  '- description says why the change was made, and is an empty string when the title already says everything',
  `- ${NO_ATTRIBUTION}`,
  '- Run no commands. Everything you need is in the diff below.',
].join('\n')

export async function commitMessage(
  root: string,
  patch: string,
  run: ClaudeRun = runClaude,
): Promise<DraftResult<CommitDraft>> {
  if (patch.trim() === '') return { ok: false, error: { kind: 'nothing-to-draft' } }

  const out = await run(`${COMMIT_PROMPT}\n\n<diff>\n${patch.slice(0, MAX_PATCH)}\n</diff>`, root, TIMEOUT_MS)
  const failed = failure(out)
  if (failed) return { ok: false, error: failed }

  const row = reply(out.stdout)
  if (row === null) {
    return { ok: false, error: { kind: 'unusable', detail: 'the reply was not the JSON object that was asked for' } }
  }

  const title = (field(row, 'title').split('\n')[0] ?? '').trim()
  if (title === '') return { ok: false, error: { kind: 'unusable', detail: 'the reply carried no commit title' } }

  return { ok: true, value: { title, description: field(row, 'description') } }
}

function skillFiles(root: string, name: string): string[] {
  const account = process.env.CLAUDE_CONFIG_DIR ?? path.join(os.homedir(), '.claude')
  return [
    path.join(root, '.claude', 'commands', `${name}.md`),
    path.join(root, '.claude', 'skills', name, 'SKILL.md'),
    path.join(account, 'commands', `${name}.md`),
    path.join(account, 'skills', name, 'SKILL.md'),
  ]
}

export function body(text: string): string {
  const front = /^---\r?\n[\s\S]*?\r?\n---[^\S\n]*(?:\r?\n|$)/.exec(text)
  return (front === null ? text : text.slice(front[0].length)).trim()
}

export async function skillText(root: string, name: string): Promise<string | null> {
  for (const file of skillFiles(root, name)) {
    const text = await fs.readFile(file, 'utf8').catch(() => null)
    if (text === null) continue

    const stripped = body(text)
    if (stripped !== '') return stripped
  }

  return null
}

const PR_RULES = [
  'Write the title and the body of a pull request.',
  '',
  'The instructions between <rules> below are how pull requests are written in this account. Follow them for the wording and the shape.',
  'Ignore every step in them that acts on the repository. Run no commands. Do not branch, stage, commit, push, or create or edit a pull request.',
  'Nothing you reply with is submitted anywhere. A person reads it, edits it and decides.',
  '',
  'Reply with one JSON object and nothing else, no prose around it and no markdown fence:',
  '{"title": "...", "body": "..."}',
  '',
  '- title is a single line under 70 characters',
  '- body is the markdown the instructions ask for, as one JSON string with real newlines escaped as \\n',
  `- ${NO_ATTRIBUTION}`,
].join('\n')

export async function pullRequest(
  root: string,
  work: BranchPatch,
  run: ClaudeRun = runClaude,
): Promise<DraftResult<PullDraft>> {
  if (work.commits === 0) return { ok: false, error: { kind: 'nothing-to-draft' } }

  const skill = await skillText(root, 'pr')
  if (skill === null) return { ok: false, error: { kind: 'no-skill', name: 'pr' } }

  const helper = await skillText(root, 'pr-help')

  const prompt = [
    PR_RULES,
    '',
    `<rules>\n${skill}\n${helper ?? ''}\n</rules>`,
    '',
    `<branch>${work.branch}</branch>`,
    `<base>${work.base}</base>`,
    `<commits>\n${work.log.slice(0, MAX_LOG)}\n</commits>`,
    `<diff>\n${work.patch.slice(0, MAX_PATCH)}\n</diff>`,
  ].join('\n')

  const out = await run(prompt, root, TIMEOUT_MS)
  const failed = failure(out)
  if (failed) return { ok: false, error: failed }

  const row = reply(out.stdout)
  if (row === null) {
    return { ok: false, error: { kind: 'unusable', detail: 'the reply was not the JSON object that was asked for' } }
  }

  const title = (field(row, 'title').split('\n')[0] ?? '').trim()
  const body = field(row, 'body')
  if (title === '' || body === '') {
    return { ok: false, error: { kind: 'unusable', detail: 'the reply carried no pull request title or body' } }
  }

  return { ok: true, value: { title, body } }
}
