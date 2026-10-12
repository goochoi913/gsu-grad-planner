import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App'
import { startPlanner } from '@/lib/store'

// Paint from this device's cached plan right away; Firebase attaches a moment later.
startPlanner()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
