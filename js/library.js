/* ═══════════════════════════════════════════════════════════════════════════
   Bee's GSU Grad Planner — library.js
   Sidebar: the Degree Audit (Degree Works blocks and lines with the courses that
   fill them, advisor exceptions, advisor checklist, rules) and the course library.
   ═══════════════════════════════════════════════════════════════════════════ */

const BLOCK_ICON = { core:'🎓', advice:'🧭', fos:'🧮', major:'⭐', rpe:'🧩' };
function roleShort(role) {
  if(!role) return '';
  if(!role.block) return '➕ Extra credit';
  if(role.lineId === 'major.elec') return '💜 CSC elective';
  return `${BLOCK_ICON[role.block]} ${BLOCK_BY_KEY[role.block].short}${role.pending?' ⏳':''}`;
}

function renderLibrary() {
  renderAuditPanel();
  renderCoreSection();
  renderMajorSection();
  renderElectiveSection();
  renderRpeSection();
}

/* ─── Shared pieces ──────────────────────────────────────────────────────── */
function resetList(type) {
  const list=document.getElementById(`${type}Courses`);
  list.innerHTML='';
  return list;
}

function setBadge(type, text, title='') {
  const el=document.getElementById(`${type}Badge`);
  if(!el) return;
  el.textContent=text;
  el.title=title;
}

function makeSubhead(text, note='') {
  const el=document.createElement('div');
  el.className='lib-subhead';
  el.innerHTML=`${escapeHtml(text)}${note?`<div class="lib-note">${escapeHtml(note)}</div>`:''}`;
  return el;
}

function seasonDots(course) {
  const tips=SEASONS.map(s=>offeringInfo(course,s).text).join(' · ');
  const dots=SEASONS.map(s=>`<span class="season-dot season-dot--${offeringInfo(course,s).level}">${SEASON_META[s].short}</span>`).join('');
  return `<span class="season-dots" title="${escapeHtml(tips)}">${dots}</span>`;
}

// For "pick one" requirements already covered by another course, a short explanation.
function coveredBy(course) {
  const lineId = { osplc:'major.osplc', capstone:'major.cap1', fos:'fos.addl', labseq:'core.labseq' }[course.tag];
  const line = lineId && state.audit.lineById[lineId];
  if(!line || line.status==='missing' || line.units.some(u=>u.courseId===course.id)) return '';
  if(line.forced || line.substitutions.length) return `${line.label}: met by an advisor exception`;
  const codes=[...new Set(line.units.map(u=>u.code))];
  return codes.length ? `${line.label}: ${codes.join(' + ')}${line.status==='pending'?' (needs advisor exception)':''}` : '';
}

function makeLibCard(course) {
  const done=isCourseDone(course.id);
  const inSem=done?null:scheduledIn(course.id);
  const req=isRequiredSection(course);
  const card=document.createElement('div');
  card.className=`lib-card lib-card--${req?'req':'elec'}${inSem?' lib-card--placed':''}${done?' lib-card--completed':''}`;
  card.dataset.courseId=course.id;
  card.draggable=!inSem&&!done;
  const unmetGlobal=done?[]:getUnmetPrereqsGlobal(course.id);
  const covered=inSem||done?'':coveredBy(course);
  const retake=done?[]:failedAttempts(course.id);
  let footerRight;
  if(done) {
    const a=lastPassingAttempt(course.id);
    footerRight=`<span class="lib-card-done">✓ ${escapeHtml(a?.rec.grade||'Done')}${a?` · ${escapeHtml(a.term.shortLabel)}`:''}</span>`;
  }
  else if(inSem)   footerRight=`<span class="lib-card-placed">📅 ${semById(inSem)?.shortLabel||''}</span>`;
  else if(covered) footerRight=`<span class="lib-card-hint" title="${escapeHtml(covered)}">✓ covered</span>`;
  else             footerRight=`<span class="lib-card-hint">drag to add</span>`;
  const lockHtml=unmetGlobal.length?`<span class="lib-card-lock" title="Needs first: ${escapeHtml(unmetGlobal.map(conditionLabel).join(', '))}">🔒</span>`:'';
  const retakeHtml=retake.length?`<span class="retake-tag" title="Earlier: ${escapeHtml(retake.map(a=>`${a.rec.grade||RECORD_STATUS[a.rec.status].short} (${a.term.label})`).join(', '))}">↻ retake</span>`:'';
  card.innerHTML=`
    <div class="lib-card-code"><span>${escapeHtml(course.code)}${retakeHtml}</span>${done?'':seasonDots(course)}</div>
    <div class="lib-card-title">${escapeHtml(course.title)}</div>
    <div class="lib-card-footer">
      <span class="lib-card-cr">${course.credits} cr</span>
      ${footerRight}
      ${lockHtml}
    </div>`;
  card.addEventListener('click',()=>openModal(course.id,inSem||null));
  if(card.draggable) {
    card.addEventListener('dragstart',e=>{
      state.drag={courseId:course.id,fromSemester:null};
      e.dataTransfer.effectAllowed='move';
      e.dataTransfer.setData('text/plain', course.id);
      card.classList.add('dragging');
    });
    card.addEventListener('dragend',()=>card.classList.remove('dragging'));
  }
  return card;
}

