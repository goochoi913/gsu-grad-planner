import { useMemo, useState } from 'react'
import type { CatalogCourse, PlanEntry, Term, TermId } from '@/lib/types'
import type { Section } from '@/lib/schedule-types'
import type { GradePart } from '@/lib/planner'
import { checkAdd, scheduledIn } from '@/lib/plan-ops'
import {
  clashText,
  clashesFor,
  entriesWithDraft,
  partsWithSections,
  scheduleFor,
  sectionByCrn,
  shortGaps,
  termEvents,
  useScheduleVersion,
  type CalEvent,
  type Clash,
  type Gap,
  type SectionDraft,
} from '@/lib/schedule'
import { saveSections, type PlannerSnapshot } from '@/lib/store'

/**
 * The section picker's state: what's saved in the plan, what's previewed on the calendar,
 * and whether the preview can be saved. Tapping a section only changes the preview; save()
 * writes it into the plan. A section that overlaps another class can be previewed, never saved.
 */
export interface PartChoice {
  part: GradePart
  sections: Section[]
  /** In the plan now. */
  saved: Section | null
  /** On the calendar (the draft). */
  previewing: Section | null
  /** What the previewed section overlaps. */
  clashes: Clash[]
}

export interface SectionPicker {
  course: CatalogCourse
  term: Term
  parts: PartChoice[]
  draft: SectionDraft
  choose: (partCodeId: string, crn: string | null) => void
  /** Back to what the plan has. */
  reset: () => void
  /** The draft differs from the plan. */
  dirty: boolean
  /** Why Save is off — empty when it can save. */
  blockers: string[]
  canSave: boolean
  /** Planned in this term already; else where it is (or null when it isn't planned). */
  inTerm: boolean
  plannedIn: Term | null
  /** The term's week with the draft in it. */
  events: CalEvent[]
  days: ReturnType<typeof termEvents>['days']
  /** Breaks next to this course. */
  gaps: Gap[]
  /** "Section 4" / "Lecture 4 + Lab 12" — what Save would save. */
  label: string
  save: () => boolean
}

const NO_ENTRIES: PlanEntry[] = []

export function useSectionPicker(course: CatalogCourse, termId: TermId, snap: PlannerSnapshot): SectionPicker | null {
  const term = snap.semesters.find((s) => s.id === termId) ?? null
  const entries = snap.plan.schedule[termId] ?? NO_ENTRIES
  const entry = entries.find((e) => e.courseId === course.id) ?? null
  const plannedId = scheduledIn(snap.semesters, snap.plan.schedule, course.id)
  // Recomputed when fresher seat counts arrive (src/lib/live-schedule.ts).
  const version = useScheduleVersion()
  const offered = useMemo(() => partsWithSections(course, termId), [course, termId, version]) // eslint-disable-line react-hooks/exhaustive-deps

  // Only the parts she has touched; the rest follow the plan (so a change from the other device shows up).
  const [touched, setTouched] = useState<SectionDraft>({})
  const saved: SectionDraft = Object.fromEntries(offered.map(({ part }) => [part.codeId, entry?.sections?.[part.codeId] ?? null]))
  const draft: SectionDraft = { ...saved, ...touched }
  const dirty = offered.some(({ part }) => (draft[part.codeId] ?? null) !== (saved[part.codeId] ?? null))

  const preview = termEvents(termId, entriesWithDraft(entries, course.id, draft))
  const parts: PartChoice[] = offered.map(({ part, sections }) => {
    const previewing = draft[part.codeId] ? sectionByCrn(termId, draft[part.codeId]!) : null
    return {
      part,
      sections,
      saved: saved[part.codeId] ? sectionByCrn(termId, saved[part.codeId]!) : null,
      previewing,
      clashes: previewing ? clashesFor(termId, entries, course.id, part.codeId, previewing, draft) : [],
    }
  })
  if (!term || !scheduleFor(termId)) return null

  const multi = parts.filter((p) => p.sections.length).length > 1
  const label = parts
    .filter((p) => p.previewing)
    .map((p) => `${multi ? (p.part.main ? 'Lecture ' : 'Lab ') : 'Section '}${p.previewing!.section}`)
    .join(' + ') || 'No section'

  // What stops Save: the term can't take the course, or a section being changed overlaps a class.
  // (A saved part that already overlaps something doesn't block changing the other part.)
  const blockers: string[] = []
  const inTerm = plannedId === termId
  if (!inTerm) {
    const check = checkAdd(snap.semesters, snap.plan.schedule, course.id, termId)
    if (!check.ok) blockers.push(check.reason.replace(/\.$/, ''))
    if (!parts.some((p) => p.previewing)) blockers.push('Choose a section first')
  }
  for (const p of parts) {
    const changed = (draft[p.part.codeId] ?? null) !== (saved[p.part.codeId] ?? null)
    if (changed && p.previewing && p.clashes.length) blockers.push(`${multi ? (p.part.main ? 'Lecture' : 'Lab') : 'Section'} ${p.previewing.section} overlaps ${p.clashes.map(clashText).join(' and ')}`)
  }
  const canSave = dirty && !blockers.length

  return {
    course,
    term,
    parts,
    draft,
    choose: (partCodeId, crn) => setTouched((t) => ({ ...t, [partCodeId]: crn })),
    reset: () => setTouched({}),
    dirty,
    blockers,
    canSave,
    inTerm,
    plannedIn: plannedId && !inTerm ? snap.semesters.find((s) => s.id === plannedId) ?? null : null,
    events: preview.events,
    days: preview.days,
    gaps: shortGaps(preview.events, { courseId: course.id, maxMinutes: 60 }),
    label,
    save: () => {
      if (!canSave) return false
      const picks = Object.fromEntries(parts.map((p) => [p.part.codeId, draft[p.part.codeId] ?? null]))
      const message = parts.some((p) => p.previewing) ? `${course.title}: ${label} saved` : `${course.title}: section unselected`
      const ok = saveSections(termId, course.id, picks, message)
      if (ok) setTouched({})
      return ok
    },
  }
}

