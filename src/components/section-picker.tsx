import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { LuCheck, LuCircleAlert, LuMousePointerClick, LuTriangleAlert } from 'react-icons/lu'
import type { PlanEntry } from '@/lib/types'
import { fmtCredits } from '@/lib/planner'
import { semesterCredits } from '@/lib/plan-ops'
import { clashesFor, hourRange, seatsAsOf, timedMeetings, type Gap } from '@/lib/schedule'
import { refreshLiveSchedule } from '@/lib/live-schedule'
import type { PlannerSnapshot } from '@/lib/store'
import type { SectionPicker } from '@/hooks/use-section-picker'
import { fmtAgo, fmtDateTime, fmtDaysLong } from '@/lib/format'
import { SectionCard } from '@/components/section-list'
import { WeekCalendar } from '@/components/calendar'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

const NO_ENTRIES: PlanEntry[] = []

/*
 * Choosing a section: every option on one side, the week on the other. Tapping a section only
 * previews it on the calendar, next to the classes already chosen; Save writes it into the plan.
 * A section that overlaps another class can be previewed — so the clash is plain to see — but
 * not saved.
 */

/* ─── The options ────────────────────────────────────────────────────────── */

export function PickerSections({ picker, snap }: { picker: SectionPicker; snap: PlannerSnapshot }) {
  const { course, term, parts, draft } = picker
  const entries = snap.plan.schedule[term.id] ?? NO_ENTRIES
  const multi = parts.filter((p) => p.sections.length).length > 1
  const asOf = seatsAsOf(term.id)

  // Fresh seat counts when the sections open (at most once a minute).
  useEffect(() => { void refreshLiveSchedule() }, [])

  return (
    <div className="space-y-4" data-picker-sections>
      <p className="text-xs leading-relaxed text-muted-foreground">
        {picker.inTerm
          ? `Tap a section to see it on your week, then Save.`
          : picker.plannedIn
            ? `Planned for ${picker.plannedIn.label}. Preview the ${term.label} sections; saving one moves the course to ${term.label}.`
            : `Not in your plan yet. Preview a section; saving adds the course to ${term.label}.`}
        {asOf && <span className="block pt-0.5" title={fmtDateTime(asOf)}>Seats from GSU, updated {fmtAgo(asOf)}.</span>}
      </p>
      {parts.map(({ part, sections, saved, previewing }) => (
        <div key={part.codeId} className="space-y-2">
          {multi && (
            <div className="flex items-baseline gap-2 text-xs">
              <span className="font-semibold">{part.main ? 'Lecture' : 'Lab'}</span>
              <span className="text-muted-foreground">{part.title}</span>
              <span className="mono ml-auto shrink-0 text-muted-foreground">{part.code} · {part.credits} cr</span>
            </div>
          )}
          {sections.length === 0 ? (
            <p className="rounded-lg border border-dashed px-3 py-3 text-xs text-muted-foreground">No {part.code} sections in this term’s schedule.</p>
          ) : (
            <div role="radiogroup" aria-label={`${part.code} sections`} className="space-y-1.5">
              {sections.map((s) => (
                <SectionCard
                  key={s.crn}
                  section={s}
                  previewing={previewing?.crn === s.crn}
                  saved={saved?.crn === s.crn}
                  clashes={clashesFor(term.id, entries, course.id, part.codeId, s, draft)}
                  onSelect={() => picker.choose(part.codeId, s.crn)}
                />
              ))}
            </div>
          )}
          {previewing && (
            <button type="button" className="text-xs text-muted-foreground underline-offset-2 hover:text-foreground hover:underline" onClick={() => picker.choose(part.codeId, null)}>
              {saved ? `Clear the ${multi ? (part.main ? 'lecture' : 'lab') : 'section'} choice` : 'Clear the preview'}
            </button>
          )}
        </div>
      ))}
    </div>
  )
}

/* ─── The week ───────────────────────────────────────────────────────────── */

function useHeight<T extends HTMLElement>(): [React.RefObject<T | null>, number] {
  const ref = useRef<T>(null)
  const [height, setHeight] = useState(0)
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const ro = new ResizeObserver(([e]) => setHeight(e.contentRect.height))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])
  return [ref, height]
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v))

