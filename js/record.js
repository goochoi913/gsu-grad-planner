/* ═══════════════════════════════════════════════════════════════════════════
   Bee's GSU Grad Planner — record.js
   Academic record editor (fix grades, credits and statuses, add a course to any
   past term, import / back up the record), final-grade entry that locks a term
   into the history, and the advisor-exception editor.
   ═══════════════════════════════════════════════════════════════════════════ */

function byId(id) { return document.getElementById(id); }
function recordWritable() {
  if(['ready','missing'].includes(state.recordStatus)) return true;
  toast(state.recordStatus==='loading' ? 'The academic record is still loading — try again in a moment.' : '📡 Firebase is unreachable, so the record can’t be changed right now.','warn');
  return false;
}
function bindBackdrop(backdropId, closeId, close) {
  const backdrop=byId(backdropId);
  backdrop.addEventListener('click',e=>{ if(e.target===backdrop) close(); });
  byId(closeId).addEventListener('click',close);
  document.addEventListener('keydown',e=>{ if(e.key==='Escape' && backdrop.classList.contains('open')) close(); });
}

/* ─── Academic record editor ─────────────────────────────────────────────── */
let recEditingId = null;
let recStatusTouched = false;

function initRecordEditor() {
  bindBackdrop('recordBackdrop','recordClose',closeRecordEditor);
  byId('recGrade').innerHTML=`<option value="">— no grade —</option>`+GRADE_OPTIONS.map(g=>`<option value="${g}">${g}</option>`).join('');
  byId('recStatus').innerHTML=Object.entries(RECORD_STATUS).map(([k,v])=>`<option value="${k}">${v.icon} ${escapeHtml(v.label)}</option>`).join('');
  byId('recLine').innerHTML=`<option value="auto">Automatic — the requirement it fits best</option><option value="elective">Elective credit only (counts toward 120)</option>`
    + BLOCKS.filter(b=>!b.shared).map(b=>`<optgroup label="${escapeHtml(b.name)}">${REQUIREMENT_LINES.filter(l=>l.block===b.key).map(l=>`<option value="${l.id}">${escapeHtml(l.label)}</option>`).join('')}</optgroup>`).join('');
  byId('recordForm').addEventListener('submit',e=>{ e.preventDefault(); submitRecordForm(); });
  byId('recCancel').addEventListener('click',resetRecordForm);
  byId('recDelete').addEventListener('click',()=>{
    const found=recEditingId && findRecordCourse(recEditingId);
    if(found && confirm(`Delete ${found.rec.code} (${found.term.label}) from the record?`)) { deleteRecordCourse(recEditingId); resetRecordForm(); }
  });
  byId('recordAddBtn').addEventListener('click',()=>{ if(!recordWritable()) return; resetRecordForm(); showRecordForm(true); byId('recCode').focus(); });
  byId('recGrade').addEventListener('change',syncStatusFromGrade);
  byId('recCode').addEventListener('input',syncFromCode);
  byId('recStatus').addEventListener('change',()=>{ recStatusTouched=true; syncLineField(); });
  byId('recTransfer').addEventListener('change',()=>byId('recSchoolWrap').classList.toggle('hidden', !byId('recTransfer').checked));
  byId('recordExportBtn').addEventListener('click',exportRecord);
  byId('recordImportBtn').addEventListener('click',()=>{ if(recordWritable()) byId('recordImportFile').click(); });
  byId('recordImportFile').addEventListener('change',onImportFile);
}

function openRecordEditor(opts={}) {
  if(!recordWritable()) return;
  resetRecordForm();
  byId('recordImportPreview').classList.add('hidden');
  renderRecordEditor();
  byId('recordBackdrop').classList.add('open');
  if(opts.recordId && findRecordCourse(opts.recordId)) startEditingRecord(opts.recordId);
  else if(opts.add) {
    showRecordForm(true);
    if(opts.termId) byId('recTerm').value=opts.termId;
    byId('recCode').focus();
  }
  if(opts.importNow) byId('recordImportFile').click();
}

function closeRecordEditor() {
  byId('recordBackdrop').classList.remove('open');
  resetRecordForm();
}

