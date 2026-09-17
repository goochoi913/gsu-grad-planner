/* ═══════════════════════════════════════════════════════════════════════════
   Bee's GSU Grad Planner — planner.js
   Planning logic with no DOM access: terms, the academic record (grades, GPA,
   statuses), prerequisites, offering history, the Degree Works-style audit with
   advisor exceptions, suggested paths, and saved-plan normalization/migration.
   The record itself is never part of the code — it arrives from Firebase.
   ═══════════════════════════════════════════════════════════════════════════ */

/* ─── Terms ──────────────────────────────────────────────────────────────── */
const SEASONS = ['spring','summer','fall'];
const SEASON_META = {
  spring: { label:'Spring', short:'Sp', emoji:'🌸' },
  summer: { label:'Summer', short:'Su', emoji:'☀️' },
  fall:   { label:'Fall',   short:'F',  emoji:'🍂' },
};

function termKey(season, year) { return year * 3 + SEASONS.indexOf(season); }
function makeTerm(key) {
  const season = SEASONS[key % 3], year = Math.floor(key / 3), meta = SEASON_META[season];
  return { id:`${season}${year}`, key, season, year, label:`${meta.label} ${year}`, shortLabel:`${meta.short}'${String(year).slice(2)}`, emoji:meta.emoji, maxCredits:MAX_CREDITS_PER_TERM };
}
function termIdKey(id) {
  const m = /^(spring|summer|fall)(\d{4})$/.exec(id || '');
  return m && +m[2] >= 1990 && +m[2] <= 2100 ? termKey(m[1], +m[2]) : -1;
}
function termById(id) { const key = termIdKey(id); return key < 0 ? null : makeTerm(key); }

const PLAN_START_KEY = termKey(PLAN_START.season, PLAN_START.year);
// Planning starts in Spring 2027, or right after the latest term that already has final grades.
function firstPlanKey(record) {
  const last = record?.terms?.length ? record.terms[record.terms.length - 1].key : -1;
  return Math.max(PLAN_START_KEY, last + 1);
}
function buildSemesters(startKey, count) { return Array.from({ length:count }, (_, i) => makeTerm(startKey + i)); }

/* ─── Courses ────────────────────────────────────────────────────────────── */
const COURSE_BY_ID = new Map(COURSES.map(c => [c.id, c]));
function findCourse(id) { return COURSE_BY_ID.get(id) || null; }
function codeToId(code) { return String(code || '').toUpperCase().replace(/[^A-Z0-9]/g, ''); }
function prettyCode(id) { return String(id || '').replace(/^([A-Z]+)(\d)/, '$1 $2'); }
function round2(n) { return Math.round(n * 100) / 100; }
function fmtCredits(n) { return String(round2(n)); }
function courseCode(id) { return findCourse(id)?.code || prettyCode(id); }
// Library colour family: honey for required areas, lavender for electives
function isRequiredSection(course) { return ['major','core','fos'].includes(course.section); }
// Every code a library course stands for: its number, its lecture/lab parts and older K numbers.
function courseCodes(course) { return [...new Set([course.id, ...course.parts.map(p => codeToId(p.code)), ...course.aliases.map(codeToId)])]; }
const COURSE_BY_CODE = new Map();
COURSES.forEach(c => courseCodes(c).forEach(code => { if(!COURSE_BY_CODE.has(code)) COURSE_BY_CODE.set(code, c.id); }));
function catalogIdForCode(code) { return COURSE_BY_CODE.get(codeToId(code)) || null; }
function subjectLevel(id) {
  const m = /^([A-Z]{2,5})(\d{4})/.exec(id || '');
  return m ? { subject:m[1], level:+m[2] } : { subject:'', level:0 };
}

/* ─── Grades (GSU catalog 1350.10) ──────────────────────────────────────── */
const LETTER_ORDER = ['F','D','C-','C','C+','B-','B','B+','A-','A','A+'];
const RECORD_STATUS = {
  counted:    { label:'Counts toward the degree',             short:'Counts',      icon:'✓' },
  unused:     { label:'Earned, but not used for this program', short:'Not used',    icon:'◌' },
  nocredit:   { label:'No credit (failed or withdrawn)',       short:'No credit',   icon:'✕' },
  notcounted: { label:'Not counted',                           short:'Not counted', icon:'⊘' },
};

function minGradeFor(code) {
  const id = codeToId(code);
  const byCode = Object.entries(MIN_GRADE_RULES.codes).find(([c]) => codeToId(c) === id);
  return byCode ? byCode[1] : MIN_GRADE_RULES.subjects[subjectLevel(id).subject] || MIN_GRADE_RULES.fallback;
}
// A blank grade, S or K (credit by exam) earns credit; W, WM, I, IP, U, V and NR do not; letters must reach the minimum.
function gradeMeets(grade, min) {
  if(!grade || grade === 'S' || grade === 'K') return true;
  const rank = LETTER_ORDER.indexOf(grade === 'WF' ? 'F' : grade);
  return rank > 0 && rank >= LETTER_ORDER.indexOf(min || 'D');
}
function statusForGrade(code, grade) {
  if(['W','WM','WF','F','U','V'].includes(grade)) return 'nocredit';
  if(['I','IP','NR'].includes(grade) || isRemedial(code)) return 'notcounted';
  return gradeMeets(grade, minGradeFor(code)) ? 'counted' : 'notcounted';
}
function earnsCredit(rec) { return rec.status === 'counted' || rec.status === 'unused'; }
function gradeLabel(rec) { return rec.grade ? `${rec.grade}${rec.transfer ? ' (transfer)' : ''}` : '—'; }

