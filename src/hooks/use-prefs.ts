import { useCallback, useEffect, useState } from 'react'

/**
 * Device-local preferences. Anything that changes the plan itself lives in Firebase;
 * these only change how it looks on this screen, so they stay out of the other
 * person's way.
 */
export type View = 'plan' | 'schedule' | 'summary'

export interface Prefs {
  theme: 'light' | 'dark' | 'system'
  view: View
  libraryOpen: boolean
  auditOpen: boolean
  /** Calendar: the whole week, or one day at a time. */
  calendarMode: 'week' | 'day'
  /** Show completed terms when the app opens (off: the board opens on the plan alone; Show/Hide on the board is for this visit). */
  showPastOnOpen: boolean
}

const KEY = 'bee-planner:prefs'

const DEFAULTS: Prefs = {
  theme: 'system',
  view: 'plan',
  libraryOpen: true,
  auditOpen: true,
  calendarMode: 'week',
  showPastOnOpen: false,
}

function read(): Prefs {
  try {
    const raw = localStorage.getItem(KEY)
    // `showPast` (always shown before) became showPastOnOpen, off by default — older devices start clean too.
    const { showPast: _old, ...stored } = raw ? (JSON.parse(raw) as Partial<Prefs> & { showPast?: boolean }) : {}
    return { ...DEFAULTS, ...stored }
  } catch {
    return DEFAULTS
  }
}

export function usePrefs() {
  const [prefs, setPrefs] = useState<Prefs>(read)

  const set = useCallback(<K extends keyof Prefs>(key: K, value: Prefs[K]) => {
    setPrefs((prev) => {
      const next = { ...prev, [key]: value }
      try {
        localStorage.setItem(KEY, JSON.stringify(next))
      } catch {
        /* private mode — the session still works, it just will not be remembered */
      }
      return next
    })
  }, [])

  /* theme: the class on <html>, plus the browser chrome colour on phones */
  useEffect(() => {
    const root = document.documentElement
    const apply = () => {
      const dark =
        prefs.theme === 'dark' ||
        (prefs.theme === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches)
      root.classList.toggle('dark', dark)
      root.style.colorScheme = dark ? 'dark' : 'light'
      document.querySelectorAll('meta[name="theme-color"]').forEach((m) => {
        m.setAttribute('content', dark ? '#0a0a0a' : '#ffffff')
      })
    }
    apply()
    if (prefs.theme !== 'system') return
    const mq = window.matchMedia('(prefers-color-scheme: dark)')
    mq.addEventListener('change', apply)
    return () => mq.removeEventListener('change', apply)
  }, [prefs.theme])

  return { prefs, set }
}

export function resolvedDark(): boolean {
  return document.documentElement.classList.contains('dark')
}