function termOptionsHtml() {
  const onRecord=new Set(state.record.terms.map(t=>t.id));
  const others=[];
  for(let k=planStartKey()-1; k>=termKey('fall',2015); k--) { const t=makeTerm(k); if(!onRecord.has(t.id)) others.push(t); }
  return `<optgroup label="Terms on the record">${[...state.record.terms].reverse().map(t=>`<option value="${t.id}">${escapeHtml(t.label)}</option>`).join('')}</optgroup>`
    + `<optgroup label="Another past term">${others.map(t=>`<option value="${t.id}">${escapeHtml(t.label)}</option>`).join('')}</optgroup>`;
}

function renderRecordEditor() {
  const s=state.summary, rec=state.record;
  byId('recordSummary').textContent = rec.terms.length
    ? `${rec.terms.length} terms · ${s.courseCount} courses · ${fmtCredits(s.earned)} cr earned · GSU GPA ${fmtGpa(s.gsu)} · with transfer ${fmtGpa(s.overall)}`
    : 'No record yet — import the record file';
  byId('recordLegend').innerHTML=Object.entries(RECORD_STATUS).map(([k,v])=>`<span class="legend-item legend-item--${k}">${v.icon} ${escapeHtml(v.label)}</span>`).join('');
  const current=byId('recTerm').value;
  byId('recTerm').innerHTML=termOptionsHtml();
  if(current) byId('recTerm').value=current;
  byId('recordList').innerHTML=[...rec.terms].reverse().map(t=>{
    const info=s.byTerm[t.id];
    const gpa=info.termGpa.gpa==null?'':` · ${info.transferOnly?'≈':''}${fmtGpa(info.termGpa)} GPA`;
    return `<div class="editor-term"><span>${t.emoji} ${escapeHtml(t.label)}${info.school?` · ⇄ ${escapeHtml(info.school)}`:''}</span><span>${fmtCredits(info.earned)} cr${gpa}</span></div>
      ${t.courses.map(c=>`
        <div class="editor-item editor-item--${c.status}${c.id===recEditingId?' editor-item--editing':''}">
          <div class="editor-item-main">
            <span class="editor-item-code">${RECORD_STATUS[c.status].icon} ${escapeHtml(c.code)} · ${escapeHtml(c.grade||'—')}${c.transfer?'<span class="done-tag">transfer</span>':''}</span>
            <span class="editor-item-title">${escapeHtml(c.title)}</span>
            <span class="editor-item-meta">${fmtCredits(c.credits)} cr · ${escapeHtml(recordWhere(c))}${c.gpa?'':' · not in GPA'}</span>
          </div>
          <div class="editor-item-actions">
            <button type="button" class="editor-btn" data-edit="${escapeHtml(c.id)}">Edit</button>
            <button type="button" class="editor-btn editor-btn--danger" data-del="${escapeHtml(c.id)}">Delete</button>
          </div>
        </div>`).join('')}`;
  }).join('') || '<div class="editor-empty">Nothing on the record yet. Use 📥 Import file with the record file, or add courses one at a time.</div>';
  byId('recordList').querySelectorAll('[data-edit]').forEach(b=>b.addEventListener('click',()=>startEditingRecord(b.dataset.edit)));
  byId('recordList').querySelectorAll('[data-del]').forEach(b=>b.addEventListener('click',()=>{
    const found=findRecordCourse(b.dataset.del);
    if(found && confirm(`Delete ${found.rec.code} (${found.term.label}) from the record?`)) { if(recEditingId===found.rec.id) resetRecordForm(); deleteRecordCourse(found.rec.id); }
  }));
}

function showRecordForm(show) {
  byId('recordForm').classList.toggle('hidden', !show);
  byId('recordAddBtn').classList.toggle('hidden', show);
}

function resetRecordForm() {
  recEditingId=null;
  recStatusTouched=false;
  byId('recordForm').reset();
  byId('recordFormTitle').textContent='Add a course to a past term';
  byId('recHint').textContent='';
  byId('recDelete').classList.add('hidden');
  byId('recStatus').value='counted';
  byId('recLine').value='auto';
  byId('recGpa').checked=true;
  byId('recSchoolWrap').classList.add('hidden');
  syncLineField();
  showRecordForm(false);
  byId('recordList')?.querySelectorAll('.editor-item--editing').forEach(el=>el.classList.remove('editor-item--editing'));
}

