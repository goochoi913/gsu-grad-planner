/* ═══════════════════════════════════════════════════════════════════════════
   Bee's GSU Grad Planner — app.js
   Schedule state per semester entry: { courseId, blocks: Block[] }
   Block: { id, type, days[], startTime, endTime, location, instructor, crn }
   ═══════════════════════════════════════════════════════════════════════════ */

/* ─── Helpers ────────────────────────────────────────────────────────────── */
function genId() { return `${Date.now()}-${Math.random().toString(36).slice(2,7)}`; }
function findCourse(id) { return COURSES.required.find(c=>c.id===id) || COURSES.elective.find(c=>c.id===id) || null; }
function isRequired(id) { return COURSES.required.some(c=>c.id===id); }
function timeToMin(t) { if(!t) return 0; const [h,m]=t.split(':').map(Number); return h*60+m; }
function fmtTime(t) {
  if(!t) return ''; const [h,m]=t.split(':').map(Number);
  return `${h%12||12}:${m.toString().padStart(2,'0')} ${h>=12?'PM':'AM'}`;
}
function fmtDays(days) { return days?.length ? days.join('') : ''; }
function isValidTime(t) { return typeof t === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(t); }
function asText(v) { return typeof v === 'string' ? v.trim() : ''; }
function emptySchedule() { return { fall2026:[], spring2027:[], summer2027:[] }; }
function isValidSemId(id) { return SEMESTERS.some(s=>s.id===id); }

