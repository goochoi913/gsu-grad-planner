import { LuCircleAlert, LuCheck, LuMapPin, LuClock, LuTriangleAlert, LuX } from 'react-icons/lu'
import type { Section } from '@/lib/schedule-types'
import { MODE_LABEL, clashText, isFull, locationText, seatsText, timedMeetings, type Clash } from '@/lib/schedule'
import { fmtDaysLong, fmtShortDate, fmtTimeRange } from '@/lib/format'
import { ProfessorLink, Tag } from '@/components/bits'
import { cn } from '@/lib/utils'

/**
 * One section of a course: days and times, room, professor with their rating, seats.
 * In the section picker it is a choice — `previewing` is the one on the calendar,
 * `saved` the one in the plan; `clashes` are the classes it would overlap.
 */
export function SectionCard({
  section: s,
  previewing = false,
  saved = false,
  clashes = [],
  readOnly = false,
  onSelect,
  onUnselect,
}: {
  section: Section
  previewing?: boolean
  saved?: boolean
  clashes?: Clash[]
  readOnly?: boolean
  onSelect?: () => void
  /** Shows an "Unselect" button on the chosen section. */
  onUnselect?: () => void
}) {
  const timed = timedMeetings(s)
  const full = isFull(s)
  const interactive = !readOnly && !!onSelect
  const blocked = clashes.length > 0
  return (
    <div
      role={interactive ? 'radio' : undefined}
      aria-checked={interactive ? previewing : undefined}
      tabIndex={interactive ? 0 : undefined}
      onClick={interactive ? onSelect : undefined}
      onKeyDown={interactive ? (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          onSelect?.()
        }
      } : undefined}
      data-crn={s.crn}
      data-saved={saved || undefined}
      data-clash={blocked || undefined}
      className={cn(
        'group relative rounded-lg border bg-card px-3 py-2.5 text-left transition-colors',
        interactive && 'cursor-pointer hover:border-foreground/25 hover:bg-accent/40 focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none',
        saved && !previewing && 'border-green-600/60 dark:border-green-500/50',
        previewing && saved && 'border-green-600 bg-green-50/70 ring-1 ring-green-600 dark:border-green-500 dark:bg-green-500/10 dark:ring-green-500',
        previewing && !saved && 'border-foreground/70 bg-accent/50 ring-1 ring-foreground/70',
        previewing && blocked && 'border-destructive bg-destructive/5 ring-destructive',
      )}
    >
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        {interactive && (
          <span
            className={cn(
              'flex size-4 shrink-0 items-center justify-center rounded-full border',
              previewing
                ? saved ? 'border-green-600 bg-green-600 text-white dark:border-green-500 dark:bg-green-500' : blocked ? 'border-destructive bg-destructive text-white' : 'border-foreground bg-foreground text-background'
                : 'border-muted-foreground/40',
            )}
            aria-hidden
          >
            {previewing && (saved ? <LuCheck className="size-3" /> : <span className="size-1.5 rounded-full bg-current" />)}
          </span>
        )}
        <span className="text-sm font-medium whitespace-nowrap">Section {s.section}</span>
        <span className="mono text-xs whitespace-nowrap text-muted-foreground">CRN {s.crn}</span>
        {saved && (
          <span className="inline-flex items-center gap-0.5 rounded-[5px] bg-green-100 px-1.5 py-px text-[10.5px] font-medium whitespace-nowrap text-green-800 dark:bg-green-500/20 dark:text-green-300">
            <LuCheck className="size-3" aria-hidden />
            Saved
          </span>
        )}
        {previewing && !saved && (
          <span className={cn('rounded-[5px] px-1.5 py-px text-[10.5px] font-medium whitespace-nowrap', blocked ? 'bg-destructive/10 text-destructive' : 'bg-foreground text-background')}>
            On your week
          </span>
        )}
        <span className={cn('mono ml-auto shrink-0 text-[11px] whitespace-nowrap', full ? 'font-medium text-destructive' : 'text-muted-foreground')}>{seatsText(s)}</span>
      </div>

      <div className={cn('mt-1.5 space-y-1 text-[13px]', interactive && 'pl-6')}>
        {timed.length ? (
          timed.map((m, i) => (
            <div key={i} className="flex flex-wrap items-center gap-x-3 gap-y-0.5">
              <span className="inline-flex items-center gap-1.5">
                <LuClock className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
                <span className="font-medium">{fmtDaysLong(m.days)}</span>
                <span className="mono">{fmtTimeRange(m.start, m.end)}</span>
              </span>
              {locationText(m) && (
                <span className="inline-flex min-w-0 items-center gap-1.5 text-muted-foreground">
                  <LuMapPin className="size-3.5 shrink-0" aria-hidden />
                  <span className="truncate">{locationText(m)}</span>
                </span>
              )}
            </div>
          ))
        ) : (
          <div className="inline-flex items-center gap-1.5 text-muted-foreground">
            <LuClock className="size-3.5 shrink-0" aria-hidden />
            {s.mode === 'online-async' ? 'Online — no set meeting time' : 'Time to be arranged'}
          </div>
        )}
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          {s.instructors.length ? (
            s.instructors.map((p) => <ProfessorLink key={p.key} profKey={p.key} name={p.display} className="text-[13px]" />)
          ) : (
            <span className="text-muted-foreground">Instructor not listed yet</span>
          )}
        </div>
        {(s.mode !== 'in-person' || s.session || s.source === 'banner' || s.credits === null) && (
          <div className="flex flex-wrap gap-1 pt-0.5">
            {s.mode !== 'in-person' && <Tag>{MODE_LABEL[s.mode]}</Tag>}
            {s.session && <Tag title={`Meets ${fmtShortDate(s.session.start)} – ${fmtShortDate(s.session.end)} only`}>{s.session.label}</Tag>}
            {s.credits === null && <Tag>{s.creditsText} credits</Tag>}
            {s.source === 'banner' && <Tag title="This section is not in your CSV; it comes from GSU’s class search.">From GSU search</Tag>}
          </div>
        )}
        {clashes.map((c) => (
          <div key={c.code} className="flex items-start gap-1.5 text-xs font-medium text-destructive">
            <LuTriangleAlert className="mt-px size-3.5 shrink-0" aria-hidden />
            Overlaps {clashText(c)}
          </div>
        ))}
        {s.notes.filter((n) => !/^Not in your CSV/.test(n)).map((n) => (
          <div key={n} className="flex items-start gap-1.5 text-xs text-muted-foreground">
            <LuCircleAlert className="mt-0.5 size-3.5 shrink-0" aria-hidden />
            {n}
          </div>
        ))}
        {interactive && previewing && onUnselect && (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation()
              onUnselect()
            }}
            className="mt-1 -ml-1 inline-flex items-center gap-1 rounded-md px-1 py-0.5 text-xs font-medium text-muted-foreground hover:bg-accent hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none"
            aria-label={`Unselect Section ${s.section}`}
          >
            <LuX className="size-3.5" aria-hidden />
            Unselect
          </button>
        )}
      </div>
    </div>
  )
}
