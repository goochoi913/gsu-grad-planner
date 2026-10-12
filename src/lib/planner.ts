/* ═══════════════════════════════════════════════════════════════════════════
   Eunbee's GSU Grad Planner — planning logic (no DOM, no React)
   Terms, the academic record (grades, GPA, statuses), prerequisites, offering
   history, the Degree Works-style audit with advisor exceptions, suggested paths,
   and saved-plan normalization/migration.
   The record itself is never part of the code — it arrives from Firebase.

   A faithful TypeScript port of the original js/planner.js: scripts/logic-test.ts
   checks it against golden results recorded from that file.
   ═══════════════════════════════════════════════════════════════════════════ */
import {
  BLOCKS,
  BLOCK_TYPES,
  COURSES,
  DAY_ORDER,
  DEFAULT_PATH_ID,
  DEFAULT_SEMESTER_COUNT,
  DEGREE,
  GPA_RULES,
  GRADE_OPTIONS,
  GRADE_POINTS,
  LEGACY_SUGGESTED_PLANS,
  MAX_CREDITS_PER_TERM,
  MAX_SEMESTER_COUNT,
  MIN_GRADE_RULES,
  OFFERING_TERMS,
  PLAN_START,
  PLAN_VERSION,
  RECORD_VERSION,
  REQUIREMENT_LINES,
  SUBSTITUTIONS,
  SUGGESTED_PATHS,
} from '@/data/degree'
import type {
  AcademicRecord,
  CatalogCourse,
  DegreeBlock,
  Exception,
  MeetingBlock,
  PlanDoc,
  PlanEntry,
  PlanSchedule,
  PrereqCondition,
  Projection,
  RecordCourse,
  RecordStatus,
  RecordTerm,
  RequirementLine,
  Season,
  Substitution,
  Term,
  TermId,
} from '@/lib/types'

/* ─── Terms ──────────────────────────────────────────────────────────────── */
export const SEASONS: Season[] = ['spring', 'summer', 'fall']
export const SEASON_META: Record<Season, { label: string; short: string; emoji: string }> = {
  spring: { label: 'Spring', short: 'Sp', emoji: '🌸' },
  summer: { label: 'Summer', short: 'Su', emoji: '☀️' },
  fall: { label: 'Fall', short: 'F', emoji: '🍂' },
}

export function termKey(season: Season, year: number): number {
  return year * 3 + SEASONS.indexOf(season)
}
export function makeTerm(key: number): Term {
  const season = SEASONS[key % 3], year = Math.floor(key / 3), meta = SEASON_META[season]
  return { id: `${season}${year}`, key, season, year, label: `${meta.label} ${year}`, shortLabel: `${meta.short}'${String(year).slice(2)}`, emoji: meta.emoji, maxCredits: MAX_CREDITS_PER_TERM }
}
export function termIdKey(id: unknown): number {
  const m = /^(spring|summer|fall)(\d{4})$/.exec(typeof id === 'string' ? id : '')
  return m && +m[2] >= 1990 && +m[2] <= 2100 ? termKey(m[1] as Season, +m[2]) : -1
}
export function termById(id: unknown): Term | null {
  const key = termIdKey(id)
  return key < 0 ? null : makeTerm(key)
}

export const PLAN_START_KEY = termKey(PLAN_START.season, PLAN_START.year)
// Planning starts in Spring 2027, or right after the latest term that already has final grades.
export function firstPlanKey(record: { terms: { key: number }[] } | null | undefined): number {
  const last = record?.terms?.length ? record.terms[record.terms.length - 1].key : -1
  return Math.max(PLAN_START_KEY, last + 1)
}
export function buildSemesters(startKey: number, count: number): Term[] {
  return Array.from({ length: count }, (_, i) => makeTerm(startKey + i))
}

/* ─── Courses ────────────────────────────────────────────────────────────── */
export const COURSE_BY_ID = new Map(COURSES.map((c) => [c.id, c]))
export function findCourse(id: string | null | undefined): CatalogCourse | null {
  return (id && COURSE_BY_ID.get(id)) || null
}
export function codeToId(code: unknown): string {
  return String(code || '').toUpperCase().replace(/[^A-Z0-9]/g, '')
}
export function prettyCode(id: unknown): string {
  return String(id || '').replace(/^([A-Z]+)(\d)/, '$1 $2')
}
export function round2(n: number): number {
  return Math.round(n * 100) / 100
}
export function fmtCredits(n: number): string {
  return String(round2(n))
}
export function courseCode(id: string): string {
  return findCourse(id)?.code || prettyCode(id)
}
// Required areas (major, core, field of study) versus electives.
export function isRequiredSection(course: CatalogCourse): boolean {
  return ['major', 'core', 'fos'].includes(course.section)
}
// Every code a library course stands for: its number, its lecture/lab parts and older K numbers.
export function courseCodes(course: CatalogCourse): string[] {
  return [...new Set([course.id, ...course.parts.map((p) => codeToId(p.code)), ...course.aliases.map(codeToId)])]
}
export const COURSE_BY_CODE = new Map<string, string>()
COURSES.forEach((c) =>
  courseCodes(c).forEach((code) => {
    if (!COURSE_BY_CODE.has(code)) COURSE_BY_CODE.set(code, c.id)
  }),
)
export function catalogIdForCode(code: unknown): string | null {
  return COURSE_BY_CODE.get(codeToId(code)) || null
}
export function subjectLevel(id: string): { subject: string; level: number } {
  const m = /^([A-Z]{2,5})(\d{4})/.exec(id || '')
  return m ? { subject: m[1], level: +m[2] } : { subject: '', level: 0 }
}

/* ─── Grades (GSU catalog 1350.10) ──────────────────────────────────────── */
export const LETTER_ORDER = ['F', 'D', 'C-', 'C', 'C+', 'B-', 'B', 'B+', 'A-', 'A', 'A+']
export const RECORD_STATUS: Record<RecordStatus, { label: string; short: string; icon: string }> = {
  counted: { label: 'Counts toward the degree', short: 'Counts', icon: '✓' },
  unused: { label: 'Earned, but not used for this program', short: 'Not used', icon: '◌' },
  nocredit: { label: 'No credit (failed or withdrawn)', short: 'No credit', icon: '✕' },
  notcounted: { label: 'Not counted', short: 'Not counted', icon: '⊘' },
}

export function minGradeFor(code: string): string {
  const id = codeToId(code)
  const byCode = Object.entries(MIN_GRADE_RULES.codes).find(([c]) => codeToId(c) === id)
  return byCode ? byCode[1] : MIN_GRADE_RULES.subjects[subjectLevel(id).subject] || MIN_GRADE_RULES.fallback
}
// A blank grade, S or K (credit by exam) earns credit; W, WM, I, IP, U, V and NR do not; letters must reach the minimum.
export function gradeMeets(grade: string, min: string): boolean {
  if (!grade || grade === 'S' || grade === 'K') return true
  const rank = LETTER_ORDER.indexOf(grade === 'WF' ? 'F' : grade)
  return rank > 0 && rank >= LETTER_ORDER.indexOf(min || 'D')
}
export function statusForGrade(code: string, grade: string): RecordStatus {
  if (['W', 'WM', 'WF', 'F', 'U', 'V'].includes(grade)) return 'nocredit'
  if (['I', 'IP', 'NR'].includes(grade) || isRemedial(code)) return 'notcounted'
  return gradeMeets(grade, minGradeFor(code)) ? 'counted' : 'notcounted'
}
export function earnsCredit(rec: { status: RecordStatus }): boolean {
  return rec.status === 'counted' || rec.status === 'unused'
}
export function gradeLabel(rec: RecordCourse): string {
  return rec.grade ? `${rec.grade}${rec.transfer ? ' (transfer)' : ''}` : '—'
}

/* ─── GPA engine (GSU catalog 1350.20 and 1350.25) ─────────────────────── */
// One calculation for the record and for projections (GPA_RULE_SUMMARY in degree.ts lists the rules):
// · grade points come from the catalog table; symbols without points (W, WM, I, IP, S, U, V, K, NR) never count
// · Learning Support / remedial courses (numbers below 1000) never count
// · the GSU (institutional) GPA uses GSU attempts; the GSU + transfer GPA adds transfer grades,
//   weighted by the converted semester hours GSU posted (3.33 for a 5-quarter-hour course)
// · every attempt counts unless Repeat to Replace removed the first grade (`r2r` on that attempt);
//   `gpa: false` marks attempts Degree Works leaves out ("Not counted")
// · sums use integer hundredths, and the result is rounded half-up to the hundredth (for example 3.456 → 3.46)
export interface GpaAttempt {
  code: string
  credits: number
  grade: string
  gpa?: boolean
  transfer?: boolean
  replaced?: boolean
}
export type GpaScope = 'gsu' | 'overall'
export interface GpaResult {
  hours: number
  points: number
  exact: number | null
  gpa: number | null
  n: number
  d: number
}