function startEditingRecord(id) {
  const found=findRecordCourse(id);
  if(!found) return;
  const { rec, term }=found;
  resetRecordForm();
  recEditingId=id;
  recStatusTouched=true;
  byId('recordFormTitle').textContent=`Edit ${rec.code} · ${term.label}`;
  byId('recTerm').value=term.id;
  byId('recCode').value=rec.code;
  byId('recTitle').value=rec.title;
  byId('recCredits').value=rec.credits;
  byId('recGrade').value=rec.grade;
  byId('recStatus').value=rec.status;
  byId('recLine').value=rec.line||'auto';
  byId('recGpa').checked=rec.gpa;
  byId('recTransfer').checked=rec.transfer;
  byId('recSchool').value=rec.school;
  byId('recNote').value=rec.note;
  byId('recSchoolWrap').classList.toggle('hidden', !rec.transfer);
  byId('recDelete').classList.remove('hidden');
  byId('recHint').textContent=[rec.equiv?`Satisfied by: ${rec.equiv}.`:'', rec.note].filter(Boolean).join(' ');
  syncLineField();
  showRecordForm(true);
  renderRecordEditor();
  byId('recordForm').scrollIntoView({ block:'nearest' });
}

function syncLineField() { byId('recLine').disabled = byId('recStatus').value!=='counted'; }

// A new grade suggests the status (a D in a CSC or MATH course won't count) and GPA use.
function syncStatusFromGrade() {
  const code=cleanCode(byId('recCode').value) || byId('recCode').value;
  const grade=byId('recGrade').value;
  const status=statusForGrade(code, grade);
  byId('recGpa').checked = grade in GRADE_POINTS;
  if(!recStatusTouched || !(recEditingId && findRecordCourse(recEditingId)?.rec.status==='unused')) byId('recStatus').value=status;
  const min=minGradeFor(code);
  byId('recHint').textContent = status==='notcounted' && grade && !['I','IP'].includes(grade)
    ? `${grade} is below the ${min} this course needs, so it won't count toward the degree or unlock later courses.`
    : status==='nocredit' ? `${grade} earns no credit.` : '';
  syncLineField();
}

function syncFromCode() {
  if(recEditingId) return;
  const code=cleanCode(byId('recCode').value);
  const courseId=code && catalogIdForCode(code);
  if(!courseId) { byId('recHint').textContent=''; return; }
  const course=findCourse(courseId);
  const part=course.parts.find(p=>codeToId(p.code)===codeToId(code));
  if(!byId('recTitle').value) byId('recTitle').value = part && course.parts.indexOf(part)>0 ? `${course.title.replace(/ \+ Lab$/,'')} Lab` : course.title.replace(/ \+ Lab$/,'');
  if(!byId('recCredits').value) byId('recCredits').value = part ? part.credits : course.credits;
  byId('recHint').textContent=`Matches ${course.code} in the library.`;
}

function submitRecordForm() {
  if(!recordWritable()) return;
  const code=cleanCode(byId('recCode').value);
  const credits=Number(byId('recCredits').value);
  const termId=byId('recTerm').value;
  if(!code) { toast('Enter a course code like MATH 2641.','warn'); return; }
  if(!termById(termId)) { toast('Pick the term the course was taken.','warn'); return; }
  if(!(credits>=0 && credits<=20)) { toast('Credits must be between 0 and 20.','warn'); return; }
  const status=byId('recStatus').value;
  const fields={
    code, title:byId('recTitle').value.trim()||code, credits:round2(credits), grade:byId('recGrade').value, status,
    line: status==='counted' ? byId('recLine').value : '', gpa:byId('recGpa').checked,
    transfer:byId('recTransfer').checked, school:byId('recTransfer').checked?byId('recSchool').value.trim():'', equiv:recEditingId?findRecordCourse(recEditingId)?.rec.equiv||'':'',
    note:byId('recNote').value.trim(),
  };
  const dup=state.record.terms.find(t=>t.id===termId)?.courses.find(c=>c.id!==recEditingId && codeToId(c.code)===codeToId(code));
  if(dup && !confirm(`${termById(termId).label} already has ${dup.code}. Add it again?`)) return;
  saveRecordCourse(termId, fields, recEditingId);
  resetRecordForm();
}

