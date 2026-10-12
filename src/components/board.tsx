import { useDroppable } from '@dnd-kit/core'
import { SortableContext, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { toast } from 'sonner'
import {
  LuArrowLeftRight,
  LuCalendarClock,
  LuCheck,
  LuCalendarX,
  LuChevronDown,
  LuChevronRight,
  LuEllipsis,
  LuEye,
  LuEyeOff,
  LuGraduationCap,
  LuHourglass,
  LuInfo,
  LuLock,
  LuPlus,
  LuRepeat,
  LuRoute,
  LuTrash2,
  LuTriangleAlert,
  LuX,
} from 'react-icons/lu'
import { SUBSTITUTIONS } from '@/data/degree'
import type { RecordCourse, RecordTerm, Term } from '@/lib/types'
import {
  RECORD_STATUS,
  SEASON_META,
  codeToId,
  conditionLabel,
  earnsCredit,
  findCourse,
  fmtCredits,
  fmtDelta,
  fmtGpa,
  offeringInfo,
} from '@/lib/planner'
import {
  GRADUATION_TERM,
  OFFERED_PATHS,
  failedAttempts,
  isTermExpanded,
  nextTermToAdd,
  pathPreview,
  pathTitle,
  recordWhere,
  roleShort,
  semesterCredits,
  unmetPrereqs,
} from '@/lib/plan-ops'
import { meetingSummary, partPicks, scheduleFor, termEvents } from '@/lib/schedule'
import { fmtDays, fmtTimeRange } from '@/lib/format'
import {
  addSemester,
  applyPath,
  matchedPathId,
  removeCourse,
  removeLastSemester,
  setAllPastExpanded,
  toggleTermExpanded,
  type PlannerSnapshot,
} from '@/lib/store'
import { confirmAction } from '@/components/confirm'
import { justDragged, rowId, useCourseDnd } from '@/components/course-dnd'
import { PlanTabs } from '@/components/plans'
import { AuditIcon, CategoryLegend, CategoryTag, GradePill, Hint, Tag } from '@/components/bits'
import { CATEGORY, PROGRESS, categoryOf, categoryOfRole } from '@/lib/colors'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Separator } from '@/components/ui/separator'
import { useUi } from '@/components/ui-context'
import { cn } from '@/lib/utils'

export function Board({ snap, showPast, onShowPast }: { snap: PlannerSnapshot; showPast: boolean; onShowPast: (v: boolean) => void }) {
  const { record, recordStatus, semesters } = snap
  const years = new Map<number, Term[]>()
  for (const t of semesters) {
    if (!years.has(t.year)) years.set(t.year, [])
    years.get(t.year)!.push(t)
  }
  const next = nextTermToAdd(semesters)
  const allOpen = record.terms.length > 0 && record.terms.every((t) => isTermExpanded(snap.plan.expandedTerms, record, t.id))

  return (
    <div className="@container space-y-6 p-3 pb-10 sm:p-4">
      {/* ── Upcoming terms, by year ── */}
      <PathBar snap={snap} />
      {[...years.entries()].map(([year, group]) => (
        <section key={year} className="space-y-2" aria-label={String(year)}>
          <div className="flex items-center gap-3">
            <span className="mono text-[11px] font-medium tracking-wider text-muted-foreground">{year}</span>
            <Separator className="flex-1" />
          </div>
          <div className="grid grid-cols-1 items-start gap-3 @2xl:grid-cols-2 @5xl:grid-cols-3">
            {group.map((term) => (
              <TermCard key={term.id} term={term} snap={snap} isFirst={term.id === semesters[0].id} isLast={term.id === semesters[semesters.length - 1].id} />
            ))}
          </div>
        </section>
      ))}

      {next && (
        <Button
          variant="outline"
          size="sm"
          onClick={addSemester}
          className="w-full border-dashed bg-transparent text-muted-foreground hover:bg-card hover:text-foreground"
        >
          <LuPlus className="size-3.5" aria-hidden />
          Add {next.label}
        </Button>
      )}

      {/* ── Completed terms ── */}
      {recordStatus !== 'ready' ? (
        <RecordNotice status={recordStatus} />
      ) : record.terms.length > 0 && (
        <section className="space-y-2" aria-label="Completed terms">
          <div className="flex items-center gap-2">
            <span className="text-[11px] font-medium tracking-wider text-muted-foreground uppercase">Completed</span>
            <span className="mono text-[11px] text-muted-foreground">
              {record.terms.length} terms · {fmtCredits(snap.summary.earned)} cr · GSU {fmtGpa(snap.summary.gsu)}
            </span>
            <Separator className="flex-1" />
            {showPast && record.terms.length > 1 && (
              <Button variant="ghost" size="xs" className="text-muted-foreground" onClick={() => setAllPastExpanded(!allOpen)}>
                {allOpen ? 'Collapse' : 'Expand all'}
              </Button>
            )}
            <Button variant="ghost" size="xs" className="text-muted-foreground" onClick={() => onShowPast(!showPast)} aria-pressed={showPast}>
              {showPast ? <LuEyeOff className="size-3.5" aria-hidden /> : <LuEye className="size-3.5" aria-hidden />}
              {showPast ? 'Hide' : 'Show'}
            </Button>
          </div>
          {showPast && (
            <div className="grid grid-cols-1 items-start gap-3 @2xl:grid-cols-2 @5xl:grid-cols-3 @7xl:grid-cols-4">
              {record.terms.map((t) => <PastTermCard key={t.id} term={t} snap={snap} />)}
            </div>
          )}
        </section>
      )}
    </div>
  )
}

