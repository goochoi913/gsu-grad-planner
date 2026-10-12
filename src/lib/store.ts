/**
 * The planner's state and its Firebase sync — a port of the original js/app.js.
 *
 *   plan        planner/sharedSchedule  debounced whole-document writes (500 ms), cached in localStorage
 *   record      planner/academicRecord  written right away; never cached in the browser; never written
 *                                       before the stored copy has loaded (that would overwrite it)
 *   projection  planner/gpaProjection   debounced writes (400 ms)
 *
 * Everything else (the audit, the GPA projection, the terms on the board) is derived on
 * every change, so the views can never disagree.
 *
 * Test fixtures: when localStorage["bee-planner:fixture"] holds { record, plan, projection },
 * the app skips Firebase entirely and keeps every change in memory. scripts/flow-test.mjs
 * uses this so browser tests never touch Bee's real data.
 */
import { useSyncExternalStore } from 'react'
import { toast } from 'sonner'
import { DEFAULT_PATH_ID, DEFAULT_SEMESTER_COUNT, GPA_RULES, MAX_SEMESTER_COUNT, PLAN_VERSION } from '@/data/degree'
import type { AcademicRecord, Exception, MeetingBlock, PlanDoc, PlanSchedule, Projection, RecordCourse, Term, TermId } from '@/lib/types'
import {
  PLAN_START_KEY,
  buildPathPlan,
  buildSemesters,
  computeAudit,
  conditionLabel,
  courseCode,
  findCourse,
  firstPlanKey,
  indexRecord,
  isCourseDone,
  makeTerm,
  migratePlan,
  normalizePlan,
  normalizeProjection,
  normalizeRecord,
  normalizeSchedule,
  pathById,
  projectGpa,
  projectionForSave,
  recordForSave,
  summarizeRecord,
  targetLabel,
  termById,
  termIdKey,
  type Audit,
  type GpaProjection,
  type MigrationInfo,
  type RecordSummary,
  type StoredRecord,
} from '@/lib/planner'
import {
  checkAdd,
  currentPathId,
  defaultExpandedTerms,
  pathTitle,
  recordWithFinishedTerm,
  unmetPrereqs,
  withCourseAdded,
  withCourseRemoved,
} from '@/lib/plan-ops'
import { blocksFromSections, sectionByCrn } from '@/lib/schedule'
import * as fb from '@/lib/firebase'
import { clone, genId } from '@/lib/format'

export type RecordLoad = 'loading' | 'ready' | 'missing' | 'offline'
export type SyncStatus = 'connecting' | 'online' | 'saving' | 'error' | 'fixture'

export interface PlannerSnapshot {
  record: AcademicRecord
  recordStatus: RecordLoad
  summary: RecordSummary
  /** Upcoming terms, first open term → plan.lastTermId. */
  semesters: Term[]
  plan: PlanDoc
  projection: Projection
  audit: Audit
  gpa: GpaProjection
  sync: SyncStatus
  fixture: boolean
  /** Key of the first term open for planning. */
  startKey: number
}

const LOCAL_KEY = 'bee-grad-planner-v6'
const OLD_LOCAL_KEYS = ['bee-grad-planner-v4', 'bee-grad-planner-v3', 'bee-grad-planner-v2', 'gsu-grad-planner']
const FIXTURE_KEY = 'bee-planner:fixture'

/* ─── State ──────────────────────────────────────────────────────────────── */
let record: AcademicRecord = normalizeRecord(null)
let recordStatus: RecordLoad = 'loading'
let summary: RecordSummary = summarizeRecord(record)
let semesters: Term[] = buildSemesters(PLAN_START_KEY, DEFAULT_SEMESTER_COUNT)
let plan: PlanDoc = normalizePlan(null, PLAN_START_KEY)
let projection: Projection = normalizeProjection(null)
let sync: SyncStatus = 'connecting'
let firebaseReady = false
let planLoaded = false
let projectionLoaded = false
let fixture = false
indexRecord(record)

let snapshot: PlannerSnapshot = derive()
const listeners = new Set<() => void>()