function exportRecord() {
  const blob=new Blob([JSON.stringify(recordForSave(state.record), null, 2)], { type:'application/json' });
  const a=document.createElement('a');
  a.href=URL.createObjectURL(blob);
  a.download=`academic-record-backup-${new Date().toISOString().slice(0,10)}.json`;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(()=>URL.revokeObjectURL(a.href), 1000);
}

function onImportFile(e) {
  const file=e.target.files?.[0];
  e.target.value='';
  if(!file) return;
  const reader=new FileReader();
  reader.onload=()=>{
    let parsed=null;
    try { parsed=JSON.parse(reader.result); } catch(_) {}
    const rec=parsed && normalizeRecord(parsed);
    const box=byId('recordImportPreview');
    if(!rec || !rec.terms.length) {
      box.innerHTML='⚠ That file has no terms and courses in the record format.';
      box.classList.remove('hidden');
      return;
    }
    const sum=summarizeRecord(rec);
    const current=state.record.terms.length;
    const keepEx=!rec.exceptions.length && state.record.exceptions.length;
    box.innerHTML=`<b>📥 ${escapeHtml(file.name)}</b>: ${rec.terms.length} terms (${escapeHtml(rec.terms[0].label)} – ${escapeHtml(rec.terms[rec.terms.length-1].label)}), ${sum.courseCount} courses, ${fmtCredits(sum.earned)} cr earned, GSU GPA ${fmtGpa(sum.gsu)} · with transfer ${fmtGpa(sum.overall)}.
      ${current?`<div class="import-warn">This replaces the ${current} terms on the record now.${keepEx?` The ${state.record.exceptions.length} recorded exception(s) are kept.`:''}</div>`:''}
      <div class="block-save-row"><button type="button" class="save-blocks-btn" id="importConfirm">${current?'Replace the record':'Import'}</button><button type="button" class="editor-btn" id="importCancel">Cancel</button></div>`;
    box.classList.remove('hidden');
    byId('importCancel').onclick=()=>box.classList.add('hidden');
    byId('importConfirm').onclick=async()=>{
      box.classList.add('hidden');
      const data=recordForSave(rec);
      if(keepEx) data.exceptions=recordForSave(state.record).exceptions;
      state.expandedTerms=null;
      await importRecord(data);
      timelineScrolled=false;
      renderSemesters();
    };
  };
  reader.readAsText(file);
}

/* ─── Enter final grades (finish a term) ─────────────────────────────────── */
let gradesSemId = null;
let gradeRows = [];   // { courseId, code, title, credits, grade, extra }

function initGradeEntry() {
  bindBackdrop('gradesBackdrop','gradesClose',closeGradeEntry);
  byId('gradesCancel').addEventListener('click',closeGradeEntry);
  byId('gradesAddRow').addEventListener('click',()=>{ gradeRows.push({ courseId:null, code:'', title:'', credits:3, grade:'', extra:true }); renderGradeRows(); });
  byId('gradesSubmit').addEventListener('click',submitGrades);
}

function openGradeEntry(semId) {
  const sem=semById(semId);
  if(!sem || sem.id!==SEMESTERS[0].id || !recordWritable()) return;
  gradesSemId=semId;
  gradeRows=[];
  for(const e of state.schedule[semId]) {
    const c=findCourse(e.courseId);
    const base=c.title.replace(/ \+ Lab$/,'');
    if(c.parts.length) c.parts.forEach((p,i)=>gradeRows.push({ courseId:c.id, code:p.code, title:i?`${base} Lab`:base, credits:p.credits, grade:'' }));
    else gradeRows.push({ courseId:c.id, code:c.code, title:c.title, credits:c.credits, grade:'' });
  }
  byId('gradesTitle').textContent=`Enter final grades — ${sem.label}`;
  byId('gradesSubmit').textContent=`🔒 Finish ${sem.label}`;
  byId('gradesSubmit').disabled=false;
  byId('gradesAddRow').classList.remove('hidden');
  renderGradeRows();
  byId('gradesBackdrop').classList.add('open');
}

function closeGradeEntry() {
  byId('gradesBackdrop').classList.remove('open');
  gradesSemId=null;
}

