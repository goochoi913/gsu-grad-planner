/**
 * The class schedule (Spring 2027 from the CSVs, enriched from GSU's class search),
 * the professors' RateMyProfessors data, and everything derived from a chosen section:
 * meeting blocks, calendar events, time conflicts and gaps, the CRN list for registration.
 *
 * The bundled schedule is the starting copy. src/lib/live-schedule.ts swaps in the copy the
 * deploy job refreshes from GSU every 30 minutes (fresh seat counts); useScheduleVersion()
 * re-renders whatever reads it.
 */
import { useSyncExternalStore } from 'react'
import spring2027 from '@/data/spring2027.json'
import professorsData from '@/data/professors.json'
import type { CatalogCourse, MeetingBlock, PlanEntry, TermId } from '@/lib/types'
import type { DayCode, Meeting, Professor, ProfessorsFile, ScheduleCourse, Section, TermSchedule } from '@/lib/schedule-types'
import { catalogIdForCode, courseGradeParts, findCourse, type GradePart } from '@/lib/planner'
import { fmtDaysLong, fmtTimeRange, timeToMin, titleCase } from '@/lib/format'

const BUNDLED = spring2027 as unknown as TermSchedule
export const SCHEDULES: Record<TermId, TermSchedule> = {
  [BUNDLED.termId]: BUNDLED,
}
export const PROFESSORS = professorsData as unknown as ProfessorsFile

/** The term the class schedule was released for — where section picking happens. */
export const SCHEDULE_TERM_ID: TermId = BUNDLED.termId

const sectionIndex = new Map<TermId, Map<string, Section>>()
const courseIndex = new Map<TermId, Map<string, ScheduleCourse>>()
function index(termId: TermId) {
  const byCrn = new Map<string, Section>(), byCode = new Map<string, ScheduleCourse>()
  for (const c of SCHEDULES[termId].courses) {
    byCode.set(c.codeId, c)
    for (const s of c.sections) byCrn.set(s.crn, s)
  }
  sectionIndex.set(termId, byCrn)
  courseIndex.set(termId, byCode)
}
Object.keys(SCHEDULES).forEach(index)

/* ─── Live updates ───────────────────────────────────────────────────────── */

let version = 0
const listeners = new Set<() => void>()
const subscribe = (l: () => void) => {
  listeners.add(l)
  return () => listeners.delete(l)
}

/** When the seat counts were read from GSU's class search (ISO), for "Seats as of …". */
export function seatsAsOf(termId: TermId): string | null {
  const s = SCHEDULES[termId]
  return s ? s.sources.banner?.fetchedAt ?? s.generatedAt : null
}

/** Swaps in a fresher copy of a term the app already ships. Returns false when it isn't newer. */
export function replaceSchedule(next: TermSchedule): boolean {
  const current = SCHEDULES[next.termId]
  if (!current) return false
  const age = (s: TermSchedule) => Date.parse(s.sources.banner?.fetchedAt ?? s.generatedAt) || 0
  if (age(next) <= age(current)) return false
  SCHEDULES[next.termId] = next
  index(next.termId)
  version++
  listeners.forEach((l) => l())
  return true
}

/** Bumps whenever the schedule data changes, so memoised views recompute. */
export function useScheduleVersion(): number {
  return useSyncExternalStore(subscribe, () => version)
}

/* ─── Lookups ────────────────────────────────────────────────────────────── */

export function scheduleFor(termId: TermId): TermSchedule | null {
  return SCHEDULES[termId] ?? null
}
export function sectionByCrn(termId: TermId, crn: string): Section | null {
  return sectionIndex.get(termId)?.get(crn) ?? null
}
export function scheduleCourse(termId: TermId, codeId: string): ScheduleCourse | null {
  return courseIndex.get(termId)?.get(codeId) ?? null
}
export function sectionsFor(termId: TermId, codeId: string): Section[] {
  return scheduleCourse(termId, codeId)?.sections ?? []
}

/** The library course a class-schedule course belongs to (CSC 3210L → the CSC 3210 + 3210L course). */
export function libraryCourseFor(codeId: string): CatalogCourse | null {
  return findCourse(catalogIdForCode(codeId))
}

/** The name a student knows a class-schedule course by: the catalog's, else GSU's title in normal case. */
export function scheduleTitle(codeId: string, gsuTitle: string): string {
  const lib = libraryCourseFor(codeId)
  if (!lib) return titleCase(gsuTitle)
  return courseGradeParts(lib).find((p) => p.codeId === codeId)?.title ?? lib.title
}

