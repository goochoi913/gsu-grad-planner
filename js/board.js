/* ═══════════════════════════════════════════════════════════════════════════
   Bee's GSU Grad Planner — board.js
   Academic timeline: locked past-term columns (grades, statuses, collapsible)
   followed by upcoming term columns, drag & drop, conflict badges, add/remove terms.
   ═══════════════════════════════════════════════════════════════════════════ */

function renderSemesters() {
  ensureColumns();
  state.record.terms.forEach(renderPastCol);
  SEMESTERS.forEach(sem=>renderSemCol(sem));
  scrollTimelineOnce();
}

// Rebuilds the columns only when the list of terms (or the record's load state) changes.
function ensureColumns() {
  const grid=document.getElementById('semestersGrid');
  const notice=state.recordStatus==='ready' ? '' : state.recordStatus;
  const wanted=[notice, ...state.record.terms.map(t=>`past:${t.id}`), ...SEMESTERS.map(s=>s.id)].join('|');
  if(grid.dataset.cols!==wanted) {
    grid.dataset.cols=wanted;
    grid.innerHTML='';
    if(notice) grid.appendChild(makeRecordNotice(notice));
    state.record.terms.forEach(t=>grid.appendChild(makePastColumn(t)));
    SEMESTERS.forEach(sem=>grid.appendChild(makeSemColumn(sem)));
    grid.appendChild(makeAddColumn());
  }
  const next=makeTerm(SEMESTERS[SEMESTERS.length-1].key+1);
  document.getElementById('col-add').classList.toggle('hidden', SEMESTERS.length>=MAX_SEMESTER_COUNT);
  document.getElementById('addSemLabel').textContent=`Add ${next.label}`;
}

// On wide screens, open the timeline at the last past term and the upcoming terms.
let timelineScrolled=false;
function scrollTimelineOnce() {
  if(timelineScrolled || state.recordStatus!=='ready' || window.matchMedia('(max-width: 900px)').matches) return;
  const grid=document.getElementById('semestersGrid');
  const first=document.getElementById(`col-${SEMESTERS[0].id}`);
  if(!first || !state.record.terms.length) return;
  timelineScrolled=true;
  requestAnimationFrame(()=>{
    const offset=first.getBoundingClientRect().left-grid.getBoundingClientRect().left+grid.scrollLeft;
    grid.scrollLeft=Math.max(0, offset-280);
  });
}

function addDropTarget(el, semId) {
  el.addEventListener('dragover',e=>{ e.preventDefault(); e.dataTransfer.dropEffect='move'; el.classList.add('drag-over'); });
  el.addEventListener('dragleave',e=>{ if(!el.contains(e.relatedTarget)) el.classList.remove('drag-over'); });
  el.addEventListener('drop',e=>{
    e.preventDefault(); el.classList.remove('drag-over');
    if(!state.drag) return;
    const sem=semById(semId);
    const ok=addCourse(state.drag.courseId,semId);
    if(ok){ const c=findCourse(state.drag.courseId); render(); toast(`Added ${c?.title} to ${sem.label}! 🐝`,'success'); }
    state.drag=null;
  });
}

// Past terms refuse drops.
function addLockedTarget(el, term) {
  el.addEventListener('dragover',e=>{ if(!state.drag) return; e.preventDefault(); e.dataTransfer.dropEffect='none'; el.classList.add('drag-locked'); });
  el.addEventListener('dragleave',e=>{ if(!el.contains(e.relatedTarget)) el.classList.remove('drag-locked'); });
  el.addEventListener('drop',e=>{
    e.preventDefault(); el.classList.remove('drag-locked');
    if(state.drag) toast(`🔒 ${term.label} is a past term. Use 📚 Record to fix a grade or add a course.`,'warn');
    state.drag=null;
  });
}

/* ─── Record notice (no record yet / loading / offline) ──────────────────── */
function makeRecordNotice(status) {
  const col=document.createElement('div');
  col.className='sem-col sem-col--notice';
  col.id='col-record-notice';
  col.innerHTML = status==='missing'
    ? `<div class="record-notice"><div class="drop-icon">📥</div><b>No academic record yet</b><span>Import past terms and grades from the record file. They are stored only in Firebase.</span><button type="button" class="save-blocks-btn">📥 Import record</button></div>`
    : status==='offline'
      ? `<div class="record-notice"><div class="drop-icon">📡</div><b>Past terms unavailable</b><span>Couldn't reach Firebase, so grades and past terms can't load. Upcoming terms show this browser's copy.</span></div>`
      : `<div class="record-notice"><div class="drop-icon notice-bee">🐝</div><span>Loading past terms…</span></div>`;
  col.querySelector('button')?.addEventListener('click',()=>openRecordEditor({ importNow:true }));
  return col;
}

