/**
 * npm test — the TypeScript planning logic must behave exactly like the original app.
 *
 * Replays the synthetic scenario battery (scripts/fixtures/scenarios.mjs) through
 * src/lib/planner.ts + src/data/degree.ts and compares every result with what the
 * original js/planner.js produced (scripts/fixtures/golden.json, from
 * scripts/make-golden.mjs). Then checks the behaviour the original never had.
 *
 *   npx tsx scripts/logic-test.ts
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import * as D from '../src/data/degree'
import * as P from '../src/lib/planner'
import * as S from '../src/lib/schedule'
import * as R from '../src/lib/relevance'
import { API_NAMES, scenarios, ser } from './fixtures/scenarios.mjs'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const golden = JSON.parse(fs.readFileSync(path.join(root, 'scripts/fixtures/golden.json'), 'utf8')) as {
  meta: { rev: string; scenarios: number }
  scenarios: { name: string; output: unknown }[]
}

/**
 * Deliberate differences from the original, applied to the expected output before comparing.
 * Each one is a wording change for the new interface — never a change in what is computed.
 */
const WORDING_CHANGES: [string, string][] = [
  // The original pointed at its "📚 Record" toolbar button; the new app calls it the Record.
  ['on the earlier F in 📚 Record.', 'on the earlier F in the Record.'],
]

let failures = 0
const fail = (label: string, detail: string) => {
  failures++
  console.log(` FAIL  ${label}\n        ${detail}`)
}

/** First path where two serialized values differ, with both sides. */
function firstDiff(a: unknown, b: unknown, at = '$'): string | null {
  if (JSON.stringify(a) === JSON.stringify(b)) return null
  if (a && b && typeof a === 'object' && typeof b === 'object') {
    if (Array.isArray(a) !== Array.isArray(b)) return `${at}: array vs object`
    if (Array.isArray(a) && Array.isArray(b)) {
      if (a.length !== b.length) return `${at}: length ${a.length} (expected) vs ${b.length} (actual)`
      for (let i = 0; i < a.length; i++) {
        const d = firstDiff(a[i], b[i], `${at}[${i}]`)
        if (d) return d
      }
      return `${at}: same items, different serialization`
    }
    const ka = Object.keys(a as object), kb = Object.keys(b as object)
    if (ka.join() !== kb.join()) return `${at}: keys\n          expected ${ka.join(',')}\n          actual   ${kb.join(',')}`
    for (const k of ka) {
      const d = firstDiff((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k], `${at}.${k}`)
      if (d) return d
    }
  }
  const show = (v: unknown) => {
    const s = JSON.stringify(v)
    return s === undefined ? 'undefined' : s.length > 300 ? `${s.slice(0, 300)}…` : s
  }
  return `${at}:\n          expected ${show(a)}\n          actual   ${show(b)}`
}

/* ── 1. the port reproduces the original ─────────────────────────── */
const api: Record<string, unknown> = { ...D, ...P }
const missingApi = API_NAMES.filter((n) => !(n in api))
if (missingApi.length) fail('API surface', `not exported by the port: ${missingApi.join(', ')}`)

const expected = new Map(golden.scenarios.map((s) => [s.name, s.output]))
const ran = new Set<string>()
let passed = 0
for (const [name, fn] of scenarios(api as never) as [string, () => unknown][]) {
  ran.add(name)
  if (!expected.has(name)) {
    fail(name, 'no golden result — regenerate with node scripts/make-golden.mjs')
    continue
  }
  let actual: unknown
  try {
    actual = ser(fn())
  } catch (e) {
    actual = { __throws: String((e as Error)?.message ?? e) }
  }
  let want = JSON.stringify(expected.get(name))
  for (const [from, to] of WORDING_CHANGES) want = want.split(from).join(to)
  const wantValue = JSON.parse(want)
  const diff = firstDiff(wantValue, actual)
  if (diff) fail(name, diff)
  else passed++
}
for (const name of expected.keys()) if (!ran.has(name)) fail(name, 'in golden.json but no longer in the battery')
console.log(`  ok    ${passed} of ${golden.scenarios.length} golden scenarios match the original (${golden.meta.rev.slice(0, 7)})`)