function normalizeBlock(block, fallbackId) {
  const rawType = typeof block?.type === 'string' ? block.type : 'Lecture';
  const type = BLOCK_TYPES.includes(rawType) ? rawType : 'Other';
  return {
    id: typeof block?.id === 'string' && block.id ? block.id : fallbackId,
    type,
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
  return {
    courseId,
    blocks: rawBlocks.map((block, blockIdx)=>normalizeBlock(block, `${courseId}-${semId}-${idx}-${blockIdx}`)),
  };
}

function normalizeSchedule(rawSchedule) {
  const normalized = emptySchedule();
  for(const sem of SEMESTERS) {
    const rawEntries = Array.isArray(rawSchedule?.[sem.id]) ? rawSchedule[sem.id] : [];
    normalized[sem.id] = rawEntries
      .map((entry, idx)=>normalizeScheduleEntry(entry, sem.id, idx))
      .filter(Boolean);
  }
  return normalized;
}

function normalizePersistedState(raw) {
  const safe = raw && typeof raw === 'object' ? raw : {};
  return {
    schedule: normalizeSchedule(safe.schedule),
    sidebarCollapsed: !!safe.sidebarCollapsed,
    sectionsCollapsed: {
      required: !!safe.sectionsCollapsed?.required,
      elective: !!safe.sectionsCollapsed?.elective,
    },
    view: safe.view === 'calendar' ? 'calendar' : 'planner',
    calSemester: isValidSemId(safe.calSemester) ? safe.calSemester : SEMESTERS[0].id,
  };
}

function buildPersistedState() {
  return normalizePersistedState({
    schedule: state.schedule,
    sidebarCollapsed: state.sidebarCollapsed,
    sectionsCollapsed: state.sectionsCollapsed,
    view: state.view,
    calSemester: state.calSemester,
  });
}

/* ─── State ─────────────────────────────────────────────────────────────── */
const state = {
  schedule: emptySchedule(),
  view: 'planner',
  calSemester: 'fall2026',
  drag: null,
  sidebarCollapsed: false,
  sectionsCollapsed: { required:false, elective:false },
  modal: { courseId:null, semId:null, dirty:false },
  firebaseReady: false,
};

/* ─── Firebase sync ──────────────────────────────────────────────────────── */
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

let saveTimer = null;
let lastSyncedHash = '';
let hasInitialSnapshot = false;
let deferredRemoteState = null;

function saveState() {
  const payload = buildPersistedState();
  const payloadHash = JSON.stringify(payload);

  // Always keep an offline/local backup.
  localStorage.setItem('bee-grad-planner-v3', JSON.stringify(payload));

  if(!state.firebaseReady || !hasInitialSnapshot) return;
  if(payloadHash === lastSyncedHash) { setSyncStatus('online'); return; }

  setSyncStatus('saving');
  clearTimeout(saveTimer);
  saveTimer = setTimeout(async () => {
    const ok = await FirebaseService.save(payload);
    if(ok) {
      lastSyncedHash = payloadHash;
      setSyncStatus('online');
    } else {
      setSyncStatus('error');
    }
  }, 500);
}

function applyRemoteData(rawData) {
  const remoteState = normalizePersistedState(rawData);
  const modalOpen = document.getElementById('modalBackdrop')?.classList.contains('open');
  if(modalOpen && state.modal.dirty) {
    deferredRemoteState = remoteState;
    return false;
  }

  const localScheduleHash = JSON.stringify(normalizeSchedule(state.schedule));
  const remoteScheduleHash = JSON.stringify(remoteState.schedule);
  if(localScheduleHash === remoteScheduleHash) return false;

  deferredRemoteState = null;
  state.schedule = remoteState.schedule;
  return true;
}

async function initFirebase() {
  setSyncStatus('connecting');
  const ok = FirebaseService.init();
  if(!ok) { setSyncStatus('error'); return; }

  state.firebaseReady = true;

  FirebaseService.listen((remoteData, exists) => {
    hasInitialSnapshot = true;

    if(!exists || !remoteData) {
      setSyncStatus('online');
      saveState();
      return;
    }

    const normalizedRemote = normalizePersistedState(remoteData);
    const remoteHash = JSON.stringify(normalizedRemote);
    if(remoteHash === lastSyncedHash) { setSyncStatus('online'); return; }

    const changed = applyRemoteData(normalizedRemote);
    lastSyncedHash = remoteHash;
    if(changed) {
      render();
      if(state.modal.courseId && document.getElementById('modalBackdrop')?.classList.contains('open')) {
        renderQuickAdd(state.modal.courseId);
        renderBlockEditor(state.modal.courseId, state.modal.semId);
      }
    }
    setSyncStatus('online');
  }, () => setSyncStatus('error'));
}

/* ─── Local state (load from localStorage for initial view) ──────────────── */
function loadLocalState() {
  try {
    const raw = localStorage.getItem('bee-grad-planner-v3')
             || localStorage.getItem('bee-grad-planner-v2')
             || localStorage.getItem('gsu-grad-planner');
    if(!raw) return;
    const p = normalizePersistedState(JSON.parse(raw));
    state.schedule = p.schedule;
    state.sidebarCollapsed = p.sidebarCollapsed;
    state.sectionsCollapsed = p.sectionsCollapsed;
    state.view = p.view;
    state.calSemester = p.calSemester;
  } catch(_) {}
}

/* ─── Schedule mutations ─────────────────────────────────────────────────── */
function scheduledIn(courseId) {
  for(const sem of SEMESTERS) {
    if(state.schedule[sem.id].some(e=>e.courseId===courseId)) return sem.id;
  }
  return null;
}

function semesterCredits(semId) {
  return state.schedule[semId].reduce((s,{courseId})=>{
    const c=findCourse(courseId); return s+(c?c.credits:0);
  },0);
}

function addCourse(courseId, semId) {
  const sem = SEMESTERS.find(s=>s.id===semId);
  if(!sem) return false;
  if(state.schedule[semId].some(e=>e.courseId===courseId)) return false;
  const course = findCourse(courseId);
  if(!course) return false;
  if(semesterCredits(semId)+course.credits > sem.maxCredits) {
    toast(`⚠️ Adding ${course.credits} credits would exceed the 18-credit limit for ${sem.label}.`,'warn');
    return false;
  }
  let carriedBlocks = [];
  for(const s of SEMESTERS) {
    const existing = state.schedule[s.id].find(e=>e.courseId===courseId);
    if(existing?.blocks?.length) carriedBlocks = existing.blocks;
    state.schedule[s.id] = state.schedule[s.id].filter(e=>e.courseId!==courseId);
  }
  state.schedule[semId].push({ courseId, blocks: carriedBlocks });
  saveState(); return true;
}

function removeCourse(courseId, semId) {
  state.schedule[semId]=state.schedule[semId].filter(e=>e.courseId!==courseId);
  saveState();
}

function updateBlocks(courseId, semId, blocks) {
  const entry = state.schedule[semId]?.find(e=>e.courseId===courseId);
  if(entry) {
    entry.blocks = normalizeScheduleEntry({ courseId, blocks }, semId, 0)?.blocks || [];
  }
  saveState();
}

/* ─── Block form state helpers ───────────────────────────────────────────── */
function getBlocks(courseId, semId) {
  if(!semId) return [];
  return state.schedule[semId]?.find(e=>e.courseId===courseId)?.blocks || [];
}

function makeBlock(overrides={}) {
  return { id:genId(), type:'Lecture', days:[], startTime:'09:00', endTime:'10:00', location:'', instructor:'', crn:'', ...overrides };
}

/* ─── Progress / header ──────────────────────────────────────────────────── */
function calcProgress() {
  const all=Object.values(state.schedule).flat();
  let req=0,elec=0;
  all.forEach(({courseId})=>{ const c=findCourse(courseId); if(!c) return; if(isRequired(courseId)) req+=c.credits; else elec+=c.credits; });
  return {req,elec,total:req+elec};
}

function updateHeaderProgress() {
  const {req,elec,total}=calcProgress();
  const effElec=Math.min(elec,ELECTIVE_CREDITS), effTotal=req+effElec;
  setProgBar('req',req,REQUIRED_CREDITS,`${req}/${REQUIRED_CREDITS} cr`);
  setProgBar('elec',elec,ELECTIVE_CREDITS,`${elec}/${ELECTIVE_CREDITS} cr`);
  setProgBar('total',effTotal,TOTAL_MIN_CREDITS,`${total} total cr`);
  const banner = document.getElementById('graduationBanner');
  if (banner && effTotal >= TOTAL_MIN_CREDITS) {
    // Only trigger if the banner is currently hidden
    if (banner.classList.contains('hidden')) {
      banner.classList.remove('hidden');
      setTimeout(() => {
        banner.classList.add('hidden');
      }, 3000); // 3000ms = 3 seconds
    }
  } else if (banner) {
    // Ensure it stays hidden if credits drop below the limit
    banner.classList.add('hidden');
  }
}

function setProgBar(id,val,max,label) {
  const bar=document.getElementById(`${id}Bar`);
  const lbl=document.getElementById(`${id}BarLabel`);
  if(!bar) return;
  bar.style.width=`${Math.min(100,(val/max)*100)}%`;
  if(lbl) lbl.textContent=label;
}

/* ─── Toast ──────────────────────────────────────────────────────────────── */
function toast(msg,type='info') {
  const c=document.getElementById('toastContainer');
  const t=document.createElement('div');
  t.className=`toast toast-${type}`; t.textContent=msg;
  c.appendChild(t);
  requestAnimationFrame(()=>t.classList.add('toast-visible'));
  setTimeout(()=>{ t.classList.remove('toast-visible'); t.addEventListener('transitionend',()=>t.remove(),{once:true}); },3200);
}

/* ─── Render: Library ────────────────────────────────────────────────────── */
function renderLibrary() {
  renderLibSection('required',COURSES.required);
  renderLibSection('elective',COURSES.elective);
}

function renderLibSection(type,courses) {
  const list=document.getElementById(`${type}Courses`);
  list.innerHTML='';
  courses.forEach(c=>list.appendChild(makeLibCard(c)));
  const placed=courses.filter(c=>scheduledIn(c.id));
  const placedCr=placed.reduce((s,c)=>s+c.credits,0);
  const totalCr=courses.reduce((s,c)=>s+c.credits,0);
  const el=document.getElementById(`${type}Badge`);
  if(el) el.textContent=`${placedCr}/${totalCr} cr · ${placed.length}/${courses.length}`;
}

function makeLibCard(course) {
  const inSem=scheduledIn(course.id);
  const req=isRequired(course.id);
  const card=document.createElement('div');
  card.className=`lib-card lib-card--${req?'req':'elec'}${inSem?' lib-card--placed':''}`;
  card.dataset.courseId=course.id;
  card.draggable=!inSem;
  const semLabel=inSem ? SEMESTERS.find(s=>s.id===inSem)?.shortLabel||'' : '';
  card.innerHTML=`
    <div class="lib-card-code">${course.subject} ${course.number}</div>
    <div class="lib-card-title">${course.title}</div>
    <div class="lib-card-footer">
      <span class="lib-card-cr">${course.credits} cr</span>
      ${inSem?`<span class="lib-card-placed">📅 ${semLabel}</span>`:`<span class="lib-card-hint">drag to add</span>`}
    </div>`;
  card.addEventListener('click',()=>openModal(course.id,inSem||null));
  if(!inSem) {
    card.addEventListener('dragstart',e=>{
      state.drag={courseId:course.id,fromSemester:null};
      e.dataTransfer.effectAllowed='move';
      card.classList.add('dragging');
    });
    card.addEventListener('dragend',()=>card.classList.remove('dragging'));
  }
  return card;
}

/* ─── Render: Semesters ──────────────────────────────────────────────────── */
function renderSemesters() {
  SEMESTERS.forEach(sem=>renderSemCol(sem));
  updateHeaderProgress();
}

function renderSemCol(sem) {
  const zone=document.getElementById(`zone-${sem.id}`);
  zone.innerHTML='';
  const cr=semesterCredits(sem.id);
  const pct=Math.min(100,(cr/sem.maxCredits)*100);
  const bar=document.getElementById(`bar-${sem.id}`);
  const lbl=document.getElementById(`label-${sem.id}`);
  if(bar){ bar.style.width=`${pct}%`; bar.className='sem-credit-fill '+(pct>=100?'fill-over':pct>=80?'fill-warn':'fill-ok'); }
  if(lbl) lbl.textContent=`${cr} / ${sem.maxCredits} cr`;
  const entries=state.schedule[sem.id];
  if(!entries.length){ zone.innerHTML=`<div class="drop-hint"><div class="drop-icon">🐝</div>Drop courses here</div>`; return; }
  const conflicts=detectConflicts(sem.id);
  entries.forEach(e=>{ const c=findCourse(e.courseId); if(c) zone.appendChild(makeSemCard(c,sem.id,e.blocks||[],conflicts.has(e.courseId))); });
}

function makeSemCard(course,semId,blocks,hasConflict) {
  const req=isRequired(course.id);
  const card=document.createElement('div');
  card.className=`sem-card sem-card--${req?'req':'elec'}`;
  card.draggable=true;
  card.dataset.courseId=course.id;

  // First block for display
  const first=blocks.find(b=>b.days?.length&&b.startTime);
  const moreBlocks=blocks.filter(b=>b.days?.length&&b.startTime).length>1;

  card.innerHTML=`
    ${hasConflict?'<div class="conflict-badge">⚠️ conflict</div>':''}
    <div class="sem-card-body">
      <div class="sem-card-code">${course.subject} ${course.number}</div>
      <div class="sem-card-title">${course.title}</div>
      ${first?`<div class="sem-block-summary">
        ${first.type!=='Lecture'?`<span style="font-size:.6rem;font-weight:800;color:var(--muted)">${first.type}</span>`:''}
        <span class="sem-block-time">${fmtDays(first.days)} · ${fmtTime(first.startTime)}–${fmtTime(first.endTime)}</span>
        ${first.location?`<span style="font-size:.62rem">${first.location}</span>`:''}
        ${moreBlocks?`<span style="font-size:.6rem;color:var(--muted)">+${blocks.filter(b=>b.days?.length&&b.startTime).length-1} more block(s)</span>`:''}
      </div>`:`<div class="no-block-chip">📝 No schedule yet</div>`}
      <div class="sem-card-cr">${course.credits} cr</div>
    </div>
    <button class="sem-card-remove" title="Remove">×</button>`;

  card.querySelector('.sem-card-remove').addEventListener('click',e=>{ e.stopPropagation(); removeCourse(course.id,semId); render(); toast(`Removed ${course.title}.`,'info'); });
  card.addEventListener('click',e=>{ if(e.target.classList.contains('sem-card-remove')) return; openModal(course.id,semId); });
  card.addEventListener('dragstart',e=>{ state.drag={courseId:course.id,fromSemester:semId}; e.dataTransfer.effectAllowed='move'; card.classList.add('dragging'); });
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

/* ─── Drop zones ─────────────────────────────────────────────────────────── */
function initDropZones() {
  SEMESTERS.forEach(sem=>{
    const col=document.getElementById(`col-${sem.id}`);
    col.addEventListener('dragover',e=>{ e.preventDefault(); e.dataTransfer.dropEffect='move'; col.classList.add('drag-over'); });
    col.addEventListener('dragleave',e=>{ if(!col.contains(e.relatedTarget)) col.classList.remove('drag-over'); });
    col.addEventListener('drop',e=>{
      e.preventDefault(); col.classList.remove('drag-over');
      if(!state.drag) return;
      const ok=addCourse(state.drag.courseId,sem.id);
      if(ok){ const c=findCourse(state.drag.courseId); render(); toast(`Added ${c?.title} to ${sem.label}! 🐝`,'success'); }
      state.drag=null;
    });
  });

  const sidebarContent=document.getElementById('sidebarContent');
  sidebarContent.addEventListener('dragover',e=>{ if(state.drag?.fromSemester){e.preventDefault();sidebarContent.classList.add('sidebar-drop-over');} });
  sidebarContent.addEventListener('dragleave',e=>{ if(!sidebarContent.contains(e.relatedTarget)) sidebarContent.classList.remove('sidebar-drop-over'); });
  sidebarContent.addEventListener('drop',e=>{
    e.preventDefault(); sidebarContent.classList.remove('sidebar-drop-over');
    if(state.drag?.fromSemester){ removeCourse(state.drag.courseId,state.drag.fromSemester); render(); toast('Removed from semester.','info'); }
    state.drag=null;
  });
}

/* ─── Calendar ───────────────────────────────────────────────────────────── */
const CAL_START_H=8, CAL_END_H=21, PX_MIN=1;

function renderCalendar() {
  renderCalTabs();
  renderCalGrid(state.calSemester);
}

function renderCalTabs() {
  const tabs=document.getElementById('calSemTabs');
  tabs.innerHTML=SEMESTERS.map(s=>`<button class="cal-tab${s.id===state.calSemester?' cal-tab--active':''}" data-sem="${s.id}">${s.label}</button>`).join('');
  tabs.querySelectorAll('.cal-tab').forEach(btn=>btn.addEventListener('click',()=>{
    state.calSemester=btn.dataset.sem; saveState();
    renderCalGrid(state.calSemester);
    tabs.querySelectorAll('.cal-tab').forEach(b=>b.classList.toggle('cal-tab--active',b.dataset.sem===state.calSemester));
  }));
}

function renderCalGrid(semId) {
  const totalMin=(CAL_END_H-CAL_START_H)*60;
  const gutter=document.getElementById('calTimeGutter');
  gutter.innerHTML=''; gutter.style.height=`${totalMin*PX_MIN}px`;
  for(let h=CAL_START_H;h<=CAL_END_H;h++) {
    const lbl=document.createElement('div');
    lbl.className='cal-hour-label'; lbl.style.top=`${(h-CAL_START_H)*60*PX_MIN}px`;
    lbl.textContent=h===12?'12 PM':h>12?`${h-12} PM`:`${h} AM`;
    gutter.appendChild(lbl);
  }
  DAY_ORDER.forEach(day=>{
    const col=document.getElementById(`calDay-${day}`);
    col.innerHTML=''; col.style.height=`${totalMin*PX_MIN}px`;
    for(let h=CAL_START_H;h<CAL_END_H;h++) {
      const l=document.createElement('div'); l.className='cal-hour-line'; l.style.top=`${(h-CAL_START_H)*60*PX_MIN}px`; col.appendChild(l);
      const lh=document.createElement('div'); lh.className='cal-hour-line cal-hour-line--half'; lh.style.top=`${(h-CAL_START_H)*60*PX_MIN+30}px`; col.appendChild(lh);
    }
  });

  // Build events from blocks
  const events=[];
  (state.schedule[semId]||[]).forEach(({courseId,blocks})=>{
    (blocks||[]).forEach(block=>{
      if(!block.days?.length||!block.startTime||!block.endTime) return;
      const startMin=timeToMin(block.startTime), endMin=timeToMin(block.endTime);
      if(startMin<CAL_START_H*60||endMin>CAL_END_H*60||endMin<=startMin) return;
      block.days.forEach(day=>{
        events.push({ courseId, block, day, top:(startMin-CAL_START_H*60)*PX_MIN, height:Math.max(20,(endMin-startMin)*PX_MIN) });
      });
    });
  });

  DAY_ORDER.forEach(day=>{
    const col=document.getElementById(`calDay-${day}`);
    const dayEvs=events.filter(e=>e.day===day);
    buildOverlapGroups(dayEvs).forEach(group=>{
      group.forEach((ev,idx)=>{
        const course=findCourse(ev.courseId);
        if(!course) return;
        const req=isRequired(ev.courseId);
        const blk=document.createElement('div');
        blk.className=`cal-event cal-event--${req?'req':'elec'}`;
        blk.style.top=`${ev.top}px`; blk.style.height=`${ev.height}px`;
        const colW=100/group.length;
        blk.style.left=`calc(${idx*colW}% + 3px)`; blk.style.right=`calc(${(group.length-idx-1)*colW}% + 3px)`; blk.style.width='auto';
        const shortLoc=(ev.block.location||'').replace(/Urban Life Building/,'UL').replace(/Langdale Hall/,'Langdale').replace(/Petit Science/,'PSC').replace(/General Classroom/,'GCB').replace(/College of Business/,'COB');
        blk.innerHTML=`
          <div class="cal-event-code">${course.subject} ${course.number}${ev.block.type!=='Lecture'?` <span style="opacity:.7;font-size:.55rem">${ev.block.type}</span>`:''}</div>
          ${ev.height>28?`<div class="cal-event-title">${course.title}</div>`:''}
          ${ev.height>48&&shortLoc?`<div class="cal-event-sub">${shortLoc}</div>`:''}`;
        blk.addEventListener('click',()=>openModal(ev.courseId,semId));
        col.appendChild(blk);
      });
    });
  });

  // Legend
  const legend=document.getElementById('calLegend');
  const hasNoBlocks=(state.schedule[semId]||[]).some(e=>!e.blocks?.some(b=>b.days?.length&&b.startTime));
  legend.innerHTML=`
    <span class="cal-legend-item"><span class="cal-legend-dot cal-legend-dot--req"></span>Required</span>
    <span class="cal-legend-item"><span class="cal-legend-dot cal-legend-dot--elec"></span>Elective</span>
    ${hasNoBlocks?'<span class="cal-legend-item" style="color:var(--muted)">⚡ Some courses have no meeting times yet — click to add them</span>':''}
    ${!events.length?'<span class="cal-legend-item" style="color:var(--muted)">Add courses and enter their meeting times to see your weekly schedule</span>':''}`;
}

function buildOverlapGroups(events) {
  const sorted=[...events].sort((a,b)=>a.top-b.top);
  const groups=[]; let cur=[],end=0;
  for(const ev of sorted) {
    if(cur.length&&ev.top>=end){ groups.push(cur); cur=[]; end=0; }
    cur.push(ev); end=Math.max(end,ev.top+ev.height);
  }
  if(cur.length) groups.push(cur);
  return groups;
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

  if(!activeSem) {
    editorSection.classList.add('hidden');
    state.modal.semId = null;
    return;
  }
  editorSection.classList.remove('hidden');
  state.modal.semId = activeSem;
  hint.textContent=`for ${SEMESTERS.find(s=>s.id===activeSem)?.label||''}`;

  const blocks=getBlocks(courseId,activeSem);
  const req=isRequired(courseId);

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
    if(state.view==='calendar') renderCalendar();
    setTimeout(()=>{ saveStatus.textContent=''; },2000);
    toast('Meeting times saved! 🐝','success');
  };
}

function makeBlockCard(block, req) {
  const card=document.createElement('div');
  card.className=`block-card${req?'':' block-card--elec'}`;
  card.dataset.blockId=block.id;

  // Type select
  const typeOpts=BLOCK_TYPES.map(t=>`<option${t===block.type?' selected':''}>${t}</option>`).join('');

  // Day toggles
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
        <input type="time" class="block-time-input block-start" value="${block.startTime||'09:00'}">
      </div>
      <span class="time-dash">–</span>
      <div class="block-time-field">
        <label>End</label>
        <input type="time" class="block-time-input block-end" value="${block.endTime||'10:00'}">
      </div>
    </div>
    <div class="block-optional-grid">
      <div class="block-optional-field">
        <label>Location</label>
        <input type="text" class="block-text-input block-location" placeholder="e.g. Petit Science 135" value="${block.location||''}">
      </div>
      <div class="block-optional-field">
        <label>Instructor</label>
        <input type="text" class="block-text-input block-instructor" placeholder="e.g. Dr. Smith" value="${block.instructor||''}">
      </div>
      <div class="block-optional-field">
        <label>CRN</label>
        <input type="text" class="block-text-input block-crn" placeholder="e.g. 85286" value="${block.crn||''}">
      </div>
    </div>`;

  // Day toggle click
  card.querySelectorAll('.day-toggle-btn').forEach(btn=>{
    btn.addEventListener('click',()=>{ btn.classList.toggle('active'); state.modal.dirty=true; });
  });

  // Delete
  card.querySelector('.block-delete-btn').addEventListener('click',()=>{ card.remove(); state.modal.dirty=true; });

  // Mark dirty on any input change
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

/* ─── Modal ──────────────────────────────────────────────────────────────── */
function openModal(courseId, semId) {
  const course=findCourse(courseId);
  if(!course) return;
  state.modal={courseId,semId:semId||null,dirty:false};

  const req=isRequired(courseId);
  document.getElementById('modalCode').textContent=`${course.subject} ${course.number}`;
  document.getElementById('modalCode').className=`modal-code modal-code--${req?'req':'elec'}`;
  document.getElementById('modalTitle').textContent=course.title;
  document.getElementById('modalCredits').textContent=`${course.credits} credit hours`;
  document.getElementById('modalType').textContent=course.type;
  document.getElementById('modalDescription').textContent=course.description;
  document.getElementById('modalPrereqs').textContent=course.prerequisites||'None listed';

  renderQuickAdd(courseId);
  renderBlockEditor(courseId,semId);

  document.getElementById('modalBackdrop').classList.add('open');
}

function renderQuickAdd(courseId) {
  const row=document.getElementById('quickAdd');
  const c=findCourse(courseId);
  row.innerHTML=SEMESTERS.map(sem=>{
    const inThis=state.schedule[sem.id].some(e=>e.courseId===courseId);
    const over=!inThis&&semesterCredits(sem.id)+(c?.credits||0)>sem.maxCredits;
    return `<button class="qa-btn${inThis?' qa-btn--active':''}" data-sem="${sem.id}" ${over?'disabled title="Would exceed 18 credits"':''}>
      ${inThis?`✓ ${sem.label}`:`+ ${sem.label}`}</button>`;
  }).join('');
  row.querySelectorAll('.qa-btn').forEach(btn=>{
    btn.addEventListener('click',()=>{
      const sid=btn.dataset.sem;
      const inThis=state.schedule[sid].some(e=>e.courseId===courseId);
      if(inThis){
        removeCourse(courseId,sid);
        if(state.modal.semId === sid) state.modal.semId = scheduledIn(courseId);
        toast(`Removed from ${SEMESTERS.find(s=>s.id===sid)?.label}.`,'info');
      } else {
        const ok=addCourse(courseId,sid);
        if(ok) {
          state.modal.semId = sid;
          toast(`Added to ${SEMESTERS.find(s=>s.id===sid)?.label}! 🐝`,'success');
        }
      }
      render();
      renderQuickAdd(courseId);
      renderBlockEditor(courseId,state.modal.semId);
    });
  });
}

function closeModal() {
  // Warn if unsaved
  if(state.modal.dirty) {
    if(!confirm('You have unsaved schedule changes. Discard them?')) return;
  }
  document.getElementById('modalBackdrop').classList.remove('open');
  state.modal={courseId:null,semId:null,dirty:false};

  if(deferredRemoteState) {
    const shouldRender = applyRemoteData(deferredRemoteState);
    deferredRemoteState = null;
    if(shouldRender) render();
  }
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
    tt.textContent=isP?'Semester Planner':'Weekly Calendar';
    h.textContent=isP?'Drag courses from the library · max 18 credits · click any card for details':'Click a course card to add meeting times · they appear here on the calendar';
    if(!isP) renderCalendar();
    saveState();
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
  btn.addEventListener('click',()=>{ applySidebar(!state.sidebarCollapsed); saveState(); });
  applySidebar(state.sidebarCollapsed);
  document.querySelectorAll('.lib-section-header').forEach(hdr=>{
    hdr.addEventListener('click',()=>{
      const type=hdr.dataset.type; state.sectionsCollapsed[type]=!state.sectionsCollapsed[type];
      const list=document.getElementById(`${type}Courses`);
      const icon=hdr.querySelector('.lib-toggle-icon');
      list.classList.toggle('collapsed',state.sectionsCollapsed[type]);
      if(icon) icon.textContent=state.sectionsCollapsed[type]?'▶':'▼';
      saveState();
    });
    const type=hdr.dataset.type;
    if(state.sectionsCollapsed[type]){ document.getElementById(`${type}Courses`)?.classList.add('collapsed'); hdr.querySelector('.lib-toggle-icon').textContent='▶'; }
  });
}

/* ─── Reset ──────────────────────────────────────────────────────────────── */
function initReset() {
  document.getElementById('resetBtn').addEventListener('click',()=>{
    if(!confirm('Clear your entire schedule and start fresh?')) return;
    state.schedule=emptySchedule();
    saveState(); render(); toast('Schedule cleared. Fresh start! 🐝','info');
  });
}

/* ─── Master render ──────────────────────────────────────────────────────── */
function render() {
  renderLibrary();
  renderSemesters();
  if(state.view==='calendar') renderCalendar();
}

/* ─── Init ───────────────────────────────────────────────────────────────── */
document.addEventListener('DOMContentLoaded', async () => {
  loadLocalState();        // Show locally-cached data instantly

  initSidebar();
  initViewToggle();        // sets up view and calls initial render
  initDropZones();
  initReset();

  // Initial render with local data
  render();

  // Hide loading overlay
  document.getElementById('loadingOverlay').classList.add('hidden');

  // Connect to Firebase (may update state asynchronously)
  await initFirebase();

  // Re-render if Firebase loaded different data
  render();

  // Modal close handlers
  document.getElementById('modalBackdrop').addEventListener('click',e=>{
    if(e.target===document.getElementById('modalBackdrop')) closeModal();
  });
  document.getElementById('modalClose').addEventListener('click',closeModal);
  document.addEventListener('keydown',e=>{ if(e.key==='Escape') closeModal(); });
});
