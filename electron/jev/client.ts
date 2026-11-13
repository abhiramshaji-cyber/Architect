export const JEV_URL = 'https://api.typesafe.ai/v1/systemone'

export const JEV_MODEL = 'jev-latest'

export const PRICE_PER_MILLION_INPUT_TOKENS = 0.042

export const LIMITS = { choices: 255, label: 64, description: 500, bodyBytes: 32 * 1024 * 1024 }

const RETRIES = 6

const FIRST_WAIT_MS = 1000

const LONGEST_WAIT_MS = 60_000

export type ChoiceQuestion = { type: 'choice'; instructions: string; criteria: Record<string, string> }

export type NoulQuestion = { type: 'noul'; instructions: string; criteria: { true: string; false: string } }

export type Question = ChoiceQuestion | NoulQuestion

export type Answer = { type: 'choice'; choice: string; probabilities: Record<string, number> } | { type: 'noul'; noul: number }

export type Reply = { model: string; answers: Record<string, Answer>; inputTokens: number }

export type Asking = { fetch: typeof fetch; signal?: AbortSignal; wait?: (ms: number, signal?: AbortSignal) => Promise<void> }

export class JevError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message)
    this.name = 'JevError'
  }
}

export function questionProblem(questions: Record<string, Question>): string | null {
  for (const [id, question] of Object.entries(questions)) {
    if (question.type !== 'choice') continue
    const labels = Object.entries(question.criteria)
    if (labels.length === 0) return `question ${id} has no choices`
    if (labels.length > LIMITS.choices) return `question ${id} has ${labels.length} choices, Jev allows ${LIMITS.choices}`
    const long = labels.find(([label]) => label.length > LIMITS.label)
    if (long) return `choice ${long[0].slice(0, LIMITS.label)}… in ${id} is longer than ${LIMITS.label} characters`
    const wordy = labels.find(([, description]) => description.length > LIMITS.description)
    if (wordy) return `the description of ${wordy[0]} in ${id} is longer than ${LIMITS.description} characters`
  }
  return null
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(signal.reason)
    const timer = setTimeout(resolve, ms)
    signal?.addEventListener('abort', () => {
      clearTimeout(timer)
      reject(signal.reason)
    }, { once: true })
  })
}

export function waitOf(header: string | null, attempt: number, now = Date.now()): number {
  const seconds = header === null || header.trim() === '' ? NaN : Number(header)
  const dated = header === null ? NaN : Date.parse(header) - now
  const told = Number.isFinite(seconds) ? seconds * 1000 : dated
  const backoff = FIRST_WAIT_MS * 2 ** attempt
  return Math.min(LONGEST_WAIT_MS, Math.max(0, Number.isFinite(told) ? told : backoff))
}

function detailOf(payload: unknown): string {
  const detail = typeof payload === 'object' && payload !== null ? (payload as { detail?: unknown }).detail : undefined
  if (typeof detail === 'string') return detail
  if (Array.isArray(detail)) return detail.map((item) => (typeof item === 'object' && item !== null ? String((item as { msg?: unknown }).msg ?? '') : '')).filter(Boolean).join('; ')
  return ''
}

const unit = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 1

function answerOf(raw: unknown, question: Question): Answer | null {
  if (typeof raw !== 'object' || raw === null) return null
  const answer = raw as { type?: unknown; noul?: unknown; choice?: unknown; probabilities?: unknown }
  if (question.type === 'noul') return answer.type === 'noul' && unit(answer.noul) ? { type: 'noul', noul: answer.noul } : null
  if (answer.type !== 'choice' || typeof answer.choice !== 'string' || typeof answer.probabilities !== 'object' || answer.probabilities === null) return null
  const given = answer.probabilities as Record<string, unknown>
  const probabilities = Object.fromEntries(Object.keys(question.criteria).map((label) => [label, unit(given[label]) ? given[label] : 0]))
  return { type: 'choice', choice: answer.choice, probabilities }
}

export function replyOf(payload: unknown, questions: Record<string, Question>): Reply {
  const body = typeof payload === 'object' && payload !== null ? (payload as { model?: unknown; answers?: unknown; usage?: unknown }) : {}
  const answers = typeof body.answers === 'object' && body.answers !== null ? (body.answers as Record<string, unknown>) : {}
  const parsed = Object.entries(questions).map(([id, question]) => [id, answerOf(answers[id], question)] as const)
  const missing = parsed.filter(([, answer]) => answer === null).map(([id]) => id)
  if (typeof body.model !== 'string' || missing.length > 0) throw new JevError(0, `Jev sent a reply Architect could not read${missing.length > 0 ? `, missing ${missing.join(', ')}` : ''}`)
  const usage = typeof body.usage === 'object' && body.usage !== null ? (body.usage as { input_tokens?: unknown }).input_tokens : undefined
  return { model: body.model, answers: Object.fromEntries(parsed) as Record<string, Answer>, inputTokens: typeof usage === 'number' ? usage : 0 }
}

async function payloadOf(response: Response): Promise<unknown> {
  const text = await response.text()
  try {
    return JSON.parse(text) as unknown
  } catch {
    return undefined
  }
}

const transient = (status: number) => status === 429 || status === 529

export async function askJev(key: string, state: string, questions: Record<string, Question>, asking: Asking): Promise<Reply> {
  const problem = questionProblem(questions)
  if (problem) throw new JevError(400, problem)
  const body = JSON.stringify({ model: JEV_MODEL, state, questions })
  const bytes = Buffer.byteLength(body)
  if (bytes > LIMITS.bodyBytes) throw new JevError(413, `the request is ${bytes} bytes, Jev accepts ${LIMITS.bodyBytes}`)
  const wait = asking.wait ?? sleep

  for (let attempt = 0; ; attempt += 1) {
    let response: Response
    try {
      response = await asking.fetch(JEV_URL, {
        method: 'POST',
        headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
        body,
        signal: asking.signal,
      })
    } catch {
      if (asking.signal?.aborted || attempt >= RETRIES) throw new JevError(0, asking.signal?.aborted ? 'stopped' : 'could not reach TypeSafe')
      await wait(waitOf(null, attempt), asking.signal)
      continue
    }

    if (response.ok) return replyOf(await payloadOf(response), questions)
    const detail = detailOf(await payloadOf(response)).replaceAll(key, '…')
    if (transient(response.status) && attempt < RETRIES) {
      await wait(waitOf(response.headers.get('retry-after'), attempt), asking.signal)
      continue
    }
    if (response.status === 401) throw new JevError(401, 'TypeSafe refused the API key')
    throw new JevError(response.status, `TypeSafe answered ${response.status}${detail ? `: ${detail}` : ''}`)
  }
}
