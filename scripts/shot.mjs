import react from '@vitejs/plugin-react'
import { chromium } from 'playwright'
import { createServer } from 'vite'

const out = process.argv[2] ?? 'shot.png'

const server = await createServer({
  root: 'src',
  plugins: [react()],
  server: { port: 0 },
  logLevel: 'error'
})
await server.listen()
const port = server.config.server.port ?? server.httpServer.address().port

const browser = await chromium.launch({ channel: 'chrome' })
const page = await browser.newPage({ viewportSize: { width: 1600, height: 1000 } })

const errors = []
page.on('console', m => m.type() === 'error' && errors.push(m.text()))
page.on('pageerror', e => errors.push(String(e)))

await page.goto(`http://localhost:${port}`)
await page.waitForSelector('.react-flow__node', { timeout: 15000 })
await page.waitForTimeout(700)
await page.screenshot({ path: out })

console.log(`wrote ${out}`)
if (errors.length) console.log('console errors:\n' + errors.join('\n'))

await browser.close()
await server.close()
process.exit(0)
