/**
 * Firebase wiring — the same project and documents the planner has always used, so
 * everything already saved keeps working:
 *
 *   planner/sharedSchedule  the first plan ("main"): upcoming terms, courses, chosen sections, meeting times
 *   planner/plan-<id>       every other plan, in the same shape
 *   planner/planIndex       the plans' names and order — { order: [ids], names: { id: name } };
 *                           missing until a second plan is made (then the list is just "main")
 *   planner/academicRecord  past terms with grades, and advisor exceptions (stored only here)
 *   planner/gpaProjection   expected (what-if) grades, Repeat to Replace switches, GPA target
 *
 * No sign-in, by choice (see README). The web config below is public by design — it ships
 * in every Firebase web app's bundle.
 *
 * The SDK is imported lazily so the first paint never waits on it. VITE_FIRESTORE_EMULATOR
 * ("127.0.0.1:8085") points it at a local Firestore emulator for tests — never at the real data.
 */
import type { DocumentReference, Firestore } from 'firebase/firestore'
import { MAIN_PLAN_ID } from '@/lib/plans'

const firebaseConfig = {
  apiKey: 'AIzaSyBRKLpnwbYa-ahTNRSaZUrTeNSYb2It5qE',
  authDomain: 'gsu-grad-planner.firebaseapp.com',
  projectId: 'gsu-grad-planner',
  storageBucket: 'gsu-grad-planner.firebasestorage.app',
  messagingSenderId: '414204042501',
  appId: '1:414204042501:web:ee9bfbdcd3a4939574ab6c',
  measurementId: 'G-0BKCSKSPVL',
}

export type DocName = 'record' | 'projection'

const DOC_PATHS: Record<DocName, [string, string]> = {
  record: ['planner', 'academicRecord'],
  projection: ['planner', 'gpaProjection'],
}

/** The first plan ("main") keeps the original document. */
const INDEX_DOC = 'planIndex'

function planDocId(planId: string): string {
  return planId === MAIN_PLAN_ID ? 'sharedSchedule' : `plan-${planId}`
}

type FirestoreModule = typeof import('firebase/firestore')

interface Connection {
  fs: FirestoreModule
  db: Firestore
  refs: Record<DocName, DocumentReference>
  plan: (planId: string) => DocumentReference
  index: DocumentReference
}

let connection: Promise<Connection | null> | null = null

export function connect(): Promise<Connection | null> {
  if (!connection) {
    connection = (async () => {
      const [{ initializeApp, getApps }, fs] = await Promise.all([import('firebase/app'), import('firebase/firestore')])
      const app = getApps()[0] ?? initializeApp(firebaseConfig)
      const db = fs.getFirestore(app)
      const emulator = import.meta.env.VITE_FIRESTORE_EMULATOR as string | undefined
      if (emulator) {
        const [host, port] = emulator.split(':')
        fs.connectFirestoreEmulator(db, host, Number(port))
      }
      const refs = Object.fromEntries(
        (Object.keys(DOC_PATHS) as DocName[]).map((k) => [k, fs.doc(db, ...DOC_PATHS[k])]),
      ) as Record<DocName, DocumentReference>
      return { fs, db, refs, plan: (id: string) => fs.doc(db, 'planner', planDocId(id)), index: fs.doc(db, 'planner', INDEX_DOC) }
    })().catch((e) => {
      console.error('[Firebase] init failed:', e)
      return null
    })
  }
  return connection
}

const stamped = (fs: FirestoreModule, payload: object) => ({ ...payload, updatedAt: fs.serverTimestamp() })

async function attempt(label: string, run: (c: Connection) => Promise<unknown>): Promise<boolean> {
  const c = await connect()
  if (!c) return false
  try {
    await run(c)
    return true
  } catch (e) {
    console.error(`[Firebase] ${label} failed:`, e)
    return false
  }
}

/** Replaces the record or the projection (merge: false), exactly like the original app. */
export function save(which: DocName, payload: object): Promise<boolean> {
  return attempt(`${which} save`, (c) => c.fs.setDoc(c.refs[which], stamped(c.fs, payload)))
}

/** Replaces one plan's document. */
export function savePlan(planId: string, payload: object): Promise<boolean> {
  return attempt(`plan ${planId} save`, (c) => c.fs.setDoc(c.plan(planId), stamped(c.fs, payload)))
}

/** Writes a plan and the record together — finishing a term moves its courses from one to the other. */
export function saveBoth(planId: string, plan: object, record: object): Promise<boolean> {
  return attempt('batch save', (c) => {
    const batch = c.fs.writeBatch(c.db)
    batch.set(c.plan(planId), stamped(c.fs, plan))
    batch.set(c.refs.record, stamped(c.fs, record))
    return batch.commit()
  })
}

