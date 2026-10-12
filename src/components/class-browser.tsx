import { useEffect, useMemo, useState } from 'react'
import { LuCheck, LuChevronDown, LuSearch } from 'react-icons/lu'
import type { ScheduleCourse } from '@/lib/schedule-types'
import { isCourseDone } from '@/lib/planner'
import { scheduledIn } from '@/lib/plan-ops'
import { SCHEDULE_TERM_ID, isFull, libraryCourseFor, scheduleFor } from '@/lib/schedule'
import { addCourse, pickSection, type PlannerSnapshot } from '@/lib/store'
import { fmtDate } from '@/lib/format'
import { AppDialog } from '@/components/app-dialog'
import { SectionOption } from '@/components/section-list'
import { Tag } from '@/components/bits'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import { useUi } from '@/components/ui-context'
import { cn } from '@/lib/utils'

/**
 * Every class in the released schedule — not just the ones in the plan — so any
 * option can be compared: professor, days and times, room, seats. Classes from the
 * course list can go straight into the plan with the chosen section.
 */
export function ClassBrowser({ query, onClose, snap }: { query: string | null; onClose: () => void; snap: PlannerSnapshot }) {
  const ui = useUi()
  const sched = scheduleFor(SCHEDULE_TERM_ID)
  const [q, setQ] = useState('')
  const [subjects, setSubjects] = useState<string[]>([])
  const [openCode, setOpenCode] = useState<string | null>(null)

  useEffect(() => {
    if (query === null) return
    setQ(query)
    setOpenCode(null)
  }, [query])

  const allSubjects = useMemo(() => [...new Set(sched?.courses.map((c) => c.subject) ?? [])], [sched])
  const courses = useMemo(() => {
    if (!sched) return []
    const words = q.trim().toLowerCase().split(/\s+/).filter(Boolean)
    return sched.courses.filter((c) => {
      if (subjects.length && !subjects.includes(c.subject)) return false
      if (!words.length) return true
      const hay = `${c.code} ${c.codeId} ${c.title} ${c.sections.map((s) => `${s.title} ${s.crn} ${s.instructors.map((i) => i.display).join(' ')}`).join(' ')}`.toLowerCase()
      return words.every((w) => hay.includes(w))
    })
  }, [sched, q, subjects])

  if (!sched) return null
  const entries = snap.plan.schedule[SCHEDULE_TERM_ID] || []

  return (
    <AppDialog
      open={query !== null}
      onOpenChange={(o) => !o && onClose()}
      size="xl"
      eyebrow={`${sched.label} class schedule`}
      title="Every class and section"
      description={`${sched.courses.length} courses · ${sched.courses.reduce((n, c) => n + c.sections.length, 0)} sections · seats as of ${fmtDate(sched.sources.banner?.fetchedAt ?? sched.generatedAt)}`}
      headerExtra={
        <div className="space-y-2 pt-2">
          <div className="relative">
            <LuSearch className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground" aria-hidden />
            <Input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Course, title, professor or CRN…" className="h-9 pl-8" aria-label="Search classes" />
          </div>
          <ToggleGroup type="multiple" size="sm" variant="outline" value={subjects} onValueChange={setSubjects} className="no-scrollbar flex w-full justify-start overflow-x-auto sm:flex-wrap">
            {allSubjects.map((s) => (
              <ToggleGroupItem key={s} value={s} className="mono h-7 flex-none px-2 text-[11px]">{s}</ToggleGroupItem>
            ))}
          </ToggleGroup>
        </div>
      }
    >
      <ul className="space-y-2">
        {courses.map((c) => (
          <CourseItem key={c.codeId} c={c} snap={snap} entries={entries} open={openCode === c.codeId} onToggle={() => setOpenCode(openCode === c.codeId ? null : c.codeId)} openCourse={ui.openCourse} />
        ))}
        {!courses.length && <li className="py-8 text-center text-sm text-muted-foreground">No classes match.</li>}
      </ul>
    </AppDialog>
  )
}

function CourseItem({ c, snap, entries, open, onToggle, openCourse }: {
  c: ScheduleCourse
  snap: PlannerSnapshot
  entries: PlannerSnapshot['plan']['schedule'][string]
  open: boolean
  onToggle: () => void
  openCourse: (id: string, term?: string | null) => void
}) {
  const lib = libraryCourseFor(c.codeId)
  const done = lib ? isCourseDone(lib.id) : false
  const inSem = lib && !done ? scheduledIn(snap.semesters, snap.plan.schedule, lib.id) : null
  const inSpring = inSem === SCHEDULE_TERM_ID
  const entry = inSpring ? entries.find((e) => e.courseId === lib!.id) ?? null : null
  const pickedCrn = entry?.sections?.[c.codeId]
  const open1 = c.sections.filter((s) => !isFull(s)).length
  const canPlan = !!lib && !done && snap.semesters.some((s) => s.id === SCHEDULE_TERM_ID)

  const choose = (crn: string) => {
    if (!lib) return
    if (!inSpring && !addCourse(lib.id, SCHEDULE_TERM_ID)) return
    pickSection(SCHEDULE_TERM_ID, lib.id, c.codeId, pickedCrn === crn ? null : crn)
  }

  return (
    <li className="overflow-hidden rounded-xl border bg-card">
      <button type="button" onClick={onToggle} aria-expanded={open} className="flex w-full items-start gap-2 px-3 py-2.5 text-left hover:bg-accent/40">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <span className="mono text-sm font-semibold">{c.code}</span>
            {done && <Tag><LuCheck className="size-3" aria-hidden /> done</Tag>}
            {inSem && <Tag tone="strong">{snap.semesters.find((s) => s.id === inSem)?.shortLabel}</Tag>}
            {!lib && <Tag title="Not one of the courses in Bee's degree plan list">not in your list</Tag>}
          </div>
          <div className="truncate text-xs text-muted-foreground">{c.title}</div>
        </div>
        <span className="mono shrink-0 pt-0.5 text-[11px] text-muted-foreground">
          {c.sections.length} sec · {open1} open
        </span>
        <LuChevronDown className={cn('mt-0.5 size-4 shrink-0 text-muted-foreground transition-transform', open && 'rotate-180')} aria-hidden />
      </button>
      {open && (
        <div className="space-y-2 border-t bg-background/60 p-3">
          {canPlan ? (
            <p className="text-xs text-muted-foreground">
              {inSpring
                ? 'Tap a section to choose it for your plan.'
                : inSem
                  ? `Tap a section to move ${lib!.code} from ${snap.semesters.find((s) => s.id === inSem)?.label} to Spring 2027 with that section.`
                  : `Tap a section to add ${lib!.code} to Spring 2027 with that section.`}
            </p>
          ) : lib && done ? (
            <p className="text-xs text-muted-foreground">Already completed.</p>
          ) : !lib ? (
            <p className="text-xs text-muted-foreground">Shown for reference — this course isn’t in the planner’s course list.</p>
          ) : null}
          {c.sections.map((s) => (
            <SectionOption
              key={s.crn}
              section={s}
              selected={pickedCrn === s.crn}
              conflicts={[]}
              readOnly={!canPlan}
              onSelect={canPlan ? () => choose(s.crn) : undefined}
            />
          ))}
          {lib && (
            <Button variant="ghost" size="sm" className="w-full" onClick={() => openCourse(lib.id, inSem)}>
              Course details
            </Button>
          )}
        </div>
      )}
    </li>
  )
}
