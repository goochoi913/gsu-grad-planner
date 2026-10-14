/**
 * Which courses she still needs — so the course list and the class browser can leave out
 * what can't help her graduate: courses already passed, alternatives for requirements the plan
 * already covers, and catalog courses GSU hasn't offered in years and hasn't scheduled.
 *
 * Worked out at runtime from the record and the plan (both in Firebase), so nothing about her
 * history is built into the site. Removing a course from the plan reopens its requirement, and
 * the alternatives come back on their own.
 */
import type { CatalogCourse } from '@/lib/types'
import { BLOCK_BY_KEY, courseCodes, isCourseDone, lineAccepts, subjectLevel, type Audit, type AuditUnit, type LineResult } from '@/lib/planner'
import { scheduledIn } from '@/lib/plan-ops'
import { onAnySchedule } from '@/lib/schedule'
import type { PlannerSnapshot } from '@/lib/store'

export type NeedReason =
  /** In an upcoming term of the plan. */
  | 'planned'
  /** Fills a requirement that is still open. */
  | 'open'
  /** Passed already. */
  | 'done'
  /** Everything it could count toward is covered by the record and the plan. */
  | 'covered'
  /** Not offered Spring 2024 – Fall 2026 and not on a released class schedule. */
  | 'unavailable'

export interface CourseNeed {
  needed: boolean
  why: NeedReason
}

export const NEED_TEXT: Record<NeedReason, string> = {
  planned: 'In the plan',
  open: 'Fills a requirement that is still open',
  done: 'Already passed',
  covered: 'Not needed — the plan already covers what it counts toward',
  unavailable: 'Not offered since 2024 and not on the schedule',
}

/** The course as the audit would see it if it were planned. */
function asPlannedUnit(course: CatalogCourse): AuditUnit {
  return { kind: 'planned', course, courseId: course.id, code: course.code, codes: courseCodes(course), ...subjectLevel(course.id), credits: course.credits } as AuditUnit
}

/**
 * Requirement lines this course could still fill: lines the record and the plan leave short.
 * (An area total is only ever filled through its lines — the audit stops adding courses to a
 * line once it is met — so a line that is met can't use another course.)
 */
export function openLinesFor(course: CatalogCourse, audit: Audit): LineResult[] {
  const unit = asPlannedUnit(course)
  return audit.lines.filter((l) => {
    if (l.status !== 'missing' || BLOCK_BY_KEY[l.block].shared || !lineAccepts(l, unit)) return false
    // "Any 2000–4999 course" would match everything: only the courses listed for it are its candidates.
    return !(l.pattern && !l.pattern.subject && course.section !== l.block)
  })
}

export function courseNeed(course: CatalogCourse, snap: Pick<PlannerSnapshot, 'semesters' | 'plan' | 'audit' | 'recordStatus'>): CourseNeed {
  if (isCourseDone(course.id)) return { needed: false, why: 'done' }
  if (scheduledIn(snap.semesters, snap.plan.schedule, course.id)) return { needed: true, why: 'planned' }
  if (!course.offered.some(Boolean) && !onAnySchedule(course)) return { needed: false, why: 'unavailable' }
  // Until the record has loaded nothing is known to be covered.
  if (snap.recordStatus !== 'ready') return { needed: true, why: 'open' }
  return openLinesFor(course, snap.audit).length ? { needed: true, why: 'open' } : { needed: false, why: 'covered' }
}
