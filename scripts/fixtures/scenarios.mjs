/**
 * The scenario battery shared by scripts/make-golden.mjs (run against the original
 * js/planner.js + js/data.js inside a Node vm) and scripts/logic-test.ts (run against
 * the TypeScript port in src/lib/planner.ts + src/data/degree.ts).
 *
 * Every record, plan and projection here is SYNTHETIC — made-up grades for made-up
 * students. Real academic records never belong in this repository.
 *
 * Each scenario is a function of `api` (the module's exports, old or new) that returns a
 * plain value; `ser()` turns it into deterministic JSON-able data so the two
 * implementations can be compared byte for byte.
 */

/* ── the API surface both implementations must provide ───────────── */
export const DATA_CONSTS = [
  'PLAN_START', 'DEFAULT_SEMESTER_COUNT', 'MAX_SEMESTER_COUNT', 'MAX_CREDITS_PER_TERM', 'PLAN_VERSION', 'RECORD_VERSION',
  'DAY_ORDER', 'DAY_LABELS', 'BLOCK_TYPES', 'OFFERING_TERMS', 'DEGREE', 'BLOCKS', 'REQUIREMENT_LINES', 'SUBSTITUTIONS',
  'GRADE_POINTS', 'GRADE_OPTIONS', 'MIN_GRADE_RULES', 'GPA_RULES', 'GPA_SOURCES', 'GPA_RULE_SUMMARY', 'R2R_HOW_TO',
  'GPA_OPEN_QUESTIONS', 'FOS_NOTE', 'RPE_NOTE', 'COURSES', 'SUGGESTED_PATHS', 'DEFAULT_PATH_ID', 'LEGACY_SUGGESTED_PLANS',
  'DEGREE_RULES', 'PLANNER_NOTES',
]
export const PLANNER_CONSTS = [
  'SEASONS', 'SEASON_META', 'PLAN_START_KEY', 'COURSE_BY_ID', 'COURSE_BY_CODE', 'LETTER_ORDER', 'RECORD_STATUS',
  'BLOCK_BY_KEY', 'LINE_BY_ID', 'LINE_CODES', 'STATUS_RANK', 'MIRROR_LINE', 'PROJECTION_GRADES', 'TARGET_LETTERS',
  'LIBRARY_SECTION_KEYS',
]
export const FUNCTIONS = [
  'termKey', 'makeTerm', 'termIdKey', 'termById', 'firstPlanKey', 'buildSemesters', 'findCourse', 'codeToId', 'prettyCode',
  'round2', 'fmtCredits', 'courseCode', 'isRequiredSection', 'courseCodes', 'catalogIdForCode', 'subjectLevel', 'minGradeFor',
  'gradeMeets', 'statusForGrade', 'earnsCredit', 'gradeLabel', 'hasGradePoints', 'isRemedial', 'gpaUse', 'roundedGpa', 'gpaFrom',
  'gpaFor', 'fmtGpa', 'fmtDelta', 'recordAttemptList', 'cleanText', 'cleanCode', 'clampCredits', 'numOrNull', 'validId',
  'recordLineValid', 'normalizeRecordCourse', 'normalizeExceptions', 'normalizeRecord', 'recordForSave', 'summarizeRecord',
  'indexRecord', 'isPassed', 'isCourseDone', 'attemptsFor', 'offeredYears', 'offeringInfo', 'conditionMet', 'unmetConditions',
  'conditionLabel', 'waiverApplies', 'targetLabel', 'computeAudit', 'advisorChecklist', 'normalizeProjection',
  'projectionForSave', 'courseGradeParts', 'firstRecordedAttempt', 'r2rBlocker', 'r2rUsedCount', 'repeatCandidates',
  'projectGpa', 'targetNeeded', 'pathById', 'buildPathPlan', 'planSignature', 'matchingPathId', 'isValidTime', 'normalizeBlock',
  'normalizeScheduleEntry', 'normalizeSchedule', 'planLastKey', 'normalizePlan', 'migratePlan',
]
export const API_NAMES = [...DATA_CONSTS, ...PLANNER_CONSTS, ...FUNCTIONS]

/* ── deterministic serialization ─────────────────────────────────── */
const tagOf = (v) => Object.prototype.toString.call(v)

/**
 * Plain data out of anything the planner returns. Works across vm realms (no instanceof).
 * Audit units are compacted to { kind, code, credits, termId, pending, line, … }, and a record
 * term nested under a `term` key is reduced to its id and course ids — both are checked in
 * full by their own scenarios.
 */
export function ser(v, key) {
  if (v === undefined) return { __undefined: true }
  if (typeof v === 'function') return { __function: true }
  if (typeof v === 'number') return Number.isFinite(v) ? (Object.is(v, -0) ? 0 : v) : { __number: String(v) }
  if (typeof v === 'bigint') return { __bigint: String(v) }
  if (v === null || typeof v !== 'object') return v
  const tag = tagOf(v)
  if (tag === '[object Map]') return { __map: [...v.entries()].map(([k, x]) => [ser(k), ser(x)]) }
  if (tag === '[object Set]') return { __set: [...v].map((x) => ser(x)) }
  if (tag === '[object RegExp]') return { __regexp: String(v) }
  if (Array.isArray(v)) return v.map((x) => ser(x))
  if ((v.kind === 'done' || v.kind === 'planned') && Array.isArray(v.codes)) {
    // kind|code|codes|credits|term|pending|line|record id|course id|grade|order|subject|level
    return `unit:${[v.kind, v.code, v.codes.join('+'), v.credits, v.term?.id ?? '', v.pending, v.line ?? '∅', v.rec?.id ?? '', v.courseId ?? '',
      v.grade ?? '', v.order, v.subject, v.level].join('|')}`
  }
  if (key === 'candidate' && v.first && v.term) return `candidate:${v.codeId}@${v.term.id}`
  if (key === 'term' && Array.isArray(v.courses)) {
    return { __recordTerm: { id: v.id, key: v.key, label: v.label, note: v.note, courseIds: v.courses.map((c) => c.id) } }
  }
  const out = {}
  for (const k of Object.keys(v)) out[k] = ser(v[k], k)
  return out
}

/**
 * The audit, compactly. A line or block result is its requirement definition spread
 * together with computed fields; the definitions are compared once (const:REQUIREMENT_LINES,
 * const:BLOCKS), so here each result records "static part equals its definition", its
 * key order, and the computed fields in full. Lookup maps reduce to keys plus an identity check.
 */
function splitResult(result, def) {
  const staticKeys = Object.keys(def)
  const computed = {}
  for (const k of Object.keys(result)) if (!staticKeys.includes(k) || result[k] !== def[k]) computed[k] = result[k]
  return { keys: Object.keys(result).join(','), computed }
}
export function serAudit(a, api) {
  const lineDef = Object.fromEntries(api.REQUIREMENT_LINES.map((l) => [l.id, l]))
  const blockDef = Object.fromEntries(api.BLOCKS.map((b) => [b.key, b]))
  return {
    lines: a.lines.map((l) => ser(splitResult(l, lineDef[l.id]))),
    blocks: a.blocks.map((b) => {
      const { keys, computed } = splitResult(b, blockDef[b.key])
      return ser({ keys, computed: { ...computed, lines: b.lines.map((l) => l.id) } })
    }),
    blockLinesAreSame: a.blocks.every((b) => b.lines.every((l) => a.lines.includes(l))),
    lineByIdKeys: Object.keys(a.lineById), blockByKeyKeys: Object.keys(a.blockByKey),
    lineByIdIsSame: a.lines.every((l) => a.lineById[l.id] === l),
    blockByKeyIsSame: a.blocks.every((b) => a.blockByKey[b.key] === b),
    total: ser(a.total), pending: ser(a.pending), status: a.status, missing: a.missing, roles: ser(a.roles),
    dHours: a.dHours, rpeGpa: ser(a.rpeGpa), plannedCredits: a.plannedCredits, earnedCredits: a.earnedCredits,
    keys: Object.keys(a),
  }
}