export function hasGradePoints(grade: string): boolean {
  return Object.prototype.hasOwnProperty.call(GRADE_POINTS, grade)
}
export function isRemedial(code: string): boolean {
  const { level } = subjectLevel(codeToId(code))
  return level > 0 && level < 1000
}
export function gpaUse(a: GpaAttempt): { gsu: boolean; overall: boolean; why: string } {
  if (!hasGradePoints(a.grade) || !(a.credits > 0)) return { gsu: false, overall: false, why: 'no grade points' }
  if (isRemedial(a.code)) return { gsu: false, overall: false, why: 'Learning Support' }
  if (a.gpa === false) return { gsu: false, overall: false, why: 'not counted' }
  if (a.replaced) return { gsu: false, overall: false, why: 'Repeat to Replace' }
  return { gsu: !a.transfer, overall: true, why: '' }
}
// n = Σ grade points × hours (both in hundredths), d = Σ hours (hundredths); GPA = n ÷ (100·d), rounded half-up.
export function roundedGpa(n: number, d: number): number | null {
  if (!d) return null
  let q = Math.floor((2 * n + d) / (2 * d))
  while (q * 2 * d > 2 * n + d) q--
  while ((q + 1) * 2 * d <= 2 * n + d) q++
  return q / 100
}
export function gpaFrom(attempts: GpaAttempt[]): GpaResult {
  let n = 0, d = 0
  for (const a of attempts) {
    const h = Math.round(a.credits * 100)
    n += Math.round(GRADE_POINTS[a.grade] * 100) * h
    d += h
  }
  return { hours: d / 100, points: n / 10000, exact: d ? n / (d * 100) : null, gpa: roundedGpa(n, d), n, d }
}
export function gpaFor(attempts: GpaAttempt[], scope: GpaScope): GpaResult {
  return gpaFrom(attempts.filter((a) => gpaUse(a)[scope]))
}
export function fmtGpa(g: { gpa: number | null } | null | undefined): string {
  return g?.gpa == null ? '—' : g.gpa.toFixed(2)
}
export function fmtDelta(v: number | null | undefined): string {
  return v == null ? '' : v === 0 ? '±0.00' : `${v > 0 ? '▲' : '▼'}${Math.abs(v).toFixed(2)}`
}
export interface RecordAttempt extends RecordCourse {
  replaced: boolean
  term: RecordTerm
}
export function recordAttemptList(record: AcademicRecord): RecordAttempt[] {
  return record.terms.flatMap((term) => term.courses.map((c) => ({ ...c, replaced: !!c.r2r, term })))
}

/* ─── Academic record (Firebase; edited in the app) ─────────────────────── */
// { terms:[{ id, note, courses:[{ id, code, title, credits, grade, status, line, gpa, transfer, school, equiv, note }] }], exceptions:[…] }
// status: counted | unused | nocredit | notcounted · line: a requirement line id, 'auto' or 'elective'
export function cleanText(v: unknown, max: number): string {
  return typeof v === 'string' ? v.replace(/\s+/g, ' ').trim().slice(0, max) : ''
}
export function cleanCode(v: unknown): string {
  const t = cleanText(v, 16).toUpperCase()
  const m = /^([A-Z]{2,5})\s?(\d{4}[A-Z]{0,2})$/.exec(t)
  return m ? `${m[1]} ${m[2]}` : ''
}
export function clampCredits(v: unknown): number {
  const n = Number(v)
  return Number.isFinite(n) && n >= 0 && n <= 20 ? round2(n) : 0
}
export function numOrNull(v: unknown): number | null {
  const n = Number(v)
  return v == null || v === '' || !Number.isFinite(n) ? null : n
}
export function validId(v: unknown): v is string {
  return typeof v === 'string' && /^[\w-]{1,60}$/.test(v)
}
export function recordLineValid(line: unknown): boolean {
  return line === 'auto' || line === 'elective' || !!LINE_BY_ID[line as string]
}

type Loose = Record<string, unknown>
const asLoose = (v: unknown): Loose => (v && typeof v === 'object' ? (v as Loose) : {})

export function normalizeRecordCourse(raw: unknown, termId: string, idx: number, usedIds: Set<string>): RecordCourse | null {
  if (!raw || typeof raw !== 'object') return null
  const r = raw as Loose
  const code = cleanCode(r.code)
  if (!code) return null
  const grade = GRADE_OPTIONS.includes(r.grade as string) ? (r.grade as string) : ''
  const status: RecordStatus = RECORD_STATUS[r.status as RecordStatus] ? (r.status as RecordStatus) : statusForGrade(code, grade)
  let id = validId(r.id) ? r.id : `${termId}-${codeToId(code)}-${idx}`
  while (usedIds.has(id)) id += 'b'
  usedIds.add(id)
  return {
    id, code, title: cleanText(r.title, 80) || code, credits: clampCredits(r.credits), grade, status,
    line: status === 'counted' ? (recordLineValid(r.line) ? (r.line as string) : 'auto') : '',
    gpa: typeof r.gpa === 'boolean' ? r.gpa : grade in GRADE_POINTS,
    transfer: !!r.transfer, school: cleanText(r.school, 60), equiv: cleanText(r.equiv, 80), note: cleanText(r.note, 300),
    r2r: !!r.r2r && !r.transfer && grade in GRADE_POINTS, // first grade removed by an approved Repeat to Replace
  }
}

// Exceptions: { id, type:'substitute', target:lineId, course } or { id, type:'waive', target:lineId|blockKey, credits|null (whole) }
export function normalizeExceptions(raw: unknown): Exception[] {
  const out: Exception[] = [], ids = new Set<string>()
  for (const item of (Array.isArray(raw) ? raw : []).slice(0, 40)) {
    if (!item || typeof item !== 'object') continue
    const x = item as Loose
    const type = x.type === 'substitute' || x.type === 'waive' ? x.type : null
    const target = typeof x.target === 'string' ? x.target : ''
    if (!type || !(LINE_BY_ID[target] || (type === 'waive' && BLOCK_BY_KEY[target]))) continue
    const course = type === 'substitute' ? cleanCode(x.course) : ''
    if (type === 'substitute' && !course) continue
    let id = validId(x.id) ? x.id : `x-${out.length + 1}`
    while (ids.has(id)) id += 'b'
    ids.add(id)
    const credits = type === 'waive' && (numOrNull(x.credits) ?? 0) > 0 ? clampCredits(x.credits) : null
    out.push({ id, type, target, course, credits, note: cleanText(x.note, 200) })
  }
  return out
}

export function normalizeRecord(raw: unknown): AcademicRecord {
  const safe = asLoose(raw)
  const byId = new Map<number, RecordTerm>(), usedIds = new Set<string>()
  for (const tRaw of (Array.isArray(safe.terms) ? safe.terms : []).slice(0, 60)) {
    const t = asLoose(tRaw)
    const key = termIdKey(t.id)
    if (key < 0) continue
    const entry: RecordTerm = byId.get(key) || { ...makeTerm(key), note: '', courses: [] }
    entry.note = cleanText(t.note, 300) || entry.note
    ;(Array.isArray(t.courses) ? t.courses : []).slice(0, 40).forEach((c: unknown) => {
      const rec = normalizeRecordCourse(c, entry.id, entry.courses.length, usedIds)
      if (rec) entry.courses.push(rec)
    })
    byId.set(key, entry)
  }
  const rep = safe.reported && typeof safe.reported === 'object' ? (safe.reported as Loose) : null
  return {
    version: RECORD_VERSION,
    exists: !!raw,
    source: cleanText(safe.source, 160),
    reported: rep
      ? { auditDate: cleanText(rep.auditDate, 20), catalogYear: cleanText(rep.catalogYear, 20),
          gsuGpa: numOrNull(rep.gsuGpa), overallGpa: numOrNull(rep.overallGpa), creditsApplied: numOrNull(rep.creditsApplied) }
      : null,
    terms: [...byId.values()].filter((t) => t.courses.length).sort((a, b) => a.key - b.key),
    exceptions: normalizeExceptions(safe.exceptions),
  }
}

