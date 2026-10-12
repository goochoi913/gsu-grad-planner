import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App'
import { startPlanner } from '@/lib/store'
import { startLiveSchedule } from '@/lib/live-schedule'

// Paint from this device's cached plan right away; Firebase attaches a moment later.
startPlanner()
// Then the freshest published seat counts (see src/lib/live-schedule.ts).
startLiveSchedule()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