/* ─── Suggested paths ────────────────────────────────────────────────────── */

function PathBar({ snap }: { snap: PlannerSnapshot }) {
  const ui = useUi()
  // Only the 3-semester path is offered — she has to graduate by Fall 2027.
  const current = OFFERED_PATHS.find((p) => p.id === matchedPathId()) ?? null
  const last = [...snap.semesters].reverse().find((s) => (snap.plan.schedule[s.id] || []).length) ?? null
  const late = !!last && last.key > GRADUATION_TERM.key

  const choose = async (id: string) => {
    const path = OFFERED_PATHS.find((p) => p.id === id)!
    if (current?.id === id) {
      toast.info(`This plan already is the ${pathTitle(path)}.`)
      return
    }
    const hasCourses = snap.semesters.some((s) => (snap.plan.schedule[s.id] || []).length)
    if (hasCourses && !current) {
      const ok = await confirmAction({
        title: `Load the ${pathTitle(path)} into this plan?`,
        description: `This replaces the courses in the open plan’s terms (graduating ${path.graduation}). Your other plans, past terms, grades and advisor exceptions are kept. Chosen sections and meeting times stay for courses that keep their term. To keep this plan as it is, make a new plan from the path instead.`,
        confirmLabel: 'Switch',
      })
      if (!ok) return
    }
    applyPath(id)
  }

  return (
    <div className="space-y-2.5">
      <PlanTabs snap={snap} />
      <div className="flex flex-wrap items-end gap-x-3 gap-y-2">
      <div className="min-w-0 space-y-1">
        <p className="text-xs text-muted-foreground">
          Graduate by <span className="font-medium text-foreground">{GRADUATION_TERM.label}</span> — 3 semesters · up to 18 credits a term · {ui.isMobile ? 'press and hold a course to move it' : 'drag courses to reorder or move them'}
        </p>
        {late && (
          <p className="text-xs font-medium text-destructive">This plan has courses after {GRADUATION_TERM.label} — move them into the three semesters.</p>
        )}
        <CategoryLegend />
      </div>
      <div className="flex-1" />
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="outline" size="sm" className="h-8 gap-1.5 text-xs" aria-label={current ? 'This plan is the 3-semester path' : 'The 3-semester path'}>
            <LuRoute className="size-3.5" aria-hidden />
            3-semester path
            {current ? <LuCheck className="size-3.5 text-green-600 dark:text-green-400" aria-hidden /> : <LuChevronDown className="size-3.5 opacity-60" aria-hidden />}
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-80">
          <DropdownMenuLabel className="text-xs font-normal text-muted-foreground">{current ? 'This plan is the suggested path' : 'Load the suggested path into this plan'}</DropdownMenuLabel>
          {OFFERED_PATHS.map((p) => {
            const prev = pathPreview(snap.record, p.id, snap.startKey)
            return (
              <DropdownMenuItem key={p.id} onClick={() => choose(p.id)} className="flex-col items-start gap-0.5 py-2">
                <span className="flex w-full items-center gap-2 text-sm font-medium">
                  {p.name}
                  <span className="text-xs font-normal text-muted-foreground">graduate {p.graduation}</span>
                  {current?.id === p.id && <span className="ml-auto text-xs">current</span>}
                </span>
                <span className="mono text-[11px] text-muted-foreground">{prev.sems.map((s, i) => `${s.shortLabel} ${prev.credits[i]}`).join(' · ')}</span>
                <span className="text-xs text-muted-foreground">{p.note}</span>
                <span className="text-xs">
                  {prev.missing ? `${prev.missing} requirement(s) not covered` : prev.pending ? `Covers everything once ${prev.pending} advisor exception${prev.pending > 1 ? 's are' : ' is'} recorded` : 'Covers every requirement'}
                </span>
              </DropdownMenuItem>
            )
          })}
        </DropdownMenuContent>
      </DropdownMenu>
      </div>
    </div>
  )
}