/* ─── Degree audit ───────────────────────────────────────────────────────── */
const auditOpen = {};   // block key → open/closed chosen by the user

function statusSentence(a) {
  if(state.recordStatus==='missing') return 'Import the academic record to see what is already complete.';
  if(a.status==='incomplete') return `${a.missing} requirement${a.missing>1?'s are':' is'} not covered by completed or planned courses yet (○ below).`;
  if(a.status==='pending') return `The plan covers every course requirement. ${a.pending.length} item${a.pending.length>1?'s need':' needs'} an advisor exception before Degree Works counts ${a.pending.length>1?'them':'it'} (⏳ below).`;
  if(a.status==='planned') return 'The plan covers every requirement, including the recorded exceptions. 🎉';
  return 'Every requirement is complete. 🎓';
}

function exceptionButton(prefill, label='Record') {
  return `<button type="button" class="ex-record-btn" data-ex="${escapeHtml(JSON.stringify(prefill))}">🖊 ${escapeHtml(label)}</button>`;
}

function auditUnitHtml(u, line) {
  const pendingNote = u.pending ? ' — counts once the advisor enters the substitution' : '';
  if(u.kind==='done') {
    return `<div class="audit-course audit-course--done${u.pending?' audit-course--pending':''}" data-rec="${escapeHtml(u.rec.id)}">
      <span class="audit-course-icon">${u.pending?'⏳':'✓'}</span><span><b>${escapeHtml(u.code)}</b> ${escapeHtml(u.rec.title)}
      <span class="audit-course-meta"><span class="audit-grade">${escapeHtml(u.grade||'—')}</span> · ${fmtCredits(u.credits)} cr · ${escapeHtml(u.term.label)}${u.rec.transfer?' · transfer':''}${pendingNote}</span></span></div>`;
  }
  return `<div class="audit-course audit-course--planned${u.pending?' audit-course--pending':''}" data-course="${escapeHtml(u.courseId)}">
    <span class="audit-course-icon">${u.pending?'⏳':'📅'}</span><span><b>${escapeHtml(u.code)}</b> ${escapeHtml(u.course.title)}
    <span class="audit-course-meta">Still needed · planned ${escapeHtml(u.term.label)} · ${fmtCredits(u.credits)} cr${pendingNote}</span></span></div>`;
}

function stillNeededText(l) {
  if(l.recordOnly) return `${l.shortCount ? `${l.shortCount} course` : `${fmtCredits(l.short)} cr`} — add the course in 📚 Record and pick this line under “Counts toward”`;
  if(l.shortCount) return `${l.shortCount} course from ${l.courses.slice(0,3).join(', ')}${l.courses.length>3?'…':''}`;
  const what = l.pattern
    ? (l.pattern.subject ? `${l.pattern.subject} ${Math.floor(l.pattern.min/1000)}000/${Math.floor(l.pattern.max/1000)}000-level courses` : 'any 2000–4999 level course, any subject')
    : l.list ? 'the Field of Study list' : l.courses.filter(c=>!/\d{4}L$/.test(c)).join(' or ');
  return `${fmtCredits(l.short)} cr in ${what}`;
}

