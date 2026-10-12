/**
 * Planning rules the old view files applied (js/app.js, board.js, library.js, modal.js,
 * record.js, gpa.js), as pure functions over the plan, the record and the audit.
 */
import { BLOCKS, DEGREE, GRADE_POINTS, MAX_SEMESTER_COUNT, SUGGESTED_PATHS } from '@/data/degree'
import type { AcademicRecord, CatalogCourse, MeetingBlock, PlanEntry, PlanSchedule, PrereqCondition, RecordCourse, RecordStatus, Term, TermId } from '@/lib/types'
import {
  BLOCK_BY_KEY,
  SEASON_META,
  attemptsFor,
  buildPathPlan,
  buildSemesters,
  catalogIdForCode,
  cleanCode,
  codeToId,
  computeAudit,
  conditionLabel,
  earnsCredit,
  findCourse,
  fmtCredits,
  gradeMeets,
  hasGradePoints,
  indexRecord,
  isCourseDone,
  makeTerm,
  matchingPathId,
  minGradeFor,
  normalizeRecord,
  offeringInfo,
  pathById,
  recordForSave,
  round2,
  statusForGrade,
  termIdKey,
  termKey,
  unmetConditions,
  type Attempt,
  type Audit,
  type AuditStatus,
  type BlockResult,
  type LineResult,
  type UnitRole,
} from '@/lib/planner'
import { timeToMin } from '@/lib/format'

/* ─── Text ───────────────────────────────────────────────────────────────── */

/** Catalog descriptions sometimes repeat a sentence ("Crosslisted with CSC 6360. Crosslisted with CSc 6360."). */
export function cleanDescription(text: string): string {
  const seen = new Set<string>()
  const key = (s: string) => s.toLowerCase().replace(/[()]/g, '').replace(/\s+/g, ' ').trim()
  return text
    .split(/(?<=\.)\s+/)
    .filter((s) => {
      const k = key(s)
      if (!k || seen.has(k)) return false
      seen.add(k)
      return true
    })
    .join(' ')
    .replace(/\s+\d+$/, '')
}

/* ─── Plan queries ───────────────────────────────────────────────────────── */

export function scheduledIn(semesters: Term[], schedule: PlanSchedule, courseId: string): TermId | null {
  for (const s of semesters) if (schedule[s.id]?.some((e) => e.courseId === courseId)) return s.id
  return null
}

export function entryFor(schedule: PlanSchedule, semId: TermId, courseId: string): PlanEntry | null {
  return schedule[semId]?.find((e) => e.courseId === courseId) ?? null
}

export function semesterCredits(schedule: PlanSchedule, semId: TermId): number {
  return round2((schedule[semId] || []).reduce((s, { courseId }) => s + (findCourse(courseId)?.credits || 0), 0))
}

// A prerequisite counts when it has a passing grade, or is planned in a strictly earlier term.
export function availableBefore(semesters: Term[], schedule: PlanSchedule, semId: TermId) {
  const idx = semesters.findIndex((s) => s.id === semId)
  const earlier = semesters.slice(0, Math.max(0, idx))
  return (id: string) => isCourseDone(id) || earlier.some((s) => (schedule[s.id] || []).some((e) => e.courseId === id))
}

export function unmetPrereqs(semesters: Term[], schedule: PlanSchedule, courseId: string, semId: TermId): PrereqCondition[] {
  return unmetConditions(courseId, availableBefore(semesters, schedule, semId))
}

export function unmetPrereqsGlobal(semesters: Term[], schedule: PlanSchedule, courseId: string): PrereqCondition[] {
  return unmetConditions(courseId, (id) => isCourseDone(id) || !!scheduledIn(semesters, schedule, id))
}

// Earlier attempts that did not count (retakes), e.g. "F · Spring 2026".
export function failedAttempts(courseId: string): Attempt[] {
  return attemptsFor(courseId).filter((a) => !earnsCredit(a.rec) || !gradeMeets(a.rec.grade, minGradeFor(a.rec.code)))
}

export function lastPassingAttempt(id: string): Attempt | null {
  return attemptsFor(id).filter((a) => earnsCredit(a.rec) && gradeMeets(a.rec.grade, minGradeFor(a.rec.code))).pop() || null
}

/* ─── Adding, moving, removing ───────────────────────────────────────────── */

export type AddCheck =
  | { ok: true; warnings: string[] }
  | { ok: false; reason: string; tone: 'info' | 'warn' }