/* ─── Past-term columns ──────────────────────────────────────────────────── */
function makePastColumn(term) {
  const col=document.createElement('div');
  col.className='sem-col sem-col--past';
  col.id=`col-${term.id}`;
  col.innerHTML=`
    <div class="sem-col-header sem-col-header--past sem-col-header--${term.season}">
      <div class="sem-col-title">
        <button type="button" class="past-toggle" title="Show or hide this term's courses"><span class="past-caret"></span><span class="past-label">${term.emoji} ${escapeHtml(term.label)}</span></button>
        <span class="sem-col-actions">
          <span class="past-lock" title="Past term — locked. Fix grades or add courses in the record.">🔒</span>
          <button type="button" class="past-add-btn" title="Add a course to ${escapeHtml(term.label)}">＋</button>
        </span>
      </div>
      <div class="past-stats"></div>
    </div>
    <div class="past-body"></div>`;
  col.querySelector('.past-toggle').addEventListener('click',()=>toggleTermExpanded(term.id));
  col.querySelector('.past-add-btn').addEventListener('click',e=>{ e.stopPropagation(); openRecordEditor({ termId:term.id, add:true }); });
  addLockedTarget(col, term);
  return col;
}

function renderPastCol(term) {
  const col=document.getElementById(`col-${term.id}`);
  const info=state.summary.byTerm[term.id];
  if(!col || !info) return;
  const open=isTermExpanded(term.id);
  col.classList.toggle('sem-col--collapsed', !open);
  col.querySelector('.past-caret').textContent=open?'▾':'▸';
  const gpa=info.termGpa.gpa==null ? '' : info.transferOnly
    ? `<span class="past-gpa" title="Transfer grades as converted by GSU — approximate">≈${fmtGpa(info.termGpa)} GPA</span>`
    : `<span class="past-gpa" title="Term GPA">${fmtGpa(info.termGpa)} GPA</span>`;
  // Cumulative GPA after this term: GSU GPA, or GSU + transfer for transfer terms.
  const cum=!open ? '' : info.transferOnly
    ? (info.cumOverall.gpa==null ? '' : `<span class="past-cum" title="Cumulative GPA with transfer credit after this term — approximate">cum. ≈${fmtGpa(info.cumOverall)} with transfer</span>`)
    : (info.cumGsu.gpa==null ? '' : `<span class="past-cum" title="Cumulative GSU GPA after this term">cum. GSU ${fmtGpa(info.cumGsu)}</span>`);
  const transfer=info.school ? `<span class="past-transfer" title="Transfer credit from ${escapeHtml(info.school)}">⇄ ${escapeHtml(info.transferOnly?info.school:'incl. transfer')}</span>` : '';
  col.querySelector('.past-stats').innerHTML=`<span class="past-earned"><b>${fmtCredits(info.earned)}</b> cr earned</span>${gpa}${cum}${transfer}`;
  const body=col.querySelector('.past-body');
  body.innerHTML = open
    ? term.courses.map(pastRowHtml).join('') + (term.note?`<div class="past-note">ⓘ ${escapeHtml(term.note)}</div>`:'')
    : `<div class="past-chips">${term.courses.map(c=>`<button type="button" class="past-chip past-chip--${c.status}" data-id="${escapeHtml(c.id)}" title="${escapeHtml(recordTooltip(c))}"><span class="past-chip-icon">${RECORD_STATUS[c.status].icon}</span>${escapeHtml(c.code)} <b>${escapeHtml(c.grade||'—')}</b></button>`).join('')}</div>`;
  body.querySelectorAll('[data-id]').forEach(b=>b.addEventListener('click',()=>openRecordEditor({ recordId:b.dataset.id })));
}

function recordWhere(c) {
  if(c.status!=='counted') return RECORD_STATUS[c.status].label;
  const role=state.audit.roles[c.id];
  if(!role) return RECORD_STATUS.counted.label;
  return role.lineId==='elective' ? 'Elective credit (120 total)' : `${role.blockName} · ${role.label}`;
}

function pastRowHtml(c) {
  const credits=earnsCredit(c) || !c.credits ? `${fmtCredits(earnsCredit(c)?c.credits:0)} cr` : `0 cr <span class="past-cr-att">(${fmtCredits(c.credits)} attempted)</span>`;
  return `<button type="button" class="past-row past-row--${c.status}" data-id="${escapeHtml(c.id)}" title="${escapeHtml(recordTooltip(c))}">
    <span class="past-row-top">
      <span class="past-status">${RECORD_STATUS[c.status].icon}</span>
      <span class="past-code">${escapeHtml(c.code)}</span>
      ${c.transfer?'<span class="done-tag">transfer</span>':''}
      <span class="past-grade">${escapeHtml(c.grade||'—')}</span>
    </span>
    <span class="past-title">${escapeHtml(c.title)}</span>
    <span class="past-meta">${credits} · ${escapeHtml(recordWhere(c))}</span>
  </button>`;
}

