const ARTICLELESS = new Set(
  'a an the all any each every some many by from to for with into in on of at as if or and not no my our your this that these those its their'.split(' '),
)

const PLAIN = new Set(
  'accept add apply ask attach check clean clear close collect compare connect copy count decode delete describe detach draft draw encode explain fetch fill filter find fix format get group hide insert join keep kill list load mark match measure merge move open pick place print pull push read refresh register reject release reload remove rename replace reset resize restore run save scan schedule search select send set show skip sort split start stop store strip take test track trim update wait watch wrap write'.split(' '),
)

const QUESTIONS = new Set(['is', 'has', 'can', 'should', 'was', 'will', 'needs', 'does', 'did', 'are'])

type Say = (object: string, rest: string) => string

const together = (verb: string, particle: string, tail = ''): Say => (object) =>
  object === 'it' ? `${verb} it ${particle}${tail}.` : `${verb} ${particle} ${object}${tail}.`

const SPECIAL: Record<string, Say> = {
  parse: (o) => `Reads ${o} and makes sense of it.`,
  serialize: (o) => `Turns ${o} into text.`,
  stringify: (o) => `Turns ${o} into text.`,
  render: (o) => `Draws ${o}.`,
  init: (o) => `Gets ${o} ready.`,
  initialize: (o) => `Gets ${o} ready.`,
  setup: (o) => `Gets ${o} ready.`,
  prepare: (o) => `Gets ${o} ready.`,
  compute: together('Works', 'out'),
  calc: together('Works', 'out'),
  calculate: together('Works', 'out'),
  resolve: together('Works', 'out'),
  derive: together('Works', 'out'),
  infer: together('Works', 'out'),
  query: together('Looks', 'up'),
  lookup: together('Looks', 'up'),
  emit: together('Sends', 'out'),
  dispatch: together('Sends', 'out'),
  broadcast: together('Sends', 'out'),
  notify: together('Sends', 'out', ' as a notice'),
  publish: together('Sends', 'out'),
  build: together('Puts', 'together'),
  compose: together('Puts', 'together'),
  assemble: together('Puts', 'together'),
  reduce: together('Boils', 'down'),
  subscribe: (o) => `Listens for ${o}.`,
  listen: (o) => `Listens for ${o}.`,
  mount: (o) => `Puts ${o} on the page.`,
  unmount: (o) => `Takes ${o} off the page.`,
  spawn: (o) => `Starts ${o}.`,
  exec: (o) => `Runs ${o}.`,
  execute: (o) => `Runs ${o}.`,
  invoke: (o) => `Runs ${o}.`,
  call: (o) => `Runs ${o}.`,
  sync: (o) => `Keeps ${o} in step.`,
  toggle: (o) => `Switches ${o} on or off.`,
  normalize: (o) => `Tidies ${o}.`,
  sanitize: (o) => `Cleans ${o}.`,
  hash: (o) => `Makes a fingerprint of ${o}.`,
  validate: (o) => `Checks ${o}.`,
  verify: (o) => `Checks ${o}.`,
  assert: (o) => `Checks ${o}.`,
  ensure: (o) => `Makes sure ${o} is there.`,
  convert: (o) => `Converts ${o}.`,
  transform: (o) => `Converts ${o}.`,
  map: (o) => `Converts ${o}.`,
  diff: (o) => `Compares ${o}.`,
  locate: (o) => `Finds ${o}.`,
  walk: (o) => `Walks through ${o}.`,
  traverse: (o) => `Walks through ${o}.`,
  visit: (o) => `Walks through ${o}.`,
  log: (o) => `Writes ${o} to the log.`,
  cache: (o) => `Remembers ${o}.`,
  memoize: (o) => `Remembers ${o}.`,
  persist: (o) => `Saves ${o}.`,
  create: (_, rest) => (rest ? `Makes a new ${rest}.` : 'Makes something new.'),
  make: (_, rest) => (rest ? `Makes a new ${rest}.` : 'Makes something new.'),
  new: (_, rest) => (rest ? `Makes a new ${rest}.` : 'Makes something new.'),
  to: (_, rest) => (rest ? `Turns it into ${rest}.` : 'Turns it into something else.'),
}

function conjugate(verb: string): string {
  const head = verb.charAt(0).toUpperCase() + verb.slice(1)
  if (/(s|x|z|ch|sh|o)$/.test(verb)) return `${head}es`
  if (/[^aeiou]y$/.test(verb)) return `${head.slice(0, -1)}ies`
  return `${head}s`
}

export function wordsOf(name: string): string[] {
  return (name.match(/[A-Z]+(?![a-z])|[A-Z]?[a-z]+|\d+/g) ?? []).map((word) =>
    word.length > 1 && /^[A-Z]+$/.test(word) ? word : word.toLowerCase(),
  )
}

export function objectOf(words: string[]): string {
  const [first] = words
  if (first === undefined) return 'it'
  return ARTICLELESS.has(first) ? words.join(' ') : `the ${words.join(' ')}`
}

export function verbPhrase(words: string[]): string | undefined {
  const [verb, ...tail] = words
  if (verb === undefined) return undefined
  const rest = tail.join(' ')

  if (QUESTIONS.has(verb)) return rest ? `Tells whether it ${verb} ${rest}.` : 'Answers a yes or no question.'

  if (Object.hasOwn(SPECIAL, verb)) return SPECIAL[verb]?.(objectOf(tail), rest)

  return PLAIN.has(verb) ? `${conjugate(verb)} ${objectOf(tail)}.` : undefined
}