function derive(): PlannerSnapshot {
  return {
    record, recordStatus, summary, semesters, plan, projection,
    audit: computeAudit(record, plan.schedule, semesters),
    gpa: projectGpa(record, plan.schedule, semesters, projection),
    sync, fixture, startKey: firstPlanKey(record),
  }
}

function emit() {
  snapshot = derive()
  celebrateIfCovered()
  listeners.forEach((l) => l())
}

function setSync(next: SyncStatus) {
  if (fixture) next = 'fixture'
  if (sync === next) return
  sync = next
  snapshot = { ...snapshot, sync }
  listeners.forEach((l) => l())
}

export function subscribe(listener: () => void) {
  listeners.add(listener)
  return () => listeners.delete(listener)
}
export function getSnapshot() {
  return snapshot
}
export function usePlanner(): PlannerSnapshot {
  return useSyncExternalStore(subscribe, getSnapshot)
}

/* ─── Terms and the record ───────────────────────────────────────────────── */
function planStartKey() {
  return firstPlanKey(record)
}

// Upcoming terms run from the first open term through plan.lastTermId.
function refreshSemesters() {
  const start = planStartKey()
  const last = Math.min(start + MAX_SEMESTER_COUNT - 1, Math.max(start, termIdKey(plan.lastTermId)))
  semesters = buildSemesters(start, last - start + 1)
  const schedule: PlanSchedule = { ...plan.schedule }
  for (const s of semesters) schedule[s.id] ||= []
  plan = {
    ...plan,
    lastTermId: semesters[semesters.length - 1].id,
    schedule,
    calSemester: semesters.some((s) => s.id === plan.calSemester) ? plan.calSemester : semesters[0].id,
  }
}

// Returns true when completed courses had to leave the plan.
function setRecord(next: AcademicRecord): boolean {
  record = next
  indexRecord(record)
  summary = summarizeRecord(record)
  refreshSemesters()
  return pruneCompletedFromSchedule()
}

// A course with a passing grade can't also be planned.
function pruneCompletedFromSchedule(): boolean {
  let changed = false
  const schedule = { ...plan.schedule }
  for (const s of semesters) {
    const kept = (schedule[s.id] || []).filter((e) => !isCourseDone(e.courseId))
    if (kept.length !== (schedule[s.id] || []).length) { schedule[s.id] = kept; changed = true }
  }
  if (changed) plan = { ...plan, schedule }
  return changed
}

function setSchedule(schedule: PlanSchedule) {
  plan = { ...plan, schedule }
}

/* ─── Saving the plan ────────────────────────────────────────────────────── */
let planTimer: ReturnType<typeof setTimeout> | null = null
let pendingPayload: PlanDoc | null = null
let lastPlanHash = ''

function buildPlanPayload(): PlanDoc {
  return normalizePlan({
    version: PLAN_VERSION,
    lastTermId: plan.lastTermId,
    schedule: plan.schedule,
    sidebarCollapsed: plan.sidebarCollapsed,
    sectionsCollapsed: plan.sectionsCollapsed,
    view: plan.view,
    calSemester: plan.calSemester,
    expandedTerms: plan.expandedTerms,
  }, planStartKey())
}

function writeLocal(payload: PlanDoc) {
  if (fixture) return
  try { localStorage.setItem(LOCAL_KEY, JSON.stringify(payload)) } catch { /* private mode */ }
}

function savePlan() {
  const payload = buildPlanPayload()
  const hash = JSON.stringify(payload)
  writeLocal(payload)
  if (fixture || !firebaseReady || !planLoaded) return
  // Back to the saved state: drop any pending write, or it would land later and undo this change.
  if (hash === lastPlanHash) {
    if (planTimer) clearTimeout(planTimer)
    planTimer = null
    pendingPayload = null
    setSync('online')
    return
  }
  setSync('saving')
  if (planTimer) clearTimeout(planTimer)
  pendingPayload = payload
  planTimer = setTimeout(() => void flushPlan(), 500)
}