/* ── 2. the battery still reaches every rule branch ──────────────── */
// The fixtures are synthetic and get rewritten; this keeps an edit from silently dropping a branch.
{
  const text = JSON.stringify(golden.scenarios)
  const branches: Record<string, string> = {
    'Repeat to Replace applies': '"status":"applies"', 'R2R lower grade': '"status":"lower"', 'R2R over the 4-course cap': '"status":"limit"',
    'R2R not eligible': '"status":"blocked"', 'R2R switched off': '"status":"off"',
    'blocked: transfer first attempt': 'is transfer credit, which isn’t part of the GSU GPA', 'blocked: grade not in GPA': 'isn’t part of the GPA, so it can’t be replaced',
    'blocked: before Fall 2011': 'Only repeats taken from Fall 2011 on qualify.', 'blocked: already replaced': 'That grade is already replaced through Repeat to Replace.',
    'graduation-term retake note': 'This retake is in the graduation term',
    'GPA: no grade points': '"why":"no grade points"', 'GPA: Learning Support': '"why":"Learning Support"', 'GPA: not counted': '"why":"not counted"', 'GPA: replaced': '"why":"Repeat to Replace"',
    'line met': '"status":"met"', 'line planned': '"status":"planned"', 'line pending': '"status":"pending"', 'line missing': '"status":"missing"',
    'pending substitution': '"kind":"substitute"', 'pending force-complete': '"kind":"complete"', 'pending waiver': '"kind":"waive"', 'quarter-credit 0.67 shortfall': '"pendingWaiver":0.67',
    'checklist: enter substitution': 'capstone substitution in Degree Works', 'checklist: substitution recorded': 'capstone substitution recorded',
    'checklist: waive fractions': 'Waive the fractional credit shortfalls', 'checklist: waivers recorded': 'Credit waivers recorded',
    'checklist: confirm small RPE course': 'counts toward Required Program Electives', 'checklist: request R2R': 'Request Repeat to Replace for',
    'checklist: R2R recorded': 'Repeat to Replace recorded for', 'checklist: apply to graduate': 'Apply to graduate in PAWS',
    'target: no courses': '"status":"none"', 'target: already there': '"status":"already"', 'target: reachable': '"status":"reachable"', 'target: unreachable': '"status":"unreachable"',
    'migrate: seeded': '"seeded":true', 'migrate: upgraded': '"upgraded":true', 'migrate: Fall 2026 moved': '"movedFromFall2026":2', 'migrate: exam removed': '"examRemoved":["ECON2105","ECON2106"]',
    'audit incomplete': '"status":"incomplete"', 'offering: none': '"level":"none"', 'offering: sometimes': '"level":"sometimes"', 'offering: regular': '"level":"regular"',
    'record: unused': '"status":"unused"', 'record: no credit': '"status":"nocredit"', 'record: not counted': '"status":"notcounted"', 'record: replaced grade': '"r2r":true',
  }
  const missing = Object.entries(branches).filter(([, marker]) => !text.includes(marker)).map(([label]) => label)
  const audits = golden.scenarios.map((s) => (s.output as { audit?: { dHours: number; rpeGpa: { gpa: number | null } } } | null)?.audit).filter(Boolean)
  if (!audits.some((a) => a!.dHours > 12)) missing.push('more than 12 D hours')
  if (!audits.some((a) => a!.rpeGpa.gpa != null && a!.rpeGpa.gpa < 2)) missing.push('program electives below a C average')
  if (missing.length) fail('battery coverage', `no golden scenario reaches: ${missing.join('; ')}`)
  else console.log(`  ok    the battery reaches all ${Object.keys(branches).length + 2} rule branches it is meant to cover`)
}

/* ── 3. behaviour the original never had ─────────────────────────── */
let newChecks = 0
function check(label: string, actual: unknown, want: unknown) {
  newChecks++
  const a = JSON.stringify(actual), w = JSON.stringify(want)
  if (a === w) console.log(`  ok    ${label}`)
  else fail(label, `expected ${w}\n        actual   ${a}`)
}

const entry = (sections: unknown) => P.normalizeScheduleEntry({ courseId: 'CSC3210', blocks: [], sections }, 'spring2027', 0)

check('a picked lecture and lab survive normalization',
  entry({ CSC3210: '14634', CSC3210L: '20706' }), { courseId: 'CSC3210', blocks: [], sections: { CSC3210: '14634', CSC3210L: '20706' } })
check('invalid section keys and CRNs are dropped',
  entry({ csc3210: '14634', 'CSC 3210': '14634', CSC3210: '1463', CSC3210L: 20706, PHYS2212: '20810', MATH3020: '168020', X: '12345' }),
  { courseId: 'CSC3210', blocks: [], sections: { PHYS2212: '20810' } })
for (const [label, value] of [['{}', {}], ['null', null], ['a string', '14634'], ['an array', ['14634']], ['all invalid', { bad: 'x' }]] as const) {
  check(`sections ${label} → no sections key, same shape as before`, Object.keys(entry(value) as object), ['courseId', 'blocks'])
}
check('an entry without sections serializes exactly as the original did',
  JSON.stringify(P.normalizeScheduleEntry({ courseId: 'CSC3210', blocks: [{ id: 'b', days: ['T', 'Th'], startTime: '11:00', endTime: '12:15' }] }, 'spring2027', 0)),
  '{"courseId":"CSC3210","blocks":[{"id":"b","type":"Lecture","days":["T","Th"],"startTime":"11:00","endTime":"12:15","location":"","instructor":"","crn":""}]}')
