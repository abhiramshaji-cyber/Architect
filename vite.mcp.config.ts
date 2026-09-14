import { builtinModules } from 'node:module'
import { resolve } from 'node:path'
import { defineConfig } from 'vite'

export default defineConfig({
  build: {
    outDir: 'out/mcp',
    emptyOutDir: true,
    target: 'node20',
    ssr: true,
    lib: { entry: resolve('mcp/bridge.ts'), formats: ['es'], fileName: () => 'bridge.js' },
    rollupOptions: {
      external: [...builtinModules, ...builtinModules.map(m => `node:${m}`), '@modelcontextprotocol/sdk', 'zod'],
      output: { banner: '#!/usr/bin/env node' }
    }
  }
})
