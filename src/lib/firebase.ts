/**
 * Firebase wiring — the same project and the same three documents the planner has
 * always used, so everything already saved keeps working:
 *
 *   planner/sharedSchedule  the plan: upcoming terms, courses, chosen sections, meeting times
 *   planner/academicRecord  past terms with grades, and advisor exceptions (stored only here)
 *   planner/gpaProjection   expected (what-if) grades, Repeat to Replace switches, GPA target
 *
 * No sign-in, by choice (see README). The web config below is public by design — it ships
 * in every Firebase web app's bundle.
 *
 * The SDK is imported lazily so the first paint never waits on it.
 */
import type { DocumentReference, Firestore } from 'firebase/firestore'

const firebaseConfig = {
  apiKey: 'AIzaSyBRKLpnwbYa-ahTNRSaZUrTeNSYb2It5qE',
  authDomain: 'gsu-grad-planner.firebaseapp.com',
  projectId: 'gsu-grad-planner',
  storageBucket: 'gsu-grad-planner.firebasestorage.app',
  messagingSenderId: '414204042501',
  appId: '1:414204042501:web:ee9bfbdcd3a4939574ab6c',
  measurementId: 'G-0BKCSKSPVL',
}

export type DocName = 'plan' | 'record' | 'projection'

const DOC_PATHS: Record<DocName, [string, string]> = {
  plan: ['planner', 'sharedSchedule'],
  record: ['planner', 'academicRecord'],
  projection: ['planner', 'gpaProjection'],
}

type FirestoreModule = typeof import('firebase/firestore')

interface Connection {
  fs: FirestoreModule
  db: Firestore
  refs: Record<DocName, DocumentReference>
}

let connection: Promise<Connection | null> | null = null

export function connect(): Promise<Connection | null> {
  if (!connection) {
    connection = (async () => {
      const [{ initializeApp, getApps }, fs] = await Promise.all([import('firebase/app'), import('firebase/firestore')])
      const app = getApps()[0] ?? initializeApp(firebaseConfig)
      const db = fs.getFirestore(app)
      const refs = Object.fromEntries(
        (Object.keys(DOC_PATHS) as DocName[]).map((k) => [k, fs.doc(db, ...DOC_PATHS[k])]),
      ) as Record<DocName, DocumentReference>
      return { fs, db, refs }
    })().catch((e) => {
      console.error('[Firebase] init failed:', e)
      return null
    })
  }
  return connection
}

const stamped = (fs: FirestoreModule, payload: object) => ({ ...payload, updatedAt: fs.serverTimestamp() })

/** Replaces one document (merge: false), exactly like the original app. */
export async function save(which: DocName, payload: object): Promise<boolean> {
  const c = await connect()
  if (!c) return false
  try {
    await c.fs.setDoc(c.refs[which], stamped(c.fs, payload))
    return true
  } catch (e) {
    console.error(`[Firebase] ${which} save failed:`, e)
    return false
  }
}

/** Writes the plan and the record together — finishing a term moves its courses from one to the other. */
export async function saveBoth(plan: object, record: object): Promise<boolean> {
  const c = await connect()
  if (!c) return false
  try {
    const batch = c.fs.writeBatch(c.db)
    batch.set(c.refs.plan, stamped(c.fs, plan))
    batch.set(c.refs.record, stamped(c.fs, record))
    await batch.commit()
    return true
  } catch (e) {
    console.error('[Firebase] batch save failed:', e)
    return false
  }
}

/** Live updates for one document. `onData(null, false)` when it doesn't exist yet. */
export async function listen(
  which: DocName,
  onData: (data: Record<string, unknown> | null, exists: boolean, pendingWrites: boolean) => void,
  onError?: (err: unknown) => void,
): Promise<() => void> {
  const c = await connect()
  if (!c) {
    onError?.(new Error('Firebase unavailable'))
    return () => {}
  }
  return c.fs.onSnapshot(
    c.refs[which],
    (snap) => onData(snap.exists() ? (snap.data() as Record<string, unknown>) : null, snap.exists(), snap.metadata.hasPendingWrites),
    (err) => {
      console.error(`[Firebase] ${which} listener error:`, err)
      onError?.(err)
    },
  )
}
