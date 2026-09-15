/* ═══════════════════════════════════════════════════════════════════════════
   Bee's GSU Grad Planner — modal.js
   Course detail modal: earlier attempts on the record, quick add, prerequisites,
   offering history, and the meeting-block (schedule) editor.
   ═══════════════════════════════════════════════════════════════════════════ */

const SECTION_ROLE = { major:'Major requirement', core:'IMPACTS Core', fos:'Field of Study', elective:'Major — CSC elective (3000/4000)', rpe:'Required Program Electives – CSC (2000–4000)' };

/* ─── Prerequisite chips ─────────────────────────────────────────────────── */
function lastPassingAttempt(id) {
  return attemptsFor(id).filter(a=>earnsCredit(a.rec) && gradeMeets(a.rec.grade, minGradeFor(a.rec.code))).pop() || null;
}

// Where is a prerequisite: passed on the record, planned, or still needed?
function prereqLocation(prereqId) {
  if(isCourseDone(prereqId)) {
    const a=lastPassingAttempt(prereqId);
    return { cls:'prereq-chip--done', icon:'✓', detail: a ? ` · ${a.rec.grade||'done'} ${a.term.shortLabel}` : ' · completed' };
  }
  const sid=scheduledIn(prereqId);
  if(sid) return { cls:'prereq-chip--placed', icon:'📅', detail:` · ${semById(sid).shortLabel}` };
  const failed=failedAttempts(prereqId);
  if(failed.length) return { cls:'prereq-chip--missing', icon:'⚠', detail:` · ${failed[failed.length-1].rec.grade||'not passed'}, retake` };
  if(!findCourse(prereqId)) return { cls:'prereq-chip--alt', icon:'', detail:'' };
  return { cls:'prereq-chip--missing', icon:'⚠', detail:' · not scheduled' };
}

function prereqChip(id) {
  const loc=prereqLocation(id);
  return `<span class="prereq-chip ${loc.cls}">${loc.icon} ${escapeHtml(courseCode(id))}${loc.detail}</span>`;
}

function prereqCondHtml(cond) {
  if(Array.isArray(cond)) return `<span class="prereq-or-group">${cond.map(prereqChip).join('<span class="prereq-or-sep">or</span>')}</span>`;
  return prereqChip(cond);
}

function renderOffering(course) {
  const el=document.getElementById('modalOffered');
  el.innerHTML=SEASONS.map(season=>{
    const cells=OFFERING_TERMS.map((t,i)=>t.season!==season?'':
      `<span class="offer-cell${course.offered[i]?' offer-cell--yes':''}" title="${SEASON_META[season].label} ${t.year}: ${course.offered[i]} section(s)">${t.year}</span>`).join('');
    return `<div class="offer-row"><span class="offer-season">${SEASON_META[season].emoji} ${SEASON_META[season].label}</span>${cells}<span class="offer-text">${escapeHtml(offeringInfo(course,season).text)}</span></div>`;
  }).join('') + `<div class="offer-foot">From GSU class schedules (${escapeHtml(DEGREE.offeringsWindow)}) — past offerings, not a promise. Check PAWS each term.</div>`;
}

function roleText(course) {
  if(isCourseDone(course.id)) {
    const a=lastPassingAttempt(course.id);
    return `✓ Completed${a?` · ${a.rec.grade||''} · ${a.term.label}`:''}`;
  }
  const role=state.audit.roles[course.id];
  if(role?.block) return `Counts toward: ${role.blockName} · ${role.label}${role.pending?' (needs advisor exception)':''}`;
  if(role) return 'Extra credit — counts toward the 120 total only';
  return `Library: ${SECTION_ROLE[course.section]}`;
}

/* ─── Modal ──────────────────────────────────────────────────────────────── */
function openModal(courseId, semId) {
  const course=findCourse(courseId);
  if(!course) return;
  const done=isCourseDone(courseId);
  state.modal={courseId,semId:done?null:semId||null,dirty:false};

  const codeEl=document.getElementById('modalCode');
  codeEl.textContent=course.code;
  codeEl.className=`modal-code modal-code--${done?'done':isRequiredSection(course)?'req':'elec'}`;
  document.getElementById('modalTitle').textContent=course.title;
  document.getElementById('modalCredits').textContent=`${course.credits} credit hours`;
  document.getElementById('modalType').textContent=course.kind;
  document.getElementById('modalRole').textContent=roleText(course);
  document.getElementById('modalDescription').textContent=course.description;

  document.getElementById('modalPrereqs').innerHTML=course.prereq.length ? course.prereq.map(prereqCondHtml).join('') : '<span class="prereq-chip prereq-chip--done">✓ No course prerequisites</span>';
  document.getElementById('modalPrereqText').textContent=`Catalog: ${course.prereqText}`;
  const note=document.getElementById('modalNote');
  note.textContent=[course.note, course.section==='rpe'?RPE_NOTE:'', course.section==='fos'?FOS_NOTE:''].filter(Boolean).join(' ');
  note.classList.toggle('hidden', !note.textContent);
  renderApproval(course);

  renderAttempts(courseId);
  document.getElementById('quickAddSection').classList.toggle('hidden', done);
  renderOffering(course);
  if(!done) renderQuickAdd(courseId);
  renderBlockEditor(courseId, state.modal.semId);

  document.getElementById('modalBackdrop').classList.add('open');
}