type OnData = (data: Record<string, unknown> | null, exists: boolean, pendingWrites: boolean) => void

async function listenTo(label: string, ref: (c: Connection) => DocumentReference, onData: OnData, onError?: (err: unknown) => void): Promise<() => void> {
  const c = await connect()
  if (!c) {
    onError?.(new Error('Firebase unavailable'))
    return () => {}
  }
  return c.fs.onSnapshot(
    ref(c),
    (snap) => onData(snap.exists() ? (snap.data() as Record<string, unknown>) : null, snap.exists(), snap.metadata.hasPendingWrites),
    (err) => {
      console.error(`[Firebase] ${label} listener error:`, err)
      onError?.(err)
    },
  )
}

/** Live updates for the record or the projection. `onData(null, false)` when it doesn't exist yet. */
export function listen(which: DocName, onData: OnData, onError?: (err: unknown) => void): Promise<() => void> {
  return listenTo(which, (c) => c.refs[which], onData, onError)
}

/** Live updates for one plan. */
export function listenPlan(planId: string, onData: OnData, onError?: (err: unknown) => void): Promise<() => void> {
  return listenTo(`plan ${planId}`, (c) => c.plan(planId), onData, onError)
}

/** Live updates for the plans' names and order. */
export function listenIndex(onData: OnData, onError?: (err: unknown) => void): Promise<() => void> {
  return listenTo('plan index', (c) => c.index, onData, onError)
}

/** One plan's document as it is now (for duplicating or comparing a plan that isn't open). */
export async function fetchPlan(planId: string): Promise<Record<string, unknown> | null> {
  const c = await connect()
  if (!c) return null
  try {
    const snap = await c.fs.getDoc(c.plan(planId))
    return snap.exists() ? (snap.data() as Record<string, unknown>) : null
  } catch (e) {
    console.error(`[Firebase] plan ${planId} read failed:`, e)
    return null
  }
}

/**
 * The plan list lives in planner/planIndex. Every change is a merge, so two devices editing
 * different plans never undo each other. `first` creates the list (with "main") when it
 * doesn't exist yet.
 */
export interface IndexBase {
  order: string[]
  names: Record<string, string>
}

function indexPatch(change: Record<string, unknown>, first: IndexBase | null): Record<string, unknown> {
  return first ? { version: 1, ...change, order: change.order ?? first.order, names: { ...first.names, ...(change.names as object) } } : change
}

/** A new plan: its document and its place in the list, in one write. */
export function createPlan(planId: string, name: string, payload: object, first: IndexBase | null): Promise<boolean> {
  return attempt('create plan', (c) => {
    const batch = c.fs.writeBatch(c.db)
    batch.set(c.plan(planId), stamped(c.fs, payload))
    batch.set(c.index, stamped(c.fs, indexPatch({
      order: first ? [...first.order, planId] : c.fs.arrayUnion(planId),
      names: { [planId]: name },
    }, first)), { merge: true })
    return batch.commit()
  })
}

export function renamePlan(planId: string, name: string, first: IndexBase | null): Promise<boolean> {
  return attempt('rename plan', (c) => c.fs.setDoc(c.index, stamped(c.fs, indexPatch({ names: { [planId]: name } }, first)), { merge: true }))
}

export function reorderPlans(order: string[], first: IndexBase | null): Promise<boolean> {
  return attempt('reorder plans', (c) => c.fs.setDoc(c.index, stamped(c.fs, indexPatch({ order }, first)), { merge: true }))
}

/** Takes a plan out of the list and deletes its document (the first plan's document stays, unlisted). */
export function deletePlan(planId: string, first: IndexBase | null): Promise<boolean> {
  return attempt('delete plan', (c) => {
    const batch = c.fs.writeBatch(c.db)
    if (first) {
      const order = first.order.filter((id) => id !== planId)
      const names = Object.fromEntries(Object.entries(first.names).filter(([id]) => id !== planId))
      batch.set(c.index, stamped(c.fs, { version: 1, order, names }), { merge: true })
    } else {
      batch.set(c.index, stamped(c.fs, { order: c.fs.arrayRemove(planId), names: { [planId]: c.fs.deleteField() } }), { merge: true })
    }
    if (planId !== MAIN_PLAN_ID) batch.delete(c.plan(planId))
    return batch.commit()
  })
}

/** Puts a deleted plan back (Undo): its document and its place in the list. */
export function restorePlan(planId: string, name: string, order: string[], payload: object): Promise<boolean> {
  return attempt('restore plan', (c) => {
    const batch = c.fs.writeBatch(c.db)
    batch.set(c.plan(planId), stamped(c.fs, payload))
    batch.set(c.index, stamped(c.fs, { order, names: { [planId]: name } }), { merge: true })
    return batch.commit()
  })
}