/* ─── GPA engine (GSU catalog 1350.20 and 1350.25) ─────────────────────── */
// One calculation for the record and for projections (GPA_RULE_SUMMARY in data.js lists the rules):
// · grade points come from the catalog table; symbols without points (W, WM, I, IP, S, U, V, K, NR) never count
// · Learning Support / remedial courses (numbers below 1000) never count
// · the GSU (institutional) GPA uses GSU attempts; the GSU + transfer GPA adds transfer grades,
//   weighted by the converted semester hours GSU posted (3.33 for a 5-quarter-hour course)
// · every attempt counts unless Repeat to Replace removed the first grade (`r2r` on that attempt);
//   `gpa: false` marks attempts Degree Works leaves out ("Not counted")
// · sums use integer hundredths, and the result is rounded half-up to the hundredth (for example 3.456 → 3.46)
function hasGradePoints(grade) { return Object.prototype.hasOwnProperty.call(GRADE_POINTS, grade); }
function isRemedial(code) { const { level } = subjectLevel(codeToId(code)); return level > 0 && level < 1000; }
function gpaUse(a) {
  if(!hasGradePoints(a.grade) || !(a.credits > 0)) return { gsu:false, overall:false, why:'no grade points' };
  if(isRemedial(a.code)) return { gsu:false, overall:false, why:'Learning Support' };
  if(a.gpa === false) return { gsu:false, overall:false, why:'not counted' };
  if(a.replaced) return { gsu:false, overall:false, why:'Repeat to Replace' };
  return { gsu:!a.transfer, overall:true, why:'' };
}
// n = Σ grade points × hours (both in hundredths), d = Σ hours (hundredths); GPA = n ÷ (100·d), rounded half-up.
function roundedGpa(n, d) {
  if(!d) return null;
  let q = Math.floor((2 * n + d) / (2 * d));
  while(q * 2 * d > 2 * n + d) q--;
  while((q + 1) * 2 * d <= 2 * n + d) q++;
  return q / 100;
}
function gpaFrom(attempts) {
  let n = 0, d = 0;
  for(const a of attempts) {
    const h = Math.round(a.credits * 100);
    n += Math.round(GRADE_POINTS[a.grade] * 100) * h;
    d += h;
  }
  return { hours:d / 100, points:n / 10000, exact: d ? n / (d * 100) : null, gpa:roundedGpa(n, d), n, d };
}
function gpaFor(attempts, scope) { return gpaFrom(attempts.filter(a => gpaUse(a)[scope])); }
function fmtGpa(g) { return g?.gpa == null ? '—' : g.gpa.toFixed(2); }
function fmtDelta(v) { return v == null ? '' : v === 0 ? '±0.00' : `${v > 0 ? '▲' : '▼'}${Math.abs(v).toFixed(2)}`; }
function recordAttemptList(record) {
  return record.terms.flatMap(term => term.courses.map(c => ({ ...c, replaced:!!c.r2r, term })));
}

/* ─── Academic record (Firebase; edited in the app) ─────────────────────── */
// { terms:[{ id, note, courses:[{ id, code, title, credits, grade, status, line, gpa, transfer, school, equiv, note }] }], exceptions:[…] }
// status: counted | unused | nocredit | notcounted · line: a requirement line id, 'auto' or 'elective'
function cleanText(v, max) { return typeof v === 'string' ? v.replace(/\s+/g, ' ').trim().slice(0, max) : ''; }
function cleanCode(v) {
  const t = cleanText(v, 16).toUpperCase();
  const m = /^([A-Z]{2,5})\s?(\d{4}[A-Z]{0,2})$/.exec(t);
  return m ? `${m[1]} ${m[2]}` : '';
}
function clampCredits(v) { const n = Number(v); return Number.isFinite(n) && n >= 0 && n <= 20 ? round2(n) : 0; }
function numOrNull(v) { const n = Number(v); return v == null || v === '' || !Number.isFinite(n) ? null : n; }
function validId(v) { return typeof v === 'string' && /^[\w-]{1,60}$/.test(v); }
function recordLineValid(line) { return line === 'auto' || line === 'elective' || !!LINE_BY_ID[line]; }

function normalizeRecordCourse(raw, termId, idx, usedIds) {
  if(!raw || typeof raw !== 'object') return null;
  const code = cleanCode(raw.code);
  if(!code) return null;
  const grade = GRADE_OPTIONS.includes(raw.grade) ? raw.grade : '';
  const status = RECORD_STATUS[raw.status] ? raw.status : statusForGrade(code, grade);
  let id = validId(raw.id) ? raw.id : `${termId}-${codeToId(code)}-${idx}`;
  while(usedIds.has(id)) id += 'b';
  usedIds.add(id);
  return {
    id, code, title: cleanText(raw.title, 80) || code, credits: clampCredits(raw.credits), grade, status,
    line: status === 'counted' ? (recordLineValid(raw.line) ? raw.line : 'auto') : '',
    gpa: typeof raw.gpa === 'boolean' ? raw.gpa : grade in GRADE_POINTS,
    transfer: !!raw.transfer, school: cleanText(raw.school, 60), equiv: cleanText(raw.equiv, 80), note: cleanText(raw.note, 300),
    r2r: !!raw.r2r && !raw.transfer && grade in GRADE_POINTS,   // first grade removed by an approved Repeat to Replace
  };
}

// Exceptions: { id, type:'substitute', target:lineId, course } or { id, type:'waive', target:lineId|blockKey, credits|null (whole) }
function normalizeExceptions(raw) {
  const out = [], ids = new Set();
  for(const x of (Array.isArray(raw) ? raw : []).slice(0, 40)) {
    if(!x || typeof x !== 'object') continue;
    const type = x.type === 'substitute' || x.type === 'waive' ? x.type : null;
    const target = typeof x.target === 'string' ? x.target : '';
    if(!type || !(LINE_BY_ID[target] || (type === 'waive' && BLOCK_BY_KEY[target]))) continue;
    const course = type === 'substitute' ? cleanCode(x.course) : '';
    if(type === 'substitute' && !course) continue;
    let id = validId(x.id) ? x.id : `x-${out.length + 1}`;
    while(ids.has(id)) id += 'b';
    ids.add(id);
    const credits = type === 'waive' && numOrNull(x.credits) > 0 ? clampCredits(x.credits) : null;
    out.push({ id, type, target, course, credits, note: cleanText(x.note, 200) });
  }
  return out;
}

function normalizeRecord(raw) {
  const safe = raw && typeof raw === 'object' ? raw : {};
  const byId = new Map(), usedIds = new Set();
  for(const t of (Array.isArray(safe.terms) ? safe.terms : []).slice(0, 60)) {
    const key = termIdKey(t?.id);
    if(key < 0) continue;
    const entry = byId.get(key) || { ...makeTerm(key), note:'', courses:[] };
    entry.note = cleanText(t.note, 300) || entry.note;
    (Array.isArray(t.courses) ? t.courses : []).slice(0, 40).forEach(c => {
      const rec = normalizeRecordCourse(c, entry.id, entry.courses.length, usedIds);
      if(rec) entry.courses.push(rec);
    });
    byId.set(key, entry);
  }
  const rep = safe.reported && typeof safe.reported === 'object' ? safe.reported : null;
  return {
    version: RECORD_VERSION,
    exists: !!raw,
    source: cleanText(safe.source, 160),
    reported: rep ? { auditDate:cleanText(rep.auditDate, 20), catalogYear:cleanText(rep.catalogYear, 20),
      gsuGpa:numOrNull(rep.gsuGpa), overallGpa:numOrNull(rep.overallGpa), creditsApplied:numOrNull(rep.creditsApplied) } : null,
    terms: [...byId.values()].filter(t => t.courses.length).sort((a, b) => a.key - b.key),
    exceptions: normalizeExceptions(safe.exceptions),
  };
}

