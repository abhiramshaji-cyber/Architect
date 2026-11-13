import fs from 'node:fs'
import path from 'node:path'

export function forgetJev(userData: string): void {
  fs.rmSync(path.join(userData, 'jev'), { recursive: true, force: true })
}