export interface StoredRecord {
  version: number
  source: string
  reported: AcademicRecord['reported']
  terms: { id: string; note: string; courses: Omit<RecordCourse, never>[] }[]
  exceptions: Exception[]
}

// The stored shape (no derived term fields).
export function recordForSave(record: AcademicRecord): StoredRecord {
  return {
    version: RECORD_VERSION, source: record.source || '', reported: record.reported || null,
    terms: record.terms.map((t) => ({ id: t.id, note: t.note || '', courses: t.courses.map((c) => ({
      id: c.id, code: c.code, title: c.title, credits: c.credits, grade: c.grade, status: c.status, line: c.line, gpa: c.gpa,
      transfer: c.transfer, school: c.school, equiv: c.equiv, note: c.note, r2r: c.r2r })) })),
    exceptions: record.exceptions.map((x) => ({ id: x.id, type: x.type, target: x.target, course: x.course, credits: x.credits, note: x.note })),
  }
}

export interface TermSummaryInfo {
  earned: number
  transferOnly: boolean
  school: string
  termGpa: GpaResult
  cumGsu: GpaResult
  cumOverall: GpaResult
}
export interface RecordSummary {
  byTerm: Record<string, TermSummaryInfo>
  courseCount: number
  earned: number
  gsu: GpaResult
  overall: GpaResult
}

// Term credits and GPAs from the GPA engine. Transfer-only terms get their (approximate) transfer GPA.
export function summarizeRecord(record: AcademicRecord): RecordSummary {
  const byTerm: Record<string, TermSummaryInfo> = {}, soFar: RecordAttempt[] = []
  for (const t of record.terms) {
    const mine = t.courses.map((c) => ({ ...c, replaced: !!c.r2r, term: t }))
    soFar.push(...mine)
    const transferOnly = !t.courses.some((c) => !c.transfer)
    byTerm[t.id] = {
      earned: round2(t.courses.filter(earnsCredit).reduce((s, c) => s + c.credits, 0)),
      transferOnly,
      school: [...new Set(t.courses.filter((c) => c.transfer).map((c) => c.school).filter(Boolean))].join(', '),
      termGpa: gpaFor(mine, transferOnly ? 'overall' : 'gsu'),
      cumGsu: gpaFor(soFar, 'gsu'),
      cumOverall: gpaFor(soFar, 'overall'),
    }
  }
  const all = recordAttemptList(record)
  return {
    byTerm, courseCount: all.length,
    earned: round2(all.filter(earnsCredit).reduce((s, c) => s + c.credits, 0)),
    gsu: gpaFor(all, 'gsu'), overall: gpaFor(all, 'overall'),
  }
}

/* ─── Record index: passed courses and attempts (prerequisites, retakes) ── */
export interface Attempt {
  rec: RecordCourse
  term: RecordTerm
}
let RECORD_INDEX: { passed: Map<string, number>; attempts: Map<string, Attempt[]> } = { passed: new Map(), attempts: new Map() }
export function indexRecord(record: AcademicRecord): void {
  const passed = new Map<string, number>(), attempts = new Map<string, Attempt[]>()
  for (const t of record.terms) for (const c of t.courses) {
    const id = codeToId(c.code)
    if (!attempts.has(id)) attempts.set(id, [])
    attempts.get(id)!.push({ rec: c, term: t })
    if (earnsCredit(c) && gradeMeets(c.grade, minGradeFor(c.code))) {
      passed.set(id, Math.max(passed.get(id) || 0, c.credits))
      const k = /^([A-Z]+\d{4})K$/.exec(id) // PHYS 2212K covers PHYS 2212 + PHYS 2212L
      if (k) { passed.set(k[1], c.credits); passed.set(`${k[1]}L`, c.credits) }
    }
  }
  RECORD_INDEX = { passed, attempts }
}
export function isPassed(codeId: string): boolean {
  return RECORD_INDEX.passed.has(codeId)
}
// A library course is completed once every part (lecture and lab) has a passing grade.
export function isCourseDone(courseId: string): boolean {
  const c = findCourse(courseId)
  if (!c) return isPassed(courseId)
  if (c.aliases.some((a) => isPassed(codeToId(a)))) return true
  if (!c.parts.length) return isPassed(c.id)
  if ((RECORD_INDEX.passed.get(c.id) || 0) >= c.credits - 0.01) return true // the older single 4-credit course
  return c.parts.every((p) => isPassed(codeToId(p.code)))
}
export function attemptsFor(courseId: string): Attempt[] {
  const c = findCourse(courseId)
  const codes = c ? courseCodes(c) : [codeToId(courseId)]
  return codes.flatMap((code) => RECORD_INDEX.attempts.get(code) || []).sort((a, b) => a.term.key - b.term.key)
}

/* ─── Offering history (GSU class schedules, Spring 2024 – Fall 2026) ────── */
export type OfferingLevel = 'none' | 'sometimes' | 'regular'
export function offeredYears(course: CatalogCourse | null | undefined, season: Season): number[] {
  if (!course?.offered) return []
  return OFFERING_TERMS.filter((t, i) => t.season === season && course.offered[i] > 0).map((t) => t.year)
}
export function offeringInfo(course: CatalogCourse, season: Season): { level: OfferingLevel; text: string } {
  const years = offeredYears(course, season)
  const total = OFFERING_TERMS.filter((t) => t.season === season).length
  const name = SEASON_META[season].label
  if (!years.length) return { level: 'none', text: `Not offered in ${name} 2024–2026` }
  if (years.length < total) return { level: 'sometimes', text: `${name}: offered in ${years.join(' & ')} only` }
  return { level: 'regular', text: `Offered every ${name} 2024–2026` }
}

/* ─── Prerequisites ──────────────────────────────────────────────────────── */
// A condition is a course id, or an array of ids of which any one is enough.
export function conditionMet(cond: PrereqCondition, isAvailable: (id: string) => boolean): boolean {
  return Array.isArray(cond) ? cond.some(isAvailable) : isAvailable(cond)
}
export function unmetConditions(courseId: string, isAvailable: (id: string) => boolean): PrereqCondition[] {
  return (findCourse(courseId)?.prereq || []).filter((cond) => !conditionMet(cond, isAvailable))
}
export function conditionLabel(cond: PrereqCondition): string {
  return Array.isArray(cond) ? cond.map(courseCode).join(' or ') : courseCode(cond)
}

/* ─── Requirement audit (Degree Works blocks and lines) ─────────────────── */
export type AuditStatus = 'met' | 'planned' | 'pending' | 'missing'
export const BLOCK_BY_KEY: Record<string, DegreeBlock> = Object.fromEntries(BLOCKS.map((b) => [b.key, b]))
export const LINE_BY_ID: Record<string, RequirementLine> = Object.fromEntries(REQUIREMENT_LINES.map((l) => [l.id, l]))
export const LINE_CODES: Record<string, Set<string>> = Object.fromEntries(REQUIREMENT_LINES.map((l) => [l.id, new Set(l.courses.map(codeToId))]))
export const STATUS_RANK: Record<AuditStatus, number> = { met: 0, planned: 1, pending: 2, missing: 3 }
const EPS = 1e-6
// A block whose only line needs the block's full credits (Required Program Electives): line and area total are one requirement.
export const MIRROR_LINE: Record<string, string | null> = Object.fromEntries(BLOCKS.map((b) => {
  const ls = REQUIREMENT_LINES.filter((l) => l.block === b.key)
  return [b.key, ls.length === 1 && b.credits != null && ls[0].credits === b.credits ? ls[0].id : null]
}))
export function waiverApplies(x: Exception, lineOrBlock: string): boolean {
  if (x.type !== 'waive') return false
  const line = LINE_BY_ID[lineOrBlock]
  const block = line ? line.block : lineOrBlock
  return x.target === lineOrBlock || (!!MIRROR_LINE[block] && (x.target === block || x.target === MIRROR_LINE[block]))
}

export function targetLabel(target: string): string {
  const line = LINE_BY_ID[target]
  if (line) return `${BLOCK_BY_KEY[line.block].name} · ${line.label}`
  return BLOCK_BY_KEY[target] ? `${BLOCK_BY_KEY[target].name} (area total)` : target
}