// The stored shape (no derived term fields).
function recordForSave(record) {
  return {
    version: RECORD_VERSION, source: record.source || '', reported: record.reported || null,
    terms: record.terms.map(t => ({ id:t.id, note:t.note || '', courses: t.courses.map(c => ({
      id:c.id, code:c.code, title:c.title, credits:c.credits, grade:c.grade, status:c.status, line:c.line, gpa:c.gpa,
      transfer:c.transfer, school:c.school, equiv:c.equiv, note:c.note, r2r:c.r2r })) })),
    exceptions: record.exceptions.map(x => ({ id:x.id, type:x.type, target:x.target, course:x.course, credits:x.credits, note:x.note })),
  };
}

// Term credits and GPAs from the GPA engine. Transfer-only terms get their (approximate) transfer GPA.
function summarizeRecord(record) {
  const byTerm = {}, soFar = [];
  for(const t of record.terms) {
    const mine = t.courses.map(c => ({ ...c, replaced:!!c.r2r, term:t }));
    soFar.push(...mine);
    const transferOnly = !t.courses.some(c => !c.transfer);
    byTerm[t.id] = {
      earned: round2(t.courses.filter(earnsCredit).reduce((s, c) => s + c.credits, 0)),
      transferOnly,
      school: [...new Set(t.courses.filter(c => c.transfer).map(c => c.school).filter(Boolean))].join(', '),
      termGpa: gpaFor(mine, transferOnly ? 'overall' : 'gsu'),
      cumGsu: gpaFor(soFar, 'gsu'),
      cumOverall: gpaFor(soFar, 'overall'),
    };
  }
  const all = recordAttemptList(record);
  return {
    byTerm, courseCount: all.length,
    earned: round2(all.filter(earnsCredit).reduce((s, c) => s + c.credits, 0)),
    gsu: gpaFor(all, 'gsu'), overall: gpaFor(all, 'overall'),
  };
}

/* ─── Record index: passed courses and attempts (prerequisites, retakes) ── */
let RECORD_INDEX = { passed:new Map(), attempts:new Map() };
function indexRecord(record) {
  const passed = new Map(), attempts = new Map();
  for(const t of record.terms) for(const c of t.courses) {
    const id = codeToId(c.code);
    if(!attempts.has(id)) attempts.set(id, []);
    attempts.get(id).push({ rec:c, term:t });
    if(earnsCredit(c) && gradeMeets(c.grade, minGradeFor(c.code))) {
      passed.set(id, Math.max(passed.get(id) || 0, c.credits));
      const k = /^([A-Z]+\d{4})K$/.exec(id);   // PHYS 2212K covers PHYS 2212 + PHYS 2212L
      if(k) { passed.set(k[1], c.credits); passed.set(`${k[1]}L`, c.credits); }
    }
  }
  RECORD_INDEX = { passed, attempts };
}
function isPassed(codeId) { return RECORD_INDEX.passed.has(codeId); }
// A library course is completed once every part (lecture and lab) has a passing grade.
function isCourseDone(courseId) {
  const c = findCourse(courseId);
  if(!c) return isPassed(courseId);
  if(c.aliases.some(a => isPassed(codeToId(a)))) return true;
  if(!c.parts.length) return isPassed(c.id);
  if((RECORD_INDEX.passed.get(c.id) || 0) >= c.credits - 0.01) return true;   // the older single 4-credit course
  return c.parts.every(p => isPassed(codeToId(p.code)));
}
function attemptsFor(courseId) {
  const c = findCourse(courseId);
  const codes = c ? courseCodes(c) : [codeToId(courseId)];
  return codes.flatMap(code => RECORD_INDEX.attempts.get(code) || []).sort((a, b) => a.term.key - b.term.key);
}

/* ─── Offering history (GSU class schedules, Spring 2024 – Fall 2026) ────── */
function offeredYears(course, season) {
  if(!course?.offered) return [];
  return OFFERING_TERMS.filter((t, i) => t.season === season && course.offered[i] > 0).map(t => t.year);
}
function offeringInfo(course, season) {
  const years = offeredYears(course, season);
  const total = OFFERING_TERMS.filter(t => t.season === season).length;
  const name = SEASON_META[season].label;
  if(!years.length) return { level:'none', text:`Not offered in ${name} 2024–2026` };
  if(years.length < total) return { level:'sometimes', text:`${name}: offered in ${years.join(' & ')} only` };
  return { level:'regular', text:`Offered every ${name} 2024–2026` };
}

/* ─── Prerequisites ──────────────────────────────────────────────────────── */
// A condition is a course id, or an array of ids of which any one is enough.
function conditionMet(cond, isAvailable) { return Array.isArray(cond) ? cond.some(isAvailable) : isAvailable(cond); }
function unmetConditions(courseId, isAvailable) {
  return (findCourse(courseId)?.prereq || []).filter(cond => !conditionMet(cond, isAvailable));
}
function conditionLabel(cond) { return Array.isArray(cond) ? cond.map(courseCode).join(' or ') : courseCode(cond); }

/* ─── Requirement audit (Degree Works blocks and lines) ─────────────────── */
const BLOCK_BY_KEY = Object.fromEntries(BLOCKS.map(b => [b.key, b]));
const LINE_BY_ID = Object.fromEntries(REQUIREMENT_LINES.map(l => [l.id, l]));
const LINE_CODES = Object.fromEntries(REQUIREMENT_LINES.map(l => [l.id, new Set(l.courses.map(codeToId))]));
const STATUS_RANK = { met:0, planned:1, pending:2, missing:3 };
const EPS = 1e-6;
// A block whose only line needs the block's full credits (Required Program Electives): line and area total are one requirement.
const MIRROR_LINE = Object.fromEntries(BLOCKS.map(b => {
  const ls = REQUIREMENT_LINES.filter(l => l.block === b.key);
  return [b.key, ls.length === 1 && b.credits != null && ls[0].credits === b.credits ? ls[0].id : null];
}));
function waiverApplies(x, lineOrBlock) {
  if(x.type !== 'waive') return false;
  const line = LINE_BY_ID[lineOrBlock];
  const block = line ? line.block : lineOrBlock;
  return x.target === lineOrBlock || (MIRROR_LINE[block] && (x.target === block || x.target === MIRROR_LINE[block]));
}