async function flushPlan() {
  const payload = pendingPayload
  if (planTimer) clearTimeout(planTimer)
  planTimer = null
  pendingPayload = null
  if (!payload) return
  const hash = JSON.stringify(payload)
  const ok = await fb.save('plan', payload)
  if (ok) { lastPlanHash = hash; setSync('online') }
  else setSync('error')
}

async function saveRecordNow(): Promise<boolean> {
  if (fixture) return true
  if (!firebaseReady) { toast.warning('Not connected to Firebase — this change is not saved.'); return false }
  setSync('saving')
  const ok = await fb.save('record', recordForSave(record))
  setSync(ok ? 'online' : 'error')
  if (!ok) toast.error('Could not save the record. Check the connection and try again.')
  return ok
}

/* ─── Firebase sync ──────────────────────────────────────────────────────── */
let migrationAnnounced = false
function announceMigration(info: MigrationInfo) {
  if (migrationAnnounced || !info) return
  migrationAnnounced = true
  if (info.movedFromFall2026) toast.info(`Fall 2026 was removed — ${info.movedFromFall2026} course(s) went back to the course list.`)
  if (info.examRemoved?.length) toast.info(`Credit by exam is no longer part of the plan — ${info.examRemoved.map(courseCode).join(', ')} went back to the course list.`)
  const path = pathById(DEFAULT_PATH_ID)!
  if (info.upgraded) toast.success(`Updated to the ${pathTitle(path)} without CLEP — graduating ${path.graduation}.`)
  else if (info.seeded) toast.success(`Loaded the ${pathTitle(path)}. Move courses around to make it yours.`)
}

function applyRemoteRecord(raw: unknown): { changed: boolean; pruned: boolean } {
  const next = normalizeRecord(raw)
  if (next.exists === record.exists && JSON.stringify(recordForSave(next)) === JSON.stringify(recordForSave(record))) return { changed: false, pruned: false }
  return { changed: true, pruned: setRecord(next) }
}

function applyRemotePlan(data: PlanDoc, first: boolean): boolean {
  if (first) {
    // The first snapshot is the truth, including the view fields, so opening the app doesn't rewrite it.
    plan = data
    refreshSemesters()
    pruneCompletedFromSchedule()
    return true
  }
  const local = JSON.stringify([plan.lastTermId, normalizeSchedule(plan.schedule, semesters)])
  const remote = JSON.stringify([data.lastTermId, data.schedule])
  if (local === remote) return false
  plan = { ...plan, lastTermId: data.lastTermId, schedule: data.schedule }
  refreshSemesters()
  pruneCompletedFromSchedule()
  return true
}

async function initFirebase() {
  setSync('connecting')
  const conn = await fb.connect()
  if (!conn) {
    recordStatus = 'offline'
    setSync('error')
    emit()
    return
  }
  firebaseReady = true
  let recordSeen = false, planSeen = false

  void fb.listen('record', (raw, exists) => {
    const first = !recordSeen
    recordSeen = true
    recordStatus = exists ? 'ready' : 'missing'
    const { changed, pruned } = applyRemoteRecord(exists ? raw : null)
    if (changed || first) emit()
    if (pruned) savePlan()
    if (!planTimer) setSync('online')
  }, () => {
    recordSeen = true
    recordStatus = 'offline'
    setSync('error')
    emit()
  })

  void fb.listen('projection', (raw) => {
    projectionLoaded = true
    const next = normalizeProjection(raw)
    if (JSON.stringify(projectionForSave(next)) === JSON.stringify(projectionForSave(projection))) return
    projection = next
    emit()
  }, () => { projectionLoaded = true })

  void fb.listen('plan', (raw, exists) => {
    const first = !planSeen
    planSeen = true
    planLoaded = true
    // A change of ours is still waiting to be written; it will replace this snapshot anyway.
    if (!first && planTimer) return
    const { data, migrated, info } = migratePlan(exists ? raw : null, planStartKey())
    const changed = applyRemotePlan(data, first)
    if (changed || first) emit()
    if (migrated) { lastPlanHash = ''; announceMigration(info); savePlan() }
    else {
      const payload = JSON.stringify(buildPlanPayload())
      lastPlanHash = payload === JSON.stringify(data) ? payload : ''
      if (!lastPlanHash) savePlan()
      else setSync('online')
    }
  }, () => { planLoaded = true; setSync('error') })
}

