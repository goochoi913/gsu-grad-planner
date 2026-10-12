/**
 * Shapes shared by the degree data (src/data/degree.ts), the planning logic
 * (src/lib/planner.ts) and the three Firestore documents:
 *   planner/sharedSchedule  the plan (PlanDoc)
 *   planner/academicRecord  past terms, grades, advisor exceptions (AcademicRecord)
 *   planner/gpaProjection   what-if grades, Repeat to Replace switches, GPA target (Projection)
 */

export type Season = 'spring' | 'summer' | 'fall'

/** "spring2027" */
export type TermId = string

export interface Term {
  id: TermId
  /** year * 3 + season index — orders terms. */
  key: number
  season: Season
  year: number
  label: string
  shortLabel: string
  emoji: string
  maxCredits: number
}

/* ── degree data ─────────────────────────────────────────────────── */

export interface DegreeBlock {
  key: string
  name: string
  short: string
  /** The Degree Works block title. */
  dw: string
  credits: number | null
  /** Program Advice re-uses courses applied elsewhere. */
  shared?: boolean
  note: string
}

export interface LinePattern {
  subject: string
  min: number
  max: number
  exclude: string[]
  limited: string[]
  limitedMax: number
}

export interface RequirementLine {
  id: string
  block: string
  group: string
  label: string
  credits: number | null
  count: number | null
  courses: string[]
  pattern: LinePattern | null
  list: boolean
  recordOnly: boolean
  minGrade: string
  note: string
}

export interface Substitution {
  course: string
  line: string
  complete: string[]
  label: string
  applyNote: string
  completeNote: string
}

/** A course id, or a list of ids of which any one is enough. */
export type PrereqCondition = string | string[]

export type LibrarySection = 'major' | 'core' | 'fos' | 'elective' | 'rpe'

export interface CatalogCourse {
  id: string
  code: string
  title: string
  credits: number
  level: number
  section: LibrarySection
  tag: string
  kind: string
  /** Lecture + lab registered separately. */
  parts: { code: string; credits: number }[]
  /** Older course numbers (e.g. PHYS 2212K). */
  aliases: string[]
  prereq: PrereqCondition[]
  prereqText: string
  note: string
  /** Sections per term in OFFERING_TERMS order. */
  offered: number[]
  description: string
}

export interface SuggestedPath {
  id: string
  name: string
  graduation: string
  emoji: string
  note: string
  terms: Record<TermId, string[]>
}

/* ── the academic record (planner/academicRecord) ───────────────── */

export type RecordStatus = 'counted' | 'unused' | 'nocredit' | 'notcounted'

export interface RecordCourse {
  id: string
  code: string
  title: string
  credits: number
  grade: string
  status: RecordStatus
  /** A requirement line id, 'auto' or 'elective' — '' unless status is 'counted'. */
  line: string
  gpa: boolean
  transfer: boolean
  school: string
  equiv: string
  note: string
  /** First grade removed by an approved Repeat to Replace. */
  r2r: boolean
}

export interface RecordTerm extends Term {
  note: string
  courses: RecordCourse[]
}

export interface Exception {
  id: string
  type: 'substitute' | 'waive'
  /** A requirement line id, or a block key (area total) for waivers. */
  target: string
  course: string
  /** null = the whole requirement (force complete). */
  credits: number | null
  note: string
}

export interface ReportedAudit {
  auditDate: string
  catalogYear: string
  gsuGpa: number | null
  overallGpa: number | null
  creditsApplied: number | null
}

export interface AcademicRecord {
  version: number
  /** false until a record document exists in Firebase. */
  exists: boolean
  source: string
  reported: ReportedAudit | null
  terms: RecordTerm[]
  exceptions: Exception[]
}

/** The stored shape of a record course (no derived fields). */
export type RecordCourseInput = Partial<Omit<RecordCourse, 'status'>> & { status?: string; code?: string }

/* ── the plan (planner/sharedSchedule) ──────────────────────────── */

/** A meeting time the planner draws on the calendar. */
export interface MeetingBlock {
  id: string
  type: string
  days: string[]
  startTime: string
  endTime: string
  location: string
  instructor: string
  crn: string
}

export interface PlanEntry {
  courseId: string
  blocks: MeetingBlock[]
  /**
   * Chosen class-schedule sections, by graded part: { CSC3210: "14634", CSC3210L: "20706" }.
   * Only present once a section has been picked.
   */
  sections?: Record<string, string>
}

export type PlanSchedule = Record<TermId, PlanEntry[]>

export interface PlanDoc {
  version: number
  lastTermId: TermId
  schedule: PlanSchedule
  sidebarCollapsed: boolean
  sectionsCollapsed: Record<string, boolean>
  view: 'planner' | 'calendar'
  calSemester: TermId
  expandedTerms: TermId[] | null
}

/* ── the GPA projection (planner/gpaProjection) ─────────────────── */

export interface Projection {
  version: 1
  grades: Record<string, string>
  r2r: Record<string, boolean>
  target: { gpa: number; termId: TermId }
}