/* ─── Record notice (no record yet / loading / offline) ──────────────────── */

function RecordNotice({ status }: { status: string }) {
  const ui = useUi()
  if (status === 'loading') {
    return (
      <div className="flex items-center gap-3 rounded-xl border border-dashed px-4 py-3 text-sm text-muted-foreground">
        <span className="size-2 animate-pulse rounded-full bg-muted-foreground" aria-hidden />
        Loading past terms and grades…
      </div>
    )
  }
  if (status === 'missing') {
    return (
      <div className="flex flex-wrap items-center gap-3 rounded-xl border border-dashed px-4 py-3 text-sm">
        <div className="min-w-0 flex-1">
          <div className="font-medium">No academic record yet</div>
          <div className="text-xs text-muted-foreground">Import past terms and grades from the record file. They are stored only in Firebase.</div>
        </div>
        <Button size="sm" onClick={() => ui.openRecord({ importNow: true })}>Import record</Button>
      </div>
    )
  }
  return (
    <div className="rounded-xl border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm">
      <div className="font-medium text-destructive">Past terms unavailable</div>
      <div className="text-xs text-muted-foreground">Couldn’t reach Firebase, so grades and past terms can’t load. Planned terms show this device’s copy.</div>
    </div>
  )
}

/* ─── Past (locked) terms ───────────────────────────────────────────────── */