function targetLabel(target) {
  const line = LINE_BY_ID[target];
  if(line) return `${BLOCK_BY_KEY[line.block].name} · ${line.label}`;
  return BLOCK_BY_KEY[target] ? `${BLOCK_BY_KEY[target].name} (area total)` : target;
}
function lineAccepts(line, unit) {
  const codes = LINE_CODES[line.id];
  if(codes.size) return unit.codes.some(c => codes.has(c));
  const p = line.pattern;
  if(!p || (p.subject && unit.subject !== p.subject) || unit.level < p.min || unit.level > p.max) return false;
  return !p.exclude.some(x => unit.codes.includes(codeToId(x)));
}
function unitGradeOk(unit, line) { return unit.kind !== 'done' || gradeMeets(unit.grade, line.minGrade || minGradeFor(unit.code)); }
function isLimited(line, unit) { return !!line.pattern?.limited.some(x => unit.codes.includes(codeToId(x))); }
function lexLess(a, b) { const i = a.findIndex((v, j) => v !== b[j]); return i >= 0 && a[i] < b[i]; }
function* subsets(list, maxSize, start = 0, prefix = []) {
  if(prefix.length) yield prefix;
  if(prefix.length === maxSize) return;
  for(let i = start; i < list.length; i++) yield* subsets(list, maxSize, i + 1, [...prefix, list[i]]);
}

