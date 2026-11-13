import type { Store } from '../classify/cache'
import type { Ask } from '../classify/run'
import { ACCOUNT, askJev, JevError } from '../client'
import { readKey, type Crypt } from '../key'
import { addMonthTokens, monthTokens } from './month'

// characters per input token, matching TypeSafe's billed usage on Architect's own index
const CHARS_PER_TOKEN = 4

export type Gate = {
  dir: string
  crypt: Crypt
  fetch: typeof fetch
  limit: () => number | null
  paused: () => string | null
  pause: (reason: string) => void
}

const resume = (act: string) => `Indexing and search are paused until ${act} or Retry is pressed on the Jev card in the AI page.`

const budgetText = (limit: number, used: number) => `The monthly Jev budget of ${limit.toLocaleString('en-US')} input tokens would be exceeded (${used.toLocaleString('en-US')} used this month). ${resume('the budget is raised')}`

export const accountError = (err: unknown): err is JevError => err instanceof JevError && err.status in ACCOUNT

export function gateOf({ dir, crypt, fetch, limit, paused, pause }: Gate): (store: Store) => Ask {
  let reserved = 0
  return (store) => async (text, questions, signal) => {
    const stopped = paused()
    if (stopped !== null) throw new JevError(0, stopped)

    const cap = limit()
    const estimate = Math.ceil((text.length + JSON.stringify(questions).length) / CHARS_PER_TOKEN)
    const used = monthTokens(dir)
    if (cap !== null && used + reserved + estimate > cap) {
      const reason = budgetText(cap, used)
      pause(reason)
      throw new JevError(0, reason)
    }

    reserved += estimate
    try {
      const key = readKey(dir, crypt)
      if (key === null) throw new JevError(401, 'no TypeSafe API key is stored')
      const reply = await askJev(key, text, questions, { fetch, signal })
      store.addTokens(reply.inputTokens)
      addMonthTokens(dir, reply.inputTokens)
      return reply
    } catch (err) {
      if (accountError(err)) pause(`${err.message}. ${resume('the key is saved again')}`)
      throw err
    } finally {
      reserved -= estimate
    }
  }
}