/** Each graded part of a library course with its sections that term: one for a lecture, two for lecture + lab. */
export function partsWithSections(course: CatalogCourse, termId: TermId): { part: GradePart; sections: Section[] }[] {
  return courseGradeParts(course).map((part) => ({ part, sections: sectionsFor(termId, part.codeId) }))
}

/** How many sections a library course has in a term (all parts). */
export function sectionCount(course: CatalogCourse, termId: TermId): number {
  return partsWithSections(course, termId).reduce((n, p) => n + p.sections.length, 0)
}

export function isOfferedIn(course: CatalogCourse, termId: TermId): boolean {
  return !!scheduleFor(termId) && sectionCount(course, termId) > 0
}

/** Offered in any released class schedule. */
export function onAnySchedule(course: CatalogCourse): boolean {
  return Object.keys(SCHEDULES).some((t) => sectionCount(course, t) > 0)
}

/* ─── Sections ───────────────────────────────────────────────────────────── */

export function timedMeetings(s: Section): Meeting[] {
  return s.meetings.filter((m) => m.days.length && m.start && m.end)
}

/** "Mon & Wed 2:00–3:15 PM" for each timed meeting; "Online, no set time" / "Time to be arranged" otherwise. */
export function meetingSummary(s: Section): string[] {
  const timed = timedMeetings(s)
  if (timed.length) return timed.map((m) => `${fmtDaysLong(m.days)} ${fmtTimeRange(m.start, m.end)}`)
  if (s.mode === 'online-async') return ['Online, no set meeting time']
  return ['Time to be arranged']
}

export function locationText(m: Meeting): string {
  if (m.online) return 'Online'
  if (!m.building) return ''
  return m.room ? `${m.building} ${m.room}` : m.building
}

export function seatsText(s: Section): string {
  if (s.seats.full || s.seats.remaining <= 0) {
    return s.waitlist && s.waitlist.capacity > 0 ? `Full · waitlist ${s.waitlist.count}/${s.waitlist.capacity}` : 'Full'
  }
  return `${s.seats.remaining} of ${s.seats.capacity} open`
}

export function isFull(s: Section): boolean {
  return s.seats.full || s.seats.remaining <= 0
}

export const MODE_LABEL: Record<Section['mode'], string> = {
  'in-person': 'In person',
  'online-sync': 'Online, live',
  'online-async': 'Online, self-paced',
  hybrid: 'Hybrid',
  arranged: 'Arranged',
}

/** Meeting blocks written into the plan for a chosen section, so older copies of the app still show the times. */
export function blocksFromSections(sections: Section[]): MeetingBlock[] {
  const blocks: MeetingBlock[] = []
  for (const s of sections) {
    const type = /laboratory|lab/i.test(s.scheduleType) && !/^lecture/i.test(s.scheduleType) ? 'Lab' : /lecture/i.test(s.scheduleType) ? 'Lecture' : 'Other'
    s.meetings.forEach((m, i) => {
      if (!m.days.length || !m.start || !m.end) return
      blocks.push({
        id: `${s.crn}-${i}`,
        type,
        days: m.days.filter((d) => ['M', 'T', 'W', 'Th', 'F'].includes(d)),
        startTime: m.start,
        endTime: m.end,
        location: locationText(m),
        instructor: s.instructors.map((p) => p.display).join(', '),
        crn: s.crn,
      })
    })
  }
  return blocks
}

/* ─── Chosen sections ────────────────────────────────────────────────────── */

export interface PartPick {
  part: GradePart
  /** Sections offered for this part in the term. */
  sections: Section[]
  /** The chosen one, if any. */
  picked: Section | null
}

export function partPicks(course: CatalogCourse, entry: PlanEntry | null, termId: TermId): PartPick[] {
  return partsWithSections(course, termId).map(({ part, sections }) => {
    const crn = entry?.sections?.[part.codeId]
    return { part, sections, picked: crn ? sectionByCrn(termId, crn) : null }
  })
}

/** Chosen sections by graded part; null = none chosen. */
export type SectionDraft = Record<string, string | null>

/** The term's entries with one course's sections replaced by a draft (added when it isn't in the term). */
export function entriesWithDraft(entries: PlanEntry[], courseId: string, draft: SectionDraft): PlanEntry[] {
  const sections = Object.fromEntries(Object.entries(draft).filter(([, crn]) => !!crn)) as Record<string, string>
  const next: PlanEntry = { courseId, blocks: [], sections }
  return entries.some((e) => e.courseId === courseId) ? entries.map((e) => (e.courseId === courseId ? next : e)) : [...entries, next]
}