/* ─── Local plan cache (instant first paint) ─────────────────────────────── */
function loadLocalState() {
  let raw: unknown = null
  try {
    raw = JSON.parse(localStorage.getItem(LOCAL_KEY) || 'null')
    for (const key of OLD_LOCAL_KEYS) {
      if (!raw && localStorage.getItem(key)) raw = JSON.parse(localStorage.getItem(key)!)
      localStorage.removeItem(key)
    }
  } catch { /* unreadable cache: start from the defaults */ }
  const { data, migrated, info } = migratePlan(raw, planStartKey())
  plan = data
  refreshSemesters()
  writeLocal(data)
  return { hadLocal: !!raw, migrated, info }
}

function readFixture(): { record?: unknown; plan?: unknown; projection?: unknown } | null {
  try {
    const raw = localStorage.getItem(FIXTURE_KEY)
    return raw ? JSON.parse(raw) : null
  } catch {
    return null
  }
}

let started = false
export function startPlanner() {
  if (started) return
  started = true
  const fx = readFixture()
  if (fx) {
    fixture = true
    sync = 'fixture'
    recordStatus = fx.record ? 'ready' : 'missing'
    setRecord(normalizeRecord(fx.record ?? null))
    plan = migratePlan(fx.plan ?? null, planStartKey()).data
    refreshSemesters()
    pruneCompletedFromSchedule()
    projection = normalizeProjection(fx.projection ?? null)
    planLoaded = true
    projectionLoaded = true
    ;(window as unknown as { __beePlanner: unknown }).__beePlanner = { getSnapshot, buildPlanPayload, recordForSave: () => recordForSave(record) }
    emit()
    return
  }
  const local = loadLocalState()
  emit()
  // Never lose a change to a closed tab or a backgrounded phone app mid-debounce.
  const flushNow = () => { if (planTimer) void flushPlan() }
  window.addEventListener('pagehide', flushNow)
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') flushNow() })
  void initFirebase().then(() => {
    if (!firebaseReady && local.migrated && local.hadLocal) announceMigration(local.info)
  })
}

/* ─── Celebration when the plan first covers everything ─────────────────── */
let wasCovered: boolean | null = null
function celebrateIfCovered() {
  const covered = snapshot.audit.missing === 0 && recordStatus === 'ready'
  if (covered && wasCovered === false) {
    const last = [...semesters].reverse().find((s) => (plan.schedule[s.id] || []).length)
    const pending = snapshot.audit.pending.length
    toast.success(`Your plan covers every requirement${last ? ` — graduation after ${last.label}` : ''}${pending ? `, once ${pending} advisor exception${pending > 1 ? 's are' : ' is'} recorded` : ''}. 🎉`)
  }
  if (recordStatus === 'ready') wasCovered = covered
}

/* ─── Plan mutations ─────────────────────────────────────────────────────── */
function termLabelOf(id: TermId) {
  return termById(id)?.label ?? id
}

/** Adds (or moves) a course; toasts the outcome. Returns false when the rules refuse it. */
export function addCourse(courseId: string, semId: TermId, opts: { quiet?: boolean } = {}): boolean {
  const check = checkAdd(semesters, plan.schedule, courseId, semId)
  const course = findCourse(courseId)
  if (!check.ok) {
    if (check.tone === 'info') toast.info(check.reason)
    else toast.warning(check.reason)
    return false
  }
  const before = plan.schedule
  const from = semesters.find((s) => before[s.id]?.some((e) => e.courseId === courseId))
  setSchedule(withCourseAdded(semesters, plan.schedule, courseId, semId))
  savePlan()
  emit()
  if (!opts.quiet) {
    const verb = from ? `Moved ${course!.code} to` : `Added ${course!.code} to`
    const undo = { label: 'Undo', onClick: () => { setSchedule(before); savePlan(); emit() } }
    if (check.warnings.length) toast.warning(`${verb} ${termLabelOf(semId)}`, { description: `${course!.code} ${check.warnings.join('; ')}.`, action: undo })
    else toast.success(`${verb} ${termLabelOf(semId)}`, { action: undo })
  }
  return true
}

