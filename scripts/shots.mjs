import react from '@vitejs/plugin-react'
import { chromium } from 'playwright'
import { createServer } from 'vite'

const dir = process.argv[2] ?? 'docs/screenshots'

const server = await createServer({
  root: 'src',
  plugins: [react()],
  server: { port: 0 },
  logLevel: 'error'
})
await server.listen()
const port = server.config.server.port ?? server.httpServer.address().port

const browser = await chromium.launch({ channel: 'chrome' })
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 }, deviceScaleFactor: 2 })
await page.addInitScript(() => localStorage.setItem('theme', 'light'))

const errors = []
page.on('console', (m) => m.type() === 'error' && errors.push(m.text()))
page.on('pageerror', (e) => errors.push(String(e)))

const shot = async (name) => {
  await page.waitForTimeout(600)
  await page.screenshot({ path: `${dir}/${name}.png` })
  console.log(`wrote ${name}.png`)
}

const open = async (name) => {
  await page.getByRole('button', { name: `Open ${name}`, exact: true }).click()
  await page.waitForTimeout(500)
}

await page.goto(`http://localhost:${port}`)
await page.waitForSelector('.react-flow__node', { timeout: 15000 })
await page.waitForTimeout(900)
await shot('contract-canvas')

// code-mode
await page.getByRole('button', { name: 'Code', exact: true }).click()
await page.waitForSelector('.code-folder', { timeout: 15000 })
await shot('code-folders')

// descend
await open('src')
await open('workflows')
await open('runner.ts')
await page.waitForSelector('.code-fnnode', { timeout: 15000 })
await shot('code-call-graph')

// select
await page.locator('.code-fnnode').first().click()
await page.waitForSelector('.code-fnnode.picked', { timeout: 15000 })
await page.waitForTimeout(700)
await shot('function-source')

if (errors.length) console.log('console errors:\n' + errors.join('\n'))

await browser.close()
await server.close()
process.exit(0)