const clone = (v) => (v === undefined ? undefined : JSON.parse(JSON.stringify(v)))

/* ── synthetic records (stored shape, as in planner/academicRecord) ── */
// Made-up students, 2016–2020 terms. They exercise the degree rules (quarter-credit
// transfers, K courses, lecture + lab parts, retakes, Repeat to Replace, Learning
// Support, capstone, Program Advice) — they are not anyone's history.
const SAMPLE = 'Sample College'

/** Transfer-heavy: quarter-converted 3.33-credit courses, a "not counted" transfer F, GSU F/D/WF/W attempts, Learning Support. */
const R_TRANSFER = {
  version: 1,
  source: 'Synthetic test record — not a real student',
  reported: { auditDate: '03/04/2019', catalogYear: '2016-2017', gsuGpa: 3.07, overallGpa: '3.12', creditsApplied: 74 },
  terms: [
    { id: 'fall2016', note: 'First transfer term', courses: [
      { id: 't1', code: 'ENGL 1101', title: 'English Composition I', credits: 3.33, grade: 'B-', status: 'counted', line: 'core.engl1', gpa: true, transfer: true, school: SAMPLE },
      { id: 't2', code: 'MATH 1113', title: 'Precalculus', credits: 3.33, grade: 'C+', status: 'counted', line: 'core.math', gpa: true, transfer: true, school: SAMPLE },
      { id: 't3', code: 'HIST 2110', title: 'Survey of US History', credits: 3.33, grade: 'B+', status: 'counted', line: 'core.ushist', gpa: true, transfer: true, school: SAMPLE },
      { id: 't4', code: 'SOCI 1101', title: 'Intro to Sociology', credits: 3.33, grade: 'F', status: 'nocredit', line: '', gpa: false, transfer: true, school: SAMPLE },
      { id: 't5', code: 'POLS 1101', title: 'American Government', credits: 3.33, grade: 'A-', status: 'counted', line: 'auto', gpa: true, transfer: true, school: SAMPLE },
    ] },
    { id: 'spring2017', courses: [
      { id: 't6', code: 'ENGL 1102', credits: 3.33, grade: 'C+', status: 'counted', line: 'core.engl2', transfer: true, school: SAMPLE },
      { id: 't7', code: 'MATH 2211', credits: 3.33, grade: 'A-', status: 'counted', line: 'core.stem', transfer: true, school: SAMPLE },
      { id: 't8', code: 'PHYS 2211K', credits: 3.33, grade: 'B-', status: 'counted', line: 'core.labseq', transfer: true, school: SAMPLE },
      { id: 't9', code: 'CSC 1301', credits: 3.33, grade: 'B+', status: 'counted', line: 'fos.csc1301', transfer: true, school: SAMPLE },
      { id: 't10', code: 'FREN 1002', credits: 3.33, grade: 'A-', status: 'counted', line: 'core.lang', transfer: true, school: SAMPLE },
    ] },
    { id: 'fall2017', courses: [
      { id: 'g1', code: 'CSC 1302', title: 'Principles of CS II', credits: 4, grade: 'C+', status: 'counted', line: 'fos.csc1302' },
      { id: 'g2', code: 'MATH 2215', title: 'Multivariate Calculus', credits: 4, grade: 'F', status: 'nocredit', gpa: true },
      { id: 'g3', code: 'GEOG 1101', title: 'Introduction to Human Geography', credits: 3, grade: 'B+', status: 'counted', line: 'core.global' },
      { id: 'g4', code: 'ANTH 1102', title: 'Introduction to Anthropology', credits: 3, grade: 'A-', status: 'counted', line: 'core.socfound' },
    ] },
    { id: 'spring2018', note: 'Retakes at the transfer school', courses: [
      { id: 't11', code: 'MATH 2215', credits: 3.33, grade: 'B', status: 'counted', transfer: true, school: SAMPLE },
      { id: 't12', code: 'ACCT 2102', credits: 3.33, grade: 'F', status: 'nocredit', gpa: true, transfer: true, school: SAMPLE },
      { id: 't13', code: 'MATH 2212', credits: 3.33, grade: 'B+', status: 'counted', line: 'fos.calc2', transfer: true, school: SAMPLE },
    ] },
    { id: 'fall2018', courses: [
      { id: 'g5', code: 'CSC 2720', credits: 3, grade: 'C+', status: 'counted', line: 'major.ds' },
      { id: 'g6', code: 'MATH 2420', credits: 3, grade: 'B-', status: 'counted', line: 'fos.theory' },
      { id: 'g7', code: 'MUSC 1100', credits: 3, grade: 'A', status: 'counted', line: 'core.hum' },
      { id: 'g8', code: 'PERS 2003', credits: 2, grade: 'A', status: 'counted', line: 'core.inst' },
      { id: 'g9', code: 'HON 1000', credits: 1, grade: 'S', status: 'unused' },
    ] },
    { id: 'spring2019', courses: [
      { id: 'g10', code: 'CSC 4710', credits: 4, grade: 'F', status: 'nocredit' },
      { id: 'g11', code: 'MATH 2641', credits: 3, grade: 'D', status: 'notcounted' },
      { id: 'g12', code: 'CSC 4370', credits: 4, grade: 'WF', status: 'nocredit' },
      { id: 'g13', code: 'CHEM 1211', credits: 3, grade: 'W', status: 'nocredit', gpa: false },
      { id: 'g14', code: 'READ 0099', credits: 3, grade: 'B', status: 'notcounted', gpa: false },
    ] },
  ],
  exceptions: [],
}