export function removeCourse(courseId: string, semId: TermId, opts: { quiet?: boolean } = {}) {
  const before = plan.schedule
  if (!before[semId]?.some((e) => e.courseId === courseId)) return
  setSchedule(withCourseRemoved(plan.schedule, courseId, semId))
  savePlan()
  emit()
  if (!opts.quiet) toast(`Removed ${courseCode(courseId)} from ${termLabelOf(semId)}`, {
    action: { label: 'Undo', onClick: () => { setSchedule(before); savePlan(); emit() } },
  })
}

export function updateBlocks(courseId: string, semId: TermId, blocks: MeetingBlock[]) {
  const schedule = { ...plan.schedule }
  schedule[semId] = (schedule[semId] || []).map((e) => (e.courseId === courseId
    ? normalizeSchedule({ [semId]: [{ courseId, blocks, sections: e.sections }] }, [termById(semId)!])[semId][0] ?? e
    : e))
  setSchedule(schedule)
  savePlan()
  emit()
}

/** Chooses (or clears, with crn null) the class-schedule section for one graded part of a planned course. */
export function pickSection(semId: TermId, courseId: string, partCodeId: string, crn: string | null) {
  const schedule = { ...plan.schedule }
  schedule[semId] = (schedule[semId] || []).map((e) => {
    if (e.courseId !== courseId) return e
    const sections = { ...(e.sections || {}) }
    if (crn) sections[partCodeId] = crn
    else delete sections[partCodeId]
    const picked = Object.values(sections).map((c) => sectionByCrn(semId, c)).filter((s) => !!s)
    const next = { courseId, blocks: blocksFromSections(picked) } as PlanDoc['schedule'][string][number]
    if (Object.keys(sections).length) next.sections = sections
    return next
  })
  setSchedule(schedule)
  savePlan()
  emit()
}

export function addSemester() {
  if (semesters.length >= MAX_SEMESTER_COUNT) return
  plan = { ...plan, lastTermId: makeTerm(termIdKey(plan.lastTermId) + 1).id }
  refreshSemesters()
  savePlan()
  emit()
  toast(`Added ${semesters[semesters.length - 1].label}`)
}

export function removeLastSemester() {
  const last = semesters[semesters.length - 1]
  if (semesters.length <= 1 || (plan.schedule[last.id] || []).length) return
  const schedule = { ...plan.schedule }
  delete schedule[last.id]
  plan = { ...plan, schedule, lastTermId: makeTerm(last.key - 1).id }
  refreshSemesters()
  savePlan()
  emit()
}

/** The path the plan matches exactly, or null for a custom plan. */
export function matchedPathId(): string | null {
  return currentPathId(plan.schedule, planStartKey())
}

/** Replaces the planned terms with a suggested path. Meeting times and sections stay for courses that keep their term. */
export function applyPath(pathId: string) {
  const path = pathById(pathId)
  if (!path) return
  const built = buildPathPlan(pathId, planStartKey(), isCourseDone)
  for (const [semId, entries] of Object.entries(built.schedule)) {
    built.schedule[semId] = entries.map((e) => {
      const prev = plan.schedule[semId]?.find((x) => x.courseId === e.courseId)
      return prev ? { ...prev } : e
    })
  }
  plan = { ...plan, schedule: built.schedule, lastTermId: built.lastTermId }
  refreshSemesters()
  savePlan()
  emit()
  toast.success(`Loaded the ${pathTitle(path)} — graduating ${path.graduation}`)
}