function gradeVerdict(row) {
  if(!row.grade) return { cls:'todo', text:'Choose a grade' };
  if(row.grade==='__drop') return { cls:'drop', text:'Not taken — back to the library' };
  const code=cleanCode(row.code);
  if(!code) return { cls:'todo', text:'Enter a course code' };
  const status=statusForGrade(code, row.grade);
  if(status==='counted') return { cls:'counted', text:'✓ Counts' };
  if(status==='nocredit') return { cls:'nocredit', text:`✕ ${row.grade==='W'?'Withdrawn':'Failed'} — no credit` };
  return { cls:'notcounted', text:['I','IP'].includes(row.grade) ? '⊘ Not counted until the grade posts' : `⊘ Below ${minGradeFor(code)} — won't count` };
}

function renderGradeRows() {
  const sem=semById(gradesSemId);
  const options=`<option value="">Grade…</option>${GRADE_OPTIONS.map(g=>`<option value="${g}">${g}</option>`).join('')}<option value="__drop">Not taken</option>`;
  byId('gradesList').innerHTML=gradeRows.map((r,i)=>`
    <div class="grade-row" data-idx="${i}">
      ${r.extra
        ? `<div class="grade-row-main grade-row-main--extra">
             <input type="text" class="grade-code" maxlength="16" placeholder="Code" value="${escapeHtml(r.code)}">
             <input type="text" class="grade-title" maxlength="80" placeholder="Title" value="${escapeHtml(r.title)}">
             <input type="number" class="grade-credits" min="0" max="20" step="0.5" value="${r.credits}">
           </div>`
        : `<div class="grade-row-main"><b>${escapeHtml(r.code)}</b><span>${escapeHtml(r.title)}</span><span class="grade-row-cr">${fmtCredits(r.credits)} cr</span></div>`}
      <select class="grade-select">${options}</select>
      <span class="grade-verdict"></span>
      ${r.extra?'<button type="button" class="sem-card-remove grade-row-remove" title="Remove">×</button>':''}
    </div>`).join('') || `<div class="editor-empty">No courses are planned for ${escapeHtml(sem?.label||'this term')}. Add the courses that were taken.</div>`;
  byId('gradesList').querySelectorAll('.grade-row').forEach(el=>{
    const r=gradeRows[+el.dataset.idx];
    el.querySelector('.grade-select').value=r.grade;
    el.querySelector('.grade-select').addEventListener('change',e=>{ r.grade=e.target.value; updateGradesResult(); });
    el.querySelector('.grade-code')?.addEventListener('input',e=>{ r.code=e.target.value; updateGradesResult(); });
    el.querySelector('.grade-title')?.addEventListener('input',e=>{ r.title=e.target.value; });
    el.querySelector('.grade-credits')?.addEventListener('input',e=>{ r.credits=Number(e.target.value); });
    el.querySelector('.grade-row-remove')?.addEventListener('click',()=>{ gradeRows.splice(+el.dataset.idx,1); renderGradeRows(); });
  });
  updateGradesResult();
}

// Preview: which grades count, and which later planned courses would lose a prerequisite.
function updateGradesResult() {
  byId('gradesList').querySelectorAll('.grade-row').forEach(el=>{
    const v=gradeVerdict(gradeRows[+el.dataset.idx]);
    const out=el.querySelector('.grade-verdict');
    out.textContent=v.text;
    out.className=`grade-verdict grade-verdict--${v.cls}`;
  });
  const sem=semById(gradesSemId);
  const taken=gradeRows.filter(r=>r.grade && r.grade!=='__drop' && cleanCode(r.code));
  const ready=gradeRows.every(r=>r.grade && (r.grade==='__drop' || cleanCode(r.code)));
  const preview=normalizeRecord({ ...recordForSave(state.record), terms:[...recordForSave(state.record).terms, { id:gradesSemId, courses:taken.map(r=>({ code:r.code, title:r.title, credits:r.credits, grade:r.grade })) }] });
  indexRecord(preview);
  const later=SEMESTERS.slice(1).flatMap(s=>state.schedule[s.id].map(e=>({ id:e.courseId, sem:s })));
  const isAvail=(s)=>id=>isCourseDone(id) || SEMESTERS.slice(1, SEMESTERS.indexOf(s)).some(p=>state.schedule[p.id].some(e=>e.courseId===id));
  const blocked=later.map(x=>({ ...x, unmet:unmetConditions(x.id, isAvail(x.sem)) })).filter(x=>x.unmet.length);
  indexRecord(state.record);
  const counted=taken.filter(r=>statusForGrade(cleanCode(r.code), r.grade)==='counted').length;
  byId('gradesSummary').textContent=`${counted} of ${gradeRows.length} course${gradeRows.length===1?'':'s'} counting so far`;
  byId('gradesResult').innerHTML = !ready
    ? `<div class="grades-note">Pick a grade (or “Not taken”) for every course to finish ${escapeHtml(sem?.label||'the term')}.</div>`
    : blocked.length
      ? `<div class="grades-warn">⚠ With these grades, planned courses would be missing a prerequisite:<ul>${blocked.map(b=>`<li><b>${escapeHtml(courseCode(b.id))}</b> (${escapeHtml(b.sem.label)}) needs ${escapeHtml(b.unmet.map(conditionLabel).join(' and '))}</li>`).join('')}</ul>Plan a retake before those courses, or move them later.</div>`
      : `<div class="grades-ok">✓ Every later planned course keeps its prerequisites.</div>`;
  byId('gradesSubmit').disabled=!ready || !gradeRows.length;
}

