import { errorText } from '../shared/text/error'
import { run, USAGE } from './check'

run(
  process.argv.slice(2),
  (line) => process.stdout.write(`${line}\n`),
  (line) => process.stderr.write(`${line}\n`),
)
  .then((code) => {
    process.exitCode = code
  })
  .catch((error: unknown) => {
    process.stderr.write(`architect: ${errorText(error)}\n`)
    process.exitCode = USAGE
  })