interface UnitBase {
  code: string
  codes: string[]
  subject: string
  level: number
  credits: number
  order: number
  /** A requirement line id, 'elective', or null while unassigned. */
  line: string | null
  pending: boolean
}
export interface DoneUnit extends UnitBase {
  kind: 'done'
  rec: RecordCourse
  grade: string
  term: RecordTerm
}
export interface PlannedUnit extends UnitBase {
  kind: 'planned'
  course: CatalogCourse
  courseId: string
  term: Term
}
export type AuditUnit = DoneUnit | PlannedUnit

export function lineAccepts(line: RequirementLine, unit: AuditUnit): boolean {
  const codes = LINE_CODES[line.id]
  if (codes.size) return unit.codes.some((c) => codes.has(c))
  const p = line.pattern
  if (!p || (p.subject && unit.subject !== p.subject) || unit.level < p.min || unit.level > p.max) return false
  return !p.exclude.some((x) => unit.codes.includes(codeToId(x)))
}
function unitGradeOk(unit: AuditUnit, line: RequirementLine): boolean {
  return unit.kind !== 'done' || gradeMeets(unit.grade, line.minGrade || minGradeFor(unit.code))
}
function isLimited(line: RequirementLine, unit: AuditUnit): boolean {
  return !!line.pattern?.limited.some((x) => unit.codes.includes(codeToId(x)))
}
function lexLess(a: number[], b: number[]): boolean {
  const i = a.findIndex((v, j) => v !== b[j])
  return i >= 0 && a[i] < b[i]
}
function* subsets<T>(list: T[], maxSize: number, start = 0, prefix: T[] = []): Generator<T[]> {
  if (prefix.length) yield prefix
  if (prefix.length === maxSize) return
  for (let i = start; i < list.length; i++) yield* subsets(list, maxSize, i + 1, [...prefix, list[i]])
}

export interface LineResult extends RequirementLine {
  status: AuditStatus
  done: number
  planned: number
  pendingCredits: number
  waived: number
  forced: boolean
  pendingWaiver: number
  short: number
  shortCount: number
  units: AuditUnit[]
  waivers: Exception[]
  substitutions: Exception[]
  pendingSub: Substitution | null
  pendingComplete: Substitution | null
}
// `short` is the credit shortfall here (it replaces the block's short name, as in js/planner.js);
// the short name stays on BLOCK_BY_KEY.
export interface BlockResult extends Omit<DegreeBlock, 'short'> {
  lines: LineResult[]
  done: number
  planned: number
  pendingCredits: number
  waived: number
  forced: boolean
  waivers: Exception[]
  creditStatus: AuditStatus
  pendingWaiver: number
  short: number
  status: AuditStatus
  shown: { done: number; planned: number; pendingCredits: number; required: number } | null
}
export type PendingItem =
  | { kind: 'substitute'; target: string; course: string; rule: Substitution }
  | { kind: 'complete'; target: string; rule: Substitution }
  | { kind: 'waive'; target: string; credits: number }
export interface UnitRole {
  block: string | null
  lineId: string
  blockName: string
  label: string
  pending: boolean
}
export interface Audit {
  blocks: BlockResult[]
  lines: LineResult[]
  lineById: Record<string, LineResult>
  blockByKey: Record<string, BlockResult>
  total: { required: number; done: number; planned: number; status: AuditStatus }
  pending: PendingItem[]
  status: 'incomplete' | 'pending' | 'met' | 'planned'
  missing: number
  /** Keyed by catalog course id for planned courses and by record id for completed ones. */
  roles: Record<string, UnitRole>
  dHours: number
  rpeGpa: GpaResult
  plannedCredits: number
  earnedCredits: number
}

