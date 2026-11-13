import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import '@fontsource/rajdhani/600.css'
import '@fontsource/rajdhani/700.css'
import '@fontsource-variable/exo-2'
import '@fontsource-variable/jetbrains-mono'
import 'cybercore-css'
import App from './App'
import { installMock } from './model/demo-mock'
import './index.css'

if (!window.architect) installMock()

// xterm measures glyph width once on open, so the bundled fonts must load before any pane mounts
const fonts = ['600 15px Rajdhani', '15px "Exo 2 Variable"', '13px "JetBrains Mono Variable"'].map((font) => document.fonts.load(font))

void Promise.allSettled(fonts).then(() =>
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <App />
    </StrictMode>
  )
)