// Advisor exception still needed for this course (e.g. CSC 4350 as the capstone).
function renderApproval(course) {
  const sub=SUBSTITUTIONS.find(s=>codeToId(s.course)===course.id);
  const box=document.getElementById('modalApproval');
  const line=sub && state.audit.lineById[sub.line];
  let text='';
  if(sub && line?.substitutions.length) text=`✓ Advisor substitution recorded: ${sub.label}.`;
  else if(sub) text=`🖊 ${sub.label} needs an advisor exception in Degree Works: “${sub.applyNote}” on ${LINE_BY_ID[sub.line].label}, and “${sub.completeNote}” on ${sub.complete.map(id=>LINE_BY_ID[id].label).join(', ')}. Ask for it before registering.`;
  box.textContent=text;
  box.classList.toggle('hidden', !text);
}

function renderAttempts(courseId) {
  const list=attemptsFor(courseId);
  document.getElementById('historySection').classList.toggle('hidden', !list.length);
  const box=document.getElementById('modalAttempts');
  box.innerHTML=list.map(({ rec, term })=>`
    <button type="button" class="attempt attempt--${rec.status}" data-id="${escapeHtml(rec.id)}" title="Edit in the academic record">
      <span class="past-status">${RECORD_STATUS[rec.status].icon}</span>
      <b>${escapeHtml(rec.code)}</b>
      <span>${escapeHtml(term.label)}</span>
      <span class="past-grade">${escapeHtml(rec.grade||'—')}</span>
      <span class="attempt-status">${escapeHtml(RECORD_STATUS[rec.status].short)}${rec.transfer?' · transfer':''}</span>
    </button>`).join('');
  box.querySelectorAll('[data-id]').forEach(b=>b.addEventListener('click',()=>{ closeModal(); openRecordEditor({ recordId:b.dataset.id }); }));
}

function renderQuickAdd(courseId) {
  const row=document.getElementById('quickAdd');
  const c=findCourse(courseId);
  row.innerHTML=SEMESTERS.map(b=>{
    const inThis=state.schedule[b.id].some(e=>e.courseId===courseId);
    const over=!inThis&&semesterCredits(b.id)+c.credits>b.maxCredits;
    const unmetHere=(!inThis&&!over)?getUnmetPrereqs(courseId,b.id):[];
    const notOffered=!inThis&&!over&&offeringInfo(c, b.season).level==='none';
    const hasWarn=unmetHere.length>0||notOffered;
    const tips=[];
    if(over) tips.push(`Would exceed ${b.maxCredits} credits`);
    if(unmetHere.length) tips.push(`Needs first: ${unmetHere.map(conditionLabel).join(', ')}`);
    if(notOffered) tips.push(offeringInfo(c, b.season).text);
    return `<button class="qa-btn${inThis?' qa-btn--active':''}${hasWarn?' qa-btn--warn':''}" data-sem="${b.id}" ${over?'disabled':''} ${tips.length?`title="${escapeHtml(tips.join(' · '))}"`:''}>${inThis?`✓ ${b.label}`:hasWarn?`⚠ ${b.label}`:`+ ${b.label}`}</button>`;
  }).join('');
  row.querySelectorAll('.qa-btn').forEach(btn=>{
    btn.addEventListener('click',()=>{
      const sid=btn.dataset.sem;
      const sem=semById(sid);
      const inThis=state.schedule[sid].some(e=>e.courseId===courseId);
      if(inThis){
        removeCourse(courseId,sid);
        if(state.modal.semId === sid) state.modal.semId = scheduledIn(courseId);
        toast(`Removed from ${sem.label}.`,'info');
      } else {
        const ok=addCourse(courseId,sid);
        if(ok) {
          state.modal.semId = sid;
          toast(`Added to ${sem.label}! 🐝`,'success');
        }
      }
      render();
      renderQuickAdd(courseId);
      renderBlockEditor(courseId,state.modal.semId);
      document.getElementById('modalRole').textContent=roleText(c);
      renderApproval(c);
    });
  });
}

function closeModal() {
  if(state.modal.dirty) {
    if(!confirm('You have unsaved schedule changes. Discard them?')) return;
  }
  document.getElementById('modalBackdrop').classList.remove('open');
  state.modal={courseId:null,semId:null,dirty:false};

  if(deferredPlan) {
    const shouldRender = applyRemotePlan(deferredPlan);
    if(shouldRender) render();
  }
}

function initModal() {
  document.getElementById('modalBackdrop').addEventListener('click',e=>{
    if(e.target===document.getElementById('modalBackdrop')) closeModal();
  });
  document.getElementById('modalClose').addEventListener('click',closeModal);
  document.addEventListener('keydown',e=>{ if(e.key==='Escape' && document.getElementById('modalBackdrop').classList.contains('open')) closeModal(); });
}