// Applies completed courses (as Degree Works did) and then planned courses in term order.
// Line status: met (completed work + recorded exceptions) · planned · pending (only with an advisor exception
// that isn't recorded yet) · missing. Recorded exceptions count as met, exactly like Degree Works.
export function computeAudit(record: AcademicRecord, schedule: PlanSchedule, semesters: Term[]): Audit {
  const units: AuditUnit[] = []
  record.terms.forEach((term) => term.courses.forEach((rec, order) => {
    if (rec.status !== 'counted') return
    const id = codeToId(rec.code)
    units.push({ kind: 'done', rec, code: rec.code, codes: [id], ...subjectLevel(id), credits: rec.credits, grade: rec.grade, term, order, line: null, pending: false })
  }))
  semesters.forEach((term) => (schedule[term.id] || []).forEach((e, order) => {
    const course = findCourse(e.courseId)
    if (course) units.push({ kind: 'planned', course, courseId: course.id, code: course.code, codes: courseCodes(course), ...subjectLevel(course.id), credits: course.credits, term, order, line: null, pending: false })
  }))
  units.sort((a, b) => (a.kind === 'done' ? 0 : 1) - (b.kind === 'done' ? 0 : 1) || a.term.key - b.term.key || a.order - b.order)

  const exceptions = record.exceptions || []
  interface LineState {
    def: RequirementLine
    units: AuditUnit[]
    substitutions: Exception[]
    pendingSub: Substitution | null
    pendingComplete: Substitution | null
    waivers: Exception[]
  }
  const L: Record<string, LineState> = Object.fromEntries(REQUIREMENT_LINES.map((def) => [def.id, {
    def, units: [], substitutions: [], pendingSub: null, pendingComplete: null,
    waivers: exceptions.filter((x) => waiverApplies(x, def.id)),
  }]))
  const lines = Object.values(L)
  const free = () => units.filter((u) => !u.line)
  const assign = (u: AuditUnit, lineId: string, pending = false) => { u.line = lineId; u.pending = pending; L[lineId].units.push(u) }
  const credits = (x: LineState) => round2(x.units.reduce((s, u) => s + u.credits, 0))
  const waived = (x: LineState) => round2(x.waivers.reduce((s, w) => s + (w.credits || 0), 0))
  const forced = (x: LineState) => x.waivers.some((w) => w.credits == null)
  const satisfied = (x: LineState) => forced(x) || ((x.def.credits == null || credits(x) + waived(x) >= x.def.credits - EPS) && (x.def.count == null || x.units.length >= x.def.count))
  const shared = (def: RequirementLine) => !!BLOCK_BY_KEY[def.block].shared

  // 1. Completed courses keep the line Degree Works applied them to.
  for (const u of units) {
    if (u.kind !== 'done') continue
    if (u.rec.line === 'elective') u.line = 'elective'
    else if (LINE_BY_ID[u.rec.line] && !shared(LINE_BY_ID[u.rec.line])) assign(u, u.rec.line)
  }
  // 2. Recorded substitutions put a named course on a line.
  for (const x of exceptions) {
    if (x.type !== 'substitute') continue
    L[x.target].substitutions.push(x)
    const u = units.find((u) => (!u.line || u.line === 'elective') && u.codes.includes(codeToId(x.course)))
    if (u) { u.line = null; assign(u, x.target) }
  }
  // 3. Lines that name specific courses, in audit order.
  for (const x of lines) {
    if (shared(x.def) || x.def.list || !LINE_CODES[x.def.id].size) continue
    for (const u of free()) {
      if (satisfied(x)) break
      if (lineAccepts(x.def, u) && unitGradeOk(u, x.def)) assign(u, x.def.id)
    }
  }
  // 4. A course that needs an advisor substitution (CSC 4350 for the capstone) holds its line as pending.
  for (const s of SUBSTITUTIONS) {
    const x = L[s.line]
    const markComplete = () => s.complete.forEach((id) => { if (L[id] && !satisfied(L[id])) L[id].pendingComplete = s })
    if (x.substitutions.length) { if (satisfied(x)) markComplete(); continue }
    if (satisfied(x)) continue
    const u = free().find((u) => u.codes.includes(codeToId(s.course)))
    if (!u) continue
    assign(u, s.line, true)
    x.pendingSub = s
    markComplete()
  }
  // 5. Pick-from-a-list lines: the fewest courses that complete the line, preferring ones that also fill the area total.
  for (const x of lines) {
    if (!x.def.list) continue
    for (const u of free()) {
      if (satisfied(x)) break
      if (u.kind === 'done' && lineAccepts(x.def, u) && unitGradeOk(u, x.def)) assign(u, x.def.id)
    }
    const cands = satisfied(x) ? [] : free().filter((u) => u.kind === 'planned' && lineAccepts(x.def, u)).slice(0, 10)
    if (!cands.length) continue
    const block = BLOCK_BY_KEY[x.def.block]
    const lineNeed = (x.def.credits as number) - credits(x) - waived(x)
    const blockNeed = (block.credits || 0) - lines.filter((o) => o.def.block === block.key).reduce((s, o) => s + credits(o), 0)
    let best: AuditUnit[] | null = null, bestScore: number[] | null = null
    for (const set of subsets(cands, 3)) {
      const cr = set.reduce((s, u) => s + u.credits, 0)
      const score = [round2(Math.max(0, lineNeed - cr)), set.length, round2(Math.max(0, blockNeed - cr)), set.reduce((s, u) => s + u.term.key, 0)]
      if (!best || lexLess(score, bestScore!)) { best = set; bestScore = score }
    }
    best!.forEach((u) => assign(u, x.def.id))
  }
  // 6. Credit-pattern lines: 3000/4000 CSC electives, then any 2000–4999 course.
  for (const x of lines) {
    if (!x.def.pattern) continue
    const p = x.def.pattern
    let limitedUsed = round2(x.units.filter((u) => isLimited(x.def, u)).reduce((s, u) => s + u.credits, 0))
    for (const u of free()) {
      if (satisfied(x)) break
      if (!lineAccepts(x.def, u) || !unitGradeOk(u, x.def)) continue
      if (isLimited(x.def, u)) {
        if (limitedUsed + u.credits > p.limitedMax + EPS) continue
        limitedUsed += u.credits
      }
      assign(u, x.def.id)
    }
  }
  // 7. Anything left is elective credit that only adds to the 120 total.
  free().forEach((u) => { u.line = 'elective' })
  // 8. Shared blocks (Program Advice) re-use courses applied elsewhere.
  for (const x of lines) {
    if (!shared(x.def)) continue
    for (const u of units) {
      if (satisfied(x)) break
      if (lineAccepts(x.def, u) && unitGradeOk(u, x.def)) x.units.push(u)
    }
  }

  const lineResults: LineResult[] = REQUIREMENT_LINES.map((def) => {
    const x = L[def.id]
    const pick = (f: (u: AuditUnit) => boolean) => x.units.filter(f)
    const sum = (list: AuditUnit[]) => round2(list.reduce((s, u) => s + u.credits, 0))
    const doneU = pick((u) => u.kind === 'done' && !u.pending), plannedU = pick((u) => u.kind === 'planned' && !u.pending), pendingU = pick((u) => u.pending)
    const done = sum(doneU), planned = sum(plannedU), pendingCredits = sum(pendingU)
    const w = waived(x), force = forced(x)
    const ok = (cr: number, n: number) => force || ((def.credits == null || cr + w >= def.credits - EPS) && (def.count == null || n >= def.count))
    let status: AuditStatus, pendingWaiver = 0, short = 0, shortCount = 0
    if (ok(done, doneU.length)) status = 'met'
    else if (ok(done + planned, doneU.length + plannedU.length)) status = 'planned'
    else if (x.pendingComplete || (pendingU.length && ok(done + planned + pendingCredits, x.units.length))) status = 'pending'
    else {
      const gap = def.credits == null ? 0 : round2(def.credits - w - done - planned - pendingCredits)
      shortCount = def.count == null ? 0 : Math.max(0, def.count - x.units.length)
      // A fractional shortfall (transfer credits converted from quarters) needs an advisor waiver, not another course.
      if (gap > EPS && gap < 1 && !shortCount && x.units.length) { status = 'pending'; pendingWaiver = gap }
      else { status = 'missing'; short = Math.max(0, gap) }
    }
    return { ...def, status, done, planned, pendingCredits, waived: w, forced: force, pendingWaiver, short, shortCount,
      units: x.units, waivers: x.waivers, substitutions: x.substitutions, pendingSub: x.pendingSub, pendingComplete: x.pendingComplete }
  })
  const lineById = Object.fromEntries(lineResults.map((l) => [l.id, l]))

  const blockResults: BlockResult[] = BLOCKS.map((b) => {
    const ls = lineResults.filter((l) => l.block === b.key)
    const waivers = exceptions.filter((x) => waiverApplies(x, b.key))
    const sum = (key: 'done' | 'planned' | 'pendingCredits') => round2(ls.reduce((s, l) => s + l[key], 0))
    const done = b.shared ? 0 : sum('done'), planned = b.shared ? 0 : sum('planned'), pendingCredits = b.shared ? 0 : sum('pendingCredits')
    const force = waivers.some((w) => w.credits == null)
    const w = round2(waivers.reduce((s, x) => s + (x.credits || 0), 0))
    let creditStatus: AuditStatus = 'met', pendingWaiver = 0, short = 0
    if (b.credits != null && !force) {
      if (done + w >= b.credits - EPS) creditStatus = 'met'
      else if (done + planned + w >= b.credits - EPS) creditStatus = 'planned'
      else if (done + planned + pendingCredits + w >= b.credits - EPS) creditStatus = 'pending'
      else {
        const gap = round2(b.credits - w - done - planned - pendingCredits)
        if (gap < 1) { creditStatus = 'pending'; pendingWaiver = gap } else { creditStatus = 'missing'; short = gap }
      }
    }
    const status = [creditStatus, ...ls.map((l) => l.status)].reduce<AuditStatus>((a, s) => (STATUS_RANK[s] > STATUS_RANK[a] ? s : a), 'met')
    // Advice lines have no block credits: show the line's own numbers.
    const shown = b.shared ? { done: sum('done'), planned: sum('planned'), pendingCredits: sum('pendingCredits'), required: ls.reduce((s, l) => s + (l.credits || 0), 0) } : null
    return { ...b, lines: ls, done, planned, pendingCredits, waived: w, forced: force, waivers, creditStatus, pendingWaiver, short, status, shown }
  })

  const allRecs = record.terms.flatMap((t) => t.courses)
  const earned = round2(allRecs.filter(earnsCredit).reduce((s, r) => s + r.credits, 0))
  const plannedCredits = round2(units.filter((u) => u.kind === 'planned').reduce((s, u) => s + u.credits, 0))
  const total = { required: DEGREE.totalCredits, done: earned, planned: plannedCredits,
    status: (earned >= DEGREE.totalCredits - EPS ? 'met' : earned + plannedCredits >= DEGREE.totalCredits - EPS ? 'planned' : 'missing') as AuditStatus }

  const pending: PendingItem[] = []
  for (const l of lineResults) {
    if (l.pendingSub) pending.push({ kind: 'substitute', target: l.id, course: l.pendingSub.course, rule: l.pendingSub })
    else if (l.pendingComplete) pending.push({ kind: 'complete', target: l.id, rule: l.pendingComplete })
    if (l.pendingWaiver && MIRROR_LINE[l.block] !== l.id) pending.push({ kind: 'waive', target: l.id, credits: l.pendingWaiver })
  }
  for (const b of blockResults) if (b.pendingWaiver) pending.push({ kind: 'waive', target: b.key, credits: b.pendingWaiver })

  const missing = lineResults.filter((l) => l.status === 'missing').length + blockResults.filter((b) => b.creditStatus === 'missing').length
    + (total.status === 'missing' ? 1 : 0)
  const status = missing ? 'incomplete' : pending.length ? 'pending' : blockResults.every((b) => b.status === 'met') && total.status === 'met' ? 'met' : 'planned'

  const roles: Record<string, UnitRole> = {}
  for (const u of units) {
    const def = LINE_BY_ID[u.line as string]
    const role = def ? { block: def.block, lineId: def.id, blockName: BLOCK_BY_KEY[def.block].name, label: def.label, pending: u.pending }
      : { block: null, lineId: 'elective', blockName: 'Elective credit', label: 'counts toward the 120 total only', pending: false }
    roles[u.kind === 'planned' ? u.courseId : u.rec.id] = role
  }
  const dHours = round2(units.filter((u) => u.kind === 'done' && u.grade === 'D').reduce((s, u) => s + u.credits, 0))
  const rpeGpa = gpaFor(L['rpe.hours'].units.filter((u): u is DoneUnit => u.kind === 'done').map((u) => u.rec), 'overall')
  return { blocks: blockResults, lines: lineResults, lineById, blockByKey: Object.fromEntries(blockResults.map((b) => [b.key, b])),
    total, pending, status, missing, roles, dHours, rpeGpa, plannedCredits, earnedCredits: earned }
}

