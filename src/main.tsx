import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import { installMock } from './model/demo-mock'
import './index.css'

if (!window.architect) installMock()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>
)