// Applies completed courses (as Degree Works did) and then planned courses in term order.
// Line status: met (completed work + recorded exceptions) · planned · pending (only with an advisor exception
// that isn't recorded yet) · missing. Recorded exceptions count as met, exactly like Degree Works.
function computeAudit(record, schedule, semesters) {
  const units = [];
  record.terms.forEach(term => term.courses.forEach((rec, order) => {
    if(rec.status !== 'counted') return;
    const id = codeToId(rec.code);
    units.push({ kind:'done', rec, code:rec.code, codes:[id], ...subjectLevel(id), credits:rec.credits, grade:rec.grade, term, order, line:null, pending:false });
  }));
  semesters.forEach(term => (schedule[term.id] || []).forEach((e, order) => {
    const course = findCourse(e.courseId);
    if(course) units.push({ kind:'planned', course, courseId:course.id, code:course.code, codes:courseCodes(course), ...subjectLevel(course.id), credits:course.credits, term, order, line:null, pending:false });
  }));
  units.sort((a, b) => (a.kind === 'done' ? 0 : 1) - (b.kind === 'done' ? 0 : 1) || a.term.key - b.term.key || a.order - b.order);

  const exceptions = record.exceptions || [];
  const L = Object.fromEntries(REQUIREMENT_LINES.map(def => [def.id, {
    def, units:[], substitutions:[], pendingSub:null, pendingComplete:null,
    waivers: exceptions.filter(x => waiverApplies(x, def.id)),
  }]));
  const lines = Object.values(L);
  const free = () => units.filter(u => !u.line);
  const assign = (u, lineId, pending = false) => { u.line = lineId; u.pending = pending; L[lineId].units.push(u); };
  const credits = x => round2(x.units.reduce((s, u) => s + u.credits, 0));
  const waived = x => round2(x.waivers.reduce((s, w) => s + (w.credits || 0), 0));
  const forced = x => x.waivers.some(w => w.credits == null);
  const satisfied = x => forced(x) || ((x.def.credits == null || credits(x) + waived(x) >= x.def.credits - EPS) && (x.def.count == null || x.units.length >= x.def.count));
  const shared = def => !!BLOCK_BY_KEY[def.block].shared;

  // 1. Completed courses keep the line Degree Works applied them to.
  for(const u of units) {
    if(u.kind !== 'done') continue;
    if(u.rec.line === 'elective') u.line = 'elective';
    else if(LINE_BY_ID[u.rec.line] && !shared(LINE_BY_ID[u.rec.line])) assign(u, u.rec.line);
  }
  // 2. Recorded substitutions put a named course on a line.
  for(const x of exceptions) {
    if(x.type !== 'substitute') continue;
    L[x.target].substitutions.push(x);
    const u = units.find(u => (!u.line || u.line === 'elective') && u.codes.includes(codeToId(x.course)));
    if(u) { u.line = null; assign(u, x.target); }
  }
  // 3. Lines that name specific courses, in audit order.
  for(const x of lines) {
    if(shared(x.def) || x.def.list || !LINE_CODES[x.def.id].size) continue;
    for(const u of free()) {
      if(satisfied(x)) break;
      if(lineAccepts(x.def, u) && unitGradeOk(u, x.def)) assign(u, x.def.id);
    }
  }
  // 4. A course that needs an advisor substitution (CSC 4350 for the capstone) holds its line as pending.
  for(const s of SUBSTITUTIONS) {
    const x = L[s.line];
    const markComplete = () => s.complete.forEach(id => { if(L[id] && !satisfied(L[id])) L[id].pendingComplete = s; });
    if(x.substitutions.length) { if(satisfied(x)) markComplete(); continue; }
    if(satisfied(x)) continue;
    const u = free().find(u => u.codes.includes(codeToId(s.course)));
    if(!u) continue;
    assign(u, s.line, true);
    x.pendingSub = s;
    markComplete();
  }
  // 5. Pick-from-a-list lines: the fewest courses that complete the line, preferring ones that also fill the area total.
  for(const x of lines) {
    if(!x.def.list) continue;
    for(const u of free()) {
      if(satisfied(x)) break;
      if(u.kind === 'done' && lineAccepts(x.def, u) && unitGradeOk(u, x.def)) assign(u, x.def.id);
    }
    const cands = satisfied(x) ? [] : free().filter(u => u.kind === 'planned' && lineAccepts(x.def, u)).slice(0, 10);
    if(!cands.length) continue;
    const block = BLOCK_BY_KEY[x.def.block];
    const lineNeed = x.def.credits - credits(x) - waived(x);
    const blockNeed = (block.credits || 0) - lines.filter(o => o.def.block === block.key).reduce((s, o) => s + credits(o), 0);
    let best = null, bestScore = null;
    for(const set of subsets(cands, 3)) {
      const cr = set.reduce((s, u) => s + u.credits, 0);
      const score = [round2(Math.max(0, lineNeed - cr)), set.length, round2(Math.max(0, blockNeed - cr)), set.reduce((s, u) => s + u.term.key, 0)];
      if(!best || lexLess(score, bestScore)) { best = set; bestScore = score; }
    }
    best.forEach(u => assign(u, x.def.id));
  }
  // 6. Credit-pattern lines: 3000/4000 CSC electives, then any 2000–4999 course.
  for(const x of lines) {
    if(!x.def.pattern) continue;
    const p = x.def.pattern;
    let limitedUsed = round2(x.units.filter(u => isLimited(x.def, u)).reduce((s, u) => s + u.credits, 0));
    for(const u of free()) {
      if(satisfied(x)) break;
      if(!lineAccepts(x.def, u) || !unitGradeOk(u, x.def)) continue;
      if(isLimited(x.def, u)) {
        if(limitedUsed + u.credits > p.limitedMax + EPS) continue;
        limitedUsed += u.credits;
      }
      assign(u, x.def.id);
    }
  }
  // 7. Anything left is elective credit that only adds to the 120 total.
  free().forEach(u => { u.line = 'elective'; });
  // 8. Shared blocks (Program Advice) re-use courses applied elsewhere.
  for(const x of lines) {
    if(!shared(x.def)) continue;
    for(const u of units) {
      if(satisfied(x)) break;
      if(lineAccepts(x.def, u) && unitGradeOk(u, x.def)) x.units.push(u);
    }
  }

  const lineResults = REQUIREMENT_LINES.map(def => {
    const x = L[def.id];
    const pick = f => x.units.filter(f);
    const sum = list => round2(list.reduce((s, u) => s + u.credits, 0));
    const doneU = pick(u => u.kind === 'done' && !u.pending), plannedU = pick(u => u.kind === 'planned' && !u.pending), pendingU = pick(u => u.pending);
    const done = sum(doneU), planned = sum(plannedU), pendingCredits = sum(pendingU);
    const w = waived(x), force = forced(x);
    const ok = (cr, n) => force || ((def.credits == null || cr + w >= def.credits - EPS) && (def.count == null || n >= def.count));
    let status, pendingWaiver = 0, short = 0, shortCount = 0;
    if(ok(done, doneU.length)) status = 'met';
    else if(ok(done + planned, doneU.length + plannedU.length)) status = 'planned';
    else if(x.pendingComplete || (pendingU.length && ok(done + planned + pendingCredits, x.units.length))) status = 'pending';
    else {
      const gap = def.credits == null ? 0 : round2(def.credits - w - done - planned - pendingCredits);
      shortCount = def.count == null ? 0 : Math.max(0, def.count - x.units.length);
      // A fractional shortfall (transfer credits converted from quarters) needs an advisor waiver, not another course.
      if(gap > EPS && gap < 1 && !shortCount && x.units.length) { status = 'pending'; pendingWaiver = gap; }
      else { status = 'missing'; short = Math.max(0, gap); }
    }
    return { ...def, status, done, planned, pendingCredits, waived:w, forced:force, pendingWaiver, short, shortCount,
      units:x.units, waivers:x.waivers, substitutions:x.substitutions, pendingSub:x.pendingSub, pendingComplete:x.pendingComplete };
  });
  const lineById = Object.fromEntries(lineResults.map(l => [l.id, l]));

  const blockResults = BLOCKS.map(b => {
    const ls = lineResults.filter(l => l.block === b.key);
    const waivers = exceptions.filter(x => waiverApplies(x, b.key));
    const sum = key => round2(ls.reduce((s, l) => s + l[key], 0));
    const done = b.shared ? 0 : sum('done'), planned = b.shared ? 0 : sum('planned'), pendingCredits = b.shared ? 0 : sum('pendingCredits');
    const force = waivers.some(w => w.credits == null);
    const w = round2(waivers.reduce((s, x) => s + (x.credits || 0), 0));
    let creditStatus = 'met', pendingWaiver = 0, short = 0;
    if(b.credits != null && !force) {
      if(done + w >= b.credits - EPS) creditStatus = 'met';
      else if(done + planned + w >= b.credits - EPS) creditStatus = 'planned';
      else if(done + planned + pendingCredits + w >= b.credits - EPS) creditStatus = 'pending';
      else {
        const gap = round2(b.credits - w - done - planned - pendingCredits);
        if(gap < 1) { creditStatus = 'pending'; pendingWaiver = gap; } else { creditStatus = 'missing'; short = gap; }
      }
    }
    const status = [creditStatus, ...ls.map(l => l.status)].reduce((a, s) => STATUS_RANK[s] > STATUS_RANK[a] ? s : a, 'met');
    // Advice lines have no block credits: show the line's own numbers.
    const shown = b.shared ? { done:sum('done'), planned:sum('planned'), pendingCredits:sum('pendingCredits'), required:ls.reduce((s, l) => s + (l.credits || 0), 0) } : null;
    return { ...b, lines:ls, done, planned, pendingCredits, waived:w, forced:force, waivers, creditStatus, pendingWaiver, short, status, shown };
  });

  const allRecs = record.terms.flatMap(t => t.courses);
  const earned = round2(allRecs.filter(earnsCredit).reduce((s, r) => s + r.credits, 0));
  const plannedCredits = round2(units.filter(u => u.kind === 'planned').reduce((s, u) => s + u.credits, 0));
  const total = { required:DEGREE.totalCredits, done:earned, planned:plannedCredits,
    status: earned >= DEGREE.totalCredits - EPS ? 'met' : earned + plannedCredits >= DEGREE.totalCredits - EPS ? 'planned' : 'missing' };

  const pending = [];
  for(const l of lineResults) {
    if(l.pendingSub) pending.push({ kind:'substitute', target:l.id, course:l.pendingSub.course, rule:l.pendingSub });
    else if(l.pendingComplete) pending.push({ kind:'complete', target:l.id, rule:l.pendingComplete });
    if(l.pendingWaiver && MIRROR_LINE[l.block] !== l.id) pending.push({ kind:'waive', target:l.id, credits:l.pendingWaiver });
  }
  for(const b of blockResults) if(b.pendingWaiver) pending.push({ kind:'waive', target:b.key, credits:b.pendingWaiver });

  const missing = lineResults.filter(l => l.status === 'missing').length + blockResults.filter(b => b.creditStatus === 'missing').length
    + (total.status === 'missing' ? 1 : 0);
  const status = missing ? 'incomplete' : pending.length ? 'pending' : blockResults.every(b => b.status === 'met') && total.status === 'met' ? 'met' : 'planned';

  const roles = {};
  for(const u of units) {
    const def = LINE_BY_ID[u.line];
    const role = def ? { block:def.block, lineId:def.id, blockName:BLOCK_BY_KEY[def.block].name, label:def.label, pending:u.pending }
                     : { block:null, lineId:'elective', blockName:'Elective credit', label:'counts toward the 120 total only', pending:false };
    roles[u.kind === 'planned' ? u.courseId : u.rec.id] = role;
  }
  const dHours = round2(units.filter(u => u.kind === 'done' && u.grade === 'D').reduce((s, u) => s + u.credits, 0));
  const rpeGpa = gpaFor(L['rpe.hours'].units.filter(u => u.kind === 'done').map(u => u.rec), 'overall');
  return { blocks:blockResults, lines:lineResults, lineById, blockByKey:Object.fromEntries(blockResults.map(b => [b.key, b])),
    total, pending, status, missing, roles, dHours, rpeGpa, plannedCredits, earnedCredits:earned };
}

