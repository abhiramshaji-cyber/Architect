import { builtinModules } from 'node:module'
import { resolve } from 'node:path'
import { defineConfig } from 'vite'

export default defineConfig({
  ssr: { noExternal: true },
  build: {
    outDir: 'out/cli',
    emptyOutDir: true,
    target: 'node20',
    ssr: true,
    lib: { entry: resolve('cli/main.ts'), formats: ['es'] },
    rollupOptions: {
      external: [...builtinModules, ...builtinModules.map((m) => `node:${m}`), 'typescript'],
      output: { banner: '#!/usr/bin/env node' }
    }
  }
})