check('a string entry still becomes a bare course', P.normalizeScheduleEntry('CSC3320', 'spring2027', 0), { courseId: 'CSC3320', blocks: [] })

const withPicks = {
  version: 6, lastTermId: 'fall2027',
  schedule: {
    spring2027: [{ courseId: 'CSC3210', blocks: [], sections: { CSC3210: '14634', CSC3210L: '20706' } }, { courseId: 'MATH3020', blocks: [], sections: { MATH3020: '16462' } }],
    summer2027: [{ courseId: 'CSC4350', blocks: [], sections: {} }],
    fall2027: [{ courseId: 'NOPE', blocks: [], sections: { NOPE: '12345' } }],
  },
}
const plan = P.normalizePlan(withPicks, P.PLAN_START_KEY)
check('normalizePlan keeps picks per course, in key order courseId, blocks, sections',
  JSON.stringify(plan.schedule.spring2027), '[{"courseId":"CSC3210","blocks":[],"sections":{"CSC3210":"14634","CSC3210L":"20706"}},{"courseId":"MATH3020","blocks":[],"sections":{"MATH3020":"16462"}}]')
check('an empty picks map is not written back', plan.schedule.summer2027, [{ courseId: 'CSC4350', blocks: [] }])
check('picks on an unknown course go with the course', plan.schedule.fall2027, [])
check('normalizePlan is idempotent with picks', JSON.stringify(P.normalizePlan(JSON.parse(JSON.stringify(plan)), P.PLAN_START_KEY)), JSON.stringify(plan))
check('migratePlan leaves a v6 plan with picks alone', P.migratePlan(withPicks, P.PLAN_START_KEY).migrated, false)
check('picks never change the audit',
  JSON.stringify(ser(P.computeAudit(P.normalizeRecord(null), plan.schedule, P.buildSemesters(P.PLAN_START_KEY, 3)).lines)),
  JSON.stringify(ser(P.computeAudit(P.normalizeRecord(null), P.normalizePlan({ ...withPicks, schedule: { spring2027: ['CSC3210', 'MATH3020'], summer2027: ['CSC4350'] } }, P.PLAN_START_KEY).schedule, P.buildSemesters(P.PLAN_START_KEY, 3)).lines)))

