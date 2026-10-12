import { useMemo } from 'react'
import { LuMapPin, LuTriangleAlert } from 'react-icons/lu'
import type { DayCode } from '@/lib/schedule-types'
import { hourRange, type CalEvent, type Gap } from '@/lib/schedule'
import { DAY_NAMES, fmtHour, fmtTimeRange } from '@/lib/format'
import { courseColor } from '@/lib/colors'
import { ProfessorLink } from '@/components/bits'
import { useUi } from '@/components/ui-context'
import { cn } from '@/lib/utils'

/** Side-by-side columns for overlapping events (a clash, or a lecture and its lab at once). */
function layoutDay(events: CalEvent[]): { ev: CalEvent; col: number; cols: number }[] {
  const sorted = [...events].sort((a, b) => a.start - b.start || b.end - a.end)
  const out: { ev: CalEvent; col: number; cols: number }[] = []
  let cluster: { ev: CalEvent; col: number; cols: number }[] = []
  let clusterEnd = -1
  const close = () => {
    const cols = Math.max(1, ...cluster.map((c) => c.col + 1))
    cluster.forEach((c) => { c.cols = cols })
    out.push(...cluster)
    cluster = []
  }
  for (const ev of sorted) {
    if (cluster.length && ev.start >= clusterEnd) close()
    const used = new Set(cluster.filter((c) => c.ev.end > ev.start).map((c) => c.col))
    let col = 0
    while (used.has(col)) col++
    cluster.push({ ev, col, cols: 1 })
    clusterEnd = Math.max(clusterEnd, ev.end)
  }
  if (cluster.length) close()
  return out
}

function TimeGutter({ from, to, pxPerHour, narrow }: { from: number; to: number; pxPerHour: number; narrow?: boolean }) {
  return (
    <div className={cn('relative shrink-0', narrow ? 'w-8' : 'w-10 sm:w-12')} style={{ height: (to - from) * pxPerHour }} aria-hidden>
      {Array.from({ length: to - from + 1 }, (_, i) => (
        <div key={i} className={cn('mono absolute right-1.5 leading-none text-muted-foreground sm:right-2', narrow ? 'text-[9px]' : 'text-[10px]', i > 0 && '-translate-y-1/2')} style={{ top: i * pxPerHour }}>
          {narrow ? fmtHour(from + i).replace(/ [AP]M$/, '') : fmtHour(from + i)}
        </div>
      ))}
    </div>
  )
}

function HourLines({ from, to, pxPerHour }: { from: number; to: number; pxPerHour: number }) {
  return (
    <>
      {Array.from({ length: to - from }, (_, i) => (
        <div key={i} className="pointer-events-none absolute inset-x-0 border-t border-border/70" style={{ top: i * pxPerHour }} aria-hidden>
          <div className="absolute inset-x-0 border-t border-dashed border-border/40" style={{ top: pxPerHour / 2 }} />
        </div>
      ))}
    </>
  )
}

/** "15 min" between two classes: amber when it's under ten minutes. */
function GapPill({ gap, top, compact, className }: { gap: Gap; top: number; compact?: boolean; className?: string }) {
  const label = compact ? `${gap.minutes}m` : gap.minutes ? `${gap.minutes} min` : 'no break'
  const tight = gap.minutes < 10
  return (
    <div
      className={cn(
        'pointer-events-none absolute z-20 -translate-y-1/2 rounded-full border bg-background px-1.5 leading-[14px] whitespace-nowrap shadow-xs',
        compact ? 'text-[8.5px]' : 'text-[9.5px]',
        tight ? 'border-amber-300 text-amber-800 dark:border-amber-500/50 dark:text-amber-300' : 'text-muted-foreground',
        className,
      )}
      style={{ top }}
      data-gap={gap.minutes}
      title={`${gap.minutes ? `${gap.minutes}-minute break` : 'No break'} between ${gap.before.partTitle} and ${gap.after.partTitle}`}
    >
      {label}
    </div>
  )
}

/**
 * Monday–Friday (plus a weekend day if anything meets then), 8 AM to the last class.
 * With `focusCourseId` it previews one course: that course stands out, the rest steps back.
 */
