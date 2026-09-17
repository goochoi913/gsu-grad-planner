/* ═══════════════════════════════════════════════════════════════════════════
   Bee's GSU Grad Planner — gpa.js
   GPA projection panel: expected grades for each upcoming term (lecture and lab
   graded separately), Repeat to Replace switches, the with/without comparison and
   the target-GPA helper. Expected grades are saved in their own Firebase document
   and never touch the academic record, the Degree Audit or the plan.
   ═══════════════════════════════════════════════════════════════════════════ */

let gpaRulesOpen = false;

function isGpaPanelOpen() { return !!document.getElementById('gpaBackdrop')?.classList.contains('open'); }

function initGpaPanel() {
  bindBackdrop('gpaBackdrop', 'gpaClose', closeGpaPanel);
  document.getElementById('gpaBtn').addEventListener('click', () => openGpaPanel());
  const body = document.getElementById('gpaBody');
  body.addEventListener('change', e => {
    const t = e.target;
    if(t.dataset.grade) setProjectedGrade(t.dataset.grade, t.value);
    else if(t.dataset.r2r) setRepeatToReplace(t.dataset.r2r, t.checked);
    else if(t.id === 'gpaTargetTerm') { setGpaTarget({ termId:t.value }); renderGpaTarget(); }
  });
  body.addEventListener('input', e => {
    if(e.target.id !== 'gpaTargetValue') return;
    const v = Number(e.target.value);
    if(v > 0 && v <= GPA_RULES.maxGradePoints) { setGpaTarget({ gpa:round2(v) }); renderGpaTarget(); }
  });
  body.addEventListener('click', e => {
    const b = e.target.closest('button');
    if(!b) return;
    if(b.dataset.fill !== undefined) fillTermGrades(b.dataset.term, b.dataset.fill);
    else if(b.id === 'gpaResetAll' && confirm('Clear every expected grade?\nReal grades, the record and the plan are not affected.')) clearAllProjectedGrades();
  });
  body.addEventListener('toggle', e => { if(e.target.classList?.contains('gpa-rules')) gpaRulesOpen = e.target.open; }, true);
}

function openGpaPanel(termId) {
  renderGpaPanel();
  document.getElementById('gpaBackdrop').classList.add('open');
  if(termId) requestAnimationFrame(() => document.getElementById(`gpa-term-${termId}`)?.scrollIntoView({ block:'start' }));
}

function closeGpaPanel() { document.getElementById('gpaBackdrop').classList.remove('open'); }

function renderGpaPanel() {
  const g = state.gpa;
  if(!g) return;
  const body = document.getElementById('gpaBody');
  const scroll = body.scrollTop;
  const rep = state.record.reported;
  const matches = rep?.gsuGpa != null && rep.gsuGpa === g.current.gsu.gpa && rep.overallGpa === g.current.overall.gpa;
  document.getElementById('gpaNow').textContent = state.record.terms.length
    ? `Now: GSU ${fmtGpa(g.current.gsu)} · GSU + transfer ${fmtGpa(g.current.overall)}${matches ? ' ✓ matches Degree Works' : ''}`
    : 'Import the academic record to project from real grades';
  body.innerHTML = [gpaSummaryHtml(g), gpaRepeatHtml(g), gpaGradesHtml(g), gpaTargetHtml(), gpaRulesHtml()].join('');
  renderGpaTarget();
  body.scrollTop = scroll;
}

function gpaDeltaHtml(v) {
  return v == null ? '' : `<span class="gpa-delta gpa-delta--${v > 0 ? 'up' : v < 0 ? 'down' : 'flat'}">${fmtDelta(v)}</span>`;
}
function gpaCell(value, delta) { return `<b>${fmtGpa(value)}</b>${gpaDeltaHtml(delta)}`; }