// "Confirm with your advisor": built from the record and the plan, so nothing personal lives in the code.
export interface ChecklistItem {
  done: boolean
  text: string
}
export function advisorChecklist(audit: Audit, record: AcademicRecord, semesters: Term[], schedule: PlanSchedule): ChecklistItem[] {
  const items: ChecklistItem[] = []
  for (const s of SUBSTITUTIONS) {
    const line = audit.lineById[s.line]
    if (line.pendingSub) items.push({ done: false, text: `Enter the ${s.course} capstone substitution in Degree Works (“${s.applyNote}” on ${line.label}, and “${s.completeNote}” on ${s.complete.map((id) => LINE_BY_ID[id].label).join(', ')}) — ideally before registering for ${s.course}.` })
    else if (line.substitutions.length) items.push({ done: !s.complete.some((id) => audit.lineById[id].status === 'pending'), text: `${s.course} capstone substitution recorded${s.complete.some((id) => audit.lineById[id].status === 'pending') ? ` — still record “course not needed” on ${s.complete.map((id) => LINE_BY_ID[id].label).join(', ')}` : ''}.` })
  }
  const waives = audit.pending.filter((p): p is Extract<PendingItem, { kind: 'waive' }> => p.kind === 'waive')
  const recordedWaivers = record.exceptions.filter((x) => x.type === 'waive')
  if (waives.length) {
    const parts = waives.map((p) => {
      const line = audit.lineById[p.target]
      const codes = line ? [...new Set(line.units.map((u) => u.code))].join(' + ') : ''
      return line ? `${codes || line.label} line in ${BLOCK_BY_KEY[line.block].name} (${fmtCredits(p.credits)} cr)` : `${BLOCK_BY_KEY[p.target].name} total (${fmtCredits(p.credits)} cr)`
    })
    items.push({ done: false, text: `Waive the fractional credit shortfalls left by quarter-to-semester transfer credit: ${parts.join('; ')}.` })
  } else if (recordedWaivers.length) {
    items.push({ done: true, text: `Credit waivers recorded (${recordedWaivers.length}).` })
  }
  const small = audit.lineById['rpe.hours'].units.filter((u) => u.kind === 'planned' && u.credits < 3)
  if (small.length) items.push({ done: false, text: `Confirm ${small.map((u) => `${u.code} (${fmtCredits(u.credits)} cr)`).join(' and ')} counts toward Required Program Electives – CSC.` })
  const plannedIds = new Set(semesters.flatMap((s) => (schedule[s.id] || []).map((e) => e.courseId)))
  // Repeat to Replace for a failed first GSU attempt that is planned again or already retaken.
  const retakes: { code: string; done: boolean }[] = []
  const attemptsByCode = new Map<string, Attempt[]>()
  for (const term of record.terms) for (const rec of term.courses) {
    const id = codeToId(rec.code)
    if (!attemptsByCode.has(id)) attemptsByCode.set(id, [])
    attemptsByCode.get(id)!.push({ rec, term })
  }
  for (const [codeId, list] of attemptsByCode) {
    const first = list[0]
    if (!first || first.rec.transfer || !['F', 'WF'].includes(first.rec.grade) || first.rec.gpa === false) continue
    const retaken = list.slice(1).some((a) => !a.rec.transfer && hasGradePoints(a.rec.grade) && GRADE_POINTS[a.rec.grade] > GRADE_POINTS[first.rec.grade])
    if (first.rec.r2r) retakes.push({ code: first.rec.code, done: true })
    else if (retaken || plannedIds.has(catalogIdForCode(first.rec.code) || codeId)) retakes.push({ code: first.rec.code, done: false })
  }
  const openRetakes = retakes.filter((r) => !r.done)
  if (openRetakes.length) items.push({ done: false, text: `Request Repeat to Replace for ${openRetakes.map((r) => r.code).join(' and ')} after the retake grades post (the Registrar’s online application; at most ${GPA_RULES.r2rMaxCourses} courses, and an approval can’t be undone). Once approved, tick “Replaced by Repeat to Replace” on the earlier F in the Record.` })
  else if (retakes.length) items.push({ done: true, text: `Repeat to Replace recorded for ${retakes.map((r) => r.code).join(' and ')}.` })
  const last = [...semesters].reverse().find((s) => (schedule[s.id] || []).length)
  items.push({ done: false, text: `Apply to graduate in PAWS by the deadline for ${last ? last.label : 'your last term'} (registrar.gsu.edu/graduation).` })
  return items
}

/* ─── GPA projection (what-if grades) ───────────────────────────────────── */
// Expected grades live in their own document: { grades:{ codeId: letter }, r2r:{ codeId: on }, target:{ gpa, termId } }.
// They never mark a course completed and never reach the record, the audit or the plan.
export const PROJECTION_GRADES = ['A+', 'A', 'A-', 'B+', 'B', 'B-', 'C+', 'C', 'C-', 'D', 'F', 'WF', 'W']
const CODE_ID_RE = /^[A-Z]{2,5}\d{4}[A-Z]{0,2}$/
export function normalizeProjection(raw: unknown): Projection {
  const safe = asLoose(raw)
  const pick = <T>(obj: unknown, ok: (v: unknown) => boolean) => Object.fromEntries(Object.entries(asLoose(obj))
    .filter(([k, v]) => CODE_ID_RE.test(k) && ok(v)).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)).slice(0, 200)) as Record<string, T>
  const t = asLoose(safe.target)
  const gpa = numOrNull(t.gpa)
  return {
    version: 1,
    grades: pick<string>(safe.grades, (v) => PROJECTION_GRADES.includes(v as string)),
    r2r: pick<boolean>(safe.r2r, (v) => typeof v === 'boolean'),
    target: { gpa: gpa != null && gpa > 0 && gpa <= GPA_RULES.maxGradePoints ? round2(gpa) : 3, termId: termIdKey(t.termId) >= 0 ? (t.termId as string) : '' },
  }
}
export function projectionForSave(p: Projection): Projection {
  return { version: 1, grades: { ...p.grades }, r2r: { ...p.r2r }, target: { ...p.target } }
}

// A planned course's graded parts: a lecture and its lab get separate grades.
export interface GradePart {
  code: string
  codeId: string
  credits: number
  title: string
  main: boolean
}
export function courseGradeParts(course: CatalogCourse): GradePart[] {
  const base = course.title.replace(/ \+ Lab$/, '')
  if (!course.parts.length) return [{ code: course.code, codeId: course.id, credits: course.credits, title: course.title, main: true }]
  return course.parts.map((p, i) => ({ code: p.code, codeId: codeToId(p.code), credits: p.credits, title: i ? `${base} Lab` : base, main: i === 0 }))
}

/* ─── Repeat to Replace (catalog 1350.25, Registrar) ─────────────────────── */
export function firstRecordedAttempt(record: AcademicRecord, codeIds: string[]): Attempt | null {
  for (const term of record.terms) for (const rec of term.courses) if (codeIds.includes(codeToId(rec.code))) return { rec, term }
  return null
}
// Why a course's first recorded grade can't be replaced ('' when it can).
export function r2rBlocker(first: Attempt): string {
  const { rec, term } = first
  if (rec.transfer) return `The first attempt (${term.label}) is transfer credit, which isn’t part of the GSU GPA.`
  if (!hasGradePoints(rec.grade) || rec.gpa === false || isRemedial(rec.code)) return `The first recorded grade (${rec.grade || 'none'}, ${term.label}) isn’t part of the GPA, so it can’t be replaced.`
  if (term.key < termIdKey(GPA_RULES.r2rFirstTerm)) return 'Only repeats taken from Fall 2011 on qualify.'
  if (rec.r2r) return 'That grade is already replaced through Repeat to Replace.'
  return ''
}
export function r2rUsedCount(record: AcademicRecord): number {
  return record.terms.reduce((s, t) => s + t.courses.filter((c) => c.r2r).length, 0)
}

export type R2RStatus = 'applies' | 'pending' | 'lower' | 'limit' | 'blocked' | 'off'
export interface RepeatCandidate extends GradePart {
  courseId: string
  term: Term
  first: Attempt
  grade: string
  eligible: boolean
  on: boolean
  status: R2RStatus
  note: string
  reserved: boolean
}