function auditLineHtml(l) {
  const rows=l.units.map(u=>auditUnitHtml(u,l));
  const isMirror=MIRROR_LINE[l.block]===l.id;
  l.substitutions.forEach(x=>rows.push(`<div class="audit-course audit-course--exception" data-exid="${escapeHtml(x.id)}"><span class="audit-course-icon">🖊</span><span>Substitution: <b>${escapeHtml(x.course)}</b>${x.note?` <span class="audit-course-meta">${escapeHtml(x.note)}</span>`:''}</span></div>`));
  l.waivers.forEach(w=>rows.push(`<div class="audit-course audit-course--exception" data-exid="${escapeHtml(w.id)}"><span class="audit-course-icon">🖊</span><span>Exception: ${w.credits==null?'requirement not needed':`${fmtCredits(w.credits)} cr waived`}${w.note?` <span class="audit-course-meta">${escapeHtml(w.note)}</span>`:''}</span></div>`));
  if(l.pendingSub) rows.push(`<div class="audit-course audit-course--todo"><span class="audit-course-icon">⏳</span><span>Pending advisor exception: ${escapeHtml(l.pendingSub.course)} substitution ${exceptionButton({ type:'substitute', target:l.id, course:l.pendingSub.course })}</span></div>`);
  else if(l.pendingComplete) rows.push(`<div class="audit-course audit-course--todo"><span class="audit-course-icon">⏳</span><span>Pending advisor exception: not needed because of the ${escapeHtml(l.pendingComplete.course)} substitution ${exceptionButton({ type:'waive', target:l.id, credits:null, note:l.pendingComplete.completeNote })}</span></div>`);
  if(l.pendingWaiver) rows.push(`<div class="audit-course audit-course--todo"><span class="audit-course-icon">⏳</span><span>${fmtCredits(l.pendingWaiver)} cr pending advisor exception ${exceptionButton({ type:'waive', target:isMirror?l.block:l.id, credits:l.pendingWaiver, note:'Fractional transfer credit (quarter-to-semester conversion)' })}</span></div>`);
  if(l.status==='missing') rows.push(`<div class="audit-course audit-course--missing"><span class="audit-course-icon">○</span><span>Still needed: ${escapeHtml(stillNeededText(l))}</span></div>`);
  return `<div class="audit-line audit-line--${l.status}">
    <div class="audit-line-head"><span class="audit-icon">${STATUS_ICON[l.status]}</span><span class="audit-line-label">${escapeHtml(l.label)}</span>${l.credits!=null?`<span class="audit-line-cr">${fmtCredits(l.forced?l.credits:Math.min(l.credits, l.done+l.planned+l.pendingCredits+l.waived+l.pendingWaiver))}/${fmtCredits(l.credits)}</span>`:''}</div>
    ${rows.join('')}
    ${l.note && l.status!=='met'?`<div class="audit-line-note">${escapeHtml(l.note)}</div>`:''}
  </div>`;
}