/* ─── Summary: projected GPA after each term, with and without Repeat to Replace ─── */
function gpaSummaryHtml(g) {
  const rows = g.withR2R.map((w, i) => {
    const o = g.withoutR2R[i];
    if(!w.total) return '';
    const empty = !w.graded;
    return `<tr class="${empty ? 'gpa-row--empty' : ''}">
      <th>${w.term.emoji} ${escapeHtml(w.term.label)}<span class="gpa-graded">${w.graded}/${w.total} graded</span></th>
      <td>${empty ? '—' : gpaCell(w.termGpa, w.deltaTerm)}</td>
      <td>${gpaCell(w.cumGsu, w.deltaGsu)}</td>
      <td class="gpa-alt">${gpaCell(o.cumGsu, o.deltaGsu)}</td>
      <td>${gpaCell(w.cumOverall, w.deltaOverall)}</td>
      <td class="gpa-alt">${gpaCell(o.cumOverall, o.deltaOverall)}</td>
    </tr>`;
  }).join('');
  return `<div class="modal-section">
    <div class="modal-section-label">📊 Projected GPA after each term</div>
    <div class="gpa-table-wrap"><table class="gpa-table">
      <thead>
        <tr><th rowspan="2">Term</th><th rowspan="2">Term GPA</th><th colspan="2">GSU GPA</th><th colspan="2">GSU + transfer GPA</th></tr>
        <tr><th>with R2R*</th><th class="gpa-alt">without</th><th>with R2R*</th><th class="gpa-alt">without</th></tr>
      </thead>
      <tbody>
        <tr class="gpa-row--now"><th>Now (official)</th><td>—</td>
          <td><b>${fmtGpa(g.current.gsu)}</b></td><td class="gpa-alt"><b>${fmtGpa(g.current.gsu)}</b></td>
          <td><b>${fmtGpa(g.current.overall)}</b></td><td class="gpa-alt"><b>${fmtGpa(g.current.overall)}</b></td></tr>
        ${rows}
      </tbody>
    </table></div>
    <div class="gpa-foot">▲▼ = change from her current GPA (the term GPA is compared with the current GSU GPA). *R2R = Repeat to Replace, as switched below. Courses without an expected grade are left out.</div>
  </div>`;
}

/* ─── Repeat to Replace ─────────────────────────────────────────────────── */
const R2R_STATUS_TEXT = {
  applies: '✓ Replaces the earlier grade',
  pending: 'Pick an expected grade to see the effect',
  lower: '✕ Won’t replace it',
  limit: '✕ Over the 4-course limit',
  blocked: '✕ Not eligible',
  off: 'Switched off',
};

function gpaRepeatHtml(g) {
  const used = g.r2rUsed + g.r2rReserved;
  const items = g.candidates.map(c => `
    <div class="r2r-item r2r-item--${c.status}">
      <label class="r2r-switch"><input type="checkbox" data-r2r="${escapeHtml(c.codeId)}"${c.on ? ' checked' : ''}><span>↻ ${escapeHtml(c.code)}</span></label>
      <div class="r2r-text">
        <div>Retake in ${escapeHtml(c.term.label)} · first grade <b>${escapeHtml(c.first.rec.grade || '—')}</b> (${escapeHtml(c.first.term.label)})${c.grade ? ` · expected <b>${escapeHtml(c.grade)}</b>` : ''}</div>
        <div class="r2r-status">${R2R_STATUS_TEXT[c.status]}${c.note ? ` — ${escapeHtml(c.note)}` : ''}</div>
      </div>
    </div>`).join('');
  // How much Repeat to Replace changes the GPA after the last term with expected grades
  const lastIdx = g.withR2R.map(w => w.graded > 0).lastIndexOf(true);
  let gain = '';
  if(lastIdx >= 0 && g.withR2R[lastIdx].replaced) {
    const w = g.withR2R[lastIdx], o = g.withoutR2R[lastIdx];
    gain = `<div class="gpa-gain">After ${escapeHtml(w.term.label)}, Repeat to Replace adds <b>${fmtDelta(round2(w.cumGsu.gpa - o.cumGsu.gpa))}</b> to the GSU GPA (${fmtGpa(o.cumGsu)} → ${fmtGpa(w.cumGsu)}) and <b>${fmtDelta(round2(w.cumOverall.gpa - o.cumOverall.gpa))}</b> to the GSU + transfer GPA (${fmtGpa(o.cumOverall)} → ${fmtGpa(w.cumOverall)}).</div>`;
  }
  return `<div class="modal-section">
    <div class="modal-section-label">↻ Repeat to Replace <span class="gpa-chip${used > GPA_RULES.r2rMaxCourses ? ' gpa-chip--warn' : ''}">${used} of ${GPA_RULES.r2rMaxCourses} courses</span></div>
    ${items || '<div class="editor-empty">No planned course repeats an earlier GSU grade.</div>'}
    ${gain}
    <div class="gpa-note">📝 <b>How and when to request it:</b> ${escapeHtml(R2R_HOW_TO)} Only the first recorded grade can be replaced, and an approval can’t be undone. After it’s approved, tick “Replaced by Repeat to Replace” on the earlier grade in 📚 Record.</div>
  </div>`;
}

