/* ═══════════════════════════════════════════════════════════════════════════
   Bee's GSU Grad Planner — calendar.js
   Weekly calendar view built from each course's meeting blocks.
   ═══════════════════════════════════════════════════════════════════════════ */

const CAL_START_H=8, CAL_END_H=21, PX_MIN=1;

function renderCalendar() {
  if(!isValidSemId(state.calSemester)) state.calSemester=SEMESTERS[0].id;
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
        const req=isRequiredSection(course);
        const blk=document.createElement('div');
        blk.className=`cal-event cal-event--${req?'req':'elec'}`;
        blk.style.top=`${ev.top}px`; blk.style.height=`${ev.height}px`;
        const colW=100/group.length;
        blk.style.left=`calc(${idx*colW}% + 3px)`; blk.style.right=`calc(${(group.length-idx-1)*colW}% + 3px)`; blk.style.width='auto';
        const shortLoc=(ev.block.location||'').replace(/Urban Life Building/,'UL').replace(/Langdale Hall/,'Langdale').replace(/Petit Science/,'PSC').replace(/General Classroom/,'GCB').replace(/College of Business/,'COB');
        blk.innerHTML=`
          <div class="cal-event-code">${escapeHtml(course.code)}${ev.block.type!=='Lecture'?` <span style="opacity:.7;font-size:.55rem">${escapeHtml(ev.block.type)}</span>`:''}</div>
          ${ev.height>28?`<div class="cal-event-title">${escapeHtml(course.title)}</div>`:''}
          ${ev.height>48&&shortLoc?`<div class="cal-event-sub">${escapeHtml(shortLoc)}</div>`:''}`;
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