function auditBlockHtml(b) {
  const m=blockMeter(b);
  const open = auditOpen[b.key] ?? (b.status!=='met');
  let group='';
  const lines=b.lines.map(l=>{
    const head = l.group && l.group!==group ? `<div class="audit-group">${escapeHtml(l.group)}</div>` : '';
    group = l.group;
    return head + auditLineHtml(l);
  }).join('');
  const total = b.credits==null || MIRROR_LINE[b.key] ? '' : [
    ...b.waivers.map(w=>`<div class="audit-course audit-course--exception" data-exid="${escapeHtml(w.id)}"><span class="audit-course-icon">🖊</span><span>Area total: ${w.credits==null?'waived':`${fmtCredits(w.credits)} cr waived`}${w.note?` <span class="audit-course-meta">${escapeHtml(w.note)}</span>`:''}</span></div>`),
    b.pendingWaiver ? `<div class="audit-course audit-course--todo"><span class="audit-course-icon">⏳</span><span>Area total ends ${fmtCredits(b.pendingWaiver)} cr short — pending advisor exception ${exceptionButton({ type:'waive', target:b.key, credits:b.pendingWaiver, note:'Fractional transfer credit (quarter-to-semester conversion)' })}</span></div>` : '',
    b.creditStatus==='missing' ? `<div class="audit-course audit-course--missing"><span class="audit-course-icon">○</span><span>Area total needs ${fmtCredits(b.short)} more cr</span></div>` : '',
  ].join('');
  return `<details class="audit-block audit-block--${b.status}" data-block="${b.key}"${open?' open':''}>
    <summary>
      <span class="audit-icon">${STATUS_ICON[b.status]}</span>
      <span class="audit-block-name">${escapeHtml(b.name)}</span>
      <span class="audit-block-cr">${fmtCredits(m.done+m.planned+m.pending)}/${fmtCredits(m.required)} cr</span>
    </summary>
    <div class="audit-block-body">
      ${b.note?`<div class="audit-block-note">${escapeHtml(b.note)}</div>`:''}
      ${total?`<div class="audit-line audit-line--total">${total}</div>`:''}
      ${lines}
    </div>
  </details>`;
}

function notAppliedHtml() {
  const recs=state.record.terms.flatMap(t=>t.courses.map(c=>({ c, t })));
  return [['unused','Courses not used for this program'],['nocredit','Failed or withdrawn — no credit'],['notcounted','Not counted']].map(([st,label])=>{
    const items=recs.filter(x=>x.c.status===st);
    if(!items.length) return '';
    return `<div class="audit-na"><div class="audit-na-head">${RECORD_STATUS[st].icon} ${escapeHtml(label)} (${items.length})</div>
      <div class="past-chips">${items.map(({ c, t })=>`<button type="button" class="past-chip past-chip--${st}" data-rec="${escapeHtml(c.id)}" title="${escapeHtml(recordTooltip(c))}">${escapeHtml(c.code)} <b>${escapeHtml(c.grade||'—')}</b> <span class="past-chip-term">${escapeHtml(t.shortLabel)}</span></button>`).join('')}</div></div>`;
  }).join('');
}