/* ─── Calendar events ────────────────────────────────────────────────────── */

export interface CalEvent {
  key: string
  courseId: string
  code: string
  title: string
  /** The graded part's code — "CSC 3210L" for a lab. */
  partCode: string
  /** The graded part's name — "Computer Organization & Programming Lab" for a lab. */
  partTitle: string
  type: string
  day: DayCode
  startTime: string
  endTime: string
  start: number
  end: number
  location: string
  instructors: string[]
  instructorKeys: string[]
  crn: string
  section: Section | null
  colorIndex: number
  conflict: boolean
}

export interface UntimedItem {
  courseId: string
  code: string
  title: string
  /** pick: a section still has to be chosen · async/arranged: the chosen section has no set time ·
   *  not-offered: no section this term · none: no meeting time entered */
  reason: 'pick' | 'async' | 'arranged' | 'not-offered' | 'none'
  section: Section | null
  colorIndex: number
}

const DAY_ORDER_ALL: DayCode[] = ['M', 'T', 'W', 'Th', 'F', 'Sa', 'Su']

/** Two events clash when they overlap on the same day — different courses, or a lecture and its own lab. */
function clash(a: CalEvent, b: CalEvent): boolean {
  if (a.day !== b.day || !(a.start < b.end && b.start < a.end)) return false
  return a.courseId !== b.courseId || (!!a.crn && !!b.crn && a.crn !== b.crn)
}

/**
 * Calendar events for one term: chosen sections where there are any, otherwise the
 * hand-entered meeting blocks. Overlapping events on the same day are flagged.
 */
export function termEvents(termId: TermId, entries: PlanEntry[]): { events: CalEvent[]; untimed: UntimedItem[]; days: DayCode[] } {
  const events: CalEvent[] = []
  const untimed: UntimedItem[] = []
  const hasData = !!scheduleFor(termId)
  entries.forEach((entry, colorIndex) => {
    const course = findCourse(entry.courseId)
    if (!course) return
    const picks = hasData ? partPicks(course, entry, termId) : []
    const anyPicked = picks.some((p) => p.picked)
    const offered = picks.some((p) => p.sections.length)
    const hasTimedBlocks = entry.blocks.some((b) => b.days.length && b.startTime)
    if (hasData && !offered && !hasTimedBlocks) {
      untimed.push({ courseId: course.id, code: course.code, title: course.title, reason: 'not-offered', section: null, colorIndex })
    } else if (hasData && (anyPicked || !hasTimedBlocks)) {
      for (const p of picks) {
        if (!p.picked) {
          if (p.sections.length) untimed.push({ courseId: course.id, code: p.part.code, title: p.part.title, reason: 'pick', section: null, colorIndex })
          continue
        }
        const s = p.picked
        const timed = timedMeetings(s)
        if (!timed.length) untimed.push({ courseId: course.id, code: p.part.code, title: p.part.title, reason: s.mode === 'online-async' ? 'async' : 'arranged', section: s, colorIndex })
        timed.forEach((m, i) => m.days.forEach((day) => events.push({
          key: `${s.crn}-${i}-${day}`, courseId: course.id, code: course.code, title: course.title, partCode: p.part.code, partTitle: p.part.title,
          type: /laboratory/i.test(s.scheduleType) && !/^lecture/i.test(s.scheduleType) ? 'Lab' : 'Class',
          day, startTime: m.start!, endTime: m.end!, start: timeToMin(m.start), end: timeToMin(m.end),
          location: locationText(m), instructors: s.instructors.map((x) => x.display), instructorKeys: s.instructors.map((x) => x.key),
          crn: s.crn, section: s, colorIndex, conflict: false,
        })))
      }
    } else {
      const timed = entry.blocks.filter((b) => b.days.length && b.startTime && b.endTime && timeToMin(b.endTime) > timeToMin(b.startTime))
      if (!timed.length) untimed.push({ courseId: course.id, code: course.code, title: course.title, reason: 'none', section: null, colorIndex })
      timed.forEach((b) => b.days.forEach((day) => events.push({
        key: `${b.id}-${day}`, courseId: course.id, code: course.code, title: course.title, partCode: course.code, partTitle: course.title,
        type: b.type, day: day as DayCode, startTime: b.startTime, endTime: b.endTime, start: timeToMin(b.startTime), end: timeToMin(b.endTime),
        location: b.location, instructors: b.instructor ? [b.instructor] : [], instructorKeys: [], crn: b.crn, section: null, colorIndex, conflict: false,
      })))
    }
  })
  for (let i = 0; i < events.length; i++) for (let j = i + 1; j < events.length; j++) {
    if (clash(events[i], events[j])) events[i].conflict = events[j].conflict = true
  }
  const used = new Set(events.map((e) => e.day))
  const days = DAY_ORDER_ALL.filter((d) => ['M', 'T', 'W', 'Th', 'F'].includes(d) || used.has(d))
  return { events, untimed, days }
}

