import { useEffect, useMemo, useState } from 'react'
import { LuCalendarRange, LuCheck, LuChevronDown, LuSearch } from 'react-icons/lu'
import type { ScheduleCourse } from '@/lib/schedule-types'
import { isCourseDone } from '@/lib/planner'
import { scheduledIn } from '@/lib/plan-ops'
import { courseNeed } from '@/lib/relevance'
import { SCHEDULE_TERM_ID, isFull, libraryCourseFor, scheduleFor, scheduleTitle, seatsAsOf, useScheduleVersion } from '@/lib/schedule'
import type { PlannerSnapshot } from '@/lib/store'
import { fmtAgo } from '@/lib/format'
import { AppDialog } from '@/components/app-dialog'
import { SectionCard } from '@/components/section-list'
import { Tag } from '@/components/bits'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import { useUi } from '@/components/ui-context'
import { cn } from '@/lib/utils'

/**
 * The released class schedule, so any option can be compared: professor, days and times,
 * room, seats. It opens on the classes she needs (in the plan, or filling a requirement
 * that's still open); "Every class" shows the whole schedule.
 */
export function ClassBrowser({ query, onClose, snap }: { query: string | null; onClose: () => void; snap: PlannerSnapshot }) {
  const ui = useUi()
  const version = useScheduleVersion()
  const sched = scheduleFor(SCHEDULE_TERM_ID)
  const [q, setQ] = useState('')
  const [scope, setScope] = useState<'needed' | 'all'>('needed')
  const [subjects, setSubjects] = useState<string[]>([])
  const [openCode, setOpenCode] = useState<string | null>(null)

  useEffect(() => {
    if (query === null) return
    setQ(query)
    setOpenCode(null)
  }, [query])

  const needed = useMemo(() => {
    const keep = new Set<string>()
    for (const c of sched?.courses ?? []) {
      const lib = libraryCourseFor(c.codeId)
      if (lib && courseNeed(lib, snap).needed) keep.add(c.codeId)
    }
    return keep
  }, [sched, snap, version]) // eslint-disable-line react-hooks/exhaustive-deps

  const inScope = useMemo(() => (sched?.courses ?? []).filter((c) => scope === 'all' || needed.has(c.codeId)), [sched, scope, needed])
  const allSubjects = useMemo(() => [...new Set(inScope.map((c) => c.subject))], [inScope])
  const courses = useMemo(() => {
    const words = q.trim().toLowerCase().split(/\s+/).filter(Boolean)
    return inScope.filter((c) => {
      if (subjects.length && !subjects.includes(c.subject)) return false
      if (!words.length) return true
      const hay = `${scheduleTitle(c.codeId, c.title)} ${c.code} ${c.codeId} ${c.title} ${c.sections.map((s) => `${s.crn} ${s.instructors.map((i) => i.display).join(' ')}`).join(' ')}`.toLowerCase()
      return words.every((w) => hay.includes(w))
    })
  }, [inScope, q, subjects])

  if (!sched) return null
  const asOf = seatsAsOf(SCHEDULE_TERM_ID)
  const total = sched.courses.length

  return (
    <AppDialog
      open={query !== null}
      onOpenChange={(o) => !o && onClose()}
      size="xl"
      eyebrow={`${sched.label} class schedule`}
      title={scope === 'needed' ? 'Classes you need' : 'Every class and section'}
      description={`${courses.length} of ${total} courses · seats from GSU, updated ${asOf ? fmtAgo(asOf) : '—'}`}
      headerExtra={
        <div className="space-y-2 pt-2">
          <div className="flex flex-wrap items-center gap-2">
            <div className="relative min-w-48 flex-1">
              <LuSearch className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground" aria-hidden />
              <Input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Class name, professor or CRN…" className="h-9 pl-8" aria-label="Search classes" />
            </div>
            <ToggleGroup type="single" size="sm" variant="outline" value={scope} onValueChange={(v) => { if (v) { setScope(v as 'needed' | 'all'); setSubjects([]) } }} aria-label="Which classes">
              <ToggleGroupItem value="needed" className="h-9 px-3 text-xs">What you need · {needed.size}</ToggleGroupItem>
              <ToggleGroupItem value="all" className="h-9 px-3 text-xs">Every class · {total}</ToggleGroupItem>
            </ToggleGroup>
          </div>
          {allSubjects.length > 1 && (
            <ToggleGroup type="multiple" size="sm" variant="outline" value={subjects} onValueChange={setSubjects} className="no-scrollbar flex w-full justify-start overflow-x-auto sm:flex-wrap">
              {allSubjects.map((s) => (
                <ToggleGroupItem key={s} value={s} className="mono h-7 flex-none px-2 text-[11px]">{s}</ToggleGroupItem>
              ))}
            </ToggleGroup>
          )}
        </div>
      }
    >
      <ul className="space-y-2">
        {courses.map((c) => (
          <CourseItem key={c.codeId} c={c} snap={snap} open={openCode === c.codeId} onToggle={() => setOpenCode(openCode === c.codeId ? null : c.codeId)} openCourse={ui.openCourse} />
        ))}
        {!courses.length && (
          <li className="space-y-2 py-8 text-center text-sm text-muted-foreground">
            <p>No classes match.</p>
            {scope === 'needed' && (
              <Button variant="outline" size="sm" onClick={() => setScope('all')}>
                Search every class
              </Button>
            )}
          </li>
        )}
      </ul>
    </AppDialog>
  )
}