/** The rules addCourse() enforced: completed courses, duplicates and the 18-credit cap refuse; prerequisites and offering history only warn. */
export function checkAdd(semesters: Term[], schedule: PlanSchedule, courseId: string, semId: TermId): AddCheck {
  const sem = semesters.find((s) => s.id === semId)
  const course = findCourse(courseId)
  if (!sem || !course) return { ok: false, reason: 'That term or course is not part of the plan.', tone: 'warn' }
  if (isCourseDone(courseId)) return { ok: false, reason: `${course.code} already has a passing grade on the record.`, tone: 'info' }
  if ((schedule[semId] || []).some((e) => e.courseId === courseId)) return { ok: false, reason: `${course.code} is already in ${sem.label}.`, tone: 'info' }
  if (semesterCredits(schedule, semId) + course.credits > sem.maxCredits) {
    return { ok: false, reason: `Adding ${course.credits} credits would go over the ${sem.maxCredits}-credit limit for ${sem.label}.`, tone: 'warn' }
  }
  const warnings: string[] = []
  const unmet = unmetPrereqs(semesters, schedule, courseId, semId)
  if (unmet.length) warnings.push(`needs ${unmet.map(conditionLabel).join(' and ')} in an earlier semester`)
  if (offeringInfo(course, sem.season).level === 'none') warnings.push(`was not offered in ${SEASON_META[sem.season].label} 2024–2026`)
  return { ok: true, warnings }
}

/**
 * Places a course in a term, taking it out of any other term. Hand-entered meeting
 * times move with it; chosen class-schedule sections belong to their term and don't.
 */
export function withCourseAdded(semesters: Term[], schedule: PlanSchedule, courseId: string, semId: TermId): PlanSchedule {
  const next: PlanSchedule = {}
  let carried: MeetingBlock[] = []
  for (const s of semesters) {
    const list = schedule[s.id] || []
    const existing = list.find((e) => e.courseId === courseId)
    if (existing?.blocks?.length && !existing.sections) carried = existing.blocks
    next[s.id] = list.filter((e) => e.courseId !== courseId)
  }
  next[semId] = [...(next[semId] || []), { courseId, blocks: carried }]
  return next
}

export function withCourseRemoved(schedule: PlanSchedule, courseId: string, semId: TermId): PlanSchedule {
  return { ...schedule, [semId]: (schedule[semId] || []).filter((e) => e.courseId !== courseId) }
}

/** The next term the plan can grow into, or null at the 12-term limit. */
export function nextTermToAdd(semesters: Term[]): Term | null {
  return semesters.length >= MAX_SEMESTER_COUNT ? null : makeTerm(semesters[semesters.length - 1].key + 1)
}

/* ─── Meeting-time conflicts (block-aware) ───────────────────────────────── */

export function hasTime(b: { days?: string[]; startTime?: string }): boolean {
  return !!b.days?.length && !!b.startTime
}

export function blocksOverlap(blocksA: MeetingBlock[], blocksB: MeetingBlock[]): boolean {
  for (const a of blocksA) {
    if (!hasTime(a)) continue
    for (const b of blocksB) {
      if (!hasTime(b)) continue
      if (!a.days.some((d) => b.days.includes(d))) continue
      if (timeToMin(a.startTime) < timeToMin(b.endTime) && timeToMin(b.startTime) < timeToMin(a.endTime)) return true
    }
  }
  return false
}

/* ─── Suggested paths ────────────────────────────────────────────────────── */

export function pathTitle(path: { name: string }): string {
  return `${path.name.replace(/ semesters?$/, '-semester')} path`
}

export function currentPathId(schedule: PlanSchedule, startKey: number): string | null {
  return matchingPathId(schedule, startKey, isCourseDone)
}

export interface PathPreview {
  sems: Term[]
  credits: number[]
  missing: number
  pending: number
}

export function pathPreview(record: AcademicRecord, pathId: string, startKey: number): PathPreview {
  const plan = buildPathPlan(pathId, startKey, isCourseDone)
  const sems = buildSemesters(startKey, termIdKey(plan.lastTermId) - startKey + 1)
  const audit = computeAudit(record, plan.schedule, sems)
  const credits = sems.map((s) => round2((plan.schedule[s.id] || []).reduce((t, e) => t + (findCourse(e.courseId)?.credits || 0), 0)))
  return { sems, credits, missing: audit.missing, pending: audit.pending.length }
}