function PastTermCard({ term, snap }: { term: RecordTerm; snap: PlannerSnapshot }) {
  const ui = useUi()
  const info = snap.summary.byTerm[term.id]
  const open = isTermExpanded(snap.plan.expandedTerms, snap.record, term.id)
  const dnd = useCourseDnd()
  // A course dragged here is refused (past terms are locked).
  const { setNodeRef } = useDroppable({ id: `past:${term.id}`, data: { kind: 'past', termId: term.id } })
  const dropWarn = dnd.over === 'past' && dnd.overPast === term.id
  if (!info) return null

  return (
    <section
      ref={setNodeRef}
      aria-label={`${term.label} (completed)`}
      className={cn('rounded-xl border bg-card/70 shadow-xs', dropWarn && 'border-destructive ring-2 ring-destructive/30')}
    >
      <header className="flex items-start gap-2 px-3 pt-2.5 pb-2">
        <button
          type="button"
          onClick={() => toggleTermExpanded(term.id)}
          aria-expanded={open}
          className="flex min-w-0 flex-1 items-start gap-1.5 rounded-md text-left focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none"
        >
          {open ? <LuChevronDown className="mt-1 size-3.5 shrink-0 text-muted-foreground" aria-hidden /> : <LuChevronRight className="mt-1 size-3.5 shrink-0 text-muted-foreground" aria-hidden />}
          <span className="min-w-0">
            <span className="block text-sm font-semibold tracking-tight">{term.label}</span>
            <span className="mono flex flex-wrap gap-x-2 text-[11px] text-muted-foreground">
              <span>{fmtCredits(info.earned)} cr</span>
              {info.termGpa.gpa != null && <span>{info.transferOnly ? '≈' : ''}{fmtGpa(info.termGpa)} GPA</span>}
              {open && !info.transferOnly && info.cumGsu.gpa != null && <span>cum. {fmtGpa(info.cumGsu)}</span>}
              {open && info.transferOnly && info.cumOverall.gpa != null && <span>cum. ≈{fmtGpa(info.cumOverall)} w/ transfer</span>}
            </span>
          </span>
        </button>
        {info.school && (
          <Hint label={`Transfer credit from ${info.school}`}>
            <span className="mt-0.5 inline-flex max-w-28 items-center gap-1 truncate text-[11px] text-muted-foreground">
              <LuArrowLeftRight className="size-3 shrink-0" aria-hidden />
              <span className="truncate">{info.transferOnly ? info.school : 'transfer'}</span>
            </span>
          </Hint>
        )}
        <Hint label="Past term — locked. Fix grades or add courses in the Record.">
          <LuLock className="mt-1 size-3.5 shrink-0 text-muted-foreground/70" aria-label="Locked" />
        </Hint>
        <Hint label={`Add a course to ${term.label}`}>
          <Button variant="ghost" size="icon" className="-mt-0.5 size-6 shrink-0 text-muted-foreground" onClick={() => ui.openRecord({ termId: term.id, add: true })} aria-label={`Add a course to ${term.label}`}>
            <LuPlus className="size-3.5" aria-hidden />
          </Button>
        </Hint>
      </header>
      <div className="px-2.5 pb-2.5">
        {open ? (
          <ul className="space-y-1">
            {term.courses.map((c) => <PastRow key={c.id} c={c} snap={snap} />)}
            {term.note && <li className="px-1 pt-1 text-xs text-muted-foreground">{term.note}</li>}
          </ul>
        ) : (
          <div className="flex flex-wrap gap-1">
            {term.courses.map((c) => (
              <button
                key={c.id}
                type="button"
                onClick={() => ui.openRecord({ recordId: c.id })}
                title={`${c.title} (${c.code}) · ${RECORD_STATUS[c.status].label}`}
                className={cn(
                  'inline-flex max-w-full items-center gap-1.5 rounded-md border bg-background py-0.5 pr-0.5 pl-1.5 text-[11px] hover:bg-accent',
                  c.status === 'nocredit' && 'border-destructive/30 text-destructive',
                  (c.status === 'notcounted' || c.status === 'unused') && 'border-dashed text-muted-foreground',
                )}
              >
                <span className={cn('truncate', c.status === 'nocredit' && 'line-through decoration-destructive/60')}>{c.title || c.code}</span>
                <GradePill grade={c.grade} />
              </button>
            ))}
          </div>
        )}
      </div>
    </section>
  )
}

function PastRow({ c, snap }: { c: RecordCourse; snap: PlannerSnapshot }) {
  const ui = useUi()
  const credits = earnsCredit(c) || !c.credits ? `${fmtCredits(earnsCredit(c) ? c.credits : 0)} cr` : `0 cr (${fmtCredits(c.credits)} attempted)`
  const cat = c.status === 'counted' ? categoryOfRole(snap.audit.roles[c.id]) : null
  return (
    <li>
      <button
        type="button"
        onClick={() => ui.openRecord({ recordId: c.id })}
        className={cn(
          'w-full rounded-lg border border-transparent border-l-[3px] bg-secondary/60 px-2.5 py-1.5 text-left hover:border-border hover:bg-accent',
          cat ? CATEGORY[cat].edge : 'border-l-neutral-300 dark:border-l-neutral-600',
          c.status === 'nocredit' && 'border-l-red-400 bg-destructive/5',
        )}
      >
        <span className="flex items-center gap-2">
          <span className={cn('min-w-0 flex-1 truncate text-[13px] font-semibold', c.status === 'nocredit' && 'text-destructive line-through decoration-destructive/50')}>{c.title || c.code}</span>
          {c.transfer && <Tag>transfer</Tag>}
          {c.r2r && <Tag>replaced</Tag>}
          <GradePill grade={c.grade} className="h-5 min-w-[26px] text-xs" />
        </span>
        <span className={cn('block truncate text-[11px]', cat && cat !== 'extra' ? CATEGORY[cat].text : 'text-muted-foreground')}>
          <span className="text-muted-foreground"><span className="mono">{c.code}</span> · {credits} · </span>{recordWhere(c, snap.audit)}
        </span>
      </button>
    </li>
  )
}