function CourseItem({ c, snap, open, onToggle, openCourse }: {
  c: ScheduleCourse
  snap: PlannerSnapshot
  open: boolean
  onToggle: () => void
  openCourse: (id: string, term?: string | null) => void
}) {
  const lib = libraryCourseFor(c.codeId)
  const done = lib ? isCourseDone(lib.id) : false
  const inSem = lib && !done ? scheduledIn(snap.semesters, snap.plan.schedule, lib.id) : null
  const entry = inSem === SCHEDULE_TERM_ID ? (snap.plan.schedule[SCHEDULE_TERM_ID] || []).find((e) => e.courseId === lib!.id) ?? null : null
  const savedCrn = entry?.sections?.[c.codeId]
  const open1 = c.sections.filter((s) => !isFull(s)).length
  const canPlan = !!lib && !done && snap.semesters.some((s) => s.id === SCHEDULE_TERM_ID)
  const title = scheduleTitle(c.codeId, c.title)

  return (
    <li className="overflow-hidden rounded-xl border bg-card" data-code={c.codeId}>
      <button type="button" onClick={onToggle} aria-expanded={open} className="flex w-full items-start gap-2 px-3 py-2.5 text-left hover:bg-accent/40">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <span className="text-sm font-semibold">{title}</span>
            {done && <Tag><LuCheck className="size-3" aria-hidden /> done</Tag>}
            {inSem && <Tag tone="strong">{snap.semesters.find((s) => s.id === inSem)?.shortLabel}</Tag>}
            {!lib && <Tag title="Not one of the courses in Eunbee’s degree plan list">not in your list</Tag>}
          </div>
          <div className="mono text-[11px] text-muted-foreground">
            {c.code} · {c.sections.length} section{c.sections.length === 1 ? '' : 's'} · {open1} open
          </div>
        </div>
        <LuChevronDown className={cn('mt-0.5 size-4 shrink-0 text-muted-foreground transition-transform', open && 'rotate-180')} aria-hidden />
      </button>
      {open && (
        <div className="space-y-2 border-t bg-background/60 p-3">
          {canPlan && (
            <Button size="sm" className="w-full sm:w-auto" onClick={() => openCourse(lib!.id, inSem)}>
              <LuCalendarRange className="size-3.5" aria-hidden />
              {savedCrn ? 'Change the section on your week' : 'Choose a section on your week'}
            </Button>
          )}
          {lib && done && <p className="text-xs text-muted-foreground">Already completed.</p>}
          {!lib && <p className="text-xs text-muted-foreground">Shown for reference — this course isn’t in the planner’s course list.</p>}
          {c.sections.map((s) => (
            <SectionCard key={s.crn} section={s} saved={savedCrn === s.crn} readOnly />
          ))}
        </div>
      )}
    </li>
  )
}