/* ─── Block editor ───────────────────────────────────────────────────────── */
function renderBlockEditor(courseId, semId) {
  const inSem=scheduledIn(courseId);
  const activeSem=semId||inSem;
  const editorSection=document.getElementById('blockEditorSection');
  const hint=document.getElementById('blockEditorHint');
  const addBtn=document.getElementById('addBlockBtn');
  const saveRow=document.getElementById('blockSaveRow');
  const saveStatus=document.getElementById('saveStatus');

  if(!activeSem || !isValidSemId(activeSem) || isCourseDone(courseId)) {
    editorSection.classList.add('hidden');
    state.modal.semId = null;
    return;
  }
  editorSection.classList.remove('hidden');
  state.modal.semId = activeSem;
  hint.textContent=`for ${semById(activeSem)?.label||''}`;

  const blocks=getBlocks(courseId,activeSem);
  const req=isRequiredSection(findCourse(courseId));

  const list=document.getElementById('blocksList');
  list.innerHTML='';
  blocks.forEach(block=>list.appendChild(makeBlockCard(block,req)));

  saveRow.classList.remove('hidden');
  saveStatus.textContent='';

  addBtn.onclick=()=>{
    const newBlock=makeBlock();
    blocks.push(newBlock);
    list.appendChild(makeBlockCard(newBlock,req));
    state.modal.dirty=true;
    saveRow.classList.remove('hidden');
  };

  document.getElementById('saveBlocksBtn').onclick=async()=>{
    const collected=collectBlocks(list);
    updateBlocks(courseId,activeSem,collected);
    state.modal.dirty=false;
    saveStatus.textContent='✓ Saved!';
    render();
    setTimeout(()=>{ saveStatus.textContent=''; },2000);
    toast('Meeting times saved! 🐝','success');
  };
}

function makeBlockCard(block, req) {
  const card=document.createElement('div');
  card.className=`block-card${req?'':' block-card--elec'}`;
  card.dataset.blockId=block.id;

  const typeOpts=BLOCK_TYPES.map(t=>`<option${t===block.type?' selected':''}>${t}</option>`).join('');
  const dayBtns=DAY_ORDER.map(d=>`<button type="button" class="day-toggle-btn${block.days?.includes(d)?' active':''}" data-day="${d}">${DAY_LABELS[d]}</button>`).join('');

  card.innerHTML=`
    <div class="block-card-header">
      <select class="block-type-select">${typeOpts}</select>
      <button type="button" class="block-delete-btn" title="Remove block">🗑</button>
    </div>
    <div class="block-days-row">
      <span class="block-days-label">Days</span>
      <div class="day-toggles-wrap">${dayBtns}</div>
    </div>
    <div class="block-time-row">
      <div class="block-time-field">
        <label>Start</label>
        <input type="time" class="block-time-input block-start" value="${escapeHtml(block.startTime||'09:00')}">
      </div>
      <span class="time-dash">–</span>
      <div class="block-time-field">
        <label>End</label>
        <input type="time" class="block-time-input block-end" value="${escapeHtml(block.endTime||'10:00')}">
      </div>
    </div>
    <div class="block-optional-grid">
      <div class="block-optional-field">
        <label>Location</label>
        <input type="text" class="block-text-input block-location" placeholder="e.g. Petit Science 135" value="${escapeHtml(block.location||'')}">
      </div>
      <div class="block-optional-field">
        <label>Instructor</label>
        <input type="text" class="block-text-input block-instructor" placeholder="e.g. Dr. Smith" value="${escapeHtml(block.instructor||'')}">
      </div>
      <div class="block-optional-field">
        <label>CRN</label>
        <input type="text" class="block-text-input block-crn" placeholder="e.g. 85286" value="${escapeHtml(block.crn||'')}">
      </div>
    </div>`;

  card.querySelectorAll('.day-toggle-btn').forEach(btn=>{
    btn.addEventListener('click',()=>{ btn.classList.toggle('active'); state.modal.dirty=true; });
  });
  card.querySelector('.block-delete-btn').addEventListener('click',()=>{ card.remove(); state.modal.dirty=true; });
  card.querySelectorAll('input,select').forEach(el=>el.addEventListener('input',()=>{ state.modal.dirty=true; }));
  return card;
}

function collectBlocks(listEl) {
  const blocks=[];
  listEl.querySelectorAll('.block-card').forEach(card=>{
    const days=[...card.querySelectorAll('.day-toggle-btn.active')].map(b=>b.dataset.day);
    blocks.push({
      id: card.dataset.blockId||genId(),
      type: card.querySelector('.block-type-select').value,
      days,
      startTime: card.querySelector('.block-start').value,
      endTime:   card.querySelector('.block-end').value,
      location:  card.querySelector('.block-location').value.trim(),
      instructor:card.querySelector('.block-instructor').value.trim(),
      crn:       card.querySelector('.block-crn').value.trim(),
    });
  });
  return blocks;
}
