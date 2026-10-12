import { useMemo, useState } from 'react'
import { toast } from 'sonner'
import {
  LuCalendarDays,
  LuCalendarRange,
  LuCheck,
  LuChevronDown,
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
import { isFull, meetingSummary, partPicks, scheduleFor, termEvents, type UntimedItem } from '@/lib/schedule'
import { DAY_NAMES, fmtDate, fmtShortDate } from '@/lib/format'
import { courseColor } from '@/lib/colors'
import { pickSection, usePlanner } from '@/lib/store'
import type { Prefs } from '@/hooks/use-prefs'
import { DayCalendar, WeekCalendar } from '@/components/calendar'
import { SectionChooser } from '@/components/section-list'
import { ProfessorLink, Tag } from '@/components/bits'
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
  const { semesters, plan } = usePlanner()
  const term = semesters.find((s) => s.id === termId) ?? semesters[0]
  const entries = plan.schedule[term.id] ?? NO_ENTRIES
  const sched = scheduleFor(term.id)
  const { events, untimed, days } = useMemo(() => termEvents(term.id, entries), [term.id, entries])
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
      {mode === 'week' ? <WeekCalendar events={events} days={days} compact={!wide} /> : <DayCalendar events={events} day={day} />}
      {!events.length && needPicks > 0 && (
        <div className="pointer-events-none absolute inset-x-4 top-1/3 flex justify-center">
          <p className="rounded-lg border bg-background/95 px-4 py-2.5 text-center text-sm shadow-sm">
            Choose a section for each class {wide ? 'on the left' : 'below'} — your week fills in here.
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
      Classes {fmtShortDate(sched.classesStart)} – {fmtShortDate(sched.classesEnd)}. Choose a section for each class and the week fills in.
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
          <div className="flex items-center gap-2 border-b bg-background px-4 py-2">
            <h2 className="text-sm font-semibold">{term.label}</h2>
            <span className="mono text-xs text-muted-foreground">{fmtCredits(semesterCredits(plan.schedule, term.id))} cr</span>
            <div className="flex-1" />
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
  const [open, setOpen] = useState<string | null>(null)
  const picks = entries.map((e) => {
    const course = findCourse(e.courseId)!
    return { entry: e, course, parts: hasSchedule ? partPicks(course, e, term.id) : [] }
  })
  const allParts = picks.flatMap((p) => p.parts.filter((x) => x.sections.length))
  const chosen = allParts.filter((x) => x.picked)
  const crns = chosen.map((x) => x.picked!.crn)

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
          const isOpen = open === course.id
          const missingPick = parts.some((p) => p.sections.length && !p.picked)
          const notOffered = hasSchedule && !parts.some((p) => p.sections.length)
          return (
            <li key={course.id} className={cn('overflow-hidden rounded-xl border border-l-4 bg-card shadow-xs', color.edge)}>
              <div
                role="button"
                tabIndex={0}
                onClick={() => setOpen(isOpen ? null : course.id)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault()
                    setOpen(isOpen ? null : course.id)
                  }
                }}
                aria-expanded={isOpen}
                className="flex w-full cursor-pointer items-start gap-2 px-3 py-2.5 text-left hover:bg-accent/40 focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none"
              >
                <div className="min-w-0 flex-1">
                  <div className="flex items-baseline gap-2">
                    <span className="mono text-sm font-semibold">{course.code}</span>
                    <span className="mono text-[11px] text-muted-foreground">{course.credits} cr</span>
                  </div>
                  <div className="truncate text-xs text-muted-foreground">{course.title}</div>
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
                              <LuCheck className="size-3.5 text-foreground" aria-hidden />
                              {parts.length > 1 && <span className="mono font-medium">{p.part.code}</span>}
                              <span>Sec {p.picked.section}</span>
                              <span className="mono text-muted-foreground">CRN {p.picked.crn}</span>
                              <span className="text-muted-foreground">{meetingSummary(p.picked).join(' · ')}</span>
                              {p.picked.instructors[0] && <ProfessorLink profKey={p.picked.instructors[0].key} className="text-xs" />}
                              {isFull(p.picked) && <Tag tone="bad">Full</Tag>}
                            </div>
                          ) : (
                            <span className="inline-flex items-center gap-1.5 font-medium text-foreground">
                              <span className="size-1.5 rounded-full bg-foreground/50" aria-hidden />
                              Choose a {parts.length > 1 ? (p.part.main ? 'lecture' : 'lab') : ''} section · {p.sections.length} option{p.sections.length > 1 ? 's' : ''}
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
                <LuChevronDown className={cn('mt-1 size-4 shrink-0 text-muted-foreground transition-transform', isOpen && 'rotate-180')} aria-hidden />
              </div>
              {isOpen && (
                <div className="space-y-3 border-t bg-background/60 px-3 py-3">
                  {hasSchedule && !notOffered ? (
                    <SectionChooser
                      termId={term.id}
                      course={course}
                      entry={entry}
                      entries={entries}
                      onPick={(partCodeId, crn) => pickSection(term.id, course.id, partCodeId, crn)}
                    />
                  ) : null}
                  <Button variant="ghost" size="sm" className="w-full" onClick={() => ui.openCourse(course.id, term.id)}>
                    Course details
                  </Button>
                </div>
              )}
              {missingPick && !isOpen && <span className="sr-only">Needs a section</span>}
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
              <span className="mono">{u.code}</span>
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
                <span className="mono w-14 font-semibold">{x.picked!.crn}</span>
                <span className="mono">{x.part.code}</span>
                <span className="text-muted-foreground">Sec {x.picked!.section}</span>
                <span className="mono ml-auto text-muted-foreground">{x.part.credits} cr</span>
              </li>
            ))}
          </ul>
          <p className="text-[11px] leading-relaxed text-muted-foreground">
            Paste these into PAWS → Registration → Add or Drop Classes → Enter CRNs. Seat counts are as of{' '}
            {fmtDate(chosen[0].picked!.seats.asOf)}.
          </p>
        </div>
      )}
    </div>
  )
}