/** All GSU, everything before the major: lab sequence and FoS complete, nothing transferred. */
const R_CLEAN = {
  source: 'Synthetic clean record',
  terms: [
    { id: 'fall2016', courses: [
      { code: 'ENGL 1101', credits: 3, grade: 'B+', line: 'core.engl1' }, { code: 'MATH 2211', credits: 4, grade: 'A-', line: 'core.stem' },
      { code: 'CSC 1301', credits: 4, grade: 'B', line: 'fos.csc1301' }, { code: 'POLS 1101', credits: 3, grade: 'C' },
      { code: 'HIST 2110', credits: 3, grade: 'B-' },
    ] },
    { id: 'spring2017', courses: [
      { code: 'ENGL 1102', credits: 3, grade: 'A-', line: 'core.engl2' }, { code: 'MATH 2212', credits: 4, grade: 'B-', line: 'fos.calc2' },
      { code: 'CSC 1302', credits: 4, grade: 'B-', line: 'fos.csc1302' }, { code: 'PHYS 2211K', credits: 4, grade: 'A-', line: 'core.labseq' },
      { code: 'PERS 2001', credits: 2, grade: 'B+', line: 'core.inst' }, { code: 'PERS 2003', credits: 2, grade: 'B', line: 'core.inst' },
    ] },
    { id: 'fall2017', courses: [
      { code: 'CSC 2510', credits: 3, grade: 'A-', line: 'fos.theory' }, { code: 'CSC 2720', credits: 3, grade: 'B-', line: 'major.ds' },
      { code: 'PHYS 2212K', credits: 4, grade: 'B+', line: 'core.labseq' }, { code: 'CSC 4810', credits: 4, grade: 'C-' },
      { code: 'ECON 2105', credits: 3, grade: 'C+', line: 'auto' },
    ] },
    { id: 'spring2018', courses: [
      { code: 'CSC 3210', credits: 3, grade: 'B-', line: 'major.comporg' }, { code: 'CSC 3210L', credits: 1, grade: 'B+', line: 'major.comporg' },
      { code: 'CSC 3320', credits: 3, grade: 'A-' }, { code: 'MATH 3020', credits: 3, grade: 'A-' }, { code: 'CSC 4980', credits: 4, grade: 'B+' },
      { code: 'ITAL 1001', credits: 3, grade: 'A', line: 'core.lang' }, { code: 'SOCI 1160', credits: 3, grade: 'B+', line: 'core.socfound' },
      { code: 'GEOG 1112', credits: 3, grade: 'A-', line: 'core.global' }, { code: 'PHIL 2050', credits: 3, grade: 'B+', line: 'core.hum' },
      { code: 'MATH 1220', credits: 3, grade: 'B', line: 'core.math' },
    ] },
  ],
}

/** D grades over the 12-hour limit, all in courses where a D still counts (RPE pattern). */
const R_DGRADES = {
  terms: [
    { id: 'fall2019', courses: [
      { code: 'ECON 2105', credits: 3, grade: 'D' }, { code: 'ECON 2106', credits: 3, grade: 'D' },
      { code: 'ACCT 2101', credits: 3, grade: 'D' }, { code: 'ACCT 2102', credits: 3, grade: 'D' },
    ] },
    { id: 'spring2020', courses: [
      { code: 'RELI 2001', credits: 3, grade: 'D', line: 'elective' }, { code: 'SCOM 2300', credits: 3, grade: 'D' },
      { code: 'CSC 2920', credits: 3, grade: 'D' }, { code: 'MATH 2215', credits: 4, grade: 'C-' },
    ] },
  ],
}

/** Three approved Repeat to Replace grades already used, for the 4-course cap. */
const R_R2R_CAP = {
  terms: [
    { id: 'fall2010', courses: [{ id: 'old1', code: 'GEOL 1121', credits: 3, grade: 'F', status: 'nocredit' }] },
    { id: 'fall2017', courses: [
      { id: 'a1', code: 'CSC 4222', credits: 4, grade: 'F', status: 'nocredit', r2r: true },
      { id: 'a2', code: 'CSC 4320', credits: 4, grade: 'WF', status: 'nocredit', r2r: true },
      { id: 'a3', code: 'MATH 2215', credits: 4, grade: 'F', status: 'nocredit', r2r: true },
      { id: 'a4', code: 'CSC 4710', credits: 4, grade: 'F', status: 'nocredit' },
      { id: 'a5', code: 'MATH 2641', credits: 3, grade: 'D', status: 'notcounted' },
      { id: 'a6', code: 'CSC 4370', credits: 4, grade: 'F', status: 'nocredit', gpa: false },
      { id: 'a7', code: 'CSC 4520', credits: 4, grade: 'C-', status: 'notcounted' },
      { id: 'a8', code: 'MATH 0999', credits: 3, grade: 'F', status: 'notcounted' },
    ] },
    { id: 'spring2018', courses: [
      { id: 'b1', code: 'CSC 4222', credits: 4, grade: 'B-', status: 'counted' },
      { id: 'b2', code: 'CSC 4320', credits: 4, grade: 'B+', status: 'counted', line: 'major.osplc' },
      { id: 'b3', code: 'MATH 2215', credits: 4, grade: 'C', status: 'counted' },
      { id: 'b4', code: 'GEOL 1121', credits: 3, grade: 'A-', status: 'counted' },
      { id: 'b5', code: 'CSC 3210', credits: 3, grade: 'C-', status: 'notcounted' },
      { id: 'b6', code: 'ASTR 1010K', credits: 4, grade: 'F', status: 'nocredit', transfer: true, school: SAMPLE },
    ] },
  ],
}

/** Spring 2027 already graded: planning starts in Summer 2027 and Spring 2027 plans fall away. */
const R_LATE = {
  terms: [
    { id: 'fall2018', courses: [{ code: 'CSC 2720', credits: 3, grade: 'A-' }, { code: 'CSC 4222', credits: 4, grade: 'F' }, { code: 'MATH 2215', credits: 4, grade: 'F' }] },
    { id: 'spring2027', courses: [{ code: 'CSC 4222', credits: 4, grade: 'B+' }, { code: 'MATH 2215', credits: 4, grade: 'C' }, { code: 'CSC 3210', credits: 3, grade: 'A-' }, { code: 'CSC 3210L', credits: 1, grade: 'B+' }] },
  ],
}

/** A completed 2-credit limited course (CSC 4870) so a planned CSC 4900 lands exactly on the 4-credit limit's edge. */
const R_LIMITED = {
  terms: [
    { id: 'fall2019', courses: [
      { code: 'CSC 4870', credits: 2, grade: 'A' }, { code: 'CSC 2720', credits: 3, grade: 'B+' }, { code: 'CSC 3320', credits: 3, grade: 'B' },
      { code: 'CSC 4880', credits: 1, grade: 'B', status: 'unused' },
    ] },
  ],
}

