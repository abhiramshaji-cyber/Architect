import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import '@fontsource-variable/geist'
import '@fontsource-variable/geist-mono'
import App from './App'
import { installMock } from './model/demo-mock'
import './index.css'

if (!window.architect) installMock()

// xterm measures glyph width once on open, so the bundled fonts must load before any pane mounts
const fonts = ['15px "Geist Variable"', '13px "Geist Mono Variable"'].map((font) => document.fonts.load(font))

void Promise.allSettled(fonts).then(() =>
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <App />
    </StrictMode>
  )
)