export function WeekCalendar({
  events,
  days,
  compact = false,
  interactive = true,
  pxPerHour: pxOverride,
  range,
  focusCourseId,
  gaps = [],
}: {
  events: CalEvent[]
  days: DayCode[]
  compact?: boolean
  /** Blocks open their course; off inside the section picker. */
  interactive?: boolean
  pxPerHour?: number
  range?: [number, number]
  focusCourseId?: string | null
  /** Breaks to label between classes. */
  gaps?: Gap[]
}) {
  const ui = useUi()
  const [from, to] = range ?? hourRange(events)
  const pxPerHour = pxOverride ?? (compact ? 46 : 56)
  const byDay = useMemo(() => Object.fromEntries(days.map((d) => [d, layoutDay(events.filter((e) => e.day === d))])), [events, days])
  const y = (min: number) => ((min - from * 60) / 60) * pxPerHour

  return (
    <div className="min-w-0" data-calendar="week">
      <div className="flex border-b pb-1.5" aria-hidden>
        <div className={cn('shrink-0', compact ? 'w-8' : 'w-10 sm:w-12')} />
        {days.map((d) => (
          <div key={d} className="min-w-0 flex-1 text-center text-xs font-medium text-muted-foreground">
            <span className={cn(!compact && 'sm:hidden')}>{compact ? DAY_NAMES[d].short : DAY_NAMES[d].letter}</span>
            {!compact && <span className="hidden sm:inline">{DAY_NAMES[d].short}</span>}
          </div>
        ))}
      </div>
      <div className="flex pt-2">
        <TimeGutter from={from} to={to} pxPerHour={pxPerHour} narrow={compact} />
        <div className="relative flex min-w-0 flex-1" style={{ height: (to - from) * pxPerHour }}>
          <HourLines from={from} to={to} pxPerHour={pxPerHour} />
          {days.map((d) => (
            <div key={d} className="relative min-w-0 flex-1 border-l border-border/60" role="list" aria-label={DAY_NAMES[d].long}>
              {byDay[d].map(({ ev, col, cols }) => {
                const top = y(ev.start)
                const height = Math.max(compact ? 16 : 18, ((ev.end - ev.start) / 60) * pxPerHour - 2)
                const color = courseColor(ev.colorIndex)
                const focus = !!focusCourseId && ev.courseId === focusCourseId
                const recede = !!focusCourseId && !focus && !ev.conflict
                const Tag = interactive ? 'button' : 'div'
                return (
                  <Tag
                    key={ev.key}
                    {...(interactive ? { type: 'button' as const, onClick: () => ui.openCourse(ev.courseId) } : {})}
                    role="listitem"
                    data-course={ev.courseId}
                    data-preview={focus || undefined}
                    data-conflict={ev.conflict || undefined}
                    className={cn(
                      'absolute overflow-hidden rounded-md border-l-[3px] px-1 py-0.5 text-left transition-[filter,opacity] sm:px-1.5',
                      interactive && 'hover:brightness-95 focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none',
                      color.block,
                      color.edge,
                      recede && 'opacity-65',
                      focus && 'z-10 shadow-md ring-2 ring-foreground/75 ring-inset',
                      ev.conflict && 'ring-2 ring-destructive ring-inset',
                    )}
                    style={{ top, height, left: `calc(${(col / cols) * 100}% + 2px)`, width: `calc(${100 / cols}% - 4px)` }}
                    aria-label={`${ev.partTitle} (${ev.partCode}), ${DAY_NAMES[ev.day].long} ${fmtTimeRange(ev.startTime, ev.endTime)}${ev.location ? `, ${ev.location}` : ''}${ev.conflict ? ', time conflict' : ''}`}
                  >
                    <div className={cn('font-semibold [overflow-wrap:anywhere]', compact ? 'line-clamp-2 text-[9.5px] leading-[1.1]' : 'line-clamp-2 text-[11px] leading-tight')}>
                      {ev.partTitle}
                    </div>
                    {height > (compact ? 36 : 40) && (
                      <div className={cn('mono truncate leading-tight opacity-80', compact ? 'text-[9px]' : 'text-[10px]')}>
                        {compact ? ev.partCode.replace(/^[A-Z]+ /, '') : ev.partCode} · {fmtTimeRange(ev.startTime, ev.endTime)}
                      </div>
                    )}
                    {height > 60 && !compact && ev.location && <div className="truncate text-[10px] leading-tight opacity-75">{ev.location}</div>}
                    {ev.conflict && height > 74 && !compact && <LuTriangleAlert className="mt-0.5 size-3 text-destructive" aria-hidden />}
                  </Tag>
                )
              })}
              {gaps.filter((g) => g.day === d).map((g) => (
                <GapPill key={g.key} gap={g} top={y((g.from + g.to) / 2)} compact={compact} className="left-1/2 -translate-x-1/2" />
              ))}
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

/** One day as a timeline with everything about each class spelled out. */
export function DayCalendar({ events, day, gaps = [] }: { events: CalEvent[]; day: DayCode; gaps?: Gap[] }) {
  const ui = useUi()
  const dayEvents = events.filter((e) => e.day === day)
  const [from, to] = hourRange(events)
  const pxPerHour = 64
  const laid = layoutDay(dayEvents)
  const y = (min: number) => ((min - from * 60) / 60) * pxPerHour

  if (!dayEvents.length) {
    return (
      <div className="rounded-xl border border-dashed px-4 py-10 text-center text-sm text-muted-foreground" data-calendar="day">
        No classes on {DAY_NAMES[day].long}.
      </div>
    )
  }

  return (
    <div className="flex" data-calendar="day">
      <TimeGutter from={from} to={to} pxPerHour={pxPerHour} />
      <div className="relative min-w-0 flex-1 border-l border-border/60" style={{ height: (to - from) * pxPerHour }}>
        <HourLines from={from} to={to} pxPerHour={pxPerHour} />
        {laid.map(({ ev, col, cols }) => {
          const top = y(ev.start)
          const height = Math.max(28, ((ev.end - ev.start) / 60) * pxPerHour - 3)
          const color = courseColor(ev.colorIndex)
          return (
            <div
              key={ev.key}
              role="button"
              tabIndex={0}
              onClick={() => ui.openCourse(ev.courseId)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault()
                  ui.openCourse(ev.courseId)
                }
              }}
              className={cn(
                'absolute cursor-pointer overflow-hidden rounded-lg border-l-4 px-2.5 py-1.5 text-left transition-[filter] hover:brightness-95 focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none',
                color.block,
                color.edge,
                ev.conflict && 'ring-2 ring-destructive ring-inset',
              )}
              style={{ top, height, left: `calc(${(col / cols) * 100}% + 4px)`, width: `calc(${100 / cols}% - 8px)` }}
            >
              <div className="flex items-baseline gap-2">
                <span className="min-w-0 truncate text-[13px] font-semibold">{ev.partTitle}</span>
                <span className="mono shrink-0 text-xs opacity-80">{fmtTimeRange(ev.startTime, ev.endTime)}</span>
              </div>
              {height > 44 && <div className="mono truncate text-xs opacity-75">{ev.partCode}{ev.type === 'Lab' ? ' · Lab' : ''}</div>}
              {height > 62 && (
                <div className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs">
                  {ev.location && (
                    <span className="inline-flex min-w-0 items-center gap-1 opacity-85">
                      <LuMapPin className="size-3 shrink-0" aria-hidden />
                      <span className="truncate">{ev.location}</span>
                    </span>
                  )}
                  {ev.instructorKeys.map((k) => <ProfessorLink key={k} profKey={k} className="text-xs" />)}
                  {!ev.instructorKeys.length && ev.instructors.map((n) => <span key={n} className="opacity-85">{n}</span>)}
                  {ev.crn && <span className="mono opacity-70">CRN {ev.crn}</span>}
                </div>
              )}
              {ev.conflict && (
                <div className="mt-0.5 inline-flex items-center gap-1 text-[11px] font-medium text-destructive">
                  <LuTriangleAlert className="size-3" aria-hidden /> Overlaps another class
                </div>
              )}
            </div>
          )
        })}
        {gaps.filter((g) => g.day === day).map((g) => (
          <GapPill key={g.key} gap={g} top={y((g.from + g.to) / 2)} className="right-2" />
        ))}
      </div>
    </div>
  )
}