/** A class a section would overlap, and on which days. */
export interface Clash {
  courseId: string
  code: string
  title: string
  days: DayCode[]
}

/**
 * What a candidate section for one part of a course would overlap: the rest of the term's
 * week, plus the course's other part (a lecture and its lab can't meet at the same time).
 */
export function clashesFor(termId: TermId, entries: PlanEntry[], courseId: string, partCodeId: string, section: Section, draft: SectionDraft = {}): Clash[] {
  const others = termEvents(termId, entriesWithDraft(entries, courseId, { ...draft, [partCodeId]: null })).events
  const found = new Map<string, Clash>()
  for (const m of timedMeetings(section)) {
    const s = timeToMin(m.start), e = timeToMin(m.end)
    for (const o of others) {
      if (!m.days.includes(o.day) || !(s < o.end && o.start < e)) continue
      const hit = found.get(o.partCode) ?? { courseId: o.courseId, code: o.partCode, title: o.partTitle, days: [] }
      if (!hit.days.includes(o.day)) hit.days.push(o.day)
      found.set(o.partCode, hit)
    }
  }
  return [...found.values()].map((c) => ({ ...c, days: DAY_ORDER_ALL.filter((d) => c.days.includes(d)) }))
}

/** "Linear Algebra I (Tue & Thu)" */
export function clashText(c: Clash): string {
  return `${c.title} (${fmtDaysLong(c.days)})`
}

/** Does this section clash with anything else already chosen (or entered) in the term? */
export function sectionConflicts(termId: TermId, entries: PlanEntry[], courseId: string, section: Section): string[] {
  return clashesFor(termId, entries, courseId, section.codeId, section).map((c) => c.code)
}

/** The hours a calendar shows: at least `min` (8 AM – 6 PM), stretched to fit every class. */
export function hourRange(events: CalEvent[], min: [number, number] = [8, 18]): [number, number] {
  if (!events.length) return min
  const first = Math.min(...events.map((e) => e.start))
  const last = Math.max(...events.map((e) => e.end))
  return [Math.min(min[0], Math.floor(first / 60)), Math.max(min[1], Math.ceil(last / 60))]
}

/** A break between two classes on the same day. */
export interface Gap {
  key: string
  day: DayCode
  /** Minutes since midnight: the earlier class ends, the later one starts. */
  from: number
  to: number
  minutes: number
  before: CalEvent
  after: CalEvent
}

/**
 * Short breaks between back-to-back classes (at most `maxMinutes`), optionally only the
 * ones next to a given course. Overlapping classes are clashes, not gaps.
 */
export function shortGaps(events: CalEvent[], { maxMinutes = 60, courseId }: { maxMinutes?: number; courseId?: string } = {}): Gap[] {
  const gaps: Gap[] = []
  for (const day of DAY_ORDER_ALL) {
    const list = events.filter((e) => e.day === day).sort((a, b) => a.start - b.start || a.end - b.end)
    let prev: CalEvent | null = null
    for (const e of list) {
      if (prev && e.start >= prev.end) {
        const minutes = e.start - prev.end
        if (minutes <= maxMinutes && (!courseId || prev.courseId === courseId || e.courseId === courseId)) {
          gaps.push({ key: `${prev.key}~${e.key}`, day, from: prev.end, to: e.start, minutes, before: prev, after: e })
        }
      }
      if (!prev || e.end > prev.end) prev = e
    }
  }
  return gaps
}

/* ─── Professors (RateMyProfessors, Georgia State) ──────────────────────── */

export function professorFor(key: string | null | undefined): Professor | null {
  return (key && PROFESSORS.professors[key]) || null
}

/** Every Spring 2027 section a professor teaches. */
export function sectionsTaughtBy(termId: TermId, key: string): Section[] {
  const out: Section[] = []
  for (const c of scheduleFor(termId)?.courses ?? []) for (const s of c.sections) if (s.instructors.some((i) => i.key === key)) out.push(s)
  return out
}

export function allProfessors(): Professor[] {
  return Object.values(PROFESSORS.professors).sort((a, b) => a.display.localeCompare(b.display))
}