/* ── 4. the class schedule: clashes, breaks, the section picker's preview, live updates ── */
{
  const terms = P.buildSemesters(P.PLAN_START_KEY, 3)
  const spring = (entries: unknown[]) => S.termEvents('spring2027', entries as never)
  // CSC 3210 lecture sec 4 (MW 2:00–3:15) and lab sec 12 (W 1:00–2:40) overlap on Wednesday.
  const own = spring([{ courseId: 'CSC3210', blocks: [], sections: { CSC3210: '14634', CSC3210L: '20708' } }])
  check('a lecture and its own lab that overlap are a clash', own.events.filter((e) => e.conflict).map((e) => `${e.partCode} ${e.day}`).sort(), ['CSC 3210 W', 'CSC 3210L W'])
  const apart = spring([{ courseId: 'CSC3210', blocks: [], sections: { CSC3210: '14634', CSC3210L: '20706' } }])
  check('  … and a lab at another time is not', apart.events.some((e) => e.conflict), false)
  check('calendar events carry the part’s name (lab named as a lab)', [...new Set(apart.events.map((e) => e.partTitle))].sort(), ['Computer Organization & Programming', 'Computer Organization & Programming Lab'])

  // Linear Algebra sec 4 (MW 12:30–1:45) right before CSC 3210 sec 4 (MW 2:00–3:15): a 15-minute break.
  const week = spring([{ courseId: 'CSC3210', blocks: [], sections: { CSC3210: '14634' } }, { courseId: 'MATH2641', blocks: [], sections: { MATH2641: '16637' } }])
  check('short breaks between classes are found, per day', S.shortGaps(week.events).map((g) => `${g.day} ${g.minutes}`), ['M 15', 'W 15'])
  check('  … and only next to the course asked about', S.shortGaps(week.events, { courseId: 'CSC4520' }).length, 0)
  check('  … overlapping classes are clashes, not breaks', S.shortGaps(own.events).length, 0)

  const entries = [{ courseId: 'CSC3320', blocks: [], sections: { CSC3320: '10643' } }] // MW 2:00–3:15 + Th 9:30–10:20
  const la2 = S.sectionByCrn('spring2027', '16304')! // Linear Algebra sec 2: TTh 9:30–10:45
  check('a candidate section names what it would overlap, by name and day',
    S.clashesFor('spring2027', entries as never, 'MATH2641', 'MATH2641', la2).map((c) => `${c.title} ${c.days.join('')}`), ['System-Level Programming Th'])
  check('  … a lab is checked against the lecture being previewed',
    S.clashesFor('spring2027', [] as never, 'CSC3210', 'CSC3210L', S.sectionByCrn('spring2027', '20708')!, { CSC3210: '14634' }).map((c) => c.code), ['CSC 3210'])
  check('previewing a course that isn’t planned adds it to the week',
    S.entriesWithDraft(entries as never, 'MATH2641', { MATH2641: '16637' }).map((e) => e.courseId), ['CSC3320', 'MATH2641'])
  check('  … and previewing a planned one replaces only its sections',
    S.entriesWithDraft(entries as never, 'CSC3320', { CSC3320: '13592' }), [{ courseId: 'CSC3320', blocks: [], sections: { CSC3320: '13592' } }])

  const all = S.scheduleFor('spring2027')!.courses.flatMap((c) => c.sections)
  check('no Honors sections in the schedule', all.filter((s) => s.honors).map((s) => s.crn), [])
  check('no sections without seats (capacity 0)', all.filter((s) => s.seats.capacity === 0).map((s) => s.crn), [])
  check('GSU’s capitalised titles read normally', S.scheduleTitle('CSC1301', 'PRINCIPLES OF COMPUTER SCIENCE I'), 'Principles of Computer Science I')

  // Fresher seat counts swap in; an older or equal copy is ignored.
  const current = S.scheduleFor('spring2027')!
  const stamp = current.sources.banner!.fetchedAt
  const later = JSON.parse(JSON.stringify(current))
  later.sources.banner.fetchedAt = new Date(Date.parse(stamp) + 30 * 60_000).toISOString()
  later.courses.find((c: { codeId: string }) => c.codeId === 'CSC3350').sections[0].seats = { remaining: 0, capacity: 90, full: true, asOf: later.sources.banner.fetchedAt, source: 'banner' }
  check('an older copy of the schedule is ignored', S.replaceSchedule(JSON.parse(JSON.stringify({ ...current, sources: { ...current.sources, banner: { ...current.sources.banner, fetchedAt: '2026-01-01T00:00:00Z' } } }))), false)
  check('a newer copy replaces it', S.replaceSchedule(later), true)
  check('  … and lookups see the new seat counts', S.sectionByCrn('spring2027', later.courses.find((c: { codeId: string }) => c.codeId === 'CSC3350').sections[0].crn)!.seats.full, true)
  check('  … and the same copy again changes nothing', S.replaceSchedule(later), false)

  // What she still needs, from an empty synthetic record and a few planned courses.
  const record = P.normalizeRecord({ version: 1, terms: [] })
  P.indexRecord(record) // isCourseDone() reads the indexed record — not the last scenario's
  const course = (id: string) => P.findCourse(id)!
  const planWith = (ids: string[]) => ({ spring2027: ids.map((courseId) => ({ courseId, blocks: [] })), summer2027: [], fall2027: [] })
  const snap = (ids: string[]) => {
    const schedule = planWith(ids)
    return { semesters: terms, plan: { schedule } as never, audit: P.computeAudit(record, schedule, terms), recordStatus: 'ready' as const }
  }
  const electives = ['CSC4710', 'CSC4740', 'CSC4760', 'CSC4850']
  check('a planned course is needed', R.courseNeed(course('CSC4320'), snap(['CSC4320'])).why, 'planned')
  check('  … its pick-one alternative still counts as a CSC elective while electives are open', R.courseNeed(course('CSC4330'), snap(['CSC4320'])).why, 'open')
  check('  … and is not needed once the electives are covered too', R.courseNeed(course('CSC4330'), snap(['CSC4320', ...electives])).why, 'covered')
  check('  … nor are the other electives', R.courseNeed(course('CSC4222'), snap(['CSC4320', ...electives])).why, 'covered')
  check('with the requirement open, the alternatives are needed', R.courseNeed(course('CSC4330'), snap([])).why, 'open')
  check('a catalog course GSU hasn’t offered or scheduled is left out', R.courseNeed(course('CSC4340'), snap([])).why, 'unavailable')
  check('“any 2000–4999 course” only pulls in the program-elective list', R.openLinesFor(course('CSC4740'), snap([]).audit).map((l) => l.id), ['major.elec'])
  check('until the record loads nothing is hidden as covered', R.courseNeed(course('CSC4330'), { ...snap(['CSC4320']), recordStatus: 'loading' }).why, 'open')
}

/* ── summary ─────────────────────────────────────────────────────── */
console.log(failures
  ? `\n${failures} check(s) FAILED`
  : `\nAll ${passed} golden scenarios and ${newChecks} new-behaviour checks passed.`)
process.exit(failures ? 1 : 0)
