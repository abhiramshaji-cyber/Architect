import { builtinModules } from 'node:module'
import { resolve } from 'node:path'
import { defineConfig } from 'vite'

export default defineConfig({
  ssr: { noExternal: true },
  build: {
    outDir: 'out/lsp',
    emptyOutDir: true,
    target: 'node20',
    ssr: true,
    lib: { entry: resolve('lsp/server.ts'), formats: ['es'], fileName: () => 'server.js' },
    rollupOptions: {
      external: [...builtinModules, ...builtinModules.map((m) => `node:${m}`)],
      output: { banner: '#!/usr/bin/env node' }
    }
  }
})
