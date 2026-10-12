import { useMemo, useState } from 'react'
import { toast } from 'sonner'
import {
  LuCalendarDays,
  LuCalendarRange,
  LuCheck,
  LuChevronRight,
  LuCircleAlert,
  LuClipboardCheck,
  LuCopy,
  LuSearch,
  LuTriangleAlert,
} from 'react-icons/lu'
import type { PlanEntry, Term, TermId } from '@/lib/types'
import type { DayCode } from '@/lib/schedule-types'
import { findCourse, fmtCredits } from '@/lib/planner'
import { semesterCredits } from '@/lib/plan-ops'
import { isFull, meetingSummary, partPicks, scheduleFor, seatsAsOf, shortGaps, termEvents, useScheduleVersion, type UntimedItem } from '@/lib/schedule'
import { DAY_NAMES, fmtAgo, fmtDateTime, fmtShortDate } from '@/lib/format'
import { courseColor } from '@/lib/colors'
import { usePlanner } from '@/lib/store'
import type { Prefs } from '@/hooks/use-prefs'
import { DayCalendar, WeekCalendar } from '@/components/calendar'
import { PlanTabs } from '@/components/plans'
import { CategoryTag, ProfessorLink, Tag } from '@/components/bits'
import { categoryOf } from '@/lib/colors'
import { Button } from '@/components/ui/button'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import { useUi } from '@/components/ui-context'
import { cn } from '@/lib/utils'

const WEEKDAYS: DayCode[] = ['M', 'T', 'W', 'Th', 'F']
const NO_ENTRIES: PlanEntry[] = []

function todayCode(): DayCode {
  const d = new Date().getDay()
  return (['M', 'M', 'T', 'W', 'Th', 'F', 'M'] as DayCode[])[d]
}