function recordTooltip(c) {
  return [
    `${c.code} — ${c.title}`,
    `Grade ${c.grade||'—'}${c.transfer?` (transfer${c.school?`, ${c.school}`:''})`:''} · ${fmtCredits(c.credits)} cr`,
    `${RECORD_STATUS[c.status].label}${c.gpa?'':' · not in GPA'}`,
    c.equiv?`Satisfied by: ${c.equiv}`:'',
    c.note,
    'Click to edit',
  ].filter(Boolean).join('\n');
}

/* ─── Upcoming term columns ─────────────────────────────────────────────── */
function makeSemColumn(sem) {
  const col=document.createElement('div');
  col.className='sem-col';
  col.id=`col-${sem.id}`;
  col.innerHTML=`
    <div class="sem-col-header sem-col-header--${sem.season}">
      <div class="sem-col-title">
        <span>${sem.emoji} ${sem.label}</span>
        <span class="sem-col-actions">
          <button type="button" class="term-done-btn hidden" title="Enter final grades and lock this term into the history">🎓 Enter grades</button>
          <button type="button" class="sem-remove-btn hidden" title="Remove this empty semester">×</button>
        </span>
      </div>
      <div class="sem-credit-bar-wrap">
        <div class="sem-credit-bar"><div class="sem-credit-fill" id="bar-${sem.id}"></div></div>
        <span class="sem-credit-label" id="label-${sem.id}">0 / ${sem.maxCredits} cr</span>
      </div>
    </div>
    <div class="sem-drop-zone" id="zone-${sem.id}"></div>`;
  addDropTarget(col, sem.id);
  col.querySelector('.sem-remove-btn').addEventListener('click',e=>{ e.stopPropagation(); removeLastSemester(); });
  col.querySelector('.term-done-btn').addEventListener('click',e=>{ e.stopPropagation(); openGradeEntry(sem.id); });
  return col;
}

function makeAddColumn() {
  const col=document.createElement('div');
  col.className='sem-col sem-col--add';
  col.id='col-add';
  col.innerHTML=`<button type="button" class="add-sem-btn"><span class="add-sem-plus">＋</span><span id="addSemLabel"></span><span class="add-sem-hint">if you need more time</span></button>`;
  col.querySelector('button').addEventListener('click',addSemester);
  return col;
}

function renderSemCol(sem) {
  const zone=document.getElementById(`zone-${sem.id}`);
  if(!zone) return;
  zone.innerHTML='';
  const cr=semesterCredits(sem.id);
  const pct=Math.min(100,(cr/sem.maxCredits)*100);
  const bar=document.getElementById(`bar-${sem.id}`);
  const lbl=document.getElementById(`label-${sem.id}`);
  if(bar){ bar.style.width=`${pct}%`; bar.className='sem-credit-fill '+(cr>sem.maxCredits?'fill-over':pct>=80?'fill-warn':'fill-ok'); }
  if(lbl) lbl.textContent=`${fmtCredits(cr)} / ${sem.maxCredits} cr`;
  const entries=state.schedule[sem.id];
  const isLast=sem.id===SEMESTERS[SEMESTERS.length-1].id;
  const canGrade=sem.id===SEMESTERS[0].id && ['ready','missing'].includes(state.recordStatus);
  document.querySelector(`#col-${sem.id} .sem-remove-btn`)?.classList.toggle('hidden', !(isLast && !entries.length && SEMESTERS.length>1));
  document.querySelector(`#col-${sem.id} .term-done-btn`)?.classList.toggle('hidden', !canGrade);
  if(!entries.length){ zone.innerHTML=`<div class="drop-hint"><div class="drop-icon">🐝</div>Drop courses here</div>`; return; }
  const conflicts=detectConflicts(sem.id);
  entries.forEach(e=>{
    const c=findCourse(e.courseId);
    if(c) zone.appendChild(makeSemCard(c,sem,e.blocks||[],conflicts.has(e.courseId),getUnmetPrereqs(e.courseId,sem.id)));
  });
}