export { SUGGESTED_PATHS, pathById }

/* ─── Degree Works meters (header rail) ──────────────────────────────────── */

export const STATUS_TEXT: Record<AuditStatus, string> = {
  met: 'complete',
  planned: 'covered by the plan',
  pending: 'needs an advisor exception',
  missing: 'still needed',
}

export interface Meter {
  key: string
  name: string
  short: string
  status: AuditStatus
  required: number
  /** Completed credits plus recorded waivers. */
  done: number
  planned: number
  /** Waiting on an advisor exception. */
  pending: number
}

export function blockMeter(b: BlockResult): Meter {
  const lineSum = (key: 'credits' | 'done' | 'waived' | 'planned' | 'pendingCredits' | 'pendingWaiver') =>
    round2(b.lines.reduce((s, l) => s + ((l[key] as number | null) ?? 0), 0))
  const short = BLOCK_BY_KEY[b.key].short
  if (b.shared) {
    return { key: b.key, name: b.name, short, status: b.status, required: lineSum('credits'),
      done: round2(lineSum('done') + lineSum('waived')), planned: lineSum('planned'), pending: round2(lineSum('pendingCredits') + lineSum('pendingWaiver')) }
  }
  return { key: b.key, name: b.name, short, status: b.status, required: b.credits ?? 0,
    done: round2(b.done + b.waived), planned: b.planned, pending: round2(b.pendingCredits + b.pendingWaiver) }
}

export function allMeters(audit: Audit): Meter[] {
  return [...audit.blocks.map(blockMeter),
    { key: 'total', name: 'Total credits', short: 'Total', status: audit.total.status, required: audit.total.required, done: audit.total.done, planned: audit.total.planned, pending: 0 }]
}

/* ─── How a course counts ────────────────────────────────────────────────── */

export const SECTION_ROLE: Record<string, string> = {
  major: 'Major requirement',
  core: 'IMPACTS Core',
  fos: 'Field of Study',
  elective: 'Major — CSC elective (3000/4000)',
  rpe: 'Required Program Electives – CSC (2000–4000)',
}

/** Short label for where a planned course counts: "Major", "CSC elective", "Extra credit". */
export function roleShort(role: UnitRole | undefined): string {
  if (!role) return ''
  if (!role.block) return 'Extra credit'
  if (role.lineId === 'major.elec') return 'CSC elective'
  return BLOCK_BY_KEY[role.block].short
}

export function roleText(course: CatalogCourse, audit: Audit): string {
  if (isCourseDone(course.id)) {
    const a = lastPassingAttempt(course.id)
    return `Completed${a ? ` · ${a.rec.grade || ''} · ${a.term.label}` : ''}`
  }
  const role = audit.roles[course.id]
  if (role?.block) return `Counts toward ${role.blockName} · ${role.label}${role.pending ? ' (needs an advisor exception)' : ''}`
  if (role) return 'Extra credit — counts toward the 120 total only'
  return SECTION_ROLE[course.section]
}

// For "pick one" requirements already covered by another course, a short explanation.
export function coveredBy(course: CatalogCourse, audit: Audit): string {
  const lineId = ({ osplc: 'major.osplc', capstone: 'major.cap1', fos: 'fos.addl', labseq: 'core.labseq' } as Record<string, string>)[course.tag]
  const line = lineId && audit.lineById[lineId]
  if (!line || line.status === 'missing' || line.units.some((u) => u.kind === 'planned' && u.courseId === course.id)) return ''
  if (line.forced || line.substitutions.length) return `${line.label}: met by an advisor exception`
  const codes = [...new Set(line.units.map((u) => u.code))]
  return codes.length ? `${line.label}: ${codes.join(' + ')}${line.status === 'pending' ? ' (needs an advisor exception)' : ''}` : ''
}

export function recordWhere(c: RecordCourse, audit: Audit | null): string {
  if (c.status !== 'counted') return RECORD_STATUS_LABEL[c.status]
  const role = audit?.roles[c.id]
  if (!role) return RECORD_STATUS_LABEL.counted
  return role.lineId === 'elective' ? 'Elective credit (120 total)' : `${role.blockName} · ${role.label}`
}

const RECORD_STATUS_LABEL: Record<RecordStatus, string> = {
  counted: 'Counts toward the degree',
  unused: 'Earned, but not used for this program',
  nocredit: 'No credit (failed or withdrawn)',
  notcounted: 'Not counted',
}