function renderAuditPanel() {
  const list=resetList('audit');
  const a=state.audit, s=state.summary, rec=state.record;
  const rep=rec.reported;
  const gpaCheck = rep?.gsuGpa!=null && s.gsu.gpa!=null
    ? (rep.gsuGpa===s.gsu.gpa && rep.overallGpa===s.overall.gpa
        ? `<div class="audit-gpa-note">✓ GPA matches Degree Works (${escapeHtml(rep.auditDate)}). Term GPAs for transfer terms are approximate.</div>`
        : `<div class="audit-gpa-note audit-gpa-note--warn">Estimated GPA — Degree Works showed ${rep.gsuGpa.toFixed(2)} GSU / ${rep.overallGpa?.toFixed(2)} with transfer on ${escapeHtml(rep.auditDate)}.</div>`)
    : '';
  const checklist=advisorChecklist(a, rec, SEMESTERS, state.schedule);
  const bullet=items=>items.map(t=>`<li>${escapeHtml(t)}</li>`).join('');
  const box=document.createElement('div');
  box.className='audit-card';
  box.innerHTML=`
    <div class="audit-meta">${escapeHtml(DEGREE.program)} · catalog ${escapeHtml(DEGREE.catalogYear)}${rec.source?`<br>${escapeHtml(rec.source)}`:''}</div>
    ${state.recordStatus==='missing'?`<button type="button" class="audit-import-btn" data-act="import">📥 Import the academic record</button>`:''}
    ${state.recordStatus==='offline'?'<div class="audit-flag">📡 Firebase is unreachable, so completed courses and grades are not shown.</div>':''}
    <div class="audit-meters">${allMeters().map(meterHtml).join('')}</div>
    <div class="audit-stats">
      <div><b>${fmtCredits(a.total.done)}</b><span>credits applied</span></div>
      <div><b>+${fmtCredits(a.total.planned)}</b><span>planned</span></div>
      <div><b>${fmtGpa(s.gsu)}</b><span>GSU GPA</span></div>
      <div><b>${fmtGpa(s.overall)}</b><span>with transfer</span></div>
    </div>
    ${gpaCheck}
    <div class="audit-status audit-status--${a.status}">${escapeHtml(statusSentence(a))}</div>
    <div class="audit-actions">
      <button type="button" class="audit-edit-btn" data-act="record">📚 Record &amp; grades</button>
      <button type="button" class="audit-edit-btn audit-edit-btn--ex" data-act="exceptions">🖊 Exceptions (${rec.exceptions.length})</button>
    </div>
    <div class="audit-legend">✓ complete · 📅 planned · ⏳ needs advisor exception · ○ still needed</div>
    <div class="audit-blocks">${a.blocks.map(auditBlockHtml).join('')}</div>
    <div class="audit-total-row audit-line--${a.total.status}"><span class="audit-icon">${STATUS_ICON[a.total.status]}</span><b>Total credits</b><span>${fmtCredits(a.total.done)} applied + ${fmtCredits(a.total.planned)} planned of ${a.total.required}</span></div>
    ${rec.terms.length?`<div class="lib-subhead">Not applied to a requirement</div>${notAppliedHtml()}`:''}
    ${a.dHours>12?`<div class="audit-flag">⚠ ${fmtCredits(a.dHours)} hours of D grades apply — GSU allows at most 12.</div>`:''}
    ${a.rpeGpa.gpa!=null&&a.rpeGpa.gpa<2?`<div class="audit-flag">⚠ Required Program Electives – CSC needs a C average (currently ${fmtGpa(a.rpeGpa)}).</div>`:''}
    <div class="lib-subhead">⚠ Confirm with your advisor</div>
    <ol class="audit-checklist">${checklist.map(i=>`<li class="${i.done?'is-done':''}">${i.done?'✓ ':''}${escapeHtml(i.text)}</li>`).join('')}</ol>
    <div class="lib-subhead">Rules to remember</div>
    <ul class="audit-bullets">${bullet(DEGREE_RULES)}</ul>
    <div class="lib-subhead">Notes</div>
    <ul class="audit-bullets">${bullet(PLANNER_NOTES)}</ul>`;
  box.querySelectorAll('details.audit-block').forEach(d=>d.addEventListener('toggle',()=>{ auditOpen[d.dataset.block]=d.open; }));
  box.querySelectorAll('[data-ex]').forEach(b=>b.addEventListener('click',e=>{ e.preventDefault(); openExceptionEditor({ prefill:JSON.parse(b.dataset.ex) }); }));
  box.querySelectorAll('[data-exid]').forEach(el=>el.addEventListener('click',()=>openExceptionEditor({ editId:el.dataset.exid })));
  box.querySelectorAll('[data-rec]').forEach(el=>el.addEventListener('click',()=>openRecordEditor({ recordId:el.dataset.rec })));
  box.querySelectorAll('[data-course]').forEach(el=>el.addEventListener('click',()=>openModal(el.dataset.course, scheduledIn(el.dataset.course))));
  box.querySelector('[data-act="record"]').addEventListener('click',()=>openRecordEditor());
  box.querySelector('[data-act="exceptions"]').addEventListener('click',()=>openExceptionEditor());
  box.querySelector('[data-act="import"]')?.addEventListener('click',()=>openRecordEditor({ importNow:true }));
  list.appendChild(box);
  const badge = state.recordStatus==='missing' ? 'import record'
    : a.status==='incomplete' ? `${a.missing} still needed` : a.status==='pending' ? `⏳ ${a.pending.length} exception${a.pending.length>1?'s':''}` : a.status==='planned' ? '✓ plan complete' : '🎓 complete';
  setBadge('audit', badge, 'Degree Works requirements covered by completed and planned courses');
}

