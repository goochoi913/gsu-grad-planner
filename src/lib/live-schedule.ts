/**
 * Fresh seat counts without an app update.
 *
 * GSU's class search can't be read from a browser (it sends no CORS headers), so the deploy
 * job (.github/workflows/deploy.yml) reads it every 30 minutes during registration season and
 * publishes the whole schedule as live/<term>.json next to the app. The app loads that file when
 * it opens, when it comes back to the foreground, every few minutes while it's open, and when a
 * course's sections are opened — and swaps it in if it's newer than what it has. The service
 * worker never caches it, and the app's own files stay the same between refreshes, so a new seat
 * count never forces an app update.
 */
import type { TermSchedule } from '@/lib/schedule-types'
import { SCHEDULE_TERM_ID, replaceSchedule } from '@/lib/schedule'

const URL_FOR = (termId: string) => `${import.meta.env.BASE_URL}live/${termId}.json`
const EVERY = 5 * 60_000

let lastTry = 0
let inFlight: Promise<boolean> | null = null

function looksValid(data: unknown): data is TermSchedule {
  const d = data as TermSchedule
  return !!d && d.termId === SCHEDULE_TERM_ID && Array.isArray(d.courses) && d.courses.every((c) => Array.isArray(c?.sections)) && !!d.sources
}

/** Fetches the published schedule unless it was tried in the last `minGapMs`. Resolves true when newer data arrived. */
export function refreshLiveSchedule(minGapMs = 60_000): Promise<boolean> {
  if (inFlight) return inFlight
  if (Date.now() - lastTry < minGapMs) return Promise.resolve(false)
  lastTry = Date.now()
  inFlight = (async () => {
    try {
      // The query string keeps GitHub's CDN and the browser from answering with an older copy.
      const res = await fetch(`${URL_FOR(SCHEDULE_TERM_ID)}?t=${Date.now()}`, { cache: 'no-store' })
      if (!res.ok) return false
      const data: unknown = await res.json()
      return looksValid(data) && replaceSchedule(data)
    } catch {
      return false
    } finally {
      inFlight = null
    }
  })()
  return inFlight
}

let started = false
export function startLiveSchedule() {
  if (started || typeof window === 'undefined') return
  started = true
  void refreshLiveSchedule(0)
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') void refreshLiveSchedule()
  })
  window.setInterval(() => {
    if (document.visibilityState === 'visible') void refreshLiveSchedule(EVERY - 30_000)
  }, EVERY)
}
