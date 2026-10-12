import { LuCircleAlert, LuCheck, LuMapPin, LuClock, LuTriangleAlert } from 'react-icons/lu'
import type { CatalogCourse, PlanEntry, TermId } from '@/lib/types'
import type { Section } from '@/lib/schedule-types'
import { MODE_LABEL, isFull, locationText, partPicks, sectionConflicts, seatsText, timedMeetings } from '@/lib/schedule'
import { fmtDaysLong, fmtShortDate, fmtTimeRange } from '@/lib/format'
import { ProfessorLink, Tag } from '@/components/bits'
import { cn } from '@/lib/utils'

/**
 * Every section of a course in one term, as a list of choices. A lecture + lab course
 * gets one list per part. Choosing a section writes its CRN into the plan; the
 * calendar and the registration list follow.
 */
export function SectionChooser({
  termId,
  course,
  entry,
  entries,
  onPick,
  readOnly = false,
  compact = false,
}: {
  termId: TermId
  course: CatalogCourse
  /** The course's plan entry in this term, when it is planned there. */
  entry: PlanEntry | null
  /** Every entry in the term — for clash checks. */
  entries: PlanEntry[]
  onPick?: (partCodeId: string, crn: string | null) => void
  readOnly?: boolean
  compact?: boolean
}) {
  const parts = partPicks(course, entry, termId)
  const multi = parts.length > 1
  return (
    <div className="space-y-4">
      {parts.map(({ part, sections, picked }) => (
        <div key={part.codeId} className="space-y-2">
          {multi && (
            <div className="flex items-baseline gap-2 text-xs">
              <span className="font-semibold">{part.main ? 'Lecture' : 'Lab'}</span>
              <span className="mono text-muted-foreground">{part.code}</span>
              <span className="mono text-muted-foreground">· {part.credits} cr</span>
              {!readOnly && !picked && sections.length > 0 && <span className="ml-auto text-muted-foreground">choose one</span>}
            </div>
          )}
          {sections.length === 0 ? (
            <p className="rounded-lg border border-dashed px-3 py-3 text-xs text-muted-foreground">No {part.code} sections in this term’s schedule.</p>
          ) : (
            <div role="radiogroup" aria-label={`${part.code} sections`} className="space-y-1.5">
              {sections.map((s) => (
                <SectionOption
                  key={s.crn}
                  section={s}
                  selected={picked?.crn === s.crn}
                  conflicts={sectionConflicts(termId, entries, course.id, s)}
                  readOnly={readOnly}
                  compact={compact}
                  onSelect={() => onPick?.(part.codeId, picked?.crn === s.crn ? null : s.crn)}
                />
              ))}
            </div>
          )}
        </div>
      ))}
    </div>
  )
}

export function SectionOption({
  section: s,
  selected,
  conflicts,
  readOnly,
  compact,
  onSelect,
}: {
  section: Section
  selected: boolean
  conflicts: string[]
  readOnly?: boolean
  compact?: boolean
  onSelect?: () => void
}) {
  const timed = timedMeetings(s)
  const full = isFull(s)
  const interactive = !readOnly && !!onSelect
  return (
    <div
      role={interactive ? 'radio' : undefined}
      aria-checked={interactive ? selected : undefined}
      tabIndex={interactive ? 0 : undefined}
      onClick={interactive ? onSelect : undefined}
      onKeyDown={interactive ? (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          onSelect?.()
        }
      } : undefined}
      data-crn={s.crn}
      className={cn(
        'group relative rounded-lg border bg-card px-3 py-2.5 text-left transition-colors',
        interactive && 'cursor-pointer hover:border-foreground/25 hover:bg-accent/40 focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none',
        selected && 'border-green-600 bg-green-50/70 ring-1 ring-green-600 dark:border-green-500 dark:bg-green-500/10 dark:ring-green-500',
      )}
    >
      <div className="flex items-center gap-2">
        {interactive && (
          <span
            className={cn(
              'flex size-4 shrink-0 items-center justify-center rounded-full border',
              selected ? 'border-green-600 bg-green-600 text-white dark:border-green-500 dark:bg-green-500' : 'border-muted-foreground/40',
            )}
            aria-hidden
          >
            {selected && <LuCheck className="size-3" />}
          </span>
        )}
        <span className="text-sm font-medium">Section {s.section}</span>
        <span className="mono text-xs text-muted-foreground">CRN {s.crn}</span>
        <span className="ml-auto flex shrink-0 items-center gap-1">
          <span className={cn('mono text-[11px]', full ? 'font-medium text-destructive' : 'text-muted-foreground')}>{seatsText(s)}</span>
        </span>
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
              {!compact && locationText(m) && (
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
        {(s.honors || s.mode !== 'in-person' || s.session || s.source === 'banner' || s.credits === null) && (
          <div className="flex flex-wrap gap-1 pt-0.5">
            {s.honors && <Tag title="Honors sections are usually reserved for Honors College students — check PAWS before choosing one.">Honors</Tag>}
            {s.mode !== 'in-person' && <Tag>{MODE_LABEL[s.mode]}</Tag>}
            {s.session && <Tag title={`Meets ${fmtShortDate(s.session.start)} – ${fmtShortDate(s.session.end)} only`}>{s.session.label}</Tag>}
            {s.credits === null && <Tag>{s.creditsText} credits</Tag>}
            {s.source === 'banner' && <Tag title="This section is not in your CSV; it comes from GSU’s class search.">From GSU search</Tag>}
          </div>
        )}
        {conflicts.length > 0 && (
          <div className="flex items-center gap-1.5 text-xs font-medium text-destructive">
            <LuTriangleAlert className="size-3.5 shrink-0" aria-hidden />
            Overlaps {conflicts.join(', ')}
          </div>
        )}
        {s.notes.filter((n) => !/^Not in your CSV/.test(n)).map((n) => (
          <div key={n} className="flex items-start gap-1.5 text-xs text-muted-foreground">
            <LuCircleAlert className="mt-0.5 size-3.5 shrink-0" aria-hidden />
            {n}
          </div>
        ))}
      </div>
    </div>
  )
}