// "Confirm with your advisor": built from the record and the plan, so nothing personal lives in the code.
function advisorChecklist(audit, record, semesters, schedule) {
  const items = [];
  for(const s of SUBSTITUTIONS) {
    const line = audit.lineById[s.line];
    if(line.pendingSub) items.push({ done:false, text:`Enter the ${s.course} capstone substitution in Degree Works (“${s.applyNote}” on ${line.label}, and “${s.completeNote}” on ${s.complete.map(id => LINE_BY_ID[id].label).join(', ')}) — ideally before registering for ${s.course}.` });
    else if(line.substitutions.length) items.push({ done:!s.complete.some(id => audit.lineById[id].status === 'pending'), text:`${s.course} capstone substitution recorded${s.complete.some(id => audit.lineById[id].status === 'pending') ? ` — still record “course not needed” on ${s.complete.map(id => LINE_BY_ID[id].label).join(', ')}` : ''}.` });
  }
  const waives = audit.pending.filter(p => p.kind === 'waive');
  const recordedWaivers = record.exceptions.filter(x => x.type === 'waive');
  if(waives.length) {
    const parts = waives.map(p => {
      const line = audit.lineById[p.target];
      const codes = line ? [...new Set(line.units.map(u => u.code))].join(' + ') : '';
      return line ? `${codes || line.label} line in ${BLOCK_BY_KEY[line.block].name} (${fmtCredits(p.credits)} cr)` : `${BLOCK_BY_KEY[p.target].name} total (${fmtCredits(p.credits)} cr)`;
    });
    items.push({ done:false, text:`Waive the fractional credit shortfalls left by quarter-to-semester transfer credit: ${parts.join('; ')}.` });
  } else if(recordedWaivers.length) {
    items.push({ done:true, text:`Credit waivers recorded (${recordedWaivers.length}).` });
  }
  const small = audit.lineById['rpe.hours'].units.filter(u => u.kind === 'planned' && u.credits < 3);
  if(small.length) items.push({ done:false, text:`Confirm ${small.map(u => `${u.code} (${fmtCredits(u.credits)} cr)`).join(' and ')} counts toward Required Program Electives – CSC.` });
  const plannedIds = new Set(semesters.flatMap(s => (schedule[s.id] || []).map(e => e.courseId)));
  // Repeat to Replace for a failed first GSU attempt that is planned again or already retaken.
  const retakes = [];
  const attemptsByCode = new Map();
  for(const term of record.terms) for(const rec of term.courses) {
    const id = codeToId(rec.code);
    if(!attemptsByCode.has(id)) attemptsByCode.set(id, []);
    attemptsByCode.get(id).push({ rec, term });
  }
  for(const [codeId, list] of attemptsByCode) {
    const first = list[0];
    if(!first || first.rec.transfer || !['F','WF'].includes(first.rec.grade) || first.rec.gpa === false) continue;
    const retaken = list.slice(1).some(a => !a.rec.transfer && hasGradePoints(a.rec.grade) && GRADE_POINTS[a.rec.grade] > GRADE_POINTS[first.rec.grade]);
    if(first.rec.r2r) retakes.push({ code:first.rec.code, done:true });
    else if(retaken || plannedIds.has(catalogIdForCode(first.rec.code) || codeId)) retakes.push({ code:first.rec.code, done:false });
  }
  const openRetakes = retakes.filter(r => !r.done);
  if(openRetakes.length) items.push({ done:false, text:`Request Repeat to Replace for ${openRetakes.map(r => r.code).join(' and ')} after the retake grades post (the Registrar’s online application; at most ${GPA_RULES.r2rMaxCourses} courses, and an approval can’t be undone). Once approved, tick “Replaced by Repeat to Replace” on the earlier F in 📚 Record.` });
  else if(retakes.length) items.push({ done:true, text:`Repeat to Replace recorded for ${retakes.map(r => r.code).join(' and ')}.` });
  const last = [...semesters].reverse().find(s => (schedule[s.id] || []).length);
  items.push({ done:false, text:`Apply to graduate in PAWS by the deadline for ${last ? last.label : 'your last term'} (registrar.gsu.edu/graduation).` });
  return items;
}

/* ─── GPA projection (what-if grades) ───────────────────────────────────── */
// Expected grades live in their own document: { grades:{ codeId: letter }, r2r:{ codeId: on }, target:{ gpa, termId } }.
// They never mark a course completed and never reach the record, the audit or the plan.
const PROJECTION_GRADES = ['A+','A','A-','B+','B','B-','C+','C','C-','D','F','WF','W'];
const CODE_ID_RE = /^[A-Z]{2,5}\d{4}[A-Z]{0,2}$/;
function normalizeProjection(raw) {
  const safe = raw && typeof raw === 'object' ? raw : {};
  const pick = (obj, ok) => Object.fromEntries(Object.entries(obj && typeof obj === 'object' ? obj : {})
    .filter(([k, v]) => CODE_ID_RE.test(k) && ok(v)).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).slice(0, 200));
  const t = safe.target && typeof safe.target === 'object' ? safe.target : {};
  const gpa = numOrNull(t.gpa);
  return {
    version: 1,
    grades: pick(safe.grades, v => PROJECTION_GRADES.includes(v)),
    r2r: pick(safe.r2r, v => typeof v === 'boolean'),
    target: { gpa: gpa != null && gpa > 0 && gpa <= GPA_RULES.maxGradePoints ? round2(gpa) : 3, termId: termIdKey(t.termId) >= 0 ? t.termId : '' },
  };
}
function projectionForSave(p) { return { version:1, grades:{ ...p.grades }, r2r:{ ...p.r2r }, target:{ ...p.target } }; }

// A planned course's graded parts: a lecture and its lab get separate grades.
function courseGradeParts(course) {
  const base = course.title.replace(/ \+ Lab$/, '');
  if(!course.parts.length) return [{ code:course.code, codeId:course.id, credits:course.credits, title:course.title, main:true }];
  return course.parts.map((p, i) => ({ code:p.code, codeId:codeToId(p.code), credits:p.credits, title:i ? `${base} Lab` : base, main:i === 0 }));
}

/* ─── Repeat to Replace (catalog 1350.25, Registrar) ─────────────────────── */
function firstRecordedAttempt(record, codeIds) {
  for(const term of record.terms) for(const rec of term.courses) if(codeIds.includes(codeToId(rec.code))) return { rec, term };
  return null;
}
// Why a course's first recorded grade can't be replaced ('' when it can).
function r2rBlocker(first) {
  const { rec, term } = first;
  if(rec.transfer) return `The first attempt (${term.label}) is transfer credit, which isn’t part of the GSU GPA.`;
  if(!hasGradePoints(rec.grade) || rec.gpa === false || isRemedial(rec.code)) return `The first recorded grade (${rec.grade || 'none'}, ${term.label}) isn’t part of the GPA, so it can’t be replaced.`;
  if(term.key < termIdKey(GPA_RULES.r2rFirstTerm)) return 'Only repeats taken from Fall 2011 on qualify.';
  if(rec.r2r) return 'That grade is already replaced through Repeat to Replace.';
  return '';
}
function r2rUsedCount(record) { return record.terms.reduce((s, t) => s + t.courses.filter(c => c.r2r).length, 0); }