/* ─── Upcoming terms ─────────────────────────────────────────────────────── */

function TermCard({ term, snap, isFirst, isLast }: { term: Term; snap: PlannerSnapshot; isFirst: boolean; isLast: boolean }) {
  const ui = useUi()
  const entries = snap.plan.schedule[term.id] || []
  const credits = semesterCredits(snap.plan.schedule, term.id)
  const over = credits > term.maxCredits
  const dnd = useCourseDnd()
  const { setNodeRef } = useDroppable({ id: `term:${term.id}`, data: { kind: 'term', termId: term.id } })
  const target = dnd.target?.termId === term.id ? dnd.target : null
  const sched = scheduleFor(term.id)
  const events = sched || entries.some((e) => e.blocks.length) ? termEvents(term.id, entries) : null
  const conflictCourses = new Set(events?.events.filter((e) => e.conflict).map((e) => e.courseId))
  const proj = snap.gpa.withR2R.find((x) => x.term.id === term.id)
  const projOff = snap.gpa.withoutR2R.find((x) => x.term.id === term.id)
  const canGrade = isFirst && (snap.recordStatus === 'ready' || snap.recordStatus === 'missing')
  const focused = ui.focusedTerm === term.id
  const picksNeeded = sched ? entries.reduce((n, e) => {
    const c = findCourse(e.courseId)
    return n + (c ? partPicks(c, e, term.id).filter((p) => p.sections.length && !p.picked).length : 0)
  }, 0) : 0

  return (
    <section
      ref={setNodeRef}
      aria-label={term.label}
      data-term={term.id}
      onClick={() => ui.setFocusedTerm(term.id)}
      className={cn(
        '@container/term flex flex-col rounded-xl border bg-card shadow-sm transition-shadow hover:shadow-md',
        focused && !ui.isMobile && 'border-foreground/30 ring-2 ring-foreground/10',
        target && (target.ok ? 'border-primary ring-2 ring-primary/30' : 'border-destructive ring-2 ring-destructive/30'),
        over && 'border-destructive ring-1 ring-destructive/30',
      )}
    >
      <header className="flex items-center gap-2 px-3.5 pt-3 pb-1.5">
        <h3 className="min-w-0 flex-1 truncate text-[15px] font-semibold tracking-tight">{term.label}</h3>
        <Hint label={`${entries.length} course${entries.length === 1 ? '' : 's'} · ${fmtCredits(credits)} of ${term.maxCredits} credits. More than ${term.maxCredits} needs a petition (catalog 1330.30).`}>
          <span className={cn('mono shrink-0 text-xs', over ? 'font-semibold text-destructive' : 'text-muted-foreground')}>
            {fmtCredits(credits)}/{term.maxCredits} cr
          </span>
        </Hint>
        <TermInfo term={term} snap={snap} />
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon" className="size-7 shrink-0 text-muted-foreground" onClick={(e) => e.stopPropagation()} aria-label={`More for ${term.label}`}>
              <LuEllipsis className="size-4" aria-hidden />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-56">
            <DropdownMenuItem onClick={() => ui.openLibrary(term.id)}>
              <LuPlus className="size-4" aria-hidden />
              Add a course
            </DropdownMenuItem>
            {(sched || entries.length > 0) && (
              <DropdownMenuItem onClick={() => { ui.setFocusedTerm(term.id); ui.setView('schedule') }}>
                <LuCalendarClock className="size-4" aria-hidden />
                {sched ? 'Choose sections & see the week' : 'See the week'}
              </DropdownMenuItem>
            )}
            <DropdownMenuItem onClick={() => ui.openGpa(term.id)}>
              <LuGraduationCap className="size-4" aria-hidden />
              Expected grades & GPA
            </DropdownMenuItem>
            {canGrade && (
              <>
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={() => ui.openGrades(term.id)}>
                  <LuLock className="size-4" aria-hidden />
                  Enter final grades…
                </DropdownMenuItem>
              </>
            )}
            {isLast && !entries.length && snap.semesters.length > 1 && (
              <>
                <DropdownMenuSeparator />
                <DropdownMenuItem variant="destructive" onClick={removeLastSemester}>
                  <LuX className="size-4" aria-hidden />
                  Remove {term.label}
                </DropdownMenuItem>
              </>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      </header>

      <div className="px-3.5 pb-2">
        <span className="block h-1 w-full overflow-hidden rounded-full bg-muted" aria-hidden>
          <span
            className={cn('block h-full rounded-full transition-[width]', over ? 'bg-destructive' : PROGRESS.done)}
            style={{ width: `${Math.min(100, (credits / term.maxCredits) * 100)}%` }}
          />
        </span>
        {proj && proj.total > 0 && (
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); ui.openGpa(term.id) }}
            className="mt-1.5 flex w-full flex-wrap items-baseline gap-x-2 gap-y-0.5 text-left text-[11px] text-muted-foreground hover:text-foreground"
            title={proj.replaced && projOff ? `Without Repeat to Replace: GSU ${fmtGpa(projOff.cumGsu)} · with transfer ${fmtGpa(projOff.cumOverall)}` : 'Open the GPA projection'}
          >
            {proj.graded ? (
              <>
                <span>est. term <b className="mono font-semibold text-foreground">{fmtGpa(proj.termGpa)}</b></span>
                <span>GSU <b className="mono font-semibold text-foreground">{fmtGpa(proj.cumGsu)}</b> <Delta v={proj.deltaGsu} /></span>
                <span>w/ transfer <b className="mono font-semibold text-foreground">{fmtGpa(proj.cumOverall)}</b> <Delta v={proj.deltaOverall} /></span>
                {proj.graded < proj.total && <span className="mono">· {proj.graded}/{proj.total} graded</span>}
              </>
            ) : (
              <span className="underline-offset-2 hover:underline">Pick expected grades to see the GPA</span>
            )}
          </button>
        )}
      </div>

      <Separator />

      <SortableContext id={`term:${term.id}`} items={entries.map((e) => rowId(term.id, e.courseId))} strategy={verticalListSortingStrategy}>
        <ul className="flex-1 space-y-1.5 p-2.5">
          {entries.map((e, i) => (
            <CourseRow key={e.courseId} courseId={e.courseId} term={term} snap={snap} conflict={conflictCourses.has(e.courseId)} dropBefore={target?.index === i ? target : null} />
          ))}
          {target && target.index >= entries.length && <DropLine ok={target.ok} reason={target.reason} />}
          {!entries.length && !target && (
            <li className="rounded-lg border border-dashed px-2 py-4 text-center text-xs text-muted-foreground">{dnd.active ? 'Drop a course here' : 'No courses yet'}</li>
          )}
        </ul>
      </SortableContext>

      <div className="flex items-center gap-1 px-2.5 pb-2.5">
        <Button
          variant="ghost"
          size="sm"
          className="h-8 flex-1 justify-start text-xs text-muted-foreground"
          onClick={(e) => { e.stopPropagation(); ui.openLibrary(term.id) }}
        >
          <LuPlus className="size-3.5" aria-hidden />
          Add course
        </Button>
        {sched && entries.length > 0 && (
          <Button
            variant={picksNeeded ? 'secondary' : 'ghost'}
            size="sm"
            className="h-8 text-xs"
            onClick={(e) => { e.stopPropagation(); ui.setFocusedTerm(term.id); ui.setView('schedule') }}
          >
            <LuCalendarClock className="size-3.5" aria-hidden />
            {picksNeeded ? `Choose ${picksNeeded} section${picksNeeded > 1 ? 's' : ''}` : 'Week view'}
          </Button>
        )}
      </div>
    </section>
  )
}

