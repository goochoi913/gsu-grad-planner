/**
 * The planner's state and its Firebase sync — a port of the original js/app.js.
 *
 *   plans       several named plans to build and compare. The first ("main") is planner/sharedSchedule,
 *               the others planner/plan-<id>; their names and order are planner/planIndex. Each device
 *               opens one plan (remembered on the device), so two people can each work on their own.
 *   plan        the open plan             debounced whole-document writes (500 ms), cached in localStorage;
 *                                       a pending write always goes to the plan it was made in
 *   record      planner/academicRecord  written right away; never cached in the browser; never written
 *                                       before the stored copy has loaded (that would overwrite it)
 *   projection  planner/gpaProjection   debounced writes (400 ms)
 *
 * Everything else (the audit, the GPA projection, the terms on the board) is derived on
 * every change, so the views can never disagree.
 *
 * Test fixtures: when localStorage["bee-planner:fixture"] holds { record, plan, projection },
 * the app skips Firebase entirely and keeps every change in memory. scripts/flow-test.mjs
 * uses this so browser tests never touch Eunbee's real data.
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
  GRADUATION_TERM,
  checkAdd,
  currentPathId,
  defaultExpandedTerms,
  nextTermToAdd,
  pathTitle,
  recordWithFinishedTerm,
  unmetPrereqs,
  withCourseAdded,
  withCourseRemoved,
  withCourseReordered,
} from '@/lib/plan-ops'
import { blocksFromSections, sectionByCrn } from '@/lib/schedule'
import * as fb from '@/lib/firebase'
import { DEFAULT_PLANS, MAIN_PLAN_ID, cleanPlanName, copyName, newPlanId, planListFrom, type PlanMeta } from '@/lib/plans'
import { clone, genId } from '@/lib/format'

export type { PlanMeta }

export type RecordLoad = 'loading' | 'ready' | 'missing' | 'offline'
export type SyncStatus = 'connecting' | 'online' | 'saving' | 'error' | 'fixture'

export interface PlannerSnapshot {
  record: AcademicRecord
  recordStatus: RecordLoad
  summary: RecordSummary
  /** Upcoming terms, first open term → plan.lastTermId. */
  semesters: Term[]
  /** The open plan. */
  plan: PlanDoc
  /** Every plan, in order. */
  plans: PlanMeta[]
  activePlanId: string
  /** loading: just switched, showing the cached copy until Firebase answers. */
  planStatus: 'loading' | 'ready'
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
/** The plan this device has open. */
const ACTIVE_PLAN_KEY = 'bee-planner:active-plan'
/** The plan list, for an instant first paint. */
const PLAN_LIST_KEY = 'bee-planner:plans'


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
let plans: PlanMeta[] = DEFAULT_PLANS
let activePlanId: string = MAIN_PLAN_ID
let planStatus: PlannerSnapshot['planStatus'] = 'ready'
/** planner/planIndex exists (the list was saved at least once). */
let indexExists = false
let indexLoaded = false
/** Test fixtures keep every plan in memory. */
let fixturePlans: Record<string, PlanDoc> = {}
indexRecord(record)

let snapshot: PlannerSnapshot = derive()
const listeners = new Set<() => void>()