// Planned retakes in term order. status: applies · pending (no expected grade) · lower (not a higher grade)
// · limit (over the 4-course cap) · blocked (not eligible) · off. `reserved` = counted toward the cap.
function repeatCandidates(record, schedule, semesters, projection) {
  const out = [];
  let used = r2rUsedCount(record);
  const lastTerm = [...semesters].reverse().find(s => (schedule[s.id] || []).length);
  for(const term of semesters) for(const entry of schedule[term.id] || []) {
    const course = findCourse(entry.courseId);
    if(!course) continue;
    for(const part of courseGradeParts(course)) {
      const first = firstRecordedAttempt(record, [part.codeId, ...(part.main ? course.aliases.map(codeToId) : [])]);
      if(!first) continue;
      const blocker = r2rBlocker(first);
      const on = projection.r2r[part.codeId] ?? !blocker;
      const grade = projection.grades[part.codeId] || '';
      let status = 'off', note = '', reserved = false;
      if(on && blocker) { status = 'blocked'; note = blocker; }
      else if(on && used >= GPA_RULES.r2rMaxCourses) { status = 'limit'; note = `Only ${GPA_RULES.r2rMaxCourses} courses can use Repeat to Replace, and ${used} are already counted.`; }
      else if(on) {
        reserved = true;
        if(!grade) status = 'pending';
        else if(!hasGradePoints(grade) || GRADE_POINTS[grade] <= GRADE_POINTS[first.rec.grade]) { status = 'lower'; reserved = false; note = `The retake needs a grade higher than the ${first.rec.grade} to replace it.`; }
        else status = 'applies';
        if(reserved) used++;
      }
      if(on && term.id === lastTerm?.id && status !== 'blocked') note = [note, 'This retake is in the graduation term: apply within the first two weeks, and GSU honors it only if the higher grade is needed to graduate.'].filter(Boolean).join(' ');
      out.push({ ...part, courseId:course.id, term, first, grade, eligible:!blocker, on, status, note, reserved });
    }
  }
  return out;
}

// Term-by-term projection: GPAs as toggled (withR2R) and with no Repeat to Replace at all (withoutR2R).
function projectGpa(record, schedule, semesters, projection) {
  const base = recordAttemptList(record);
  const current = { gsu:gpaFor(base, 'gsu'), overall:gpaFor(base, 'overall') };
  const candidates = repeatCandidates(record, schedule, semesters, projection);
  const terms = semesters.map(term => {
    const rows = (schedule[term.id] || []).flatMap(e => {
      const course = findCourse(e.courseId);
      return course ? courseGradeParts(course).map(p => ({ ...p, courseId:course.id, grade:projection.grades[p.codeId] || '',
        candidate:candidates.find(c => c.codeId === p.codeId && c.term.id === term.id) || null })) : [];
    });
    return { term, rows, graded:rows.filter(r => r.grade).length, hours:round2(rows.reduce((s, r) => s + r.credits, 0)) };
  });
  const delta = (a, b) => a.gpa == null || b.gpa == null ? null : round2(a.gpa - b.gpa);
  const scenario = useR2R => {
    const projected = [];
    return terms.map(t => {
      const mine = t.rows.filter(r => r.grade).map(r => ({ id:`p-${r.codeId}`, code:r.code, credits:r.credits, grade:r.grade, transfer:false, term:t.term, projected:true }));
      projected.push(...mine);
      const replaced = new Set(useR2R ? candidates.filter(c => c.status === 'applies' && c.term.key <= t.term.key).map(c => c.first.rec.id) : []);
      const all = [...base.map(a => replaced.has(a.id) ? { ...a, replaced:true } : a), ...projected];
      const termGpa = gpaFor(mine, 'gsu'), cumGsu = gpaFor(all, 'gsu'), cumOverall = gpaFor(all, 'overall');
      return { term:t.term, graded:t.graded, total:t.rows.length, replaced:replaced.size, termGpa, cumGsu, cumOverall,
        deltaTerm:delta(termGpa, current.gsu), deltaGsu:delta(cumGsu, current.gsu), deltaOverall:delta(cumOverall, current.overall) };
    });
  };
  return { current, candidates, terms, withR2R:scenario(true), withoutR2R:scenario(false),
    r2rUsed:r2rUsedCount(record), r2rReserved:candidates.filter(c => c.reserved).length };
}

// The average grade points needed in every planned course through `termId` for the rounded GPA to reach
// `target`. With Repeat to Replace, toggled retakes are assumed to beat their old grade.
const TARGET_LETTERS = ['D','C-','C','C+','B-','B','B+','A-','A','A+'];
function targetNeeded(record, schedule, semesters, projection, termId, target, scope, useR2R) {
  const endKey = termIdKey(termId);
  const upto = semesters.filter(s => s.key <= endKey);
  const replaced = new Set();
  let used = r2rUsedCount(record);
  if(useR2R) for(const c of repeatCandidates(record, schedule, semesters, projection)) {
    if(!c.eligible || !c.on || c.term.key > endKey || used >= GPA_RULES.r2rMaxCourses) continue;
    used++;
    replaced.add(c.first.rec.id);
  }
  const now = gpaFor(recordAttemptList(record).map(a => replaced.has(a.id) ? { ...a, replaced:true } : a), scope);
  const h = upto.flatMap(s => (schedule[s.id] || []).flatMap(e => { const c = findCourse(e.courseId); return c ? courseGradeParts(c) : []; }))
    .filter(p => !isRemedial(p.code)).reduce((sum, p) => sum + Math.round(p.credits * 100), 0);
  const result = x => roundedGpa(now.n + Math.round(x * 100) * h, now.d + h);
  if(!h) return { scope, useR2R, hours:0, status:'none', now:now.gpa, replaced:replaced.size };
  const reaches = x => result(x) >= target - 1e-9;
  const exact = ((target - 0.005) * (now.d + h) * 100 - now.n) / (h * 100);
  let needed = Math.max(0, Math.ceil(exact * 100 - 1e-6) / 100);
  while(needed <= GPA_RULES.maxGradePoints && !reaches(needed)) needed = round2(needed + 0.01);
  while(needed > 0 && reaches(round2(needed - 0.01))) needed = round2(needed - 0.01);
  const status = reaches(0) ? 'already' : needed > GPA_RULES.maxGradePoints ? 'unreachable' : 'reachable';
  return { scope, useR2R, hours:h / 100, needed, status, now:now.gpa, replaced:replaced.size,
    atLeast: TARGET_LETTERS.find(l => GRADE_POINTS[l] >= needed - 1e-9) || null,
    allA: result(GRADE_POINTS.A), allAPlus: result(GRADE_POINTS['A+']) };
}

