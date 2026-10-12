import { useMemo } from 'react'
import { LuMapPin, LuTriangleAlert } from 'react-icons/lu'
import type { DayCode } from '@/lib/schedule-types'
import type { CalEvent } from '@/lib/schedule'
import { DAY_NAMES, fmtHour, fmtTimeRange } from '@/lib/format'
import { courseColor } from '@/lib/colors'
import { ProfessorLink } from '@/components/bits'
import { useUi } from '@/components/ui-context'
import { cn } from '@/lib/utils'

/** The hours the grid shows: at least 8 AM – 6 PM, stretched to fit every class. */
function hourRange(events: CalEvent[]): [number, number] {
  if (!events.length) return [8, 18]
  const first = Math.min(...events.map((e) => e.start))
  const last = Math.max(...events.map((e) => e.end))
  return [Math.min(8, Math.floor(first / 60)), Math.max(18, Math.ceil(last / 60))]
}

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

function TimeGutter({ from, to, pxPerHour }: { from: number; to: number; pxPerHour: number }) {
  return (
    <div className="relative w-10 shrink-0 sm:w-12" style={{ height: (to - from) * pxPerHour }} aria-hidden>
      {Array.from({ length: to - from + 1 }, (_, i) => (
        <div key={i} className={cn('mono absolute right-1.5 text-[10px] leading-none text-muted-foreground sm:right-2', i > 0 && '-translate-y-1/2')} style={{ top: i * pxPerHour }}>
          {fmtHour(from + i).replace(' ', ' ')}
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

/** Monday–Friday (plus a weekend day if anything meets then), 8 AM to the last class. */
export function WeekCalendar({ events, days, compact = false }: { events: CalEvent[]; days: DayCode[]; compact?: boolean }) {
  const ui = useUi()
  const [from, to] = hourRange(events)
  const pxPerHour = compact ? 46 : 56
  const byDay = useMemo(() => Object.fromEntries(days.map((d) => [d, layoutDay(events.filter((e) => e.day === d))])), [events, days])

  return (
    <div className="min-w-0" data-calendar="week">
      <div className="flex border-b pb-1.5" aria-hidden>
        <div className="w-10 shrink-0 sm:w-12" />
        {days.map((d) => (
          <div key={d} className="min-w-0 flex-1 text-center text-xs font-medium text-muted-foreground">
            <span className="sm:hidden">{DAY_NAMES[d].letter}</span>
            <span className="hidden sm:inline">{DAY_NAMES[d].short}</span>
          </div>
        ))}
      </div>
      <div className="flex pt-2">
        <TimeGutter from={from} to={to} pxPerHour={pxPerHour} />
        <div className="relative flex min-w-0 flex-1" style={{ height: (to - from) * pxPerHour }}>
          <HourLines from={from} to={to} pxPerHour={pxPerHour} />
          {days.map((d) => (
            <div key={d} className="relative min-w-0 flex-1 border-l border-border/60" role="list" aria-label={DAY_NAMES[d].long}>
              {byDay[d].map(({ ev, col, cols }) => {
                const top = ((ev.start - from * 60) / 60) * pxPerHour
                const height = Math.max(18, ((ev.end - ev.start) / 60) * pxPerHour - 2)
                const color = courseColor(ev.colorIndex)
                return (
                  <button
                    key={ev.key}
                    type="button"
                    role="listitem"
                    onClick={() => ui.openCourse(ev.courseId)}
                    className={cn(
                      'absolute overflow-hidden rounded-md border-l-[3px] px-1 py-0.5 text-left transition-[filter] hover:brightness-95 focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none sm:px-1.5',
                      color.block,
                      color.edge,
                      ev.conflict && 'ring-2 ring-destructive ring-inset',
                    )}
                    style={{ top, height, left: `calc(${(col / cols) * 100}% + 2px)`, width: `calc(${100 / cols}% - 4px)` }}
                    aria-label={`${ev.partCode}, ${DAY_NAMES[ev.day].long} ${fmtTimeRange(ev.startTime, ev.endTime)}${ev.location ? `, ${ev.location}` : ''}${ev.conflict ? ', time conflict' : ''}`}
                  >
                    <div className="mono truncate text-[10.5px] leading-tight font-semibold sm:text-[11px]">
                      {ev.partCode.replace(/^[A-Z]+ /, compact ? '' : '$&')}
                    </div>
                    {height > 30 && <div className="mono truncate text-[9.5px] leading-tight opacity-80 sm:text-[10px]">{fmtTimeRange(ev.startTime, ev.endTime)}</div>}
                    {height > 48 && !compact && ev.location && <div className="truncate text-[10px] leading-tight opacity-75">{ev.location}</div>}
                    {ev.conflict && height > 62 && <LuTriangleAlert className="mt-0.5 size-3 text-destructive" aria-hidden />}
                  </button>
                )
              })}
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

/** One day as a timeline with everything about each class spelled out. */
export function DayCalendar({ events, day }: { events: CalEvent[]; day: DayCode }) {
  const ui = useUi()
  const dayEvents = events.filter((e) => e.day === day)
  const [from, to] = hourRange(events)
  const pxPerHour = 64
  const laid = layoutDay(dayEvents)

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
          const top = ((ev.start - from * 60) / 60) * pxPerHour
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
                <span className="mono text-[13px] font-semibold">{ev.partCode}</span>
                <span className="mono text-xs opacity-80">{fmtTimeRange(ev.startTime, ev.endTime)}</span>
                {ev.type === 'Lab' && <span className="text-[11px] opacity-70">Lab</span>}
              </div>
              {height > 44 && <div className="truncate text-xs opacity-85">{ev.title}</div>}
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
      </div>
    </div>
  )
}