export function resetPlan() {
  const before = { schedule: plan.schedule, lastTermId: plan.lastTermId }
  setSchedule(normalizeSchedule({}, semesters))
  savePlan()
  emit()
  toast('Planned courses cleared — past terms and grades are untouched', {
    action: { label: 'Undo', onClick: () => { plan = { ...plan, ...before }; refreshSemesters(); savePlan(); emit() } },
  })
}

export function toggleTermExpanded(termId: TermId) {
  const open = new Set(plan.expandedTerms || defaultExpandedTerms(record))
  if (open.has(termId)) open.delete(termId)
  else open.add(termId)
  plan = { ...plan, expandedTerms: [...open] }
  savePlan()
  emit()
}

export function setAllPastExpanded(expand: boolean) {
  plan = { ...plan, expandedTerms: expand ? record.terms.map((t) => t.id) : defaultExpandedTerms(record) }
  savePlan()
  emit()
}

export function setCalSemester(termId: TermId) {
  if (!semesters.some((s) => s.id === termId) || plan.calSemester === termId) return
  plan = { ...plan, calSemester: termId }
  savePlan()
  emit()
}

/* ─── Academic record mutations (never touched by Reset or a suggested path) ── */
export function recordWritable(): boolean {
  if (recordStatus === 'ready' || recordStatus === 'missing') return true
  toast.warning(recordStatus === 'loading' ? 'The academic record is still loading — try again in a moment.' : 'Firebase is unreachable, so the record can’t be changed right now.')
  return false
}

async function commitRecord(mutate: (draft: StoredRecord) => void, message?: string): Promise<boolean> {
  // Never write before the stored record has loaded — that would overwrite it.
  if (!recordWritable()) return false
  const draft = clone(recordForSave(record))
  mutate(draft)
  const pruned = setRecord(normalizeRecord(draft))
  recordStatus = 'ready'
  emit()
  const ok = await saveRecordNow()
  if (pruned) savePlan()
  if (ok && message) toast.success(message)
  return ok
}

export type RecordFields = Omit<RecordCourse, 'id' | 'equiv'> & { equiv?: string }

export function saveRecordCourse(termId: TermId, fields: RecordFields, editingId: string | null) {
  return commitRecord((d) => {
    let keepId: string | null = null
    if (editingId) for (const t of d.terms) {
      const i = t.courses.findIndex((c) => c.id === editingId)
      if (i >= 0) { keepId = editingId; t.courses.splice(i, 1) }
    }
    let term = d.terms.find((t) => t.id === termId)
    if (!term) { term = { id: termId, note: '', courses: [] }; d.terms.push(term) }
    term.courses.push({ equiv: '', ...fields, id: keepId || genId('c-') } as RecordCourse)
  }, editingId ? `Saved ${fields.code}.` : `Added ${fields.code} to ${termLabelOf(termId)}.`)
}

export function deleteRecordCourse(recordId: string) {
  const found = findRecordCourse(recordId)
  if (!found) return
  return commitRecord((d) => d.terms.forEach((t) => { t.courses = t.courses.filter((c) => c.id !== recordId) }), `Removed ${found.rec.code} (${found.term.label}) from the record.`)
}

export function findRecordCourse(recordId: string) {
  for (const term of record.terms) {
    const rec = term.courses.find((c) => c.id === recordId)
    if (rec) return { term, rec }
  }
  return null
}

export function importRecord(data: StoredRecord) {
  plan = { ...plan, expandedTerms: null }
  return commitRecord((d) => {
    d.terms = data.terms
    d.exceptions = data.exceptions
    d.source = data.source
    d.reported = data.reported
  }, `Imported ${data.terms.length} terms and ${data.terms.reduce((s, t) => s + t.courses.length, 0)} courses.`)
}

export type ExceptionFields = Omit<Exception, 'id'>