/* ─── Suggested paths ────────────────────────────────────────────────────── */
function pathById(id) { return SUGGESTED_PATHS.find(p => p.id === id) || null; }
// The path's courses from startKey on, leaving out courses already completed.
function buildPathPlan(pathId, startKey, isDone = () => false) {
  const path = pathById(pathId) || pathById(DEFAULT_PATH_ID);
  const schedule = {};
  let lastKey = startKey;
  for(const [termId, ids] of Object.entries(path.terms)) {
    const key = termIdKey(termId);
    if(key < startKey) continue;
    schedule[termId] = ids.filter(id => findCourse(id) && !isDone(id)).map(courseId => ({ courseId, blocks:[] }));
    lastKey = Math.max(lastKey, key);
  }
  return { lastTermId: makeTerm(lastKey).id, schedule };
}
function planSignature(schedule) {
  return JSON.stringify(Object.entries(schedule || {})
    .map(([bucket, list]) => [bucket, (Array.isArray(list) ? list : []).map(e => typeof e === 'string' ? e : e?.courseId).filter(Boolean).sort()])
    .filter(([, ids]) => ids.length).sort());
}
function matchingPathId(schedule, startKey, isDone) {
  const sig = planSignature(schedule);
  return SUGGESTED_PATHS.find(p => planSignature(buildPathPlan(p.id, startKey, isDone).schedule) === sig)?.id || null;
}

/* ─── Saved plan normalization & migration ─────────────────────────────── */
const LIBRARY_SECTION_KEYS = ['audit','core','major','elective','rpe'];

function isValidTime(t) { return typeof t === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(t); }
function asText(v) { return typeof v === 'string' ? v.trim() : ''; }

function normalizeBlock(block, fallbackId) {
  const rawType = typeof block?.type === 'string' ? block.type : 'Lecture';
  return {
    id: typeof block?.id === 'string' && block.id ? block.id : fallbackId,
    type: BLOCK_TYPES.includes(rawType) ? rawType : 'Other',
    days: Array.isArray(block?.days) ? block.days.filter(day=>DAY_ORDER.includes(day)) : [],
    startTime: isValidTime(block?.startTime) ? block.startTime : '',
    endTime: isValidTime(block?.endTime) ? block.endTime : '',
    location: asText(block?.location),
    instructor: asText(block?.instructor),
    crn: asText(block?.crn),
  };
}

function normalizeScheduleEntry(entry, semId, idx) {
  if(typeof entry === 'string') return { courseId: entry, blocks: [] };
  if(!entry || typeof entry !== 'object') return null;
  const courseId = typeof entry.courseId === 'string' ? entry.courseId : '';
  if(!courseId) return null;
  const rawBlocks = Array.isArray(entry.blocks) ? entry.blocks : [];
  return { courseId, blocks: rawBlocks.map((block, blockIdx)=>normalizeBlock(block, `${courseId}-${semId}-${idx}-${blockIdx}`)) };
}

// Keeps only plannable catalog courses, each in at most one upcoming term.
function normalizeSchedule(rawSchedule, semesters) {
  const normalized = {}, seen = new Set();
  for(const sem of semesters) {
    const rawEntries = Array.isArray(rawSchedule?.[sem.id]) ? rawSchedule[sem.id] : [];
    normalized[sem.id] = rawEntries
      .map((entry, idx)=>normalizeScheduleEntry(entry, sem.id, idx))
      .filter(e => e && findCourse(e.courseId) && !seen.has(e.courseId) && seen.add(e.courseId));
  }
  return normalized;
}

// Upcoming terms run from startKey through the saved last term, and never end before a term that has courses.
function planLastKey(raw, startKey) {
  let last = termIdKey(raw?.lastTermId);
  if(last < 0) last = PLAN_START_KEY + (Number.isInteger(raw?.semesterCount) ? raw.semesterCount : DEFAULT_SEMESTER_COUNT) - 1;
  for(const [id, list] of Object.entries(raw?.schedule || {})) {
    const key = termIdKey(id);
    if(key >= startKey && Array.isArray(list) && list.length) last = Math.max(last, key);
  }
  return Math.min(startKey + MAX_SEMESTER_COUNT - 1, Math.max(startKey, last));
}

function normalizePlan(raw, startKey) {
  const safe = raw && typeof raw === 'object' ? raw : {};
  const lastKey = planLastKey(safe, startKey);
  const semesters = buildSemesters(startKey, lastKey - startKey + 1);
  return {
    version: PLAN_VERSION,
    lastTermId: makeTerm(lastKey).id,
    schedule: normalizeSchedule(safe.schedule, semesters),
    sidebarCollapsed: !!safe.sidebarCollapsed,
    sectionsCollapsed: Object.fromEntries(LIBRARY_SECTION_KEYS.map(k => [k, !!safe.sectionsCollapsed?.[k]])),
    view: safe.view === 'calendar' ? 'calendar' : 'planner',
    calSemester: semesters.some(s => s.id === safe.calSemester) ? safe.calSemester : semesters[0].id,
    expandedTerms: Array.isArray(safe.expandedTerms) ? [...new Set(safe.expandedTerms.filter(id => termIdKey(id) >= 0))].slice(0, 60) : null,
  };
}

// Older plans: Fall 2026 and the credit-by-exam bucket are gone, and a plan still identical to an earlier
// suggested path (or an empty pre-v4 plan) gets the default path.
function migratePlan(raw, startKey) {
  const safe = raw && typeof raw === 'object' ? raw : {};
  const version = Number(safe.version) || 0;
  if(version >= PLAN_VERSION) return { data: normalizePlan(safe, startKey), migrated:false, info:{} };
  const info = { movedFromFall2026: Array.isArray(safe.schedule?.fall2026) ? safe.schedule.fall2026.length : 0, seeded:false, upgraded:false, examRemoved:[] };
  let data = normalizePlan(safe, startKey);
  const hasCourses = Object.values(safe.schedule || {}).some(list => Array.isArray(list) && list.length);
  const oldSuggestion = hasCourses && LEGACY_SUGGESTED_PLANS.some(p => planSignature(p) === planSignature(safe.schedule));
  if((!hasCourses && version < 4) || oldSuggestion) {
    data = normalizePlan({ ...data, ...buildPathPlan(DEFAULT_PATH_ID, startKey, isCourseDone) }, startKey);
    info.seeded = !hasCourses;
    info.upgraded = oldSuggestion;
  } else if(Array.isArray(safe.schedule?.exam)) {
    info.examRemoved = safe.schedule.exam.map(e => typeof e === 'string' ? e : e?.courseId).filter(id => findCourse(id));
  }
  return { data, migrated:true, info };
}
