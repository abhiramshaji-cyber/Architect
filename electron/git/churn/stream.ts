import { spawn } from 'node:child_process'
import { StringDecoder } from 'node:string_decoder'

export function streamLines(root: string, args: string[], onLine: (line: string) => void): Promise<boolean> {
  return new Promise((resolve) => {
    const child = spawn('git', args, { cwd: root, windowsHide: true, stdio: ['ignore', 'pipe', 'ignore'] })
    const decoder = new StringDecoder('utf8')
    let rest = ''

    const feed = (text: string) => {
      const buffer = rest + text
      let start = 0
      for (let end = buffer.indexOf('\n'); end !== -1; end = buffer.indexOf('\n', start)) {
        onLine(buffer.slice(start, end))
        start = end + 1
      }
      rest = buffer.slice(start)
    }

    child.stdout.on('data', (chunk: Buffer) => feed(decoder.write(chunk)))
    child.once('error', () => resolve(false))
    child.once('close', (code) => {
      feed(decoder.end())
      if (rest) onLine(rest)
      resolve(code === 0)
    })
  })
}