function makeSemCard(course,sem,blocks,hasConflict,unmetPrereqs) {
  const req=isRequiredSection(course);
  const role=state.audit.roles[course.id];
  const offer=offeringInfo(course, sem.season);
  const retake=failedAttempts(course.id);
  const card=document.createElement('div');
  card.className=`sem-card sem-card--${req?'req':'elec'}${unmetPrereqs?.length?' sem-card--prereq-warn':''}`;
  card.draggable=true;
  card.dataset.courseId=course.id;

  const timed=blocks.filter(b=>b.days?.length&&b.startTime);
  const first=timed[0];
  const prereqLabels=unmetPrereqs?.map(conditionLabel)||[];
  const sub=role?.pending ? SUBSTITUTIONS.find(s=>codeToId(s.course)===course.id) : null;

  card.innerHTML=`
    ${hasConflict?'<div class="conflict-badge">⚠️ conflict</div>':''}
    <div class="sem-card-body">
      <div class="sem-card-code">${escapeHtml(course.code)}${retake.length?`<span class="retake-tag" title="Earlier attempt${retake.length>1?'s':''}: ${escapeHtml(retake.map(a=>`${a.rec.grade||RECORD_STATUS[a.rec.status].short} (${a.term.label})`).join(', '))}">↻ retake</span>`:''}</div>
      <div class="sem-card-title">${escapeHtml(course.title)}</div>
      ${prereqLabels.length?`<div class="prereq-warn-strip">⚠ Take first: ${escapeHtml(prereqLabels.join(' · '))}</div>`:''}
      ${offer.level==='none'?`<div class="offer-warn-strip">📆 ${escapeHtml(offer.text)}</div>`:''}
      ${sub?`<div class="approval-strip" title="${escapeHtml(`${sub.label}. ${sub.applyNote} ${sub.completeNote}`)}">🖊 Needs advisor exception</div>`:''}
      ${first?`<div class="sem-block-summary">
        ${first.type!=='Lecture'?`<span style="font-size:.6rem;font-weight:800;color:var(--muted)">${escapeHtml(first.type)}</span>`:''}
        <span class="sem-block-time">${fmtDays(first.days)} · ${fmtTime(first.startTime)}–${fmtTime(first.endTime)}</span>
        ${first.location?`<span style="font-size:.62rem">${escapeHtml(first.location)}</span>`:''}
        ${timed.length>1?`<span style="font-size:.6rem;color:var(--muted)">+${timed.length-1} more block(s)</span>`:''}
      </div>`:`<div class="no-block-chip">📝 No schedule yet</div>`}
      <div class="sem-card-cr">${course.credits} cr · <span class="sem-card-role${role?.block?'':' sem-card-role--extra'}" title="${escapeHtml(role?`${role.blockName} · ${role.label}`:'')}">${escapeHtml(roleShort(role))}</span></div>
    </div>
    <button class="sem-card-remove" title="Remove">×</button>`;

  card.querySelector('.sem-card-remove').addEventListener('click',e=>{ e.stopPropagation(); removeCourse(course.id,sem.id); render(); toast(`Removed ${course.title}.`,'info'); });
  card.addEventListener('click',e=>{ if(e.target.classList.contains('sem-card-remove')) return; openModal(course.id,sem.id); });
  card.addEventListener('dragstart',e=>{ state.drag={courseId:course.id,fromSemester:sem.id}; e.dataTransfer.effectAllowed='move'; e.dataTransfer.setData('text/plain', course.id); card.classList.add('dragging'); });
  card.addEventListener('dragend',()=>card.classList.remove('dragging'));
  return card;
}

/* ─── Conflict detection (block-aware) ───────────────────────────────────── */
function detectConflicts(semId) {
  const conflicts=new Set();
  const entries=state.schedule[semId].filter(e=>e.blocks?.some(b=>b.days?.length&&b.startTime));
  for(let i=0;i<entries.length;i++) {
    for(let j=i+1;j<entries.length;j++) {
      if(blocksOverlap(entries[i].blocks,entries[j].blocks)) {
        conflicts.add(entries[i].courseId); conflicts.add(entries[j].courseId);
      }
    }
  }
  return conflicts;
}

function blocksOverlap(blocksA,blocksB) {
  for(const a of blocksA) {
    if(!a.days?.length||!a.startTime) continue;
    for(const b of blocksB) {
      if(!b.days?.length||!b.startTime) continue;
      if(!a.days.some(d=>b.days.includes(d))) continue;
      if(timeToMin(a.startTime)<timeToMin(b.endTime)&&timeToMin(b.startTime)<timeToMin(a.endTime)) return true;
    }
  }
  return false;
}

/* ─── Drag back to the library to remove ─────────────────────────────────── */
function initDropZones() {
  const sidebarContent=document.getElementById('sidebarContent');
  sidebarContent.addEventListener('dragover',e=>{ if(state.drag?.fromSemester){e.preventDefault();sidebarContent.classList.add('sidebar-drop-over');} });
  sidebarContent.addEventListener('dragleave',e=>{ if(!sidebarContent.contains(e.relatedTarget)) sidebarContent.classList.remove('sidebar-drop-over'); });
  sidebarContent.addEventListener('drop',e=>{
    e.preventDefault(); sidebarContent.classList.remove('sidebar-drop-over');
    if(state.drag?.fromSemester){ removeCourse(state.drag.courseId,state.drag.fromSemester); render(); toast('Removed from the plan.','info'); }
    state.drag=null;
  });
}