function derive(): PlannerSnapshot {
  return {
    record, recordStatus, summary, semesters, plan, plans, activePlanId, planStatus, projection,
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
/** The next write, with the plan it belongs to — switching plans never sends it to the wrong one. */
let pendingPayload: { planId: string; payload: PlanDoc } | null = null
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

const localKey = (planId: string) => (planId === MAIN_PLAN_ID ? LOCAL_KEY : `${LOCAL_KEY}:${planId}`)

function writeLocal(payload: PlanDoc, planId = activePlanId) {
  if (fixture) { fixturePlans[planId] = clone(payload); return }
  try { localStorage.setItem(localKey(planId), JSON.stringify(payload)) } catch { /* private mode */ }
}

function readLocal(planId: string): unknown {
  if (fixture) return fixturePlans[planId] ? clone(fixturePlans[planId]) : null
  try { return JSON.parse(localStorage.getItem(localKey(planId)) || 'null') } catch { return null }
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
  pendingPayload = { planId: activePlanId, payload }
  planTimer = setTimeout(() => void flushPlan(), 500)
}

async function flushPlan() {
  const pending = pendingPayload
  if (planTimer) clearTimeout(planTimer)
  planTimer = null
  pendingPayload = null
  if (!pending) return
  const hash = JSON.stringify(pending.payload)
  const ok = await fb.savePlan(pending.planId, pending.payload)
  if (ok && pending.planId === activePlanId) lastPlanHash = hash
  setSync(ok ? 'online' : 'error')
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
  let recordSeen = false

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

  void fb.listenIndex((raw, exists) => {
    const wasListed = indexLoaded && plans.some((p) => p.id === activePlanId)
    indexExists = exists
    indexLoaded = true
    const next = exists ? planListFrom(raw) : DEFAULT_PLANS
    if (JSON.stringify(next) !== JSON.stringify(plans)) {
      plans = next
      cachePlanList()
    }
    if (!plans.some((p) => p.id === activePlanId)) {
      if (wasListed) toast.info(`The plan you had open was deleted on the other device — showing “${plans[0].name}”.`)
      void switchPlan(plans[0].id, { force: true })
    } else emit()
  }, () => { indexLoaded = true })

  void subscribePlan(activePlanId)
}

/* ─── The open plan's document ───────────────────────────────────────────── */
let planUnsub: (() => void) | null = null
// Bumped on every (re)subscription, so a late snapshot from the plan we left is ignored.
let planSub = 0

async function subscribePlan(planId: string) {
  const sub = ++planSub
  planLoaded = false
  let seen = false
  const unsub = await fb.listenPlan(planId, (raw, exists) => {
    if (sub !== planSub) return
    const first = !seen
    seen = true
    if (!exists && planId !== MAIN_PLAN_ID) {
      // Deleted on the other device (or this device remembered a plan that's gone): never write it back.
      planLoaded = false
      void leaveMissingPlan(planId)
      return
    }
    planLoaded = true
    // A change of ours is still waiting to be written; it will replace this snapshot anyway.
    if (!first && planTimer) return
    const { data, migrated, info } = migratePlan(exists ? raw : null, planStartKey())
    const changed = applyRemotePlan(data, first)
    if (first) planStatus = 'ready'
    if (changed || first) {
      writeLocal(buildPlanPayload())
      emit()
    }
    if (migrated) { lastPlanHash = ''; if (planId === MAIN_PLAN_ID) announceMigration(info); savePlan() }
    else {
      const payload = JSON.stringify(buildPlanPayload())
      lastPlanHash = payload === JSON.stringify(data) ? payload : ''
      if (!lastPlanHash) savePlan()
      else if (!planTimer) setSync('online')
    }
  }, () => {
    if (sub !== planSub) return
    planLoaded = true
    planStatus = 'ready'
    setSync('error')
    emit()
  })
  if (sub !== planSub) { unsub(); return }
  planUnsub = unsub
}

async function leaveMissingPlan(planId: string) {
  if (planId !== activePlanId) return
  const rest = plans.filter((p) => p.id !== planId)
  plans = rest.length ? rest : DEFAULT_PLANS
  cachePlanList()
  await switchPlan(plans[0].id, { force: true })
}

/* ─── Local caches (instant first paint) ─────────────────────────────────── */
const EMPTY_PLAN = { version: PLAN_VERSION, schedule: {} }

function loadLocalState() {
  let raw: unknown = null
  try {
    raw = JSON.parse(localStorage.getItem(localKey(activePlanId)) || 'null')
    if (activePlanId === MAIN_PLAN_ID) for (const key of OLD_LOCAL_KEYS) {
      if (!raw && localStorage.getItem(key)) raw = JSON.parse(localStorage.getItem(key)!)
      localStorage.removeItem(key)
    }
  } catch { /* unreadable cache: start from the defaults */ }
  // Only the first plan ever gets the default path; another plan without a cache waits for Firebase.
  const { data, migrated, info } = activePlanId === MAIN_PLAN_ID ? migratePlan(raw, planStartKey()) : { data: normalizePlan(raw ?? EMPTY_PLAN, planStartKey()), migrated: false, info: {} }
  plan = data
  refreshSemesters()
  writeLocal(data)
  return { hadLocal: !!raw, migrated, info }
}

function readActivePlanId(): string {
  try { return localStorage.getItem(ACTIVE_PLAN_KEY) || MAIN_PLAN_ID } catch { return MAIN_PLAN_ID }
}

function writeActivePlanId(planId: string) {
  if (fixture) return
  try { localStorage.setItem(ACTIVE_PLAN_KEY, planId) } catch { /* private mode */ }
}

function readCachedPlanList(): PlanMeta[] {
  try {
    const raw = JSON.parse(localStorage.getItem(PLAN_LIST_KEY) || 'null') as { order?: unknown; names?: unknown } | null
    return raw ? planListFrom(raw) : DEFAULT_PLANS
  } catch { return DEFAULT_PLANS }
}

function cachePlanList() {
  if (fixture) return
  try { localStorage.setItem(PLAN_LIST_KEY, JSON.stringify({ order: plans.map((p) => p.id), names: Object.fromEntries(plans.map((p) => [p.id, p.name])) })) } catch { /* private mode */ }
}

interface Fixture {
  record?: unknown
  plan?: unknown
  projection?: unknown
  /** More plans: [{ id, name, plan }]. The fixture's `plan` is the first ("main") unless one has id "main". */
  plans?: { id: string; name: string; plan: unknown }[]
  activePlanId?: string
}

function readFixture(): Fixture | null {
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
    const extra = (fx.plans ?? []).filter((p) => p && /^[a-z0-9]{4,40}$|^main$/.test(p.id))
    plans = [...(extra.some((p) => p.id === MAIN_PLAN_ID) ? [] : DEFAULT_PLANS), ...extra.map((p) => ({ id: p.id, name: cleanPlanName(p.name) || 'Untitled plan' }))]
    fixturePlans = { [MAIN_PLAN_ID]: migratePlan(fx.plan ?? null, planStartKey()).data }
    for (const p of extra) fixturePlans[p.id] = normalizePlan(p.plan ?? EMPTY_PLAN, planStartKey())
    activePlanId = plans.some((p) => p.id === fx.activePlanId) ? fx.activePlanId! : plans[0].id
    plan = clone(fixturePlans[activePlanId])
    refreshSemesters()
    pruneCompletedFromSchedule()
    projection = normalizeProjection(fx.projection ?? null)
    planLoaded = true
    projectionLoaded = true
    ;(window as unknown as { __beePlanner: unknown }).__beePlanner = {
      getSnapshot, buildPlanPayload, recordForSave: () => recordForSave(record),
      /** Every plan as stored, with the open one's unsaved state. */
      planDocs: () => ({ ...clone(fixturePlans), [activePlanId]: buildPlanPayload() }),
    }
    emit()
    return
  }
  plans = readCachedPlanList()
  activePlanId = readActivePlanId()
  if (!plans.some((p) => p.id === activePlanId)) activePlanId = plans[0].id
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
  // A plan that is still loading shows a blank placeholder — not a change worth celebrating.
  if (planStatus === 'loading' || !planLoaded && !fixture && firebaseReady) return
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

/** Adds (or moves) a course — at `index` in the term when given; toasts the outcome. Returns false when the rules refuse it. */
export function addCourse(courseId: string, semId: TermId, opts: { quiet?: boolean; index?: number } = {}): boolean {
  const check = checkAdd(semesters, plan.schedule, courseId, semId)
  const course = findCourse(courseId)
  if (!check.ok) {
    if (check.tone === 'info') toast.info(check.reason)
    else toast.warning(check.reason)
    return false
  }
  const before = plan.schedule
  const from = semesters.find((s) => before[s.id]?.some((e) => e.courseId === courseId))
  setSchedule(withCourseAdded(semesters, plan.schedule, courseId, semId, opts.index))
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

/**
 * Drag and drop: puts a course at `index` in a term — a new position within its term, a move
 * from another term (the 18-credit cap still applies), or an add from the course list.
 */
export function placeCourse(courseId: string, semId: TermId, index: number): boolean {
  const from = semesters.find((s) => plan.schedule[s.id]?.some((e) => e.courseId === courseId))?.id ?? null
  if (from !== semId) return addCourse(courseId, semId, { index })
  const at = (plan.schedule[semId] || []).findIndex((e) => e.courseId === courseId)
  if (at === index) return true
  setSchedule(withCourseReordered(plan.schedule, semId, courseId, index))
  savePlan()
  emit()
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

// A plan entry with some parts' sections set (a CRN) or cleared (null).
function withSections(schedule: PlanSchedule, semId: TermId, courseId: string, picks: Record<string, string | null>): PlanSchedule {
  return {
    ...schedule,
    [semId]: (schedule[semId] || []).map((e) => {
      if (e.courseId !== courseId) return e
      const sections = { ...(e.sections || {}) }
      for (const [part, crn] of Object.entries(picks)) {
        if (crn) sections[part] = crn
        else delete sections[part]
      }
      const picked = Object.values(sections).map((c) => sectionByCrn(semId, c)).filter((s) => !!s)
      const next = { courseId, blocks: blocksFromSections(picked) } as PlanDoc['schedule'][string][number]
      if (Object.keys(sections).length) next.sections = sections
      return next
    }),
  }
}

/** Chooses (or clears, with crn null) the class-schedule section for one graded part of a planned course. */
export function pickSection(semId: TermId, courseId: string, partCodeId: string, crn: string | null) {
  setSchedule(withSections(plan.schedule, semId, courseId, { [partCodeId]: crn }))
  savePlan()
  emit()
}

/**
 * Saves the sections chosen in the section picker in one step — adding the course to the
 * term (or moving it there) first when it isn't planned there yet. Toasts with Undo.
 * Returns false when the term can't take it (the 18-credit cap, a completed course).
 */
export function saveSections(semId: TermId, courseId: string, picks: Record<string, string | null>, message: string): boolean {
  const before = plan.schedule
  let schedule = plan.schedule
  const from = semesters.find((s) => before[s.id]?.some((e) => e.courseId === courseId)) ?? null
  if (from?.id !== semId) {
    const check = checkAdd(semesters, schedule, courseId, semId)
    if (!check.ok) {
      if (check.tone === 'info') toast.info(check.reason)
      else toast.warning(check.reason)
      return false
    }
    schedule = withCourseAdded(semesters, schedule, courseId, semId)
  }
  setSchedule(withSections(schedule, semId, courseId, picks))
  savePlan()
  emit()
  const where = from?.id === semId ? '' : from ? ` — moved to ${termLabelOf(semId)}` : ` — added to ${termLabelOf(semId)}`
  toast.success(`${message}${where}`, {
    duration: 8000,
    action: { label: 'Undo', onClick: () => { setSchedule(before); savePlan(); emit() } },
  })
  return true
}

export function addSemester() {
  if (!nextTermToAdd(semesters)) {
    toast.info(`She graduates in three semesters — the plan ends with ${GRADUATION_TERM.label}.`)
    return
  }
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

/* ─── Plans: make, open, rename, reorder, delete ──────────────────────────── */
function indexBase(): fb.IndexBase | null {
  return indexExists ? null : { order: plans.map((p) => p.id), names: Object.fromEntries(plans.map((p) => [p.id, p.name])) }
}

function connected(): boolean {
  if (fixture || firebaseReady) return true
  toast.warning('Not connected to Firebase — plans can’t be changed right now.')
  return false
}

/** Opens another plan on this device (the other device keeps whatever it has open). */
export async function switchPlan(planId: string, opts: { force?: boolean } = {}) {
  if (!opts.force && (planId === activePlanId || !plans.some((p) => p.id === planId))) return
  if (planTimer) await flushPlan()
  planUnsub?.()
  planUnsub = null
  planSub++
  activePlanId = planId
  writeActivePlanId(planId)
  // Paint from this device's copy right away; Firebase's copy replaces it a moment later.
  const cached = readLocal(planId)
  plan = normalizePlan(cached ?? EMPTY_PLAN, planStartKey())
  refreshSemesters()
  pruneCompletedFromSchedule()
  lastPlanHash = ''
  wasCovered = null
  planLoaded = fixture
  planStatus = fixture || !firebaseReady ? 'ready' : 'loading'
  emit()
  if (!fixture && firebaseReady) void subscribePlan(planId)
}

/** The stored copy of any plan (the open one includes unsaved changes). */
export async function loadPlan(planId: string): Promise<PlanDoc | null> {
  if (planId === activePlanId) return buildPlanPayload()
  if (fixture) return fixturePlans[planId] ? clone(fixturePlans[planId]) : null
  const raw = await fb.fetchPlan(planId)
  if (!raw) return null
  const data = normalizePlan(raw, planStartKey())
  writeLocal(data, planId)
  return data
}

export type PlanStart = 'copy' | 'empty' | { pathId: string }

/** Makes a new plan — a copy of the open one, an empty one, or a suggested path — and opens it. */
export async function createPlan(name: string, start: PlanStart): Promise<boolean> {
  if (!connected()) return false
  const id = newPlanId()
  const title = cleanPlanName(name) || 'Untitled plan'
  const base = buildPlanPayload()
  const payload = start === 'copy'
    ? base
    : start === 'empty'
      ? normalizePlan({ ...base, schedule: {} }, planStartKey())
      : normalizePlan({ ...base, ...buildPathPlan(start.pathId, planStartKey(), isCourseDone) }, planStartKey())
  return addPlan(id, title, payload)
}

async function addPlan(id: string, title: string, payload: PlanDoc): Promise<boolean> {
  const first = indexBase()
  if (!fixture) {
    setSync('saving')
    const ok = await fb.createPlan(id, title, payload, first)
    setSync(ok ? 'online' : 'error')
    if (!ok) {
      toast.error('Couldn’t make the plan — check the connection and try again.')
      return false
    }
  }
  writeLocal(payload, id)
  if (!plans.some((p) => p.id === id)) plans = [...plans, { id, name: title }]
  indexExists = true
  cachePlanList()
  await switchPlan(id, { force: true })
  toast.success(`Made “${title}” — it’s open now`)
  return true
}

/** A copy of any plan, opened. */
export async function duplicatePlan(planId: string): Promise<boolean> {
  if (!connected()) return false
  const meta = plans.find((p) => p.id === planId)
  const data = await loadPlan(planId)
  if (!meta || !data) {
    toast.error('Couldn’t read that plan — try again.')
    return false
  }
  return addPlan(newPlanId(), copyName(meta.name, plans), data)
}

export async function renamePlan(planId: string, name: string): Promise<boolean> {
  const title = cleanPlanName(name)
  const meta = plans.find((p) => p.id === planId)
  if (!title || !meta || meta.name === title || !connected()) return false
  const first = indexBase()
  const before = plans
  plans = plans.map((p) => (p.id === planId ? { ...p, name: title } : p))
  cachePlanList()
  emit()
  if (fixture) return true
  const ok = await fb.renamePlan(planId, title, first)
  if (ok) indexExists = true
  else {
    plans = before
    cachePlanList()
    emit()
    toast.error('Couldn’t rename the plan — check the connection and try again.')
  }
  return ok
}

/** A new order for the list (drag and drop). */
export async function reorderPlans(ids: string[]): Promise<boolean> {
  const next = ids.map((id) => plans.find((p) => p.id === id)).filter((p): p is PlanMeta => !!p)
  if (next.length !== plans.length || next.every((p, i) => p.id === plans[i].id) || !connected()) return false
  const first = indexBase()
  const before = plans
  plans = next
  cachePlanList()
  emit()
  if (fixture) return true
  const ok = await fb.reorderPlans(next.map((p) => p.id), first ? { ...first, order: next.map((p) => p.id) } : null)
  if (ok) indexExists = true
  else {
    plans = before
    cachePlanList()
    emit()
    toast.error('Couldn’t save the new order — check the connection and try again.')
  }
  return ok
}

/** Deletes a plan for both of you (Undo puts it back). The last plan can't be deleted. */
export async function deletePlan(planId: string): Promise<boolean> {
  const meta = plans.find((p) => p.id === planId)
  if (!meta || !connected()) return false
  if (plans.length < 2) {
    toast.info('This is the only plan — make another one before deleting it.')
    return false
  }
  const content = await loadPlan(planId)
  const order = plans.map((p) => p.id)
  const first = indexBase()
  if (planId === activePlanId) {
    const i = plans.findIndex((p) => p.id === planId)
    await switchPlan((plans[i + 1] ?? plans[i - 1]).id)
  }
  plans = plans.filter((p) => p.id !== planId)
  cachePlanList()
  emit()
  if (fixture) delete fixturePlans[planId]
  else {
    setSync('saving')
    const ok = await fb.deletePlan(planId, first)
    setSync(ok ? 'online' : 'error')
    if (!ok) {
      plans = order.map((id) => (id === planId ? meta : plans.find((p) => p.id === id))).filter((p): p is PlanMeta => !!p)
      cachePlanList()
      emit()
      toast.error('Couldn’t delete the plan — check the connection and try again.')
      return false
    }
    indexExists = true
  }
  toast(`Deleted “${meta.name}”`, {
    duration: 8000,
    action: content ? { label: 'Undo', onClick: () => void restoreDeletedPlan(meta, order, content) } : undefined,
  })
  return true
}

async function restoreDeletedPlan(meta: PlanMeta, order: string[], content: PlanDoc) {
  if (!fixture) {
    const ok = await fb.restorePlan(meta.id, meta.name, order, content)
    if (!ok) { toast.error('Couldn’t restore the plan.'); return }
  } else fixturePlans[meta.id] = clone(content)
  writeLocal(content, meta.id)
  const byId = new Map([...plans, meta].map((p) => [p.id, p]))
  plans = [...order.filter((id) => byId.has(id)).map((id) => byId.get(id)!), ...plans.filter((p) => !order.includes(p.id))]
  cachePlanList()
  await switchPlan(meta.id, { force: true })
  toast.success(`Restored “${meta.name}”`)
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
    ok = await fb.saveBoth(activePlanId, planPayload, recordPayload)
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