// Planned retakes in term order. status: applies · pending (no expected grade) · lower (not a higher grade)
// · limit (over the 4-course cap) · blocked (not eligible) · off. `reserved` = counted toward the cap.
export function repeatCandidates(record: AcademicRecord, schedule: PlanSchedule, semesters: Term[], projection: Projection): RepeatCandidate[] {
  const out: RepeatCandidate[] = []
  let used = r2rUsedCount(record)
  const lastTerm = [...semesters].reverse().find((s) => (schedule[s.id] || []).length)
  for (const term of semesters) for (const entry of schedule[term.id] || []) {
    const course = findCourse(entry.courseId)
    if (!course) continue
    for (const part of courseGradeParts(course)) {
      const first = firstRecordedAttempt(record, [part.codeId, ...(part.main ? course.aliases.map(codeToId) : [])])
      if (!first) continue
      const blocker = r2rBlocker(first)
      const on = projection.r2r[part.codeId] ?? !blocker
      const grade = projection.grades[part.codeId] || ''
      let status: R2RStatus = 'off', note = '', reserved = false
      if (on && blocker) { status = 'blocked'; note = blocker }
      else if (on && used >= GPA_RULES.r2rMaxCourses) { status = 'limit'; note = `Only ${GPA_RULES.r2rMaxCourses} courses can use Repeat to Replace, and ${used} are already counted.` }
      else if (on) {
        reserved = true
        if (!grade) status = 'pending'
        else if (!hasGradePoints(grade) || GRADE_POINTS[grade] <= GRADE_POINTS[first.rec.grade]) { status = 'lower'; reserved = false; note = `The retake needs a grade higher than the ${first.rec.grade} to replace it.` }
        else status = 'applies'
        if (reserved) used++
      }
      if (on && term.id === lastTerm?.id && status !== 'blocked') note = [note, 'This retake is in the graduation term: apply within the first two weeks, and GSU honors it only if the higher grade is needed to graduate.'].filter(Boolean).join(' ')
      out.push({ ...part, courseId: course.id, term, first, grade, eligible: !blocker, on, status, note, reserved })
    }
  }
  return out
}

export interface ProjectionRow extends GradePart {
  courseId: string
  grade: string
  candidate: RepeatCandidate | null
}
export interface ProjectionTerm {
  term: Term
  rows: ProjectionRow[]
  graded: number
  hours: number
}
export interface ScenarioTerm {
  term: Term
  graded: number
  total: number
  replaced: number
  termGpa: GpaResult
  cumGsu: GpaResult
  cumOverall: GpaResult
  deltaTerm: number | null
  deltaGsu: number | null
  deltaOverall: number | null
}
export interface GpaProjection {
  current: { gsu: GpaResult; overall: GpaResult }
  candidates: RepeatCandidate[]
  terms: ProjectionTerm[]
  withR2R: ScenarioTerm[]
  withoutR2R: ScenarioTerm[]
  r2rUsed: number
  r2rReserved: number
}

// Term-by-term projection: GPAs as toggled (withR2R) and with no Repeat to Replace at all (withoutR2R).
export function projectGpa(record: AcademicRecord, schedule: PlanSchedule, semesters: Term[], projection: Projection): GpaProjection {
  const base = recordAttemptList(record)
  const current = { gsu: gpaFor(base, 'gsu'), overall: gpaFor(base, 'overall') }
  const candidates = repeatCandidates(record, schedule, semesters, projection)
  const terms: ProjectionTerm[] = semesters.map((term) => {
    const rows = (schedule[term.id] || []).flatMap((e) => {
      const course = findCourse(e.courseId)
      return course ? courseGradeParts(course).map((p) => ({ ...p, courseId: course.id, grade: projection.grades[p.codeId] || '',
        candidate: candidates.find((c) => c.codeId === p.codeId && c.term.id === term.id) || null })) : []
    })
    return { term, rows, graded: rows.filter((r) => r.grade).length, hours: round2(rows.reduce((s, r) => s + r.credits, 0)) }
  })
  const delta = (a: GpaResult, b: GpaResult) => (a.gpa == null || b.gpa == null ? null : round2(a.gpa - b.gpa))
  const scenario = (useR2R: boolean): ScenarioTerm[] => {
    const projected: (GpaAttempt & { id: string; term: Term; projected: true })[] = []
    return terms.map((t) => {
      const mine = t.rows.filter((r) => r.grade).map((r) => ({ id: `p-${r.codeId}`, code: r.code, credits: r.credits, grade: r.grade, transfer: false, term: t.term, projected: true as const }))
      projected.push(...mine)
      const replaced = new Set(useR2R ? candidates.filter((c) => c.status === 'applies' && c.term.key <= t.term.key).map((c) => c.first.rec.id) : [])
      const all: GpaAttempt[] = [...base.map((a) => (replaced.has(a.id) ? { ...a, replaced: true } : a)), ...projected]
      const termGpa = gpaFor(mine, 'gsu'), cumGsu = gpaFor(all, 'gsu'), cumOverall = gpaFor(all, 'overall')
      return { term: t.term, graded: t.graded, total: t.rows.length, replaced: replaced.size, termGpa, cumGsu, cumOverall,
        deltaTerm: delta(termGpa, current.gsu), deltaGsu: delta(cumGsu, current.gsu), deltaOverall: delta(cumOverall, current.overall) }
    })
  }
  return { current, candidates, terms, withR2R: scenario(true), withoutR2R: scenario(false),
    r2rUsed: r2rUsedCount(record), r2rReserved: candidates.filter((c) => c.reserved).length }
}

// The average grade points needed in every planned course through `termId` for the rounded GPA to reach
// `target`. With Repeat to Replace, toggled retakes are assumed to beat their old grade.
export const TARGET_LETTERS = ['D', 'C-', 'C', 'C+', 'B-', 'B', 'B+', 'A-', 'A', 'A+']
export type TargetResult =
  | { scope: GpaScope; useR2R: boolean; hours: 0; status: 'none'; now: number | null; replaced: number }
  | { scope: GpaScope; useR2R: boolean; hours: number; needed: number; status: 'already' | 'unreachable' | 'reachable'; now: number | null; replaced: number; atLeast: string | null; allA: number | null; allAPlus: number | null }
export function targetNeeded(record: AcademicRecord, schedule: PlanSchedule, semesters: Term[], projection: Projection, termId: string, target: number, scope: GpaScope, useR2R: boolean): TargetResult {
  const endKey = termIdKey(termId)
  const upto = semesters.filter((s) => s.key <= endKey)
  const replaced = new Set<string>()
  let used = r2rUsedCount(record)
  if (useR2R) for (const c of repeatCandidates(record, schedule, semesters, projection)) {
    if (!c.eligible || !c.on || c.term.key > endKey || used >= GPA_RULES.r2rMaxCourses) continue
    used++
    replaced.add(c.first.rec.id)
  }
  const now = gpaFor(recordAttemptList(record).map((a) => (replaced.has(a.id) ? { ...a, replaced: true } : a)), scope)
  const h = upto.flatMap((s) => (schedule[s.id] || []).flatMap((e) => { const c = findCourse(e.courseId); return c ? courseGradeParts(c) : [] }))
    .filter((p) => !isRemedial(p.code)).reduce((sum, p) => sum + Math.round(p.credits * 100), 0)
  const result = (x: number) => roundedGpa(now.n + Math.round(x * 100) * h, now.d + h)
  if (!h) return { scope, useR2R, hours: 0, status: 'none', now: now.gpa, replaced: replaced.size }
  const reaches = (x: number) => (result(x) as number) >= target - 1e-9
  const exact = ((target - 0.005) * (now.d + h) * 100 - now.n) / (h * 100)
  let needed = Math.max(0, Math.ceil(exact * 100 - 1e-6) / 100)
  while (needed <= GPA_RULES.maxGradePoints && !reaches(needed)) needed = round2(needed + 0.01)
  while (needed > 0 && reaches(round2(needed - 0.01))) needed = round2(needed - 0.01)
  const status = reaches(0) ? 'already' : needed > GPA_RULES.maxGradePoints ? 'unreachable' : 'reachable'
  return { scope, useR2R, hours: h / 100, needed, status, now: now.gpa, replaced: replaced.size,
    atLeast: TARGET_LETTERS.find((l) => GRADE_POINTS[l] >= needed - 1e-9) || null,
    allA: result(GRADE_POINTS.A), allAPlus: result(GRADE_POINTS['A+']) }
}