async function submitGrades() {
  const sem=semById(gradesSemId);
  if(!sem || !recordWritable()) return;
  const rows=gradeRows.filter(r=>r.grade && r.grade!=='__drop').map(r=>({ code:cleanCode(r.code), title:r.title.trim()||cleanCode(r.code), credits:round2(Number(r.credits)||0), grade:r.grade }));
  if(rows.some(r=>!r.code)) { toast('Every added course needs a code like CSC 4222.','warn'); return; }
  if(!confirm(`Finish ${sem.label}?\nIts courses and grades move into the locked history, and planning continues from the next term.`)) return;
  byId('gradesSubmit').disabled=true;
  const result=await finishTerm(sem.id, rows);
  if(!result) return;
  const replace=result.term.courses.filter(c=>c.status==='counted' && attemptsFor(catalogIdForCode(c.code)||codeToId(c.code)).some(a=>a.term.key<sem.key && ['F','WF'].includes(a.rec.grade) && a.rec.gpa));
  byId('gradesAddRow').classList.add('hidden');
  byId('gradesList').innerHTML='';
  byId('gradesSummary').textContent=`${sem.label} is now a past term`;
  byId('gradesResult').innerHTML=`
    <div class="grades-ok">🔒 ${escapeHtml(sem.label)} moved into the history: ${result.term.courses.filter(c=>c.status==='counted').length} counted, ${result.term.courses.filter(c=>c.status!=='counted').length} not counted.</div>
    ${result.blocked.length?`<div class="grades-warn">⚠ These planned courses are now missing a prerequisite:<ul>${result.blocked.map(b=>`<li><b>${escapeHtml(courseCode(b.courseId))}</b> (${escapeHtml(b.sem.label)}) needs ${escapeHtml(b.unmet.map(conditionLabel).join(' and '))}</li>`).join('')}</ul></div>`:''}
    ${replace.length?`<div class="grades-note">↻ Ask the Registrar for Repeat to Replace on ${escapeHtml(replace.map(c=>c.code).join(' and '))}. Once approved, open 📚 Record and untick “Counts in GPA” on the earlier F.</div>`:''}`;
  byId('gradesSubmit').textContent='Done';
  byId('gradesSubmit').disabled=true;
  toast(`🔒 ${sem.label} is now part of the academic history.`,'success');
}

/* ─── Advisor exceptions ─────────────────────────────────────────────────── */
let exEditingId = null;

function initExceptionEditor() {
  bindBackdrop('exceptionBackdrop','exceptionClose',closeExceptionEditor);
  byId('exTarget').innerHTML=BLOCKS.map(b=>`<optgroup label="${escapeHtml(b.name)}">`
    + (b.credits!=null?`<option value="${b.key}" data-area="1">${escapeHtml(b.name)} — area total (${b.credits} cr)</option>`:'')
    + REQUIREMENT_LINES.filter(l=>l.block===b.key).map(l=>`<option value="${l.id}">${escapeHtml(l.label)}</option>`).join('')
    + '</optgroup>').join('');
  ['exType','exTarget','exWhole'].forEach(id=>byId(id).addEventListener('change',syncExceptionForm));
  byId('exceptionForm').addEventListener('submit',e=>{ e.preventDefault(); submitException(); });
  byId('exCancel').addEventListener('click',closeExceptionEditor);
  byId('exDelete').addEventListener('click',()=>{
    if(exEditingId && confirm('Remove this exception? The requirement goes back to its normal status.')) { removeException(exEditingId); resetExceptionForm(); }
  });
}

