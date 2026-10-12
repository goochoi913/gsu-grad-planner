/**
 * The class schedule (Spring 2027 from the CSVs, enriched from GSU's class search),
 * the professors' RateMyProfessors data, and everything derived from a chosen section:
 * meeting blocks, calendar events, time conflicts, the CRN list for registration.
 */
import spring2027 from '@/data/spring2027.json'
import professorsData from '@/data/professors.json'
import type { CatalogCourse, MeetingBlock, PlanEntry, TermId } from '@/lib/types'
import type { DayCode, Meeting, Professor, ProfessorsFile, ScheduleCourse, Section, TermSchedule } from '@/lib/schedule-types'
import { catalogIdForCode, courseGradeParts, findCourse, type GradePart } from '@/lib/planner'
import { fmtDaysLong, fmtTimeRange, timeToMin } from '@/lib/format'

export const SCHEDULES: Record<TermId, TermSchedule> = {
  [(spring2027 as unknown as TermSchedule).termId]: spring2027 as unknown as TermSchedule,
}
export const PROFESSORS = professorsData as unknown as ProfessorsFile

/** The term the class schedule was released for — where section picking happens. */
export const SCHEDULE_TERM_ID: TermId = (spring2027 as unknown as TermSchedule).termId

const sectionIndex = new Map<TermId, Map<string, Section>>()
const courseIndex = new Map<TermId, Map<string, ScheduleCourse>>()
for (const [termId, sched] of Object.entries(SCHEDULES)) {
  const byCrn = new Map<string, Section>(), byCode = new Map<string, ScheduleCourse>()
  for (const c of sched.courses) {
    byCode.set(c.codeId, c)
    for (const s of c.sections) byCrn.set(s.crn, s)
  }
  sectionIndex.set(termId, byCrn)
  courseIndex.set(termId, byCode)
}

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

/* ─── Calendar events ────────────────────────────────────────────────────── */

export interface CalEvent {
  key: string
  courseId: string
  code: string
  title: string
  /** The graded part's code — "CSC 3210L" for a lab. */
  partCode: string
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
          if (p.sections.length) untimed.push({ courseId: course.id, code: p.part.code, title: course.title, reason: 'pick', section: null, colorIndex })
          continue
        }
        const s = p.picked
        const timed = timedMeetings(s)
        if (!timed.length) untimed.push({ courseId: course.id, code: p.part.code, title: course.title, reason: s.mode === 'online-async' ? 'async' : 'arranged', section: s, colorIndex })
        timed.forEach((m, i) => m.days.forEach((day) => events.push({
          key: `${s.crn}-${i}-${day}`, courseId: course.id, code: course.code, title: course.title, partCode: p.part.code,
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
        key: `${b.id}-${day}`, courseId: course.id, code: course.code, title: course.title, partCode: course.code,
        type: b.type, day: day as DayCode, startTime: b.startTime, endTime: b.endTime, start: timeToMin(b.startTime), end: timeToMin(b.endTime),
        location: b.location, instructors: b.instructor ? [b.instructor] : [], instructorKeys: [], crn: b.crn, section: null, colorIndex, conflict: false,
      })))
    }
  })
  for (let i = 0; i < events.length; i++) for (let j = i + 1; j < events.length; j++) {
    const a = events[i], b = events[j]
    if (a.day === b.day && a.courseId !== b.courseId && a.start < b.end && b.start < a.end) a.conflict = b.conflict = true
  }
  const used = new Set(events.map((e) => e.day))
  const days = DAY_ORDER_ALL.filter((d) => ['M', 'T', 'W', 'Th', 'F'].includes(d) || used.has(d))
  return { events, untimed, days }
}

/** Does this section clash with anything else already chosen (or entered) in the term? */
export function sectionConflicts(termId: TermId, entries: PlanEntry[], courseId: string, section: Section): string[] {
  const others = termEvents(termId, entries).events.filter((e) => e.courseId !== courseId)
  const clashes = new Set<string>()
  for (const m of timedMeetings(section)) {
    const s = timeToMin(m.start), e = timeToMin(m.end)
    for (const o of others) if (m.days.includes(o.day) && s < o.end && o.start < e) clashes.add(o.partCode)
  }
  return [...clashes]
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