/** The term's week with the previewed section in it. `fill`: grow to the column's height (computer). */
export function PickerWeek({ picker, snap, fill, isTouch, stackHeight = 156 }: {
  picker: SectionPicker
  snap: PlannerSnapshot
  /** Grow to the column's height (computer); otherwise a strip `stackHeight` px tall above the options. */
  fill: boolean
  isTouch: boolean
  stackHeight?: number
}) {
  const { course, term, events, days, gaps, parts } = picker
  const [ref, height] = useHeight<HTMLDivElement>()
  const range = hourRange(events, fill ? [8, 18] : [9, 17])
  const hours = range[1] - range[0]
  const px = fill ? clamp((height - 30) / hours, 26, 64) : clamp(stackHeight / hours, 15, 40)
  const compact = !fill && stackHeight < 240
  const focus = events.filter((e) => e.courseId === course.id)
  const clashes = focus.some((e) => e.conflict)
  const untimed = parts.filter((p) => p.previewing && !timedMeetings(p.previewing).length)
  const credits = semesterCredits(snap.plan.schedule, term.id) + (picker.inTerm ? 0 : course.credits)

  return (
    <div className={cn('flex min-h-0 flex-col', fill ? 'h-full px-5 pt-4 pb-3' : 'px-3 pt-2.5 pb-2')} data-picker-week>
      <div className="mb-1.5 flex flex-wrap items-center gap-x-3 gap-y-1">
        <h3 className="text-sm font-semibold tracking-tight">Your {term.label} week</h3>
        <span className="mono text-[11px] text-muted-foreground">{fmtCredits(credits)}/{term.maxCredits} cr{picker.inTerm ? '' : ' with it'}</span>
        <div className="ml-auto flex items-center gap-3 text-[11px] text-muted-foreground">
          <span className="inline-flex items-center gap-1.5">
            <span className="size-2.5 rounded-[3px] bg-muted ring-2 ring-foreground/75 ring-inset" aria-hidden />
            This class
          </span>
          {clashes ? (
            <span className="inline-flex items-center gap-1 font-medium text-destructive">
              <LuTriangleAlert className="size-3" aria-hidden /> Overlap
            </span>
          ) : (
            <span className="hidden items-center gap-1.5 sm:inline-flex">
              <span className="size-2.5 rounded-[3px] bg-muted-foreground/25" aria-hidden />
              Your other classes
            </span>
          )}
        </div>
      </div>
      <div ref={ref} className={cn('relative min-h-0', fill && 'flex-1')}>
        {(!fill || height > 0) && (
          <WeekCalendar events={events} days={days} compact={compact} interactive={false} pxPerHour={px} range={range} focusCourseId={course.id} gaps={gaps} />
        )}
        {!focus.length && !untimed.length && (
          <div className="pointer-events-none absolute inset-x-0 top-1/3 flex justify-center px-4">
            <p className="flex items-center gap-2 rounded-lg border bg-background/95 px-3 py-2 text-center text-xs shadow-sm sm:text-sm">
              <LuMousePointerClick className="size-4 shrink-0 text-muted-foreground" aria-hidden />
              {isTouch ? 'Tap a section below to see it here' : 'Click a section on the left to see it here'}
            </p>
          </div>
        )}
      </div>
      {untimed.length > 0 && (
        <p className="mt-1.5 text-[11px] text-muted-foreground">
          {untimed.map((p) => `Section ${p.previewing!.section}`).join(', ')} {untimed.length > 1 ? 'have' : 'has'} no set meeting time (online at your own pace, or arranged).
        </p>
      )}
    </div>
  )
}

/* ─── Save ───────────────────────────────────────────────────────────────── */

function shortestBreak(gaps: Gap[], courseId: string): string | null {
  if (!gaps.length) return null
  const g = [...gaps].sort((a, b) => a.minutes - b.minutes)[0]
  const other = g.before.courseId === courseId ? g.after : g.before
  const when = g.before.courseId === courseId ? 'before' : 'after'
  const sameDay = gaps.filter((x) => x.minutes === g.minutes && (x.before.partCode === g.before.partCode && x.after.partCode === g.after.partCode)).map((x) => x.day)
  return `${g.minutes ? `${g.minutes}-min break` : 'No break'} ${when} ${other.partTitle} (${fmtDaysLong(sameDay.length ? sameDay : [g.day])})`
}

export function PickerFooter({ picker, onCancel, onSave }: { picker: SectionPicker; onCancel: () => void; onSave: () => void }) {
  const { dirty, blockers, canSave, parts, term, course } = picker
  const anyPreview = parts.some((p) => p.previewing)
  const anySaved = parts.some((p) => p.saved)
  const brk = shortestBreak(picker.gaps, course.id)

  let tone: 'muted' | 'ok' | 'bad' | 'saved' = 'muted'
  let text: React.ReactNode
  if (dirty && blockers.length) {
    tone = 'bad'
    text = <>{blockers[0]}{/overlaps/.test(blockers[0]) ? ' — choose another to save.' : '.'}</>
  } else if (dirty && anyPreview) {
    tone = 'ok'
    text = <>{picker.label} fits your week{brk ? <span className="font-normal text-muted-foreground"> · {brk}</span> : ''}. Not saved yet.</>
  } else if (dirty) {
    text = 'The section choice will be cleared.'
  } else if (anySaved) {
    tone = 'saved'
    text = <>Saved: {parts.filter((p) => p.saved).map((p) => `${parts.length > 1 ? (p.part.main ? 'Lecture' : 'Lab') : 'Section'} ${p.saved!.section} (CRN ${p.saved!.crn})`).join(' + ')}</>
  } else {
    text = 'Pick a section to see it on your week.'
  }

  const saveLabel = picker.inTerm ? 'Save' : picker.plannedIn ? `Move to ${term.label}` : `Add to ${term.label}`
  return (
    <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:gap-3" data-picker-footer>
      <p
        className={cn(
          'flex min-w-0 flex-1 items-start gap-1.5 text-xs leading-snug sm:text-[13px]',
          tone === 'bad' && 'font-medium text-destructive',
          tone === 'ok' && 'font-medium',
          tone === 'saved' && 'text-green-700 dark:text-green-400',
          tone === 'muted' && 'text-muted-foreground',
        )}
        role="status"
        aria-live="polite"
      >
        {tone === 'bad' && <LuTriangleAlert className="mt-px size-3.5 shrink-0" aria-hidden />}
        {tone === 'saved' && <LuCheck className="mt-px size-3.5 shrink-0" aria-hidden />}
        {tone === 'muted' && !anyPreview && <LuCircleAlert className="mt-px size-3.5 shrink-0 opacity-60" aria-hidden />}
        <span className="min-w-0">{text}</span>
      </p>
      <div className="flex shrink-0 gap-2">
        {dirty && (
          <Button variant="outline" className="flex-1 sm:flex-none" onClick={onCancel}>
            Cancel
          </Button>
        )}
        <Button className="flex-1 sm:flex-none sm:min-w-28" disabled={!canSave} onClick={onSave} data-picker-save>
          {dirty || !anySaved ? saveLabel : <><LuCheck className="size-4" aria-hidden /> Saved</>}
        </Button>
      </div>
    </div>
  )
}
