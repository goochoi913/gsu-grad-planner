import { createContext, useContext } from 'react'
import type { TermId } from '@/lib/types'
import type { View } from '@/hooks/use-prefs'

export interface RecordDialogOptions {
  recordId?: string
  termId?: string
  add?: boolean
  importNow?: boolean
}

export interface ExceptionPrefill {
  type: 'substitute' | 'waive'
  target: string
  course?: string
  credits?: number | null
  note?: string
}

/** What any view can ask the app shell to open. */
export interface UiApi {
  openCourse: (courseId: string, termId?: TermId | null) => void
  openProfessor: (key: string) => void
  openRecord: (opts?: RecordDialogOptions) => void
  openGrades: (termId: TermId) => void
  openGpa: (termId?: TermId) => void
  openExceptions: (opts?: { prefill?: ExceptionPrefill; editId?: string }) => void
  openClassBrowser: (query?: string) => void
  openAudit: (blockKey?: string) => void
  openLibrary: (termId?: TermId) => void
  setView: (view: View) => void
  /** The term the course list's [+] adds into. */
  focusedTerm: TermId | null
  setFocusedTerm: (termId: TermId) => void
  /** The course a drag started from, so terms can show where it may land. */
  dragging: string | null
  setDragging: (courseId: string | null) => void
  isMobile: boolean
}

export const UiContext = createContext<UiApi | null>(null)

export function useUi(): UiApi {
  const ui = useContext(UiContext)
  if (!ui) throw new Error('useUi outside UiContext')
  return ui
}
