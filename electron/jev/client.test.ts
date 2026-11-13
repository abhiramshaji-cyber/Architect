import { describe, expect, it, vi } from 'vitest'
import { askJev, JEV_MODEL, JEV_URL, JevError, questionProblem, replyOf, waitOf, type Question } from './client'
import { accountError } from './spend/gate'

const KEY = 'ts-SENTINEL-key-0123456789'

const QUESTIONS: Record<string, Question> = {
  kind: { type: 'choice', instructions: 'Which?', criteria: { a: 'first', b: 'second' } },
  same: { type: 'noul', instructions: 'Same?', criteria: { true: 'yes', false: 'no' } },
}

const OK = { model: 'jev-1-2026', answers: { kind: { type: 'choice', choice: 'a', confidence: 0.8, probabilities: { a: 0.8, b: 0.2 } }, same: { type: 'noul', noul: 0.9 } }, usage: { input_tokens: 40, output_tokens: 3 } }

const json = (status: number, body: unknown, headers: Record<string, string> = {}) => new Response(JSON.stringify(body), { status, headers })

describe('questionProblem', () => {
  it('accepts the documented limits and rejects anything past them', () => {
    const many = (count: number) => Object.fromEntries(Array.from({ length: count }, (_, i) => [`l${i}`, 'x']))
    expect(questionProblem({ q: { type: 'choice', instructions: '', criteria: many(255) } })).toBeNull()
    expect(questionProblem({ q: { type: 'choice', instructions: '', criteria: many(256) } })).toMatch(/256 choices/)
    expect(questionProblem({ q: { type: 'choice', instructions: '', criteria: { ['x'.repeat(64)]: 'ok' } } })).toBeNull()
    expect(questionProblem({ q: { type: 'choice', instructions: '', criteria: { ['x'.repeat(65)]: 'ok' } } })).toMatch(/longer than 64/)
    expect(questionProblem({ q: { type: 'choice', instructions: '', criteria: { a: 'y'.repeat(500) } } })).toBeNull()
    expect(questionProblem({ q: { type: 'choice', instructions: '', criteria: { a: 'y'.repeat(501) } } })).toMatch(/longer than 500/)
    expect(questionProblem({ q: { type: 'choice', instructions: '', criteria: {} } })).toMatch(/no choices/)
  })
})

describe('askJev', () => {
  it('posts the model, state and questions with the bearer key and reads every answer', async () => {
    const fetch = vi.fn(async () => json(200, OK))
    const reply = await askJev(KEY, 'state text', QUESTIONS, { fetch })

    expect(fetch).toHaveBeenCalledOnce()
    const [url, init] = fetch.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe(JEV_URL)
    expect(init.method).toBe('POST')
    expect((init.headers as Record<string, string>).Authorization).toBe(`Bearer ${KEY}`)
    expect(JSON.parse(String(init.body))).toEqual({ model: JEV_MODEL, state: 'state text', questions: QUESTIONS })
    expect(reply).toEqual({ model: 'jev-1-2026', inputTokens: 40, answers: { kind: { type: 'choice', choice: 'a', probabilities: { a: 0.8, b: 0.2 } }, same: { type: 'noul', noul: 0.9 } } })
  })

  it('refuses a question past the label limits without calling the network', async () => {
    const fetch = vi.fn()
    const long = { q: { type: 'choice', instructions: '', criteria: { ['x'.repeat(65)]: 'd' } } } as Record<string, Question>
    await expect(askJev(KEY, 's', long, { fetch })).rejects.toMatchObject({ status: 400 })
    expect(fetch).not.toHaveBeenCalled()
  })

  it('waits as long as retry-after says on 429 and backs off on 529, then succeeds', async () => {
    const responses = [json(429, { detail: 'slow down' }, { 'retry-after': '3' }), json(529, { detail: 'busy' }), json(200, OK)]
    const fetch = vi.fn(async () => responses.shift() as Response)
    const wait = vi.fn(async () => {})
    await askJev(KEY, 's', QUESTIONS, { fetch, wait })
    expect(fetch).toHaveBeenCalledTimes(3)
    expect(wait.mock.calls.map((call) => (call as unknown[])[0])).toEqual([3000, 2000])
  })

  it('gives up after its retries and reports the status', async () => {
    const fetch = vi.fn(async () => json(429, { detail: 'no' }))
    await expect(askJev(KEY, 's', QUESTIONS, { fetch, wait: async () => {} })).rejects.toMatchObject({ status: 429 })
    expect(fetch).toHaveBeenCalledTimes(7)
  })

  it('reports account errors and 422 without the key, even when the server echoes it', async () => {
    const refused = askJev(KEY, 's', QUESTIONS, { fetch: async () => json(401, { detail: `bad ${KEY}` }) })
    await expect(refused).rejects.toThrow('TypeSafe returned 401: the API key was refused (bad …)')
    const broke = await askJev(KEY, 's', QUESTIONS, { fetch: async () => json(402, { detail: `no credit for ${KEY}` }) }).catch((err: unknown) => err)
    expect(accountError(broke)).toBe(true)
    expect((broke as Error).message).toBe('TypeSafe returned 402: the account is out of credit (no credit for …)')
    const forbidden = vi.fn(async () => json(403, {}))
    await expect(askJev(KEY, 's', QUESTIONS, { fetch: forbidden, wait: async () => {} })).rejects.toMatchObject({ status: 403, message: 'TypeSafe returned 403: the API key is not allowed to make this request' })
    expect(forbidden).toHaveBeenCalledTimes(1)
    const invalid = await askJev(KEY, 's', QUESTIONS, { fetch: async () => json(422, { detail: [{ msg: `field ${KEY} missing` }] }) }).catch((err: unknown) => err)
    expect(invalid).toBeInstanceOf(JevError)
    expect(accountError(invalid)).toBe(false)
    expect((invalid as JevError).status).toBe(422)
    expect((invalid as Error).message).toMatch(/field … missing/)
    expect((invalid as Error).message).not.toContain(KEY)
  })

  it('rejects a reply that leaves out an answer', async () => {
    const partial = { ...OK, answers: { kind: OK.answers.kind } }
    await expect(askJev(KEY, 's', QUESTIONS, { fetch: async () => json(200, partial) })).rejects.toThrow(/missing same/)
  })

  it('stops when the signal is aborted', async () => {
    const stop = new AbortController()
    stop.abort()
    const fetch = vi.fn(async () => Promise.reject(new DOMException('aborted', 'AbortError')))
    await expect(askJev(KEY, 's', QUESTIONS, { fetch, signal: stop.signal })).rejects.toThrow('stopped')
    expect(fetch).toHaveBeenCalledOnce()
  })
})

describe('replyOf and waitOf', () => {
  it('fills a label Jev left out with zero and reads an HTTP date retry-after', () => {
    const reply = replyOf({ model: 'm', answers: { kind: { type: 'choice', choice: 'a', probabilities: { a: 1 } }, same: { type: 'noul', noul: 0 } } }, QUESTIONS)
    expect(reply.answers.kind).toEqual({ type: 'choice', choice: 'a', probabilities: { a: 1, b: 0 } })
    const now = Date.parse('2026-01-01T00:00:00Z')
    expect(waitOf('Thu, 01 Jan 2026 00:00:05 GMT', 0, now)).toBe(5000)
    expect(waitOf(null, 2)).toBe(4000)
    expect(waitOf('9999', 0)).toBe(60_000)
  })
})