function Delta({ v }: { v: number | null }) {
  if (v == null) return null
  return <span className={cn('mono', v < 0 ? 'text-destructive' : v > 0 ? 'text-green-700 dark:text-green-400' : '')}>{fmtDelta(v)}</span>
}

function TermInfo({ term, snap }: { term: Term; snap: PlannerSnapshot }) {
  const entries = snap.plan.schedule[term.id] || []
  const notOffered = entries.map((e) => findCourse(e.courseId)!).filter((c) => offeringInfo(c, term.season).level === 'none')
  const sched = scheduleFor(term.id)
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="ghost" size="icon" className="size-7 shrink-0 text-muted-foreground" onClick={(e) => e.stopPropagation()} aria-label={`About ${term.label}`}>
          <LuInfo className="size-3.5" aria-hidden />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-72 space-y-2 text-xs" onClick={(e) => e.stopPropagation()}>
        <div className="text-sm font-medium">{term.label}</div>
        <p className="text-muted-foreground">
          {term.season === 'summer'
            ? 'Summer has no 15-week session: most courses run 7 weeks (Summer 2027: June 7 – August 2), plus a 3-week May session.'
            : sched
              ? `Classes run ${new Date(sched.classesStart + 'T12:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} – ${new Date(sched.classesEnd + 'T12:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}. The class schedule is out — choose sections in Schedule.`
              : `GSU hasn't released the ${term.label} class schedule yet.`}
        </p>
        <p className="text-muted-foreground">Up to {term.maxCredits} credit hours without special permission (catalog 1330.30).</p>
        {notOffered.length > 0 && (
          <p className="text-muted-foreground">
            Not offered in {SEASON_META[term.season].label} 2024–2026: {notOffered.map((c) => c.title).join(", ")}.
          </p>
        )}
      </PopoverContent>
    </Popover>
  )
}