/* ─── Course library sections ────────────────────────────────────────────── */
function meterBadge(key) {
  const b=state.audit.blockByKey[key];
  const m=blockMeter(b);
  return `${fmtCredits(m.done+m.planned+m.pending)}/${fmtCredits(m.required)}`;
}

function renderCoreSection() {
  const list=resetList('core');
  const lab=state.audit.lineById['core.labseq'];
  list.appendChild(makeSubhead('IMPACTS Core · Lab Science Sequence', lab.note));
  COURSES.filter(c=>c.tag==='labseq').forEach(c=>list.appendChild(makeLibCard(c)));
  const fos=state.audit.blockByKey.fos;
  const left=round2(Math.max(0, fos.credits-fos.done-fos.planned-fos.pendingCredits));
  list.appendChild(makeSubhead(`Field of Study · pick from this list${left?` (${fmtCredits(left)} cr to 18)`:''}`, FOS_NOTE));
  COURSES.filter(c=>c.tag==='fos').forEach(c=>list.appendChild(makeLibCard(c)));
  setBadge('core', `${meterBadge('core')} · ${meterBadge('fos')}`, 'IMPACTS Core (42) · Field of Study (18): completed + planned credits');
}

function renderMajorSection() {
  const list=resetList('major');
  const majors=COURSES.filter(c=>c.section==='major');
  majors.filter(c=>c.tag==='req').forEach(c=>list.appendChild(makeLibCard(c)));
  list.appendChild(makeSubhead('Pick one: Operating Systems or Programming Language Concepts'));
  majors.filter(c=>c.tag==='osplc').forEach(c=>list.appendChild(makeLibCard(c)));
  list.appendChild(makeSubhead('Capstone: CSC 4350 in one term (advisor exception), or CSC 4351 (Fall) → CSC 4352 (Spring)'));
  majors.filter(c=>c.tag==='capstone').sort((a,b)=>(b.id==='CSC4350')-(a.id==='CSC4350')).forEach(c=>list.appendChild(makeLibCard(c)));
  const lines=state.audit.lines.filter(l=>l.block==='major' && l.id!=='major.elec');
  const covered=lines.filter(l=>l.status!=='missing').length;
  setBadge('major', `${meterBadge('major')} · ${covered}/${lines.length}`, 'Major (48 cr incl. CSC electives) · required lines covered');
}

function renderElectiveSection() {
  const list=resetList('elective');
  const byCode=(a,b)=>a.code.localeCompare(b.code);
  const line=state.audit.lineById['major.elec'];
  list.appendChild(makeSubhead('Any CSC 3000/4000 course', 'Choose 16 credits (usually 4 courses). A second OS/PLC course also counts here. Letters show which terms each course ran in 2024–2026.'));
  COURSES.filter(c=>c.section==='elective'&&c.tag!=='rare').sort(byCode).forEach(c=>list.appendChild(makeLibCard(c)));
  list.appendChild(makeSubhead('📭 In the catalog, not offered Spring 2024 – Fall 2026', 'New or dormant courses — check PAWS before counting on them.'));
  COURSES.filter(c=>c.tag==='rare').sort(byCode).forEach(c=>list.appendChild(makeLibCard(c)));
  setBadge('elective', `${fmtCredits(line.done+line.planned+line.pendingCredits)}/16 cr`, '3000/4000 level CSC electives: completed + planned credits');
}

function renderRpeSection() {
  const list=resetList('rpe');
  const b=state.audit.blockByKey.rpe;
  const left=round2(Math.max(0, b.credits-b.done-b.planned-b.pendingCredits-b.waived));
  list.appendChild(makeSubhead(left ? `${fmtCredits(left)} more credits · any subject, 2000–4000 level` : 'Required Program Electives – CSC covered ✓', RPE_NOTE));
  COURSES.filter(c=>c.section==='rpe').forEach(c=>list.appendChild(makeLibCard(c)));
  setBadge('rpe', `${meterBadge('rpe')} cr`, 'Required Program Electives – CSC (12 cr, any subject at the 2000–4000 level)');
}