export function ScheduleView({
  termId,
  onTerm,
  prefs,
  setPref,
  wide,
}: {
  termId: TermId
  onTerm: (t: TermId) => void
  prefs: Prefs
  setPref: <K extends keyof Prefs>(k: K, v: Prefs[K]) => void
  /** Side-by-side layout (computer); stacked on a phone. */
  wide: boolean
}) {
  const ui = useUi()
  const snap = usePlanner()
  const { semesters, plan } = snap
  const term = semesters.find((s) => s.id === termId) ?? semesters[0]
  const entries = plan.schedule[term.id] ?? NO_ENTRIES
  const sched = scheduleFor(term.id)
  const version = useScheduleVersion()
  const { events, untimed, days } = useMemo(() => termEvents(term.id, entries), [term.id, entries, version]) // eslint-disable-line react-hooks/exhaustive-deps
  const gaps = useMemo(() => shortGaps(events, { maxMinutes: 30 }), [events])
  const [day, setDay] = useState<DayCode>(() => todayCode())
  const conflicts = new Set(events.filter((e) => e.conflict).map((e) => e.partCode)).size
  const mode = prefs.calendarMode

  const toolbar = (
    <div className="flex flex-wrap items-center gap-2">
      <ToggleGroup
        type="single"
        size="sm"
        variant="outline"
        value={mode}
        onValueChange={(v) => v && setPref('calendarMode', v as Prefs['calendarMode'])}
        aria-label="Calendar view"
      >
        <ToggleGroupItem value="week" className="px-3 text-xs">
          <LuCalendarRange className="size-3.5" aria-hidden />
          Week
        </ToggleGroupItem>
        <ToggleGroupItem value="day" className="px-3 text-xs">
          <LuCalendarDays className="size-3.5" aria-hidden />
          Day
        </ToggleGroupItem>
      </ToggleGroup>
      {conflicts > 0 && (
        <Tag tone="bad">
          <LuTriangleAlert className="size-3" aria-hidden />
          {conflicts} time conflict{conflicts > 1 ? 's' : ''}
        </Tag>
      )}
    </div>
  )

  const dayChips = mode === 'day' && (
    <div className="flex gap-1.5" role="tablist" aria-label="Day">
      {(days.length > 5 ? days : WEEKDAYS).map((d) => {
        const n = new Set(events.filter((e) => e.day === d).map((e) => e.partCode)).size
        return (
          <button
            key={d}
            type="button"
            role="tab"
            aria-selected={day === d}
            onClick={() => setDay(d)}
            className={cn(
              'flex min-w-0 flex-1 flex-col items-center rounded-lg border px-1 py-1.5 transition-colors',
              day === d ? 'border-primary bg-primary text-primary-foreground' : 'bg-card hover:bg-accent',
            )}
          >
            <span className="text-xs font-semibold">{DAY_NAMES[d].short}</span>
            <span className={cn('mono text-[10px]', day === d ? 'opacity-80' : 'text-muted-foreground')}>{n ? `${n} class${n > 1 ? 'es' : ''}` : 'free'}</span>
          </button>
        )
      })}
    </div>
  )

  const needPicks = untimed.filter((u) => u.reason === 'pick').length
  const calendarCard = (
    <div className="relative space-y-3 rounded-xl border bg-card p-3 shadow-sm sm:p-4">
      {dayChips}
      {mode === 'week' ? <WeekCalendar events={events} days={days} compact={!wide} gaps={gaps} /> : <DayCalendar events={events} day={day} gaps={gaps} />}
      {!events.length && needPicks > 0 && (
        <div className="pointer-events-none absolute inset-x-4 top-1/3 flex justify-center">
          <p className="rounded-lg border bg-background/95 px-4 py-2.5 text-center text-sm shadow-sm">
            Open a class {wide ? 'on the left' : 'below'} to choose its section — your week fills in here.
          </p>
        </div>
      )}
      {!events.length && !untimed.length && (
        <p className="text-center text-xs text-muted-foreground">Nothing planned for {term.label} yet.</p>
      )}
    </div>
  )

  const classes = (
    <ClassesPanel term={term} entries={entries} untimed={untimed} hasSchedule={!!sched} />
  )

  const termSelect = (
    <Select value={term.id} onValueChange={onTerm}>
      <SelectTrigger size="sm" className={cn('h-9 gap-1.5 font-medium', wide ? 'w-auto' : 'w-full')} aria-label="Term">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {semesters.map((s) => (
          <SelectItem key={s.id} value={s.id}>
            {s.label}
            {scheduleFor(s.id) ? <span className="ml-1 text-xs text-muted-foreground">· class schedule out</span> : null}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )

  const intro = sched ? (
    <p className="text-xs leading-relaxed text-muted-foreground">
      Classes {fmtShortDate(sched.classesStart)} – {fmtShortDate(sched.classesEnd)}. Open a class to compare its sections on your week, then save one.
    </p>
  ) : (
    <p className="text-xs leading-relaxed text-muted-foreground">
      GSU hasn’t released the {term.label} class schedule yet. You can still type in meeting times from a course’s details.
    </p>
  )

  if (wide) {
    return (
      <div className="flex h-full min-h-0">
        <aside className="flex w-[25rem] shrink-0 flex-col border-r bg-sidebar">
          <div className="space-y-2 border-b p-3">
            <div className="flex items-center gap-2">
              {termSelect}
              <div className="flex-1" />
              <Button variant="outline" size="sm" onClick={() => ui.openClassBrowser()}>
                <LuSearch className="size-3.5" aria-hidden />
                All classes
              </Button>
            </div>
            {intro}
          </div>
          <ScrollArea className="min-h-0 flex-1 [&>[data-slot=scroll-area-viewport]>div]:!block">
            <div className="p-3">{classes}</div>
          </ScrollArea>
        </aside>
        <div className="flex min-w-0 flex-1 flex-col bg-board">
          <div className="flex items-center gap-3 border-b bg-background px-4 py-2">
            <h2 className="shrink-0 text-sm font-semibold">{term.label}</h2>
            <span className="mono shrink-0 text-xs text-muted-foreground">{fmtCredits(semesterCredits(plan.schedule, term.id))} cr</span>
            {/* Switch plans right here to compare their weeks. */}
            <div className="min-w-0 flex-1">
              <PlanTabs snap={snap} compact />
            </div>
            {toolbar}
          </div>
          <ScrollArea className="min-h-0 flex-1 [&>[data-slot=scroll-area-viewport]>div]:!block">
            <div className="mx-auto max-w-5xl p-4">{calendarCard}</div>
          </ScrollArea>
        </div>
      </div>
    )
  }

  return (
    <ScrollArea className="h-full [&>[data-slot=scroll-area-viewport]>div]:!block">
      <div className="min-w-0 space-y-4 p-3 pb-8">
        <div className="space-y-2">
          <PlanTabs snap={snap} compact />
          {termSelect}
          {toolbar}
          {intro}
        </div>
        {calendarCard}
        {classes}
        <Button variant="outline" className="w-full" onClick={() => ui.openClassBrowser()}>
          <LuSearch className="size-4" aria-hidden />
          Browse every {term.label} class
        </Button>
      </div>
    </ScrollArea>
  )
}

/* ─── The classes in the term, with their sections ───────────────────────── */

function ClassesPanel({ term, entries, untimed, hasSchedule }: { term: Term; entries: PlanEntry[]; untimed: UntimedItem[]; hasSchedule: boolean }) {
  const ui = useUi()
  const roles = usePlanner().audit.roles
  const picks = entries.map((e) => {
    const course = findCourse(e.courseId)!
    return { entry: e, course, parts: hasSchedule ? partPicks(course, e, term.id) : [] }
  })
  const allParts = picks.flatMap((p) => p.parts.filter((x) => x.sections.length))
  const chosen = allParts.filter((x) => x.picked)
  const crns = chosen.map((x) => x.picked!.crn)
  const asOf = seatsAsOf(term.id)

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(crns.join(', '))
      toast.success(`Copied ${crns.length} CRN${crns.length === 1 ? '' : 's'}`)
    } catch {
      toast.error('Could not copy — select the numbers and copy them instead.')
    }
  }

  if (!entries.length) {
    return (
      <div className="space-y-3 rounded-xl border border-dashed p-5 text-center">
        <p className="text-sm text-muted-foreground">No classes planned for {term.label}.</p>
        <Button size="sm" variant="outline" onClick={() => ui.openLibrary(term.id)}>
          Add a class
        </Button>
      </div>
    )
  }

  return (
    <div className="space-y-3">
      {hasSchedule && (
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <span className="font-medium text-foreground">Your classes</span>
          <span className="mono">
            {chosen.length}/{allParts.length} sections chosen
          </span>
        </div>
      )}
      <ul className="space-y-2">
        {picks.map(({ entry, course, parts }, i) => {
          const color = courseColor(i)
          const notOffered = hasSchedule && !parts.some((p) => p.sections.length)
          const multi = parts.filter((p) => p.sections.length).length > 1
          return (
            <li key={course.id}>
              <div
                role="button"
                tabIndex={0}
                onClick={() => ui.openCourse(course.id, term.id)}
                onKeyDown={(e) => {
                  if (e.target === e.currentTarget && (e.key === 'Enter' || e.key === ' ')) {
                    e.preventDefault()
                    ui.openCourse(course.id, term.id)
                  }
                }}
                data-course={course.id}
                className={cn(
                  'flex w-full cursor-pointer items-start gap-2 overflow-hidden rounded-xl border border-l-4 bg-card px-3 py-2.5 text-left shadow-xs transition-colors hover:bg-accent/40 focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none',
                  color.edge,
                )}
              >
                <div className="min-w-0 flex-1">
                  <div className="flex items-start gap-2">
                    <span className="min-w-0 flex-1 text-sm leading-snug font-semibold">{course.title}</span>
                    <CategoryTag category={categoryOf(course, roles[course.id])} className="mt-px" />
                  </div>
                  <div className="mono text-[11px] text-muted-foreground">{course.code} · {course.credits} cr</div>
                  {hasSchedule && (
                    <div className="mt-1.5 space-y-1">
                      {notOffered && (
                        <div className="inline-flex items-center gap-1.5 text-xs font-medium text-destructive">
                          <LuCircleAlert className="size-3.5" aria-hidden />
                          Not offered in {term.label}
                        </div>
                      )}
                      {parts.filter((p) => p.sections.length).map((p) => (
                        <div key={p.part.codeId} className="text-xs">
                          {p.picked ? (
                            <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
                              <LuCheck className="size-3.5 text-green-600 dark:text-green-400" aria-hidden />
                              {multi && <span className="font-medium">{p.part.main ? 'Lecture' : 'Lab'}</span>}
                              <span>Sec {p.picked.section}</span>
                              <span className="mono text-muted-foreground">CRN {p.picked.crn}</span>
                              <span className="text-muted-foreground">{meetingSummary(p.picked).join(' · ')}</span>
                              {p.picked.instructors[0] && <ProfessorLink profKey={p.picked.instructors[0].key} className="text-xs" />}
                              {isFull(p.picked) && <Tag tone="bad">Full</Tag>}
                            </div>
                          ) : (
                            <span className="inline-flex items-center gap-1.5 font-medium text-foreground">
                              <span className="size-1.5 rounded-full bg-foreground/50" aria-hidden />
                              Choose a {multi ? (p.part.main ? 'lecture' : 'lab') : ''} section · {p.sections.length} option{p.sections.length > 1 ? 's' : ''}
                            </span>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                  {!hasSchedule && (
                    <div className="mt-1 text-xs text-muted-foreground">
                      {entry.blocks.some((b) => b.days.length && b.startTime) ? 'Meeting times entered' : 'No meeting times yet'}
                    </div>
                  )}
                </div>
                <LuChevronRight className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden />
              </div>
            </li>
          )
        })}
      </ul>

      {untimed.filter((u) => u.reason === 'async' || u.reason === 'arranged').length > 0 && (
        <div className="rounded-xl border bg-card px-3 py-2.5 text-xs">
          <div className="mb-1 font-medium">No set meeting time</div>
          {untimed.filter((u) => u.reason === 'async' || u.reason === 'arranged').map((u) => (
            <div key={u.code} className="flex items-center gap-2 text-muted-foreground">
              <span className={cn('size-2 rounded-full', courseColor(u.colorIndex).dot)} aria-hidden />
              <span className="text-foreground">{u.title}</span>
              {u.reason === 'async' ? 'online, at your own pace' : 'time arranged with the instructor'}
            </div>
          ))}
        </div>
      )}

      {hasSchedule && crns.length > 0 && (
        <div className="space-y-2 rounded-xl border bg-card p-3">
          <div className="flex items-center gap-2">
            <LuClipboardCheck className="size-4 text-muted-foreground" aria-hidden />
            <span className="flex-1 text-sm font-medium">CRNs for registration</span>
            <Button size="sm" variant="outline" onClick={copy}>
              <LuCopy className="size-3.5" aria-hidden />
              Copy
            </Button>
          </div>
          <ul className="divide-y text-xs">
            {chosen.map((x) => (
              <li key={x.picked!.crn} className="flex items-center gap-2 py-1.5">
                <span className="mono w-12 shrink-0 font-semibold">{x.picked!.crn}</span>
                <span className="min-w-0 flex-1 truncate">{x.part.title}</span>
                <span className="mono shrink-0 text-muted-foreground">{x.part.code} · Sec {x.picked!.section}</span>
              </li>
            ))}
          </ul>
          <p className="text-[11px] leading-relaxed text-muted-foreground">
            Paste these into PAWS → Registration → Add or Drop Classes → Enter CRNs.
            {asOf && <> Seats from GSU, updated {fmtAgo(asOf)} ({fmtDateTime(asOf)}).</>}
          </p>
        </div>
      )}
    </div>
  )
}
