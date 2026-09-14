import { resolve } from 'node:path'
import { defineConfig } from 'electron-vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  main: {
    build: {
      lib: { entry: resolve('electron/main.ts') },
      rollupOptions: { output: { entryFileNames: 'main.js' } }
    }
  },
  preload: {
    build: {
      lib: { entry: resolve('electron/preload.ts') },
      rollupOptions: { output: { entryFileNames: 'preload.js' } }
    }
  },
  renderer: {
    root: 'src',
    plugins: [react()],
    build: { rollupOptions: { input: resolve('src/index.html') } }
  }
})