/** Messy input: bad codes and terms, duplicate ids, unknown statuses, junk exceptions. */
const R_MESSY = {
  version: 9,
  source: 'x'.repeat(200),
  reported: { auditDate: '2019-01-01T00:00:00 extra long', catalogYear: 2016, gsuGpa: '', overallGpa: 'abc', creditsApplied: '101.5' },
  terms: [
    null, 'spring2019', { id: 'winter2019', courses: [{ code: 'CSC 4740', credits: 4, grade: 'A' }] },
    { id: 'spring1980', courses: [{ code: 'CSC 4740', grade: 'A' }] }, { id: 'fall2101', courses: [{ code: 'CSC 4740' }] },
    { id: 2019, courses: [{ code: 'CSC 4740' }] },
    { id: 'fall2019', note: '  spaced   note  ', courses: [
      { id: 'dup', code: 'csc4740', title: '  Lower case code  ', credits: '4', grade: 'B+' },
      { id: 'dup', code: 'CSC  4730', credits: 4, grade: 'B+', status: 'foo', line: 'nonsense' },
      { id: 'dup', code: 'MATH2215', credits: 3.3333, grade: 'Z', status: 'counted', line: 'fos.addl' },
      { id: 'has space', code: 'PHYS 2212K', credits: 4, grade: 'C+', transfer: true, school: 'S'.repeat(80), r2r: true },
      { code: 'CS101', credits: 3, grade: 'A' },
      { code: 'CSC 1301L', credits: 1, grade: 'C-', status: 'counted' },
      { code: 'ENGL 1101', credits: -1, grade: 'C-' },
      { code: 'ENGL 1102', credits: 25, grade: 'C-' },
      { code: 'ASTR 1010K', credits: 4, grade: 'IP' },
      { code: 'ASTR 1020', credits: 3, grade: 'WM', r2r: true },
      { code: 'CHEM 1212', credits: 3, grade: 'F', r2r: true, gpa: 'yes' },
      { code: 'JAPN 2001', credits: 3, grade: 'K', note: 'n'.repeat(400) },
      { code: 'ECON 2105', credits: 3, grade: 'A-', status: 'unused', line: 'core.global' },
      { code: 'ACCT 2101', credits: 3, grade: 'NR', title: 't'.repeat(120) },
      { code: 'SCOM 1500', credits: 3, grade: 'S', equiv: 'Equivalent course text', status: 'counted', line: 'elective' },
      7, null, 'CSC 4350',
    ] },
    { id: 'fall2019', note: '', courses: [{ id: 'dup', code: 'CSC 4820', credits: 4, grade: 'A-' }] },
    { id: 'summer2019', courses: [] },
    { id: 'spring2020', courses: 'nope' },
  ],
  exceptions: [
    { id: 'x1', type: 'substitute', target: 'major.cap1', course: 'csc4350', note: 'Apply Here' },
    { id: 'x1', type: 'waive', target: 'major.cap2', credits: null, note: 'Force Complete' },
    { type: 'waive', target: 'core', credits: '0.67' },
    { type: 'waive', target: 'rpe', credits: 0 },
    { type: 'waive', target: 'advice.calc', credits: 25 },
    { type: 'substitute', target: 'core', course: 'CSC 4350' },
    { type: 'substitute', target: 'major.cap1', course: '' },
    { type: 'other', target: 'major.cap1' },
    { type: 'waive', target: 'nope' },
    null, 'junk',
    { id: 'bad id!', type: 'waive', target: 'fos.addl', credits: -2, note: 'n'.repeat(250) },
  ],
}

/** More than 60 terms and 40 courses per term: the slices. */
function bigRecord() {
  const terms = []
  for (let y = 2000; y < 2025; y++) {
    for (const s of ['spring', 'summer', 'fall']) {
      terms.push({ id: `${s}${y}`, courses: Array.from({ length: s === 'fall' && y === 2000 ? 45 : 1 }, (_, i) => ({ code: `ARTH ${1000 + i}`, credits: 1, grade: 'B' })) })
    }
  }
  const exceptions = Array.from({ length: 45 }, (_, i) => ({ id: `w${i}`, type: 'waive', target: 'core', credits: 0.01 }))
  return { terms, exceptions }
}

const EXC_CAPSTONE_BOTH = [
  { id: 'x-sub', type: 'substitute', target: 'major.cap1', course: 'CSC 4350', note: 'Apply Here: Substitute for Capstone courses to graduate.' },
  { id: 'x-cmp', type: 'waive', target: 'major.cap2', course: '', credits: null, note: 'Force Complete: Course not needed because of substitution.' },
]
const EXC_WAIVERS = [
  { id: 'w1', type: 'waive', target: 'advice.calc', credits: 0.67, note: 'Fractional transfer credit (quarter-to-semester conversion)' },
  { id: 'w2', type: 'waive', target: 'core', credits: 0.67, note: 'Area total' },
  { id: 'w3', type: 'waive', target: 'core.lang', credits: null, note: 'Forced' },
  { id: 'w4', type: 'waive', target: 'rpe', credits: 1 },
  { id: 'w5', type: 'waive', target: 'fos', credits: 0.67 },
  { id: 'w6', type: 'waive', target: 'core.inst', credits: 2 },
]

/* ── synthetic plans (stored shape, as in planner/sharedSchedule) ─── */
// Retakes are of the synthetic failures above (CSC 4710 F, MATH 2641 D, CSC 4370 WF/F, …).
const PLAN_MAIN = {
  version: 6, lastTermId: 'fall2027',
  schedule: {
    spring2027: [{ courseId: 'CSC4710', blocks: [] }, { courseId: 'MATH2641', blocks: [] }, { courseId: 'CSC3210', blocks: [] }, { courseId: 'CSC3320', blocks: [] }, { courseId: 'CSC4370', blocks: [] }],
    summer2027: [{ courseId: 'CSC3350' }, { courseId: 'CSC4222' }, { courseId: 'CHEM1211' }],
    fall2027: [{ courseId: 'CSC4520' }, { courseId: 'CSC4350' }, { courseId: 'PERS2001' }, { courseId: 'PHYS2212' }, { courseId: 'MATH3020' }, 'CSC4810'],
  },
  view: 'calendar', calSemester: 'summer2027', sidebarCollapsed: 1, sectionsCollapsed: { audit: true, rpe: 'yes', junk: true },
  expandedTerms: ['fall2017', 'fall2017', 'winter2018', 5, 'spring2018'],
}
const PLAN_CAPSTONE_TWO_TERM = {
  version: 6, lastTermId: 'spring2028',
  schedule: {
    spring2027: [{ courseId: 'CSC3350' }, { courseId: 'CSC3210' }, { courseId: 'CSC4740' }],
    summer2027: [{ courseId: 'CSC3320' }, { courseId: 'MATH3020' }],
    fall2027: [{ courseId: 'CSC4351' }, { courseId: 'CSC4520' }, { courseId: 'MATH2215' }, { courseId: 'CSC4330' }],
    spring2028: [{ courseId: 'CSC4352' }, { courseId: 'CSC4710' }, { courseId: 'CSC4730' }, { courseId: 'ECON2106' }, { courseId: 'PHYS2212' }],
  },
}
const PLAN_FOS_CHOICE = {
  version: 6, lastTermId: 'fall2027',
  schedule: {
    spring2027: [{ courseId: 'ECON2105' }, { courseId: 'SCOM1500' }, { courseId: 'ACCT2101' }],
    summer2027: [{ courseId: 'ECON2106' }, { courseId: 'CSC2920' }],
    fall2027: [{ courseId: 'MATH2215' }, { courseId: 'ASTR1010' }, { courseId: 'BIOL1103' }],
  },
}
const PLAN_LIMITED = {
  version: 6, lastTermId: 'fall2027',
  schedule: {
    spring2027: [{ courseId: 'CSC4900' }, { courseId: 'CSC4982' }, { courseId: 'CSC4810' }],
    summer2027: [{ courseId: 'CSC4980' }, { courseId: 'CSC4710' }, { courseId: 'PERS2001' }],
    fall2027: [{ courseId: 'CSC4370' }, { courseId: 'CSC4740' }, { courseId: 'JAPN2001' }, { courseId: 'PHIL2920' }, { courseId: 'CSC4330' }, { courseId: 'CSC4320' }],
  },
}
const PLAN_RETAKES = {
  version: 6, lastTermId: 'fall2027',
  schedule: {
    spring2027: [{ courseId: 'CSC4710' }, { courseId: 'MATH2641' }, { courseId: 'CSC3210' }],
    summer2027: [{ courseId: 'CSC4370' }, { courseId: 'CSC3320' }, { courseId: 'ACCT2102' }],
    fall2027: [{ courseId: 'GEOL1121' }, { courseId: 'CHEM1211' }, { courseId: 'CSC4520' }],
  },
}
const PLAN_EMPTY = { version: 6, lastTermId: 'summer2027', schedule: { spring2027: [], summer2027: [] } }