/* ─── Audit wording ──────────────────────────────────────────────────────── */

export function statusSentence(a: Audit, recordStatus: string): string {
  if (recordStatus === 'missing') return 'Import the academic record to see what is already complete.'
  if (a.status === 'incomplete') return `${a.missing} requirement${a.missing > 1 ? 's are' : ' is'} not covered by completed or planned courses yet.`
  if (a.status === 'pending') return `The plan covers every course requirement. ${a.pending.length} item${a.pending.length > 1 ? 's need' : ' needs'} an advisor exception before Degree Works counts ${a.pending.length > 1 ? 'them' : 'it'}.`
  if (a.status === 'planned') return 'The plan covers every requirement, including the recorded exceptions.'
  return 'Every requirement is complete.'
}

export function auditHeadline(a: Audit, recordStatus: string): string {
  if (recordStatus === 'missing') return 'No academic record yet'
  if (a.status === 'incomplete') return `${a.missing} requirement${a.missing > 1 ? 's' : ''} still open`
  if (a.status === 'pending') return `Covered — ${a.pending.length} advisor exception${a.pending.length > 1 ? 's' : ''} to go`
  if (a.status === 'planned') return 'Your plan covers everything'
  return 'Every requirement is complete'
}

export function stillNeededText(l: LineResult): string {
  if (l.recordOnly) return `${l.shortCount ? `${l.shortCount} course` : `${fmtCredits(l.short)} cr`} — add the course in the Record and pick this line under “Counts toward”`
  if (l.shortCount) return `${l.shortCount} course from ${l.courses.slice(0, 3).join(', ')}${l.courses.length > 3 ? '…' : ''}`
  const what = l.pattern
    ? (l.pattern.subject ? `${l.pattern.subject} ${Math.floor(l.pattern.min / 1000)}000/${Math.floor(l.pattern.max / 1000)}000-level courses` : 'any 2000–4999 level course, any subject')
    : l.list ? 'the Field of Study list' : l.courses.filter((c) => !/\d{4}L$/.test(c)).join(' or ')
  return `${fmtCredits(l.short)} cr in ${what}`
}

/* ─── Past terms on the board ────────────────────────────────────────────── */

export function defaultExpandedTerms(record: AcademicRecord): TermId[] {
  const terms = record.terms
  return terms.length ? [terms[terms.length - 1].id] : []
}

export function isTermExpanded(expanded: TermId[] | null, record: AcademicRecord, termId: TermId): boolean {
  return (expanded || defaultExpandedTerms(record)).includes(termId)
}

/* ─── Record editor ──────────────────────────────────────────────────────── */

/** Terms a course can be added to: the ones on the record, then every other past term back to Fall 2015. */
export function recordTermOptions(record: AcademicRecord, planStartKey: number): { onRecord: Term[]; others: Term[] } {
  const onRecord = new Set(record.terms.map((t) => t.id))
  const others: Term[] = []
  for (let k = planStartKey - 1; k >= termKey('fall', 2015); k--) {
    const t = makeTerm(k)
    if (!onRecord.has(t.id)) others.push(t)
  }
  return { onRecord: [...record.terms].reverse(), others }
}

/** A new grade suggests the status and whether it counts in the GPA, plus a hint. */
export function gradeSuggestion(code: string, grade: string): { status: RecordStatus; gpa: boolean; hint: string } {
  const status = statusForGrade(code, grade)
  const min = minGradeFor(code)
  const hint = status === 'notcounted' && grade && !['I', 'IP'].includes(grade)
    ? `${grade} is below the ${min} this course needs, so it won't count toward the degree or unlock later courses.`
    : status === 'nocredit' ? `${grade} earns no credit.` : ''
  return { status, gpa: grade in GRADE_POINTS, hint }
}

/** Fills title and credits from the library when a known code is typed. */
export function codeAutofill(rawCode: string): { title: string; credits: number; match: string } | null {
  const code = cleanCode(rawCode)
  const courseId = code && catalogIdForCode(code)
  if (!courseId) return null
  const course = findCourse(courseId)!
  const part = course.parts.find((p) => codeToId(p.code) === codeToId(code))
  const base = course.title.replace(/ \+ Lab$/, '')
  return {
    title: part && course.parts.indexOf(part) > 0 ? `${base} Lab` : base,
    credits: part ? part.credits : course.credits,
    match: course.code,
  }
}