function openExceptionEditor(opts={}) {
  if(!recordWritable()) return;
  resetExceptionForm();
  if(opts.editId) startEditingException(opts.editId);
  else if(opts.prefill) applyExceptionPrefill(opts.prefill);
  renderExceptionList();
  byId('exceptionBackdrop').classList.add('open');
}

function closeExceptionEditor() {
  byId('exceptionBackdrop').classList.remove('open');
  resetExceptionForm();
}

function resetExceptionForm() {
  exEditingId=null;
  byId('exceptionForm').reset();
  byId('exType').value='waive';
  byId('exTarget').value='advice.calc';
  byId('exceptionTitle').textContent='Record an exception';
  byId('exDelete').classList.add('hidden');
  syncExceptionForm();
}

function applyExceptionPrefill(p) {
  byId('exType').value=p.type;
  byId('exTarget').value=p.target;
  byId('exCourse').value=p.course||'';
  byId('exWhole').checked=p.type==='waive' && p.credits==null;
  byId('exCredits').value=p.credits ?? '';
  byId('exNote').value=p.note || (p.type==='substitute' ? (SUBSTITUTIONS.find(s=>s.line===p.target)?.applyNote||'') : '');
  byId('exceptionTitle').textContent=`Record: ${targetLabel(p.target)}`;
  syncExceptionForm();
}

function startEditingException(id) {
  const x=state.record.exceptions.find(e=>e.id===id);
  if(!x) return;
  applyExceptionPrefill(x);
  exEditingId=id;
  byId('exceptionTitle').textContent=`Edit: ${targetLabel(x.target)}`;
  byId('exDelete').classList.remove('hidden');
  byId('exPairWrap').classList.add('hidden');
}

function syncExceptionForm() {
  const type=byId('exType').value;
  const sub=type==='substitute';
  byId('exTarget').querySelectorAll('option[data-area]').forEach(o=>{ o.disabled=sub; });
  if(sub && BLOCK_BY_KEY[byId('exTarget').value]) byId('exTarget').value=MIRROR_LINE[byId('exTarget').value] || REQUIREMENT_LINES.find(l=>l.block===byId('exTarget').value).id;
  byId('exCourseWrap').classList.toggle('hidden', !sub);
  byId('exCreditsWrap').classList.toggle('hidden', sub || byId('exWhole').checked);
  byId('exWholeWrap').classList.toggle('hidden', sub);
  const rule=sub && SUBSTITUTIONS.find(s=>s.line===byId('exTarget').value);
  const pairOpen=rule && rule.complete.some(id=>!state.record.exceptions.some(x=>x.type==='waive' && x.target===id));
  byId('exPairWrap').classList.toggle('hidden', !pairOpen || !!exEditingId);
  if(rule) byId('exPairLabel').textContent=`Also record “${rule.completeNote}” on ${rule.complete.map(id=>LINE_BY_ID[id].label).join(', ')}`;
  const codes=new Set([...state.record.terms.flatMap(t=>t.courses.map(c=>c.code)), ...SEMESTERS.flatMap(s=>state.schedule[s.id].map(e=>courseCode(e.courseId)))]);
  byId('exCourseOptions').innerHTML=[...codes].sort().map(c=>`<option value="${escapeHtml(c)}"></option>`).join('');
  const line=state.audit?.lineById[byId('exTarget').value];
  byId('exHint').textContent = sub
    ? 'The course fills this line like Degree Works “Apply Here”.'
    : line ? `${line.label} needs ${line.credits!=null?`${line.credits} cr`:`${line.count} course`}; a waiver counts as met right away.` : 'Lowers the credits this area needs.';
}