/* ─── Expected grades per term ──────────────────────────────────────────── */
function gpaGradesHtml(g) {
  const options = grade => `<option value="">—</option>` + PROJECTION_GRADES.map(l => `<option value="${l}"${l === grade ? ' selected' : ''}>${l}</option>`).join('');
  const terms = g.terms.map((t, i) => {
    const w = g.withR2R[i];
    return `<div class="gpa-term" id="gpa-term-${t.term.id}">
      <div class="gpa-term-head">
        <span class="gpa-term-name">${t.term.emoji} ${escapeHtml(t.term.label)} <span class="gpa-graded">${fmtCredits(t.hours)} cr</span></span>
        <span class="gpa-quick">${t.rows.length ? ['A', 'B', 'C'].map(l => `<button type="button" class="editor-btn" data-fill="${l}" data-term="${t.term.id}">All ${l}</button>`).join('')
          + `<button type="button" class="editor-btn editor-btn--danger" data-fill="" data-term="${t.term.id}">Reset</button>` : ''}</span>
      </div>
      ${t.rows.map(r => `<div class="gpa-course${r.grade ? '' : ' gpa-course--empty'}">
          <span class="gpa-course-code">${escapeHtml(r.code)}${r.candidate ? '<span class="retake-tag">↻ retake</span>' : ''}</span>
          <span class="gpa-course-title">${escapeHtml(r.title)}</span>
          <span class="gpa-course-cr">${fmtCredits(r.credits)} cr</span>
          <select class="grade-select" data-grade="${escapeHtml(r.codeId)}" aria-label="Expected grade for ${escapeHtml(r.code)}">${options(r.grade)}</select>
        </div>`).join('') || '<div class="editor-empty">No courses planned for this term.</div>'}
      ${t.graded ? `<div class="gpa-term-result">Estimated: term <b>${fmtGpa(w.termGpa)}</b> · GSU <b>${fmtGpa(w.cumGsu)}</b> ${gpaDeltaHtml(w.deltaGsu)} · GSU + transfer <b>${fmtGpa(w.cumOverall)}</b> ${gpaDeltaHtml(w.deltaOverall)}</div>` : ''}
    </div>`;
  }).join('');
  return `<div class="modal-section">
    <div class="modal-section-label gpa-label-row"><span>✏️ Expected grades</span><button type="button" class="editor-btn" id="gpaResetAll">Reset all</button></div>
    <div class="gpa-foot">Only for estimates — they never mark a course completed. Real grades go in through 🎓 Enter grades when a term ends.</div>
    ${terms}
  </div>`;
}

/* ─── Target GPA helper ─────────────────────────────────────────────────── */
function targetTerms() { return SEMESTERS.filter(s => (state.schedule[s.id] || []).length); }

function gpaTargetHtml() {
  const t = state.projection.target;
  const terms = targetTerms();
  const termId = terms.some(s => s.id === t.termId) ? t.termId : terms[0]?.id || '';
  return `<div class="modal-section" id="gpaTarget">
    <div class="modal-section-label">🎯 Target GPA</div>
    <div class="gpa-target-form">
      <label>Reach <input type="number" id="gpaTargetValue" min="1" max="${GPA_RULES.maxGradePoints}" step="0.01" value="${t.gpa.toFixed(2)}"></label>
      <label>by the end of <select id="gpaTargetTerm">${terms.map(s => `<option value="${s.id}"${s.id === termId ? ' selected' : ''}>${escapeHtml(s.label)}</option>`).join('')}</select></label>
    </div>
    <div id="gpaTargetResults"></div>
  </div>`;
}