/* ── synthetic projections (stored shape, as in planner/gpaProjection) ── */
const PROJ_MAIN = {
  grades: { CSC4710: 'B+', MATH2641: 'B-', CSC3210: 'B', CSC3210L: 'A-', CSC3320: 'C+', CSC4370: 'C', CSC3350: 'B-', CSC4222: 'W',
    CHEM1211: 'B+', CHEM1211L: 'A', CSC4520: 'C+', CSC4350: 'B+', PERS2001: 'A-', PHYS2212: 'B', PHYS2212L: 'B+', MATH3020: 'B', CSC4810: 'A+' },
  r2r: { CSC4370: true }, target: { gpa: 3.2, termId: 'fall2027' },
}
const PROJ_RETAKES = {
  grades: { CSC4710: 'B', MATH2641: 'D', CSC3210: 'A-', CSC3210L: 'B-', CSC4370: 'A-', CSC3320: 'C', ACCT2102: 'A', GEOL1121: 'B-', CSC4520: 'B+' },
  r2r: { MATH2641: true, ACCT2102: true, GEOL1121: true }, target: { gpa: 2.5, termId: 'summer2027' },
}
const PROJ_PARTIAL = { grades: { CSC4710: 'A-' }, r2r: { CSC4710: false }, target: {} }
const PROJ_JUNK = {
  grades: Object.assign({ 'bad key': 'A', csc4710: 'B', MATH2641: 'Z', CSC3210: 'C+' }, Object.fromEntries(Array.from({ length: 210 }, (_, i) => [`AB${1000 + i}`, 'B']))),
  r2r: { CSC4710: 'yes', MATH2641: false, 'x y': true },
  target: { gpa: '3.456', termId: 'winter2027' },
}

/* ── inline attempt lists (GPA engine, record-course cleaning) ───── */
const GPA_SETS = [
  [],
  [{ code: 'CSC 4740', credits: 3, grade: 'A' }, { code: 'CSC 4730', credits: 4, grade: 'B+' }],
  [{ code: 'ENGL 1101', credits: 3.33, grade: 'B-', transfer: true }, { code: 'MATH 2211', credits: 3.33, grade: 'C+', transfer: true }, { code: 'CSC 2720', credits: 3, grade: 'C+' }],
  [{ code: 'CSC 4222', credits: 4, grade: 'F' }, { code: 'CSC 4222', credits: 4, grade: 'A', replaced: false }, { code: 'CSC 4820', credits: 3, grade: 'WF' }],
  [{ code: 'CSC 4710', credits: 4, grade: 'F', replaced: true }, { code: 'CSC 4710', credits: 4, grade: 'A' }],
  [{ code: 'READ 0099', credits: 3, grade: 'A' }, { code: 'SOCI 1101', credits: 3.33, grade: 'F', gpa: false, transfer: true }, { code: 'HON 1000', credits: 1, grade: 'S' }, { code: 'CSC 4999', credits: 0, grade: 'A' }],
  [{ code: 'CSC 4980', credits: 1, grade: 'A+' }, { code: 'CSC 4980', credits: 2, grade: 'A+' }],
  // exact .xx5 cases: 3.455, 2.675, 1.005
  [{ code: 'X 1000', credits: 2, grade: 'A' }, { code: 'X 1000', credits: 2, grade: 'B' }, { code: 'X 1000', credits: 1, grade: 'C' }],
  [{ code: 'CSC 1000', credits: 1, grade: 'A-' }, { code: 'CSC 1001', credits: 1, grade: 'B' }, { code: 'CSC 1002', credits: 1, grade: 'C+' }, { code: 'CSC 1003', credits: 1, grade: 'C-' }],
]

const RECORD_COURSE_INPUTS = [
  { code: 'csc4740', credits: 4, grade: 'A' }, { code: 'CSC 4740', credits: 4, grade: 'A' }, { id: 'z', code: 'CSC 4820', grade: 'D' },
  { id: 'z', code: 'CSC 4820', grade: 'D', status: 'unused', line: 'major.elec' }, null, 'x', { code: 'bad' },
  { code: 'PHYS 2212K', credits: '4', grade: 'C+', transfer: 1, r2r: true }, { code: 'CSC 4260', grade: 'F', r2r: 1, gpa: false },
]

/* ── scenario helpers ────────────────────────────────────────────── */
function load(api, rawRecord, rawPlan) {
  const record = api.normalizeRecord(clone(rawRecord))
  api.indexRecord(record)
  const start = api.firstPlanKey(record)
  const plan = api.normalizePlan(clone(rawPlan), start)
  const semesters = api.buildSemesters(start, api.termIdKey(plan.lastTermId) - start + 1)
  return { record, start, plan, semesters }
}

function withRecord(raw, exceptions) {
  const r = clone(raw)
  if (exceptions) r.exceptions = clone(exceptions)
  return r
}

/** Everything the app derives from a record + plan (+ projection). */
function fullRun(api, rawRecord, rawPlan, rawProjection, { targets: withTargets = true } = {}) {
  const { record, start, plan, semesters } = load(api, rawRecord, rawPlan)
  const audit = api.computeAudit(record, plan.schedule, semesters)
  const out = {
    start, plan: ser(plan), semesters: ser(semesters),
    audit: serAudit(audit, api),
    checklist: ser(api.advisorChecklist(audit, record, semesters, plan.schedule)),
    summary: ser(api.summarizeRecord(record)),
    matchingPath: api.matchingPathId(plan.schedule, start, api.isCourseDone),
  }
  if (rawProjection !== undefined) {
    const projection = api.normalizeProjection(clone(rawProjection))
    out.projection = ser(projection)
    const g = api.projectGpa(record, plan.schedule, semesters, projection)
    out.gpa = ser(g)
    // rows point at the candidate objects themselves (serialized above as references)
    out.gpaRowCandidatesAreSame = g.terms.every((t) => t.rows.every((r) => !r.candidate || g.candidates.includes(r.candidate)))
    const targets = []
    if (withTargets) for (const termId of [...semesters.map((s) => s.id), 'spring2026', 'fall2099', 'bogus']) {
      for (const target of [1, 2.5, 2.98, 3.33, 4.3, 4.31]) {
        for (const scope of ['gsu', 'overall']) {
          for (const useR2R of [true, false]) {
            targets.push([termId, target, scope, useR2R, ser(api.targetNeeded(record, plan.schedule, semesters, projection, termId, target, scope, useR2R))])
          }
        }
      }
    }
    out.targets = targets
  }
  return out
}