/** Saves an exception; `also` adds companion exceptions (the capstone's "course not needed"). */
export function saveException(fields: ExceptionFields, editingId: string | null, also: ExceptionFields[] = []) {
  return commitRecord((d) => {
    if (editingId) d.exceptions = d.exceptions.map((x) => (x.id === editingId ? { ...fields, id: editingId } : x))
    else {
      d.exceptions.push({ ...fields, id: genId('x-') })
      also.forEach((x) => d.exceptions.push({ ...x, id: genId('x-') }))
    }
  }, editingId ? 'Exception updated.' : `Exception recorded: ${targetLabel(fields.target)}${also.length ? ' (+ Senior Design II not needed)' : ''}.`)
}

export function removeException(id: string) {
  return commitRecord((d) => { d.exceptions = d.exceptions.filter((x) => x.id !== id) }, 'Exception removed.')
}

/**
 * Final grades turn the first upcoming term into a locked past term. Rows marked
 * "not taken" are left out and their courses leave the plan.
 */
export async function finishTerm(semId: TermId, rows: { code: string; title: string; credits: number; grade: string }[]) {
  const sem = semesters[0]
  if (!sem || sem.id !== semId || !recordWritable()) return null
  const nextRecord = recordWithFinishedTerm(record, semId, rows)
  const expanded = new Set(plan.expandedTerms || defaultExpandedTerms(record))
  expanded.add(semId)
  const schedule = { ...plan.schedule }
  delete schedule[semId]
  plan = { ...plan, schedule, expandedTerms: [...expanded], lastTermId: plan.lastTermId === semId ? makeTerm(sem.key + 1).id : plan.lastTermId }
  setRecord(nextRecord)
  recordStatus = 'ready'
  emit()

  const planPayload = buildPlanPayload(), recordPayload = recordForSave(record)
  writeLocal(planPayload)
  let ok = fixture
  if (!fixture && firebaseReady) {
    setSync('saving')
    ok = await fb.saveBoth(planPayload, recordPayload)
    if (ok) lastPlanHash = JSON.stringify(planPayload)
    setSync(ok ? 'online' : 'error')
  }
  if (!ok) toast.error('Grades are shown but not saved to Firebase — check the connection and try again.')
  const blocked = semesters.flatMap((s) => (plan.schedule[s.id] || []).map((e) => ({ courseId: e.courseId, sem: s, unmet: unmetPrereqs(semesters, plan.schedule, e.courseId, s.id) }))).filter((x) => x.unmet.length)
  return { ok, blocked: blocked.map((b) => ({ ...b, unmetText: b.unmet.map(conditionLabel).join(' and ') })), term: record.terms.find((t) => t.id === semId)! }
}

/* ─── GPA projection (expected grades; never part of the record) ────────── */
let projectionTimer: ReturnType<typeof setTimeout> | null = null

function saveProjection() {
  if (fixture || !firebaseReady || !projectionLoaded) return
  setSync('saving')
  if (projectionTimer) clearTimeout(projectionTimer)
  projectionTimer = setTimeout(async () => {
    const ok = await fb.save('projection', projectionForSave(projection))
    setSync(ok ? 'online' : 'error')
  }, 400)
}

function commitProjection(mutate: (draft: Projection) => void) {
  const draft = projectionForSave(projection)
  mutate(draft)
  projection = normalizeProjection(draft)
  emit()
  saveProjection()
}

export function setProjectedGrade(codeId: string, grade: string) {
  commitProjection((p) => { if (grade) p.grades[codeId] = grade; else delete p.grades[codeId] })
}
export function fillTermGrades(semId: TermId, grade: string) {
  const rows = snapshot.gpa.terms.find((t) => t.term.id === semId)?.rows || []
  commitProjection((p) => rows.forEach((r) => { if (grade) p.grades[r.codeId] = grade; else delete p.grades[r.codeId] }))
}
export function clearAllProjectedGrades() {
  commitProjection((p) => { p.grades = {} })
}
export function setRepeatToReplace(codeId: string, on: boolean) {
  commitProjection((p) => { p.r2r[codeId] = !!on })
}
export function setGpaTarget(fields: Partial<Projection['target']>) {
  commitProjection((p) => { p.target = { ...p.target, ...fields } })
}

export { GPA_RULES }