function targetCellHtml(r, target) {
  if(r.status === 'none') return 'No courses planned by then';
  if(r.status === 'already') return `Already there — any passing grades keep it at ${target.toFixed(2)} or higher`;
  if(r.status === 'unreachable') return `<b class="gpa-bad">Not reachable</b> — even all A+ gives ${r.allAPlus.toFixed(2)} (all A: ${r.allA.toFixed(2)})`;
  return `Needs a <b>${r.needed.toFixed(2)}</b> average over ${fmtCredits(r.hours)} cr — about all <b>${r.atLeast}</b>${r.atLeast === 'A+' ? ' (A+ is rare)' : ''} · all A gives ${r.allA.toFixed(2)}`;
}

function renderGpaTarget() {
  const box = document.getElementById('gpaTargetResults');
  if(!box) return;
  const target = state.projection.target.gpa;
  const termId = document.getElementById('gpaTargetTerm')?.value;
  if(!termId) { box.innerHTML = '<div class="editor-empty">Plan some courses first.</div>'; return; }
  const scopes = [['overall', 'GSU + transfer GPA'], ['gsu', 'GSU GPA']];
  const rows = scopes.map(([scope, label]) => {
    const on = targetNeeded(state.record, state.schedule, SEMESTERS, state.projection, termId, target, scope, true);
    const off = targetNeeded(state.record, state.schedule, SEMESTERS, state.projection, termId, target, scope, false);
    return `<tr><th>${label}<span class="gpa-graded">now ${fmtGpa({ gpa:off.now })}</span></th><td>${targetCellHtml(on, target)}</td><td class="gpa-alt">${targetCellHtml(off, target)}</td></tr>`;
  }).join('');
  box.innerHTML = `<div class="gpa-table-wrap"><table class="gpa-table gpa-target-table">
      <thead><tr><th></th><th>with R2R*</th><th class="gpa-alt">without R2R</th></tr></thead>
      <tbody>${rows}</tbody>
    </table></div>
    <div class="gpa-foot">The average is weighted by credits across every course planned through ${escapeHtml(termById(termId)?.label || '')} (A 4.00 · A− 3.70 · B+ 3.30 · B 3.00). A target counts once the official GPA rounds to it. *Retakes switched on above are assumed to beat their old grade.</div>`;
}

/* ─── Rules, sources and open questions ─────────────────────────────────── */
function gpaRulesHtml() {
  const notCounted = state.record.terms.flatMap(t => t.courses
    .filter(c => c.transfer && hasGradePoints(c.grade) && c.gpa === false)
    .map(c => `${c.code} ${c.grade} (${t.label})`));
  const open = [...GPA_OPEN_QUESTIONS];
  if(notCounted.length) open.unshift(`Degree Works leaves ${notCounted.join(' and ')} out as “Not counted” (“Max of zero classes/credits exceeded”). Her official GSU + transfer GPA matches only without them, but no catalog rule says why (each course was retaken later) — confirm with the Registrar.`);
  return `<details class="modal-section gpa-rules"${gpaRulesOpen ? ' open' : ''}>
    <summary class="modal-section-label">📘 How GSU calculates GPA · open questions</summary>
    <ul class="audit-bullets">${GPA_RULE_SUMMARY.map(x => `<li>${escapeHtml(x)}</li>`).join('')}</ul>
    <div class="gpa-subhead">To confirm with the Registrar or her advisor</div>
    <ul class="audit-bullets">${open.map(x => `<li>${escapeHtml(x)}</li>`).join('')}</ul>
    <div class="gpa-sources">Sources: ${GPA_SOURCES.map(s => `<a href="${s.url}" target="_blank" rel="noopener">${escapeHtml(s.label)}</a>`).join(' · ')}</div>
  </details>`;
}
