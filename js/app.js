/* ═══════════════════════════════════════════════════════════════════════════
   Bee's GSU Grad Planner — app.js
   State, Firebase sync (plan + academic record), plan / record / exception
   mutations, suggested paths, header progress, startup.
   Degree and GPA logic: planner.js · Rendering: board.js (timeline), library.js (audit
   and course library), calendar.js, modal.js, record.js (record, grades, exceptions),
   gpa.js (GPA projection)
   Plan state per upcoming term id: { courseId, blocks: Block[] }
   Block: { id, type, days[], startTime, endTime, location, instructor, crn }
   ═══════════════════════════════════════════════════════════════════════════ */

/* ─── Helpers ────────────────────────────────────────────────────────────── */
function genId(prefix = '') { return `${prefix}${Date.now().toString(36)}-${Math.random().toString(36).slice(2,7)}`; }
function timeToMin(t) { if(!t) return 0; const [h,m]=t.split(':').map(Number); return h*60+m; }
function fmtTime(t) {
  if(!t) return ''; const [h,m]=t.split(':').map(Number);
  return `${h%12||12}:${m.toString().padStart(2,'0')} ${h>=12?'PM':'AM'}`;
}
function fmtDays(days) { return days?.length ? days.join('') : ''; }
function escapeHtml(s) { return String(s ?? '').replace(/[&<>"']/g, ch => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' })[ch]); }
function isValidSemId(id) { return SEMESTERS.some(s=>s.id===id); }
function semIndex(semId) { return SEMESTERS.findIndex(s=>s.id===semId); }
function semById(id) { return SEMESTERS.find(s=>s.id===id) || null; }
function clone(v) { return JSON.parse(JSON.stringify(v)); }

/* ─── State ─────────────────────────────────────────────────────────────── */
let SEMESTERS = buildSemesters(PLAN_START_KEY, DEFAULT_SEMESTER_COUNT);
const state = {
  record: normalizeRecord(null),      // past terms, grades, advisor exceptions (Firebase only)
  recordStatus: 'loading',            // loading | ready | missing | offline
  summary: null,
  lastTermId: SEMESTERS[SEMESTERS.length-1].id,
  schedule: normalizeSchedule({}, SEMESTERS),
  expandedTerms: null,                // past terms shown open; null = only the latest
  view: 'planner',
  calSemester: SEMESTERS[0].id,
  drag: null,
  sidebarCollapsed: false,
  sectionsCollapsed: Object.fromEntries(LIBRARY_SECTION_KEYS.map(k=>[k,false])),
  modal: { courseId:null, semId:null, dirty:false },
  firebaseReady: false,
  audit: null,
  projection: normalizeProjection(null),   // expected grades — kept apart from the record
  gpa: null,                               // projectGpa() result
};
indexRecord(state.record);
state.summary = summarizeRecord(state.record);

function planStartKey() { return firstPlanKey(state.record); }

// Upcoming terms run from the first open term through state.lastTermId.
function refreshSemesters() {
  const start = planStartKey();
  const last = Math.min(start + MAX_SEMESTER_COUNT - 1, Math.max(start, termIdKey(state.lastTermId)));
  SEMESTERS = buildSemesters(start, last - start + 1);
  state.lastTermId = SEMESTERS[SEMESTERS.length-1].id;
  for(const s of SEMESTERS) state.schedule[s.id] ||= [];
  if(!isValidSemId(state.calSemester)) state.calSemester = SEMESTERS[0].id;
}

function applyPlan(p) {
  state.lastTermId = p.lastTermId;
  state.schedule = p.schedule;
  state.sidebarCollapsed = p.sidebarCollapsed;
  state.sectionsCollapsed = p.sectionsCollapsed;
  state.view = p.view;
  state.calSemester = p.calSemester;
  state.expandedTerms = p.expandedTerms;
  refreshSemesters();
}

function buildPlanPayload() {
  return normalizePlan({
    version: PLAN_VERSION,
    lastTermId: state.lastTermId,
    schedule: state.schedule,
    sidebarCollapsed: state.sidebarCollapsed,
    sectionsCollapsed: state.sectionsCollapsed,
    view: state.view,
    calSemester: state.calSemester,
    expandedTerms: state.expandedTerms,
  }, planStartKey());
}

// Returns true when completed courses had to leave the plan.
function setRecord(record) {
  state.record = record;
  indexRecord(record);
  state.summary = summarizeRecord(record);
  refreshSemesters();
  return pruneCompletedFromSchedule();
}

// A course with a passing grade can't also be planned.
function pruneCompletedFromSchedule() {
  let changed = false;
  for(const s of SEMESTERS) {
    const kept = state.schedule[s.id].filter(e=>!isCourseDone(e.courseId));
    if(kept.length !== state.schedule[s.id].length) { state.schedule[s.id] = kept; changed = true; }
  }
  return changed;
}

/* ─── Firebase sync ──────────────────────────────────────────────────────── */
// Only the plan is cached in this browser; the academic record lives in Firebase alone.
const LOCAL_KEY = 'bee-grad-planner-v6';
const OLD_LOCAL_KEYS = ['bee-grad-planner-v4','bee-grad-planner-v3','bee-grad-planner-v2','gsu-grad-planner'];

function setSyncStatus(status) {
  const dot  = document.getElementById('syncDot');
  const text = document.getElementById('syncText');
  if(!dot || !text) return;
  dot.className = 'sync-dot';
  if(status === 'online')  { dot.classList.add('sync-dot--online');  text.textContent = 'Synced'; }
  if(status === 'saving')  { dot.classList.add('sync-dot--saving');  text.textContent = 'Saving…'; }
  if(status === 'error')   { dot.classList.add('sync-dot--error');   text.textContent = 'Offline'; }
  if(status === 'connecting') { text.textContent = 'Connecting…'; }
}

let planTimer = null;
let lastPlanHash = '';
let planLoaded = false;
let deferredPlan = null;

function savePlan() {
  const payload = buildPlanPayload();
  const hash = JSON.stringify(payload);
  try { localStorage.setItem(LOCAL_KEY, hash); } catch(_) {}
  if(!state.firebaseReady || !planLoaded) return;
  // Back to the saved state: drop any pending write, or it would land later and undo this change.
  if(hash === lastPlanHash) { clearTimeout(planTimer); setSyncStatus('online'); return; }
  setSyncStatus('saving');
  clearTimeout(planTimer);
  planTimer = setTimeout(async () => {
    const ok = await FirebaseService.save('plan', payload);
    if(ok) { lastPlanHash = hash; setSyncStatus('online'); }
    else setSyncStatus('error');
  }, 500);
}

async function saveRecordNow() {
  if(!state.firebaseReady) { toast('⚠️ Not connected to Firebase — this change is not saved.','warn'); return false; }
  setSyncStatus('saving');
  const ok = await FirebaseService.save('record', recordForSave(state.record));
  setSyncStatus(ok ? 'online' : 'error');
  if(!ok) toast('⚠️ Could not save the record. Check the connection and try again.','warn');
  return ok;
}

// Plan changes from another device (meeting-time edits in progress wait until the modal closes).
function applyRemotePlan(data) {
  if(document.getElementById('modalBackdrop')?.classList.contains('open') && state.modal.dirty) {
    deferredPlan = data;
    return false;
  }
  deferredPlan = null;
  const local  = JSON.stringify([state.lastTermId, normalizeSchedule(state.schedule, SEMESTERS)]);
  const remote = JSON.stringify([data.lastTermId, data.schedule]);
  if(local === remote) return false;
  state.lastTermId = data.lastTermId;
  state.schedule = data.schedule;
  refreshSemesters();
  pruneCompletedFromSchedule();
  return true;
}

function applyRemoteRecord(raw) {
  const next = normalizeRecord(raw);
  if(next.exists === state.record.exists && JSON.stringify(recordForSave(next)) === JSON.stringify(recordForSave(state.record))) return { changed:false, pruned:false };
  return { changed:true, pruned:setRecord(next) };
}

let migrationAnnounced = false;
function announceMigration(info) {
  if(migrationAnnounced || !info) return;
  migrationAnnounced = true;
  if(info.movedFromFall2026) toast(`Fall 2026 was removed — ${info.movedFromFall2026} course(s) went back to the library.`,'info');
  if(info.examRemoved?.length) toast(`Credit by exam is no longer part of the plan — ${info.examRemoved.map(courseCode).join(', ')} went back to the library.`,'info');
  const path = pathById(DEFAULT_PATH_ID);
  if(info.upgraded) toast(`✨ Updated to the ${pathTitle(path)} without CLEP — graduating ${path.graduation}. Switch paths in the toolbar.`,'success');
  else if(info.seeded) toast(`✨ Loaded the ${pathTitle(path)}. Drag courses around to make it yours!`,'success');
}

function refreshOpenEditors() {
  if(isGpaPanelOpen()) renderGpaPanel();
  if(document.getElementById('recordBackdrop')?.classList.contains('open')) renderRecordEditor();
  if(document.getElementById('exceptionBackdrop')?.classList.contains('open')) renderExceptionList();
  if(document.getElementById('modalBackdrop')?.classList.contains('open') && state.modal.courseId && !state.modal.dirty) openModal(state.modal.courseId, scheduledIn(state.modal.courseId));
}

async function initFirebase() {
  setSyncStatus('connecting');
  if(!FirebaseService.init()) {
    state.recordStatus = 'offline';
    setSyncStatus('error'); hideLoading(); render();
    return;
  }
  state.firebaseReady = true;
  let planSeen = false, recordSeen = false;
  const settle = () => { if(planSeen && recordSeen) hideLoading(); };

  FirebaseService.listen('record', (raw, exists) => {
    const first = !recordSeen;
    recordSeen = true;
    state.recordStatus = exists ? 'ready' : 'missing';
    const { changed, pruned } = applyRemoteRecord(exists ? raw : null);
    if(changed || first) { render(); refreshOpenEditors(); }
    if(pruned) savePlan();
    setSyncStatus('online');
    settle();
  }, () => { recordSeen = true; state.recordStatus = 'offline'; setSyncStatus('error'); render(); settle(); });

  FirebaseService.listen('projection', raw => {
    projectionLoaded = true;
    const next = normalizeProjection(raw);
    if(JSON.stringify(projectionForSave(next)) === JSON.stringify(projectionForSave(state.projection))) return;
    state.projection = next;
    render();
  }, () => { projectionLoaded = true; });

  FirebaseService.listen('plan', (raw, exists) => {
    const first = !planSeen;
    planSeen = true;
    planLoaded = true;
    const { data, migrated, info } = migratePlan(exists ? raw : null, planStartKey());
    const changed = applyRemotePlan(data);
    if(changed || first) { render(); refreshOpenEditors(); }
    if(migrated) { lastPlanHash = ''; announceMigration(info); savePlan(); }
    else { lastPlanHash = JSON.stringify(buildPlanPayload()) === JSON.stringify(data) ? JSON.stringify(data) : ''; if(!lastPlanHash) savePlan(); else setSyncStatus('online'); }
    settle();
  }, () => { planSeen = true; setSyncStatus('error'); settle(); });
}

/* ─── Local plan cache (instant first paint) ─────────────────────────────── */
function loadLocalState() {
  let raw = null;
  try {
    raw = JSON.parse(localStorage.getItem(LOCAL_KEY) || 'null');
    for(const key of OLD_LOCAL_KEYS) {
      if(!raw && localStorage.getItem(key)) raw = JSON.parse(localStorage.getItem(key));
      localStorage.removeItem(key);
    }
  } catch(_) {}
  const { data, migrated, info } = migratePlan(raw, planStartKey());
  applyPlan(data);
  try { localStorage.setItem(LOCAL_KEY, JSON.stringify(data)); } catch(_) {}
  return { hadLocal: !!raw, migrated, info };
}

/* ─── Plan mutations ─────────────────────────────────────────────────────── */
function scheduledIn(courseId) {
  for(const s of SEMESTERS) {
    if(state.schedule[s.id]?.some(e=>e.courseId===courseId)) return s.id;
  }
  return null;
}

function semesterCredits(semId) {
  return round2((state.schedule[semId]||[]).reduce((s,{courseId})=>s+(findCourse(courseId)?.credits||0),0));
}

// A prerequisite counts when it has a passing grade, or is planned in a strictly earlier term.
function availableBefore(semId) {
  const earlier = SEMESTERS.slice(0, Math.max(0, semIndex(semId)));
  return id => isCourseDone(id) || earlier.some(s=>state.schedule[s.id].some(e=>e.courseId===id));
}
function getUnmetPrereqs(courseId, semId) { return unmetConditions(courseId, availableBefore(semId)); }
function getUnmetPrereqsGlobal(courseId) { return unmetConditions(courseId, id=>isCourseDone(id) || !!scheduledIn(id)); }

// Earlier attempts that did not count (retakes), e.g. "F · Spring 2026".
function failedAttempts(courseId) {
  return attemptsFor(courseId).filter(a => !earnsCredit(a.rec) || !gradeMeets(a.rec.grade, minGradeFor(a.rec.code)));
}

function addCourse(courseId, semId) {
  const sem = semById(semId);
  const course = findCourse(courseId);
  if(!sem || !course) return false;
  if(isCourseDone(courseId)) { toast(`${course.code} already has a passing grade on the record.`,'info'); return false; }
  if(state.schedule[semId].some(e=>e.courseId===courseId)) return false;
  if(semesterCredits(semId)+course.credits > sem.maxCredits) {
    toast(`⚠️ Adding ${course.credits} credits would exceed the ${sem.maxCredits}-credit limit for ${sem.label}.`,'warn');
    return false;
  }
  // Prerequisite order and offering history — warn but still allow the placement
  const warnings = [];
  const unmet = getUnmetPrereqs(courseId, semId);
  if(unmet.length) warnings.push(`needs ${unmet.map(conditionLabel).join(' and ')} in an earlier semester`);
  if(offeringInfo(course, sem.season).level === 'none') warnings.push(`was not offered in ${SEASON_META[sem.season].label} 2024–2026`);
  if(warnings.length) toast(`⚠️ ${course.code} ${warnings.join('; ')}.`,'warn');

  let carriedBlocks = [];
  for(const s of SEMESTERS) {
    const existing = state.schedule[s.id].find(e=>e.courseId===courseId);
    if(existing?.blocks?.length) carriedBlocks = existing.blocks;
    state.schedule[s.id] = state.schedule[s.id].filter(e=>e.courseId!==courseId);
  }
  state.schedule[semId].push({ courseId, blocks: carriedBlocks });
  savePlan(); return true;
}

function removeCourse(courseId, semId) {
  if(!state.schedule[semId]) return;
  state.schedule[semId]=state.schedule[semId].filter(e=>e.courseId!==courseId);
  savePlan();
}

function updateBlocks(courseId, semId, blocks) {
  const entry = state.schedule[semId]?.find(e=>e.courseId===courseId);
  if(entry) entry.blocks = normalizeScheduleEntry({ courseId, blocks }, semId, 0)?.blocks || [];
  savePlan();
}

function addSemester() {
  if(SEMESTERS.length >= MAX_SEMESTER_COUNT) return;
  state.lastTermId = makeTerm(termIdKey(state.lastTermId) + 1).id;
  refreshSemesters();
  savePlan(); render();
  toast(`Added ${SEMESTERS[SEMESTERS.length-1].label}. 🐝`,'info');
}

function removeLastSemester() {
  const last = SEMESTERS[SEMESTERS.length-1];
  if(SEMESTERS.length <= 1 || state.schedule[last.id].length) return;
  delete state.schedule[last.id];
  state.lastTermId = makeTerm(last.key - 1).id;
  refreshSemesters();
  savePlan(); render();
}

/* ─── Academic record mutations (never touched by Reset or Suggested path) ── */
async function commitRecord(mutate, message) {
  // Never write before the stored record has loaded — that would overwrite it.
  if(!['ready','missing'].includes(state.recordStatus)) { recordWritable(); return false; }
  const draft = clone(recordForSave(state.record));
  mutate(draft);
  const pruned = setRecord(normalizeRecord(draft));
  state.recordStatus = 'ready';
  render(); refreshOpenEditors();
  const ok = await saveRecordNow();
  if(pruned) savePlan();
  if(ok && message) toast(message,'success');
  return ok;
}

// fields: { code, title, credits, grade, status, line, gpa, transfer, school, note }
function saveRecordCourse(termId, fields, editingId) {
  return commitRecord(d => {
    let keepId = null;
    if(editingId) for(const t of d.terms) {
      const i = t.courses.findIndex(c=>c.id===editingId);
      if(i >= 0) { keepId = editingId; t.courses.splice(i, 1); }
    }
    let term = d.terms.find(t=>t.id===termId);
    if(!term) { term = { id:termId, note:'', courses:[] }; d.terms.push(term); }
    term.courses.push({ ...fields, id: keepId || genId('c-') });
  }, editingId ? `Saved ${fields.code}.` : `Added ${fields.code} to ${termById(termId)?.label}.`);
}

function deleteRecordCourse(recordId) {
  const found = findRecordCourse(recordId);
  if(!found) return;
  return commitRecord(d => d.terms.forEach(t => { t.courses = t.courses.filter(c=>c.id!==recordId); }), `Removed ${found.rec.code} (${found.term.label}) from the record.`);
}

function findRecordCourse(recordId) {
  for(const term of state.record.terms) {
    const rec = term.courses.find(c=>c.id===recordId);
    if(rec) return { term, rec };
  }
  return null;
}

function importRecord(data) {
  return commitRecord(d => {
    d.terms = data.terms; d.exceptions = data.exceptions; d.source = data.source; d.reported = data.reported;
  }, `📥 Imported ${data.terms.length} terms and ${data.terms.reduce((s,t)=>s+t.courses.length,0)} courses.`);
}

// fields: { type, target, course, credits, note }
function saveException(fields, editingId) {
  return commitRecord(d => {
    if(editingId) d.exceptions = d.exceptions.map(x => x.id===editingId ? { ...fields, id:editingId } : x);
    else d.exceptions.push({ ...fields, id:genId('x-') });
  }, editingId ? 'Exception updated.' : `🖊 Exception recorded: ${targetLabel(fields.target)}.`);
}

function removeException(id) {
  return commitRecord(d => { d.exceptions = d.exceptions.filter(x=>x.id!==id); }, 'Exception removed.');
}

// Final grades turn the first upcoming term into a locked past term.
// rows: [{ code, title, credits, grade }] (courses marked "not taken" are left out and leave the plan).
async function finishTerm(semId, rows) {
  const sem = SEMESTERS[0];
  if(!sem || sem.id !== semId) return null;
  const draft = clone(recordForSave(state.record));
  draft.terms = draft.terms.filter(t=>t.id!==semId);
  draft.terms.push({ id:semId, note:'', courses: rows.map(r => ({
    code:r.code, title:r.title, credits:r.credits, grade:r.grade, status:statusForGrade(r.code, r.grade), line:'auto', gpa: r.grade in GRADE_POINTS,
  })) });
  const expanded = new Set(state.expandedTerms || defaultExpandedTerms());
  expanded.add(semId);
  delete state.schedule[semId];
  if(state.lastTermId === semId) state.lastTermId = makeTerm(sem.key + 1).id;
  setRecord(normalizeRecord(draft));
  state.expandedTerms = [...expanded];
  state.recordStatus = 'ready';
  render(); refreshOpenEditors();

  const planPayload = buildPlanPayload(), recordPayload = recordForSave(state.record);
  try { localStorage.setItem(LOCAL_KEY, JSON.stringify(planPayload)); } catch(_) {}
  let ok = false;
  if(state.firebaseReady) {
    setSyncStatus('saving');
    ok = await FirebaseService.saveBoth(planPayload, recordPayload);
    if(ok) lastPlanHash = JSON.stringify(planPayload);
    setSyncStatus(ok ? 'online' : 'error');
  }
  if(!ok) toast('⚠️ Grades are shown but not saved to Firebase — check the connection and try again.','warn');
  const blocked = SEMESTERS.flatMap(s => state.schedule[s.id].map(e => ({ courseId:e.courseId, sem:s, unmet:getUnmetPrereqs(e.courseId, s.id) }))).filter(x=>x.unmet.length);
  return { ok, blocked, term: state.record.terms.find(t=>t.id===semId) };
}

/* ─── GPA projection (expected grades; never part of the record) ────────── */
let projectionLoaded = false;
let projectionTimer = null;

function saveProjection() {
  if(!state.firebaseReady || !projectionLoaded) return;
  setSyncStatus('saving');
  clearTimeout(projectionTimer);
  projectionTimer = setTimeout(async () => {
    const ok = await FirebaseService.save('projection', projectionForSave(state.projection));
    setSyncStatus(ok ? 'online' : 'error');
  }, 400);
}

function commitProjection(mutate, rerender = true) {
  const draft = projectionForSave(state.projection);
  mutate(draft);
  state.projection = normalizeProjection(draft);
  if(rerender) render();
  saveProjection();
}

function projectedRows(semId) { return state.gpa?.terms.find(t => t.term.id === semId)?.rows || []; }
function setProjectedGrade(codeId, grade) { commitProjection(p => { if(grade) p.grades[codeId] = grade; else delete p.grades[codeId]; }); }
function fillTermGrades(semId, grade) {
  const rows = projectedRows(semId);
  commitProjection(p => rows.forEach(r => { if(grade) p.grades[r.codeId] = grade; else delete p.grades[r.codeId]; }));
}
function clearAllProjectedGrades() { commitProjection(p => { p.grades = {}; }); }
function setRepeatToReplace(codeId, on) { commitProjection(p => { p.r2r[codeId] = !!on; }); }
function setGpaTarget(fields) { commitProjection(p => { p.target = { ...p.target, ...fields }; }, false); }

/* ─── Past-term display state ────────────────────────────────────────────── */
function defaultExpandedTerms() {
  const terms = state.record.terms;
  return terms.length ? [terms[terms.length-1].id] : [];
}
function isTermExpanded(termId) { return (state.expandedTerms || defaultExpandedTerms()).includes(termId); }
function toggleTermExpanded(termId) {
  const open = new Set(state.expandedTerms || defaultExpandedTerms());
  if(open.has(termId)) open.delete(termId); else open.add(termId);
  state.expandedTerms = [...open];
  savePlan(); renderSemesters(); updateHistoryToggle();
}
function initHistoryToggle() {
  document.getElementById('historyToggle').addEventListener('click', () => {
    const all = state.record.terms.map(t=>t.id);
    state.expandedTerms = all.every(isTermExpanded) ? defaultExpandedTerms() : all;
    savePlan(); renderSemesters(); updateHistoryToggle();
  });
}
function updateHistoryToggle() {
  const btn = document.getElementById('historyToggle');
  const terms = state.record.terms;
  btn.classList.toggle('hidden', terms.length < 2);
  btn.textContent = terms.length && terms.every(t=>isTermExpanded(t.id)) ? '📚 Collapse older terms' : '📚 Expand all past terms';
}

/* ─── Block form state helpers ───────────────────────────────────────────── */
function getBlocks(courseId, semId) {
  if(!semId) return [];
  return state.schedule[semId]?.find(e=>e.courseId===courseId)?.blocks || [];
}

function makeBlock(overrides={}) {
  return { id:genId(), type:'Lecture', days:[], startTime:'09:00', endTime:'10:00', location:'', instructor:'', crn:'', ...overrides };
}

/* ─── Suggested paths & reset (both leave the academic record alone) ─────── */
function currentPathId() { return matchingPathId(state.schedule, planStartKey(), isCourseDone); }

function pathPreview(pathId) {
  const plan = buildPathPlan(pathId, planStartKey(), isCourseDone);
  const start = planStartKey();
  const sems = buildSemesters(start, termIdKey(plan.lastTermId) - start + 1);
  const audit = computeAudit(state.record, plan.schedule, sems);
  const credits = sems.map(s => round2((plan.schedule[s.id]||[]).reduce((t,e)=>t+(findCourse(e.courseId)?.credits||0),0)));
  return { plan, sems, audit, credits };
}

function initPathSwitch() {
  document.getElementById('pathSwitch').addEventListener('click', e => {
    const btn = e.target.closest('.path-btn');
    if(btn) applyPath(btn.dataset.path);
  });
}

function renderPathSwitch() {
  const current = currentPathId();
  document.getElementById('pathSwitch').innerHTML = `<span class="path-switch-label">✨ Suggested path</span>` + SUGGESTED_PATHS.map(p => {
    const { sems, audit, credits } = pathPreview(p.id);
    const tip = [p.note, sems.map((s,i)=>`${s.label}: ${credits[i]} cr`).join(' · '),
      audit.missing ? `${audit.missing} requirement(s) still not covered` : audit.pending.length ? `Needs ${audit.pending.length} advisor exception(s) — see the Degree Audit` : 'Covers every requirement'].join('\n');
    return `<button type="button" class="path-btn${current===p.id?' path-btn--active':''}" data-path="${p.id}" title="${escapeHtml(tip)}">${p.emoji} ${escapeHtml(p.name)}<span class="path-btn-sub"> · ${escapeHtml(p.graduation)}</span></button>`;
  }).join('') + (current ? '' : '<span class="path-custom" title="Your plan differs from both suggested paths">✏️ Custom</span>');
}

// "3 semesters" → "3-semester path"
function pathTitle(path) { return `${path.name.replace(/ semesters?$/, '-semester')} path`; }

function applyPath(pathId) {
  const path = pathById(pathId);
  if(!path) return;
  const current = currentPathId();
  if(current === pathId) { toast(`${path.emoji} You're already on the ${pathTitle(path)}.`,'info'); return; }
  const hasCourses = SEMESTERS.some(s=>state.schedule[s.id].length);
  if(hasCourses && !current && !confirm(`Replace your planned semesters with the ${pathTitle(path)} (graduating ${path.graduation})?\nPast terms, grades and advisor exceptions are kept. Meeting times stay for courses that remain in the same semester.`)) return;
  const plan = buildPathPlan(pathId, planStartKey(), isCourseDone);
  for(const [semId, entries] of Object.entries(plan.schedule)) {
    entries.forEach(e=>{ const prev=state.schedule[semId]?.find(x=>x.courseId===e.courseId); if(prev) e.blocks=prev.blocks; });
  }
  state.schedule = plan.schedule;
  state.lastTermId = plan.lastTermId;
  refreshSemesters();
  savePlan(); render();
  toast(`${path.emoji} Loaded the ${pathTitle(path)} — graduating ${path.graduation}. Drag anything to adjust!`,'success');
}

function initReset() {
  document.getElementById('resetBtn').addEventListener('click',()=>{
    if(!confirm('Clear the planned semesters and start fresh?\nPast terms, grades and advisor exceptions are kept.')) return;
    state.schedule = normalizeSchedule({}, SEMESTERS);
    savePlan(); render(); toast('Planned courses cleared — the academic record is untouched. 🐝','info');
  });
}

/* ─── Header progress (Degree Works blocks + total) ─────────────────────── */
const STATUS_ICON = { met:'✓', planned:'📅', pending:'⏳', missing:'○' };
const STATUS_TEXT = { met:'complete', planned:'covered by the plan', pending:'needs an advisor exception', missing:'still needed' };

function blockMeter(b) {
  const lineSum = key => round2(b.lines.reduce((s,l)=>s+l[key],0));
  if(b.shared) {
    return { key:b.key, name:b.name, status:b.status, required:lineSum('credits'),
      done:round2(lineSum('done')+lineSum('waived')), planned:lineSum('planned'), pending:round2(lineSum('pendingCredits')+lineSum('pendingWaiver')) };
  }
  return { key:b.key, name:b.name, status:b.status, required:b.credits,
    done:round2(b.done+b.waived), planned:b.planned, pending:round2(b.pendingCredits+b.pendingWaiver) };
}

function allMeters() {
  const a = state.audit;
  return [...a.blocks.map(blockMeter),
    { key:'total', name:'Total credits', status:a.total.status, required:a.total.required, done:a.total.done, planned:a.total.planned, pending:0 }];
}

// Solid: completed (and recorded waivers) · light: planned · striped: waiting on an advisor exception
function meterHtml(m) {
  const pct = v => Math.min(100, v / m.required * 100);
  const shown = round2(m.done + m.planned + m.pending);
  const tip = `${m.name}: ${STATUS_TEXT[m.status]}\n${fmtCredits(m.done)} done${m.key!=='total'?' (incl. waived)':''} + ${fmtCredits(m.planned)} planned`
    + (m.pending ? ` + ${fmtCredits(m.pending)} pending advisor exception` : '') + ` of ${fmtCredits(m.required)} cr`;
  return `<div class="prog-group prog-group--${m.status}" title="${escapeHtml(tip)}" data-block="${m.key}">
    <div class="prog-label"><span class="prog-name">${escapeHtml(m.name)}</span><span class="prog-icon">${STATUS_ICON[m.status]}</span></div>
    <div class="prog-track">
      <div class="prog-fill prog-fill--pending" style="width:${pct(shown)}%"></div>
      <div class="prog-fill prog-fill--planned" style="width:${pct(m.done+m.planned)}%"></div>
      <div class="prog-fill prog-fill--${m.key}" style="width:${pct(m.done)}%"></div>
    </div>
    <div class="prog-val">${fmtCredits(shown)}/${fmtCredits(m.required)} cr</div>
  </div>`;
}

function renderHeaderProgress() {
  document.getElementById('headerProgress').innerHTML = allMeters().map(meterHtml).join('');
}

let wasCovered = null;   // null until the first render, so the banner celebrates changes, not page loads
let bannerTimer = null;
function updateGradBanner() {
  const banner = document.getElementById('graduationBanner');
  if(!banner) return;
  const covered = state.audit.missing === 0 && state.recordStatus === 'ready';
  if(covered && wasCovered === false) {
    const last = [...SEMESTERS].reverse().find(s=>state.schedule[s.id].length);
    const pending = state.audit.pending.length;
    banner.textContent = `🎉✨ Your plan covers every requirement${last?` — graduation after ${last.label}`:''}${pending?`, once ${pending} advisor exception${pending>1?'s are':' is'} recorded`:''}, Bee! ✨🎉`;
    banner.classList.remove('hidden');
    clearTimeout(bannerTimer);
    bannerTimer = setTimeout(() => banner.classList.add('hidden'), 4500);
  }
  if(!covered) banner.classList.add('hidden');
  if(state.recordStatus === 'ready') wasCovered = covered;
}

/* ─── Toast ──────────────────────────────────────────────────────────────── */
function toast(msg,type='info') {
  const c=document.getElementById('toastContainer');
  const t=document.createElement('div');
  t.className=`toast toast-${type}`; t.textContent=msg;
  c.appendChild(t);
  requestAnimationFrame(()=>t.classList.add('toast-visible'));
  setTimeout(()=>{ t.classList.remove('toast-visible'); t.addEventListener('transitionend',()=>t.remove(),{once:true}); },4200);
}

/* ─── View toggle ────────────────────────────────────────────────────────── */
function initViewToggle() {
  const btnP=document.getElementById('btnPlanner');
  const btnC=document.getElementById('btnCalendar');
  const pv=document.getElementById('plannerView');
  const cv=document.getElementById('calendarView');
  const tt=document.getElementById('plannerTitleText');
  const h=document.getElementById('plannerHint');

  function applyView(v) {
    state.view=v;
    const isP=v==='planner';
    btnP.classList.toggle('view-btn--active',isP); btnC.classList.toggle('view-btn--active',!isP);
    pv.classList.toggle('hidden',!isP); cv.classList.toggle('hidden',isP);
    document.getElementById('pathSwitch').classList.toggle('hidden',!isP);
    tt.textContent=isP?'Academic Timeline':'Weekly Calendar';
    h.textContent=isP?`Past terms are locked 🔒 · drag courses into upcoming terms · max ${MAX_CREDITS_PER_TERM} credits`:'Click a course card to add meeting times · they appear here on the calendar';
    if(!isP) renderCalendar();
    savePlan();
  }
  btnP.addEventListener('click',()=>applyView('planner'));
  btnC.addEventListener('click',()=>applyView('calendar'));
  applyView(state.view);
}

/* ─── Sidebar ────────────────────────────────────────────────────────────── */
function initSidebar() {
  const sidebar=document.getElementById('sidebar');
  const btn=document.getElementById('collapseBtn');
  function applySidebar(c){ state.sidebarCollapsed=c; sidebar.classList.toggle('sidebar--collapsed',c); btn.textContent=c?'▶':'◀'; }
  btn.addEventListener('click',()=>{ applySidebar(!state.sidebarCollapsed); savePlan(); });
  applySidebar(state.sidebarCollapsed);
  document.querySelectorAll('.lib-section-header').forEach(hdr=>{
    const type=hdr.dataset.type;
    const list=document.getElementById(`${type}Courses`);
    const icon=hdr.querySelector('.lib-toggle-icon');
    const apply=()=>{ list?.classList.toggle('collapsed',state.sectionsCollapsed[type]); if(icon) icon.textContent=state.sectionsCollapsed[type]?'▶':'▼'; };
    hdr.addEventListener('click',()=>{ state.sectionsCollapsed[type]=!state.sectionsCollapsed[type]; apply(); savePlan(); });
    apply();
  });
}

/* ─── Master render ──────────────────────────────────────────────────────── */
function render() {
  state.audit = computeAudit(state.record, state.schedule, SEMESTERS);
  state.gpa = projectGpa(state.record, state.schedule, SEMESTERS, state.projection);
  renderHeaderProgress();
  renderPathSwitch();
  renderLibrary();
  renderSemesters();
  updateHistoryToggle();
  updateGradBanner();
  if(state.view==='calendar') renderCalendar();
  if(isGpaPanelOpen()) renderGpaPanel();
}

function hideLoading() { document.getElementById('loadingOverlay')?.classList.add('hidden'); }

/* ─── Init ───────────────────────────────────────────────────────────────── */
document.addEventListener('DOMContentLoaded', async () => {
  const local = loadLocalState();   // show the cached plan instantly

  initSidebar();
  initViewToggle();
  initDropZones();
  initReset();
  initPathSwitch();
  initHistoryToggle();
  initModal();
  initRecordEditor();
  initGradeEntry();
  initExceptionEditor();
  initGpaPanel();
  document.getElementById('recordBtn').addEventListener('click',()=>openRecordEditor());

  render();
  setTimeout(hideLoading, 3000);   // never keep the page hidden if Firebase is slow

  await initFirebase();
  if(!state.firebaseReady && local.migrated && local.hadLocal) announceMigration(local.info);
});