// Warnings before saving an approved Repeat to Replace (catalog 1350.25).
export function r2rSaveWarnings(record: AcademicRecord, editingId: string | null, termId: TermId, code: string, grade: string, maxCourses: number): string[] {
  const warn: string[] = []
  const others = record.terms.flatMap((t) => t.courses).filter((c) => c.r2r && c.id !== editingId).length
  if (others >= maxCourses) warn.push(`Repeat to Replace is limited to ${maxCourses} courses, and ${others} are already marked.`)
  const id = codeToId(code), key = termIdKey(termId)
  const attempts = record.terms.flatMap((t) => t.courses.filter((c) => c.id !== editingId && codeToId(c.code) === id).map((c) => ({ c, key: t.key })))
  if (attempts.some((a) => a.key < key)) warn.push('Only the first recorded grade in a course can be replaced, and this course has an earlier attempt.')
  if (!attempts.some((a) => a.key > key && !a.c.transfer && hasGradePoints(a.c.grade) && GRADE_POINTS[a.c.grade] > GRADE_POINTS[grade])) warn.push('The record has no later, higher GSU grade in this course.')
  return warn
}

/* ─── Finishing a term ───────────────────────────────────────────────────── */

export interface GradeRow {
  courseId: string | null
  code: string
  title: string
  credits: number
  /** A letter, "__drop" for "not taken", or "" while unpicked. */
  grade: string
  extra?: boolean
}

export function gradeVerdict(row: GradeRow): { cls: 'todo' | 'drop' | RecordStatus; text: string } {
  if (!row.grade) return { cls: 'todo', text: 'Choose a grade' }
  if (row.grade === '__drop') return { cls: 'drop', text: 'Not taken — goes back to the course list' }
  const code = cleanCode(row.code)
  if (!code) return { cls: 'todo', text: 'Enter a course code' }
  const status = statusForGrade(code, row.grade)
  if (status === 'counted') return { cls: 'counted', text: 'Counts' }
  if (status === 'nocredit') return { cls: 'nocredit', text: `${row.grade === 'W' ? 'Withdrawn' : 'Failed'} — no credit` }
  return { cls: 'notcounted', text: ['I', 'IP'].includes(row.grade) ? 'Not counted until the grade posts' : `Below ${minGradeFor(code)} — won't count` }
}

/** The record once a term's final grades are in (rows marked "not taken" are left out). */
export function recordWithFinishedTerm(record: AcademicRecord, semId: TermId, rows: { code: string; title: string; credits: number; grade: string }[]): AcademicRecord {
  const draft = recordForSave(record)
  draft.terms = draft.terms.filter((t) => t.id !== semId)
  draft.terms.push({ id: semId, note: '', courses: rows.map((r) => ({
    code: r.code, title: r.title, credits: r.credits, grade: r.grade, status: statusForGrade(r.code, r.grade), line: 'auto', gpa: r.grade in GRADE_POINTS,
  })) as RecordCourse[] })
  return normalizeRecord(draft)
}

/**
 * Planned courses in later terms that would lose a prerequisite with these grades.
 * Re-indexes the global record index for the preview and restores it afterwards.
 */
export function blockedAfterGrades(record: AcademicRecord, semesters: Term[], schedule: PlanSchedule, semId: TermId, rows: GradeRow[]): { id: string; sem: Term; unmet: PrereqCondition[] }[] {
  const taken = rows.filter((r) => r.grade && r.grade !== '__drop' && cleanCode(r.code))
  const preview = normalizeRecord({ ...recordForSave(record), terms: [...recordForSave(record).terms, { id: semId, courses: taken.map((r) => ({ code: r.code, title: r.title, credits: r.credits, grade: r.grade })) }] })
  indexRecord(preview)
  try {
    const later = semesters.slice(1).flatMap((s) => (schedule[s.id] || []).map((e) => ({ id: e.courseId, sem: s })))
    const isAvail = (s: Term) => (id: string) => isCourseDone(id) || semesters.slice(1, semesters.indexOf(s)).some((p) => (schedule[p.id] || []).some((e) => e.courseId === id))
    return later.map((x) => ({ ...x, unmet: unmetConditions(x.id, isAvail(x.sem)) })).filter((x) => x.unmet.length)
  } finally {
    indexRecord(record)
  }
}

export { DEGREE, BLOCKS, codeToId as toCodeId }