/* ─── Suggested paths ────────────────────────────────────────────────────── */
export function pathById(id: string | null | undefined) {
  return SUGGESTED_PATHS.find((p) => p.id === id) || null
}
// The path's courses from startKey on, leaving out courses already completed.
export function buildPathPlan(pathId: string, startKey: number, isDone: (id: string) => boolean = () => false): { lastTermId: TermId; schedule: PlanSchedule } {
  const path = pathById(pathId) || pathById(DEFAULT_PATH_ID)!
  const schedule: PlanSchedule = {}
  let lastKey = startKey
  for (const [termId, ids] of Object.entries(path.terms)) {
    const key = termIdKey(termId)
    if (key < startKey) continue
    schedule[termId] = ids.filter((id) => findCourse(id) && !isDone(id)).map((courseId) => ({ courseId, blocks: [] }))
    lastKey = Math.max(lastKey, key)
  }
  return { lastTermId: makeTerm(lastKey).id, schedule }
}
export function planSignature(schedule: unknown): string {
  return JSON.stringify(Object.entries(asLoose(schedule))
    .map(([bucket, list]) => [bucket, (Array.isArray(list) ? list : []).map((e: unknown) => (typeof e === 'string' ? e : (asLoose(e).courseId as string | undefined))).filter(Boolean).sort()] as [string, string[]])
    .filter(([, ids]) => ids.length).sort())
}
export function matchingPathId(schedule: PlanSchedule, startKey: number, isDone: (id: string) => boolean): string | null {
  const sig = planSignature(schedule)
  return SUGGESTED_PATHS.find((p) => planSignature(buildPathPlan(p.id, startKey, isDone).schedule) === sig)?.id || null
}

/* ─── Saved plan normalization & migration ─────────────────────────────── */
export const LIBRARY_SECTION_KEYS = ['audit', 'core', 'major', 'elective', 'rpe']

export function isValidTime(t: unknown): t is string {
  return typeof t === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(t)
}
function asText(v: unknown): string {
  return typeof v === 'string' ? v.trim() : ''
}

export function normalizeBlock(block: unknown, fallbackId: string): MeetingBlock {
  const b = asLoose(block)
  const rawType = typeof b.type === 'string' ? b.type : 'Lecture'
  return {
    id: typeof b.id === 'string' && b.id ? b.id : fallbackId,
    type: BLOCK_TYPES.includes(rawType) ? rawType : 'Other',
    days: Array.isArray(b.days) ? b.days.filter((day: unknown) => DAY_ORDER.includes(day as string)) : [],
    startTime: isValidTime(b.startTime) ? b.startTime : '',
    endTime: isValidTime(b.endTime) ? b.endTime : '',
    location: asText(b.location),
    instructor: asText(b.instructor),
    crn: asText(b.crn),
  }
}

// Picked class-schedule sections: { graded-part code id: CRN }. Kept only when something is picked.
function normalizeSections(raw: unknown): Record<string, string> | null {
  const out: Record<string, string> = {}
  for (const [k, v] of Object.entries(asLoose(raw))) {
    if (CODE_ID_RE.test(k) && typeof v === 'string' && /^\d{5}$/.test(v)) out[k] = v
  }
  return Object.keys(out).length ? out : null
}

export function normalizeScheduleEntry(entry: unknown, semId: string, idx: number): PlanEntry | null {
  if (typeof entry === 'string') return { courseId: entry, blocks: [] }
  if (!entry || typeof entry !== 'object') return null
  const e = entry as Loose
  const courseId = typeof e.courseId === 'string' ? e.courseId : ''
  if (!courseId) return null
  const rawBlocks = Array.isArray(e.blocks) ? e.blocks : []
  const out: PlanEntry = { courseId, blocks: rawBlocks.map((block: unknown, blockIdx: number) => normalizeBlock(block, `${courseId}-${semId}-${idx}-${blockIdx}`)) }
  const sections = normalizeSections(e.sections)
  if (sections) out.sections = sections
  return out
}

// Keeps only plannable catalog courses, each in at most one upcoming term.
export function normalizeSchedule(rawSchedule: unknown, semesters: Term[]): PlanSchedule {
  const normalized: PlanSchedule = {}, seen = new Set<string>()
  const raw = asLoose(rawSchedule)
  for (const sem of semesters) {
    const rawEntries = Array.isArray(raw[sem.id]) ? (raw[sem.id] as unknown[]) : []
    normalized[sem.id] = rawEntries
      .map((entry, idx) => normalizeScheduleEntry(entry, sem.id, idx))
      .filter((e): e is PlanEntry => !!e && !!findCourse(e.courseId) && !seen.has(e.courseId) && !!seen.add(e.courseId))
  }
  return normalized
}

// Upcoming terms run from startKey through the saved last term, and never end before a term that has courses.
export function planLastKey(raw: Loose, startKey: number): number {
  let last = termIdKey(raw?.lastTermId)
  if (last < 0) last = PLAN_START_KEY + (Number.isInteger(raw?.semesterCount) ? (raw.semesterCount as number) : DEFAULT_SEMESTER_COUNT) - 1
  for (const [id, list] of Object.entries(asLoose(raw?.schedule))) {
    const key = termIdKey(id)
    if (key >= startKey && Array.isArray(list) && list.length) last = Math.max(last, key)
  }
  return Math.min(startKey + MAX_SEMESTER_COUNT - 1, Math.max(startKey, last))
}

export function normalizePlan(raw: unknown, startKey: number): PlanDoc {
  const safe = asLoose(raw)
  const lastKey = planLastKey(safe, startKey)
  const semesters = buildSemesters(startKey, lastKey - startKey + 1)
  const sc = asLoose(safe.sectionsCollapsed)
  return {
    version: PLAN_VERSION,
    lastTermId: makeTerm(lastKey).id,
    schedule: normalizeSchedule(safe.schedule, semesters),
    sidebarCollapsed: !!safe.sidebarCollapsed,
    sectionsCollapsed: Object.fromEntries(LIBRARY_SECTION_KEYS.map((k) => [k, !!sc[k]])),
    view: safe.view === 'calendar' ? 'calendar' : 'planner',
    calSemester: semesters.some((s) => s.id === safe.calSemester) ? (safe.calSemester as string) : semesters[0].id,
    expandedTerms: Array.isArray(safe.expandedTerms) ? [...new Set((safe.expandedTerms as unknown[]).filter((id): id is string => termIdKey(id) >= 0))].slice(0, 60) : null,
  }
}

export interface MigrationInfo {
  movedFromFall2026?: number
  seeded?: boolean
  upgraded?: boolean
  examRemoved?: string[]
}

// Older plans: Fall 2026 and the credit-by-exam bucket are gone, and a plan still identical to an earlier
// suggested path (or an empty pre-v4 plan) gets the default path.
export function migratePlan(raw: unknown, startKey: number): { data: PlanDoc; migrated: boolean; info: MigrationInfo } {
  const safe = asLoose(raw)
  const version = Number(safe.version) || 0
  if (version >= PLAN_VERSION) return { data: normalizePlan(safe, startKey), migrated: false, info: {} }
  const sched = asLoose(safe.schedule)
  const info: MigrationInfo = { movedFromFall2026: Array.isArray(sched.fall2026) ? sched.fall2026.length : 0, seeded: false, upgraded: false, examRemoved: [] }
  let data = normalizePlan(safe, startKey)
  const hasCourses = Object.values(sched).some((list) => Array.isArray(list) && list.length)
  const oldSuggestion = hasCourses && LEGACY_SUGGESTED_PLANS.some((p) => planSignature(p) === planSignature(safe.schedule))
  if ((!hasCourses && version < 4) || oldSuggestion) {
    data = normalizePlan({ ...data, ...buildPathPlan(DEFAULT_PATH_ID, startKey, isCourseDone) }, startKey)
    info.seeded = !hasCourses
    info.upgraded = oldSuggestion
  } else if (Array.isArray(sched.exam)) {
    info.examRemoved = (sched.exam as unknown[]).map((e) => (typeof e === 'string' ? e : (asLoose(e).courseId as string))).filter((id) => findCourse(id))
  }
  return { data, migrated: true, info }
}