function submitException() {
  if(!recordWritable()) return;
  const type=byId('exType').value, target=byId('exTarget').value;
  const course=cleanCode(byId('exCourse').value);
  const whole=byId('exWhole').checked;
  const credits=Number(byId('exCredits').value);
  if(type==='substitute' && !course) { toast('Enter the course that substitutes, like CSC 4350.','warn'); return; }
  if(type==='substitute' && !LINE_BY_ID[target]) { toast('A substitution goes on a requirement line.','warn'); return; }
  if(type==='waive' && !whole && !(credits>0 && credits<=20)) { toast('Enter the credits waived (for example 0.67) or tick “Whole requirement”.','warn'); return; }
  const fields={ type, target, course:type==='substitute'?course:'', credits:type==='waive'&&!whole?round2(credits):null, note:byId('exNote').value.trim() };
  const rule=type==='substitute' && SUBSTITUTIONS.find(s=>s.line===target);
  const pair=!exEditingId && rule && !byId('exPairWrap').classList.contains('hidden') && byId('exPair').checked;
  if(exEditingId) saveException(fields, exEditingId);
  else commitRecord(d=>{
    d.exceptions.push({ ...fields, id:genId('x-') });
    if(pair) rule.complete.forEach(id=>d.exceptions.push({ id:genId('x-'), type:'waive', target:id, course:'', credits:null, note:rule.completeNote }));
  }, `🖊 Exception recorded: ${targetLabel(target)}${pair?' (+ Senior Design II not needed)':''}.`);
  resetExceptionForm();
}

function renderExceptionList() {
  const list=state.record.exceptions;
  const pending=state.audit?.pending || [];
  const pendingHtml=pending.map(p=>{
    const prefill = p.kind==='substitute' ? { type:'substitute', target:p.target, course:p.course }
      : p.kind==='complete' ? { type:'waive', target:p.target, credits:null, note:p.rule.completeNote }
      : { type:'waive', target:p.target, credits:p.credits, note:'Fractional transfer credit (quarter-to-semester conversion)' };
    const text = p.kind==='substitute' ? `${p.course} substitution` : p.kind==='complete' ? 'Course not needed because of substitution' : `${fmtCredits(p.credits)} cr waiver`;
    return `<div class="editor-item editor-item--pending"><div class="editor-item-main"><span class="editor-item-code">⏳ Pending</span><span class="editor-item-title">${escapeHtml(targetLabel(p.target))}</span><span class="editor-item-meta">${escapeHtml(text)}</span></div>
      <div class="editor-item-actions"><button type="button" class="editor-btn" data-prefill="${escapeHtml(JSON.stringify(prefill))}">Fill in</button></div></div>`;
  }).join('');
  byId('exceptionList').innerHTML = (list.map(x=>`
    <div class="editor-item editor-item--exception${x.id===exEditingId?' editor-item--editing':''}">
      <div class="editor-item-main">
        <span class="editor-item-code">🖊 ${x.type==='substitute'?`Substitution · ${escapeHtml(x.course)}`:x.credits==null?'Not needed (force complete)':`${fmtCredits(x.credits)} cr waived`}</span>
        <span class="editor-item-title">${escapeHtml(targetLabel(x.target))}</span>
        ${x.note?`<span class="editor-item-meta">${escapeHtml(x.note)}</span>`:''}
      </div>
      <div class="editor-item-actions">
        <button type="button" class="editor-btn" data-edit="${escapeHtml(x.id)}">Edit</button>
        <button type="button" class="editor-btn editor-btn--danger" data-del="${escapeHtml(x.id)}">Remove</button>
      </div>
    </div>`).join('') || '<div class="editor-empty">None recorded yet.</div>')
    + (pendingHtml?`<div class="editor-term"><span>Still pending in the plan</span><span>${pending.length}</span></div>${pendingHtml}`:'');
  byId('exceptionList').querySelectorAll('[data-edit]').forEach(b=>b.addEventListener('click',()=>{ startEditingException(b.dataset.edit); renderExceptionList(); }));
  byId('exceptionList').querySelectorAll('[data-del]').forEach(b=>b.addEventListener('click',()=>{ if(confirm('Remove this exception?')) { if(exEditingId===b.dataset.del) resetExceptionForm(); removeException(b.dataset.del); } }));
  byId('exceptionList').querySelectorAll('[data-prefill]').forEach(b=>b.addEventListener('click',()=>{ resetExceptionForm(); applyExceptionPrefill(JSON.parse(b.dataset.prefill)); byId('exceptionForm').scrollIntoView({ block:'nearest' }); }));
}