/** Where a dragged course will land: a line between two courses (red when the term can't take it). */
function DropLine({ ok, reason }: { ok: boolean; reason: string }) {
  return (
    <li className="pointer-events-none list-none" aria-hidden data-drop-line={ok ? 'ok' : 'refused'}>
      <div className={cn('h-0.5 rounded-full', ok ? 'bg-primary' : 'bg-destructive')} />
      {!ok && <div className="pt-1 text-[11px] font-medium text-destructive">{reason}</div>}
    </li>
  )
}

function CourseRow({ courseId, term, snap, conflict, dropBefore }: { courseId: string; term: Term; snap: PlannerSnapshot; conflict: boolean; dropBefore: { ok: boolean; reason: string } | null }) {
  const ui = useUi()
  const sortable = useSortable({ id: rowId(term.id, courseId), data: { kind: 'row', courseId, termId: term.id } })
  const course = findCourse(courseId)!
  const role = snap.audit.roles[course.id]
  const unmet = unmetPrereqs(snap.semesters, snap.plan.schedule, course.id, term.id)
  const offer = offeringInfo(course, term.season)
  const retake = failedAttempts(course.id)
  const needsException = role?.pending ? SUBSTITUTIONS.find((s) => codeToId(s.course) === course.id) : null
  const sched = scheduleFor(term.id)
  const entry = (snap.plan.schedule[term.id] || []).find((e) => e.courseId === courseId) ?? null
  const picks = sched ? partPicks(course, entry, term.id) : []
  const offeredNow = picks.some((p) => p.sections.length)
  const timed = entry?.blocks.filter((b) => b.days.length && b.startTime) ?? []
  const cat = categoryOf(course, role)

  const { setNodeRef, attributes, listeners, transform, transition, isDragging } = sortable
  return (
    <>
    {dropBefore && <DropLine ok={dropBefore.ok} reason={dropBefore.reason} />}
    <li
      ref={setNodeRef}
      style={{ transform: CSS.Translate.toString(transform), transition }}
      {...attributes}
      {...listeners}
      role="button"
      tabIndex={0}
      aria-roledescription="Course — Enter opens it; Space picks it up to move"
      data-course={course.id}
      onClick={(e) => {
        e.stopPropagation()
        if (justDragged()) return
        ui.openCourse(course.id, term.id)
      }}
      onKeyDown={(e) => {
        listeners?.onKeyDown?.(e)
        if (e.key === 'Enter') {
          e.preventDefault()
          ui.openCourse(course.id, term.id)
        }
      }}
      className={cn(
        'group relative cursor-pointer touch-manipulation rounded-lg border border-transparent border-l-[3px] bg-secondary/60 px-2.5 py-2 transition-colors select-none [-webkit-touch-callout:none]',
        'hover:border-border hover:bg-accent focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none',
        !ui.isMobile && 'active:cursor-grabbing',
        CATEGORY[cat].edge,
        conflict && 'bg-destructive/5',
        isDragging && 'z-10 opacity-40',
      )}
    >
      <div className="flex items-center gap-2">
        <span className="min-w-0 flex-1 truncate text-[13px] font-semibold">{course.title}</span>
        <span className="flex shrink-0 items-center gap-1.5">
          {retake.length > 0 && (
            <Hint label={`Retake — earlier: ${retake.map((a) => `${a.rec.grade || RECORD_STATUS[a.rec.status].short} (${a.term.label})`).join(', ')}`}>
              <LuRepeat className="size-3.5 text-muted-foreground" aria-label="Retake" />
            </Hint>
          )}
          {unmet.length > 0 && (
            <Hint label={`Take first: ${unmet.map(conditionLabel).join(' · ')}`}>
              <LuTriangleAlert className="size-3.5 text-destructive" aria-label="Prerequisite missing" />
            </Hint>
          )}
          {offer.level === 'none' && (
            <Hint label={offer.text}>
              <LuCalendarX className="size-3.5 text-muted-foreground" aria-label="Not usually offered this term" />
            </Hint>
          )}
          {needsException && (
            <Hint label={`${needsException.label}: needs an advisor exception in Degree Works.`}>
              <LuHourglass className="size-3.5 text-pending" aria-label="Needs an advisor exception" />
            </Hint>
          )}
          {conflict && (
            <Hint label="Its meeting times overlap another course this term.">
              <LuTriangleAlert className="size-3.5 text-destructive" aria-label="Time conflict" />
            </Hint>
          )}
          {!ui.isMobile && (
            <Button
              variant="ghost"
              size="icon"
              className="size-6 opacity-0 group-hover:opacity-100 focus-visible:opacity-100"
              onClick={(e) => {
                e.stopPropagation()
                removeCourse(course.id, term.id)
              }}
              aria-label={`Remove ${course.code}`}
            >
              <LuTrash2 className="size-3.5" aria-hidden />
            </Button>
          )}
        </span>
      </div>
      <div className="mt-0.5 flex min-w-0 items-center gap-2 text-[11px] text-muted-foreground">
        <span className="mono shrink-0 whitespace-nowrap">{course.code} · {course.credits} cr</span>
        <span className="flex shrink-0 items-center gap-1 whitespace-nowrap">
          <CategoryTag category={cat} label={role ? roleShort(role) : CATEGORY[cat].short} />
          {role?.pending && <AuditIcon status="pending" className="size-3" />}
        </span>
        {sched && offeredNow && (
          <span className="ml-auto min-w-0 truncate text-right">
            {picks.filter((p) => p.sections.length).every((p) => p.picked) ? (
              <span className="text-foreground/80">
                {picks.filter((p) => p.picked).map((p) => `Sec ${p.picked!.section}${picks.length > 1 ? (p.part.main ? '' : ' lab') : ''}`).join(' + ')} · {meetingSummary(picks.find((p) => p.picked)!.picked!)[0]}
              </span>
            ) : (
              <span className="font-medium text-foreground underline decoration-foreground/30 underline-offset-2">Choose a section</span>
            )}
          </span>
        )}
        {sched && !offeredNow && <span className="ml-auto text-destructive">Not offered {term.label}</span>}
        {!sched && timed.length > 0 && (
          <span className="ml-auto min-w-0 truncate">
            {fmtDays(timed[0].days)} {fmtTimeRange(timed[0].startTime, timed[0].endTime)}{timed.length > 1 ? ` +${timed.length - 1}` : ''}
          </span>
        )}
      </div>
    </li>
    </>
  )
}