/* ── the battery ─────────────────────────────────────────────────── */
export function scenarios(api) {
  const list = []
  const add = (name, fn) => list.push([name, fn])
  const courseIds = api.COURSES.map((c) => c.id)

  /* constants — degree.ts and the planner tables */
  for (const name of [...DATA_CONSTS, ...PLANNER_CONSTS]) add(`const:${name}`, () => api[name])

  /* terms */
  add('terms:makeTerm', () => Array.from({ length: 30 }, (_, i) => api.makeTerm(2010 * 3 + i * 2)))
  add('terms:termIdKey', () => ['spring2027', 'summer2027', 'fall2027', 'fall1989', 'spring1990', 'fall2100', 'spring2101', 'winter2027', 'Spring2027', 'spring27', '', null, undefined, 2027, {}, 'spring2027 ', ' spring2027']
    .map((id) => [String(id), api.termIdKey(id), api.termById(id)]))
  add('terms:termKey', () => api.SEASONS.flatMap((s) => [2000, 2026, 2027].map((y) => api.termKey(s, y))))
  add('terms:buildSemesters', () => [api.buildSemesters(api.PLAN_START_KEY, 3), api.buildSemesters(api.PLAN_START_KEY + 5, 1), api.buildSemesters(6081, 0)])
  add('terms:firstPlanKey', () => [null, undefined, { terms: [] }, { terms: [{ key: 6000 }] }, { terms: [{ key: 6000 }, { key: 6081 }] }, { terms: [{ key: 6083 }] }].map((r) => api.firstPlanKey(r)))

  /* courses */
  add('courses:lookups', () => courseIds.map((id) => [id, api.isRequiredSection(api.findCourse(id)), api.courseCodes(api.findCourse(id)), api.courseCode(id), api.courseGradeParts(api.findCourse(id))]))
  add('courses:findCourse-misses', () => [null, undefined, '', 'CSC 3210', 'csc3210', 'XYZ1234'].map((id) => api.findCourse(id)))
  add('courses:codes', () => ['CSC 3210', 'csc 3210l', 'PHYS 2212K', 'phys2212l', 'ASTR 1010K', 'BIOL 2107L', 'XYZ 1234', '', null, 'MATH-2641', 'CSC4350']
    .map((c) => [String(c), api.codeToId(c), api.catalogIdForCode(c), api.prettyCode(api.codeToId(c)), api.subjectLevel(api.codeToId(c))]))
  add('courses:courseCode-unknown', () => ['CSC9999', 'ENGL1101', 'PHYS2211K', ''].map((id) => api.courseCode(id)))
  add('numbers:round2-fmtCredits', () => [0, 1, 3.333, 3.335, 2.675, 1.005, -0.004, 12.3456, 0.1 + 0.2, 129.64].map((n) => [api.round2(n), api.fmtCredits(n)]))

  /* grades */
  const codes = ['CSC 1301', 'CSC 4350', 'MATH 2215', 'ENGL 1101', 'ENGL 1102', 'PHYS 2212', 'ECON 2105', 'READ 0099', 'MATH 0999', 'PERS 2001', 'CSC 1301L']
  add('grades:minGradeFor', () => codes.map((c) => [c, api.minGradeFor(c)]))
  add('grades:statusForGrade', () => codes.map((c) => ['', ...api.GRADE_OPTIONS, 'Z'].map((g) => api.statusForGrade(c, g))))
  add('grades:gradeMeets', () => ['', ...api.GRADE_OPTIONS, 'Z'].map((g) => ['', 'D', 'C-', 'C', 'B', 'A', 'A+'].map((m) => api.gradeMeets(g, m))))
  add('grades:points', () => ['', ...api.GRADE_OPTIONS, 'Z', 'toString'].map((g) => [g, api.hasGradePoints(g)]))
  add('grades:remedial', () => ['READ 0099', 'MATH 0997', 'CSC 1301', 'XYZ', '', 'ENGL 1000'].map((c) => api.isRemedial(c)))
  add('grades:earnsCredit-gradeLabel', () => ['counted', 'unused', 'nocredit', 'notcounted'].map((status) => [api.earnsCredit({ status }), api.gradeLabel({ grade: status === 'nocredit' ? '' : 'B', transfer: status === 'unused' })]))

  /* GPA engine */
  add('gpa:roundedGpa-grid', () => {
    const out = []
    for (const d of [0, 1, 2, 3, 7, 100, 300, 333, 1000, 1333, 10000]) {
      for (const n of [0, 1, 5, 49, 50, 51, 149, 150, 151, 3455, 3456, 3454, 34550, 34549, 99999, 123456, 299995, 300000, 3455000, 3454999]) out.push([n, d, api.roundedGpa(n, d)])
    }
    return out
  })
  add('gpa:gpaFrom-gpaFor', () => {
    const sets = clone(GPA_SETS)
    return sets.map((s) => [api.gpaFrom(s.filter((a) => api.hasGradePoints(a.grade))), api.gpaFor(s, 'gsu'), api.gpaFor(s, 'overall'), s.map((a) => api.gpaUse(a))])
  })
  add('gpa:format', () => [null, undefined, { gpa: null }, { gpa: 3 }, { gpa: 2.675 }, { gpa: 0 }].map((g) => api.fmtGpa(g)).concat([null, undefined, 0, -0, 0.004, -0.33, 1.2].map((v) => api.fmtDelta(v))))

  /* record cleaning */
  add('record:clean-helpers', () => ({
    cleanText: [[' a  b ', 5], ['x'.repeat(30), 10], [5, 3], [null, 3], ['\n\ttabs\n', 20]].map(([v, m]) => api.cleanText(v, m)),
    cleanCode: ['csc 1301', 'CSC1301', 'CSC  1301', ' MATH 2215K ', 'PHYS 2212L', 'ABCDEF 1234', 'A 1234', 'CSC 123', 'CSC 12345', 'CSC 1301LL', 'CSC 1301LLL', '', null, 42].map((v) => api.cleanCode(v)),
    clampCredits: [4, '3.333', -1, 0, 20, 20.01, 'x', null, undefined, NaN, Infinity].map((v) => api.clampCredits(v)),
    numOrNull: [0, '0', '', null, undefined, 'x', '3.5', NaN, Infinity, false, true].map((v) => api.numOrNull(v)),
    validId: ['abc', 'a-b_c', 'has space', '', 'x'.repeat(60), 'x'.repeat(61), 5, null].map((v) => api.validId(v)),
    recordLineValid: ['auto', 'elective', 'major.ds', 'nope', '', null].map((v) => api.recordLineValid(v)),
  }))
  add('record:normalizeRecordCourse', () => {
    const used = new Set(['spring2024-CSC4740-0'])
    return clone(RECORD_COURSE_INPUTS).map((raw, i) => api.normalizeRecordCourse(raw, 'spring2024', i % 3, used)).concat([[...used]])
  })
  add('record:normalizeExceptions', () => [null, 'x', [], R_MESSY.exceptions, EXC_CAPSTONE_BOTH, EXC_WAIVERS, bigRecord().exceptions].map((x) => api.normalizeExceptions(clone(x))))
  for (const [name, raw] of [['null', null], ['undefined', undefined], ['string', 'x'], ['array', [1, 2]], ['empty', {}], ['transfer', R_TRANSFER], ['clean', R_CLEAN], ['dgrades', R_DGRADES], ['r2rcap', R_R2R_CAP], ['late', R_LATE], ['messy', R_MESSY], ['big', bigRecord()]]) {
    add(`record:normalize:${name}`, () => {
      const rec = api.normalizeRecord(clone(raw))
      const saved = api.recordForSave(rec)
      const again = api.normalizeRecord(clone(saved))
      return { rec, saved, roundTrip: JSON.stringify(api.recordForSave(again)) === JSON.stringify(saved), summary: api.summarizeRecord(rec),
        attempts: api.recordAttemptList(rec), used: api.r2rUsedCount(rec) }
    })
  }

  /* record index: completion, parts, aliases, K courses */
  for (const [name, raw] of [['transfer', R_TRANSFER], ['clean', R_CLEAN], ['dgrades', R_DGRADES], ['r2rcap', R_R2R_CAP], ['late', R_LATE], ['messy', R_MESSY]]) {
    add(`index:${name}`, () => {
      const rec = api.normalizeRecord(clone(raw))
      api.indexRecord(rec)
      const extra = ['CSC1301', 'CSC1302', 'PHYS2211K', 'PHYS2211', 'PHYS2211L', 'PHYS2212', 'PHYS2212L', 'PHYS2212K', 'ENGL1101', 'MATH2211', 'CSC3210L', 'ASTR1010K', 'MATH2215']
      return {
        done: [...courseIds, ...extra].map((id) => [id, api.isCourseDone(id)]),
        passed: extra.map((id) => [id, api.isPassed(id)]),
        attempts: [...courseIds, ...extra].map((id) => [id, api.attemptsFor(id)]),
        first: [['CSC4710'], ['MATH2215'], ['ACCT2102'], ['CHEM1211', 'CHEM1211K'], ['XYZ1234'], ['GEOL1121'], ['CSC3210']].map((ids) => {
          const f = api.firstRecordedAttempt(rec, ids)
          return [ids, f, f ? api.r2rBlocker(f) : null]
        }),
      }
    })
  }

  /* offering history and prerequisites */
  add('offering:all', () => courseIds.map((id) => api.SEASONS.map((s) => [api.offeredYears(api.findCourse(id), s), api.offeringInfo(api.findCourse(id), s)])).concat([[api.offeredYears(null, 'fall'), api.offeredYears(undefined, 'spring')]]))
  add('prereq:all', () => {
    const sets = [[], ['CSC1302'], ['CSC2720', 'CSC3320', 'CSC3210', 'MATH3020'], courseIds]
    return courseIds.map((id) => [id, api.findCourse(id).prereq.map((c) => api.conditionLabel(c)),
      sets.map((set) => api.unmetConditions(id, (x) => set.includes(x))),
      api.findCourse(id).prereq.map((c) => api.conditionMet(c, (x) => x.startsWith('CSC')))])
      .concat([[api.unmetConditions('NOPE', () => false)]])
  })

  /* audit pieces */
  add('audit:targetLabel', () => [...api.REQUIREMENT_LINES.map((l) => l.id), ...api.BLOCKS.map((b) => b.key), 'nope', ''].map((t) => api.targetLabel(t)))
  add('audit:waiverApplies', () => {
    const xs = [...EXC_WAIVERS, ...EXC_CAPSTONE_BOTH, { type: 'waive', target: 'rpe.hours', credits: 1 }]
    const targets = [...api.REQUIREMENT_LINES.map((l) => l.id), ...api.BLOCKS.map((b) => b.key)]
    return xs.map((x) => targets.filter((t) => api.waiverApplies(x, t)))
  })

  /* whole-app derivations for each record + plan combination */
  const combos = [
    ['empty+main', null, PLAN_MAIN, PROJ_MAIN],
    ['empty+empty', {}, PLAN_EMPTY, {}],
    ['transfer+main', R_TRANSFER, PLAN_MAIN, PROJ_MAIN],
    ['transfer+main+waivers', withRecord(R_TRANSFER, EXC_WAIVERS), PLAN_MAIN, PROJ_MAIN],
    ['transfer+main+capstone-both', withRecord(R_TRANSFER, EXC_CAPSTONE_BOTH), PLAN_MAIN, PROJ_PARTIAL],
    ['transfer+main+capstone-sub-only', withRecord(R_TRANSFER, [EXC_CAPSTONE_BOTH[0]]), PLAN_MAIN, PROJ_MAIN],
    ['transfer+main+capstone-complete-only', withRecord(R_TRANSFER, [EXC_CAPSTONE_BOTH[1]]), PLAN_MAIN, PROJ_MAIN],
    ['transfer+capstone-two-term', R_TRANSFER, PLAN_CAPSTONE_TWO_TERM, PROJ_MAIN],
    ['transfer+capstone-two-term+sub', withRecord(R_TRANSFER, EXC_CAPSTONE_BOTH), PLAN_CAPSTONE_TWO_TERM, PROJ_MAIN],
    ['transfer+retakes', R_TRANSFER, PLAN_RETAKES, PROJ_RETAKES],
    ['transfer+fos-choice', R_TRANSFER, PLAN_FOS_CHOICE, PROJ_JUNK],
    ['clean+fos-choice', R_CLEAN, PLAN_FOS_CHOICE, {}],
    ['clean+limited', R_CLEAN, PLAN_LIMITED, PROJ_MAIN],
    ['clean+main', R_CLEAN, PLAN_MAIN, PROJ_MAIN],
    ['clean+main+waivers', withRecord(R_CLEAN, EXC_WAIVERS), PLAN_MAIN, PROJ_MAIN],
    ['clean+empty', R_CLEAN, PLAN_EMPTY, PROJ_MAIN],
    ['dgrades+limited', R_DGRADES, PLAN_LIMITED, PROJ_MAIN],
    ['dgrades+main', R_DGRADES, PLAN_MAIN, PROJ_PARTIAL],
    ['r2rcap+retakes', R_R2R_CAP, PLAN_RETAKES, PROJ_RETAKES],
    ['r2rcap+main', R_R2R_CAP, PLAN_MAIN, PROJ_MAIN],
    ['messy+main', R_MESSY, PLAN_MAIN, PROJ_JUNK],
    ['messy+limited', R_MESSY, PLAN_LIMITED, PROJ_RETAKES],
    ['late+main', R_LATE, PLAN_MAIN, PROJ_MAIN],
    ['limited-edge+limited', R_LIMITED, PLAN_LIMITED, PROJ_MAIN],
    ['late+retakes', R_LATE, PLAN_RETAKES, PROJ_RETAKES],
  ]
  for (const [name, rec, plan, proj] of combos) add(`app:${name}`, () => fullRun(api, rec, plan, proj))

  /* each suggested path, on several records */
  for (const p of api.SUGGESTED_PATHS) {
    for (const [rname, rec] of [['empty', null], ['transfer', R_TRANSFER], ['clean', R_CLEAN], ['late', R_LATE]]) {
      add(`path:${p.id}:${rname}`, () => {
        const record = api.normalizeRecord(clone(rec))
        api.indexRecord(record)
        const start = api.firstPlanKey(record)
        const built = api.buildPathPlan(p.id, start, api.isCourseDone)
        return { built, run: fullRun(api, rec, { version: 6, ...built }, PROJ_MAIN, { targets: false }) }
      })
    }
  }
  add('paths:helpers', () => {
    const start = api.PLAN_START_KEY
    const doneSet = new Set(['CSC3210', 'CSC3320'])
    return {
      byId: [api.pathById('three'), api.pathById('four'), api.pathById('nope'), api.pathById(null)],
      built: [...api.SUGGESTED_PATHS.map((p) => p.id), 'nope'].flatMap((id) => [start - 3, start, start + 1, start + 2, start + 3].map((k) => [api.buildPathPlan(id, k), api.buildPathPlan(id, k, (x) => doneSet.has(x))])),
      sig: [null, {}, 'abc', [1], { a: ['X', 'A'], b: [], c: [{ courseId: 'Z' }, null, 5, 'Y'], d: 'nope' }, ...api.LEGACY_SUGGESTED_PLANS].map((s) => api.planSignature(s)),
      matching: [
        api.matchingPathId(api.buildPathPlan('three', start).schedule, start, () => false),
        api.matchingPathId(api.buildPathPlan('four', start).schedule, start, () => false),
        api.matchingPathId(api.buildPathPlan('three', start, (x) => doneSet.has(x)).schedule, start, (x) => doneSet.has(x)),
        api.matchingPathId(api.buildPathPlan('three', start).schedule, start, (x) => doneSet.has(x)),
        api.matchingPathId({}, start, () => false),
      ],
    }
  })

  /* blocks, schedule entries, plans */
  add('plan:normalizeBlock', () => [
    null, 'x', {}, { id: 'b1', type: 'Lab', days: ['M', 'W', 'Sa', 5, 'Th'], startTime: '09:30', endTime: '10:45', location: '  Langdale 200 ', instructor: ' Dr. X ', crn: ' 12345 ' },
    { type: 'Seminar', days: 'MW', startTime: '9:30', endTime: '24:00', location: 5 }, { id: '', type: 5, startTime: '23:59', endTime: '00:00' },
  ].map((b, i) => api.normalizeBlock(b, `fallback-${i}`)))
  add('plan:normalizeScheduleEntry', () => [
    'CSC3210', null, 5, {}, { courseId: '' }, { courseId: 'CSC3210' }, { courseId: 'CSC3210', blocks: 'x' },
    { courseId: 'NOPE', blocks: [{ days: ['T'] }] }, { courseId: 'CSC3210', blocks: [{ id: 'k', days: ['T', 'Th'], startTime: '11:00', endTime: '12:15' }, null] },
    { courseId: 'CSC3210', blocks: [], sections: {} }, { courseId: 'CSC3210', blocks: [], sections: 'abc' },
    { courseId: 'CSC3210', blocks: [], sections: { 'bad key': '12345', CSC3210: '123', CSC3210L: 12345 } },
  ].map((e, i) => api.normalizeScheduleEntry(e, 'spring2027', i)))
  add('plan:normalizeSchedule', () => {
    const sems = api.buildSemesters(api.PLAN_START_KEY, 3)
    return [null, 'x', {}, { spring2027: 'x', summer2027: [null, 'CSC3210', { courseId: 'CSC3210' }, { courseId: 'NOPE' }], fall2027: ['CSC3210', 'CSC3320'], fall2026: ['CSC4350'], spring2028: ['CSC4520'] },
      clone(PLAN_MAIN.schedule)].map((s) => api.normalizeSchedule(clone(s), sems))
  })
  add('plan:planLastKey', () => [
    {}, { lastTermId: 'fall2027' }, { lastTermId: 'bogus', semesterCount: 5 }, { semesterCount: 2.5 }, { semesterCount: 40 },
    { lastTermId: 'spring2027', schedule: { fall2028: ['X'], spring2026: ['Y'], summer2031: [] } }, { lastTermId: 'fall2040' }, { schedule: 'abc' },
  ].flatMap((raw) => [api.PLAN_START_KEY, api.PLAN_START_KEY + 2].map((k) => api.planLastKey(clone(raw), k))))
  const rawPlans = [
    ['null', null], ['garbage', 'garbage'], ['number', 42], ['array', [1]], ['v0-empty', {}], ['v3-empty', { version: 3, schedule: {} }],
    ['v3-empty-sched-arrays', { version: 3, schedule: { spring2027: [] } }], ['v5-empty', { version: 5, schedule: {} }],
    ['v5-fall2026', { version: 5, lastTermId: 'summer2027', schedule: { fall2026: [{ courseId: 'CSC3210' }, 'CSC3320'], spring2027: ['CSC4710'] } }],
    ['v5-exam', { version: 5, schedule: { exam: ['ECON2105', { courseId: 'ECON2106' }, { courseId: 'NOPE' }, null], spring2027: ['CSC4710'] } }],
    ['v6-main', PLAN_MAIN], ['v6-two-term', PLAN_CAPSTONE_TWO_TERM], ['v7-future', { ...PLAN_MAIN, version: 7 }],
    ['v6-dupes', { version: 6, lastTermId: 'summer2027', schedule: { spring2027: ['CSC3210', 'CSC3210', { courseId: 'CSC3320' }], summer2027: ['CSC3210', 'CSC3320', 'CSC4350'] }, calSemester: 'spring2030' }],
    ['v6-legacy-count', { version: 6, semesterCount: 4, schedule: { spring2027: ['CSC3210'] } }],
    ['v6-far', { version: 6, lastTermId: 'fall2035', schedule: { fall2031: ['CSC3210'] } }],
    ...legacyPlans(api).map((p, i) => [`legacy-${i}`, { version: 5, schedule: p }]),
    ...legacyPlans(api).map((p, i) => [`legacy-${i}-v6`, { version: 6, schedule: p }]),
    ['legacy-0-v2', { version: 2, schedule: api.LEGACY_SUGGESTED_PLANS[0] }],
  ]
  for (const [rname, rec] of [['empty', null], ['transfer', R_TRANSFER], ['clean', R_CLEAN], ['late', R_LATE]]) {
    for (const [pname, raw] of rawPlans) {
      add(`plan:migrate:${rname}:${pname}`, () => {
        const record = api.normalizeRecord(clone(rec))
        api.indexRecord(record)
        const start = api.firstPlanKey(record)
        const m = api.migratePlan(clone(raw), start)
        const n = api.normalizePlan(clone(raw), start)
        const again = api.normalizePlan(clone(n), start)
        return { start, migrated: m, normalized: n, idempotent: JSON.stringify(again) === JSON.stringify(n), atStart: api.normalizePlan(clone(raw), api.PLAN_START_KEY) }
      })
    }
  }

  /* projection documents */
  add('projection:normalize', () => [null, 'x', {}, PROJ_MAIN, PROJ_RETAKES, PROJ_PARTIAL, PROJ_JUNK,
    { target: { gpa: 0, termId: 'fall2027' } }, { target: { gpa: 4.3 } }, { target: { gpa: 4.31 } }, { target: { gpa: -1 } }, { target: { gpa: '' } }, { target: 'x' },
  ].map((p) => {
    const n = api.normalizeProjection(clone(p))
    return [n, api.projectionForSave(n), JSON.stringify(api.normalizeProjection(api.projectionForSave(n))) === JSON.stringify(n)]
  }))

  return list
}

// The legacy suggested plans, cloned so a scenario can never mutate the shared table.
function legacyPlans(api) {
  return api.LEGACY_SUGGESTED_PLANS.map((p) => clone(p))
}

/** Every synthetic record, attempt list, plan and projection — for the privacy overlap check. */
export const FIXTURES = {
  records: { R_TRANSFER, R_CLEAN, R_DGRADES, R_R2R_CAP, R_LATE, R_LIMITED, R_MESSY, bigRecord: bigRecord() },
  attemptLists: { GPA_SETS, RECORD_COURSE_INPUTS },
  plans: { PLAN_MAIN, PLAN_CAPSTONE_TWO_TERM, PLAN_FOS_CHOICE, PLAN_LIMITED, PLAN_RETAKES, PLAN_EMPTY },
  projections: { PROJ_MAIN, PROJ_RETAKES, PROJ_PARTIAL, PROJ_JUNK },
}
