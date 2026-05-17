import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { Observer } from './Observer.js'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Observer />
  </StrictMode>,
)
