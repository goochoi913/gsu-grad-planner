import type { ReactNode } from 'react'
import { LuCalendarClock, LuCircleCheck, LuCircleDashed, LuHourglass, LuStar } from 'react-icons/lu'
import type { AuditStatus } from '@/lib/planner'
import type { Professor } from '@/lib/schedule-types'
import { professorFor } from '@/lib/schedule'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'
import { CATEGORY, CATEGORY_ORDER, gradeTone, type Category } from '@/lib/colors'
import { useUi } from '@/components/ui-context'

export const AUDIT_STATUS_LABEL: Record<AuditStatus, string> = {
  met: 'Complete',
  planned: 'Covered by the plan',
  pending: 'Needs an advisor exception',
  missing: 'Still needed',
}

/** One icon per Degree Works status: done, planned, waiting on the advisor, still open. */
export function AuditIcon({ status, className }: { status: AuditStatus; className?: string }) {
  const cls = cn('size-3.5 shrink-0', className)
  if (status === 'met') return <LuCircleCheck className={cn(cls, 'text-green-600 dark:text-green-400')} aria-label={AUDIT_STATUS_LABEL.met} />
  if (status === 'planned') return <LuCalendarClock className={cn(cls, 'text-muted-foreground')} aria-label={AUDIT_STATUS_LABEL.planned} />
  if (status === 'pending') return <LuHourglass className={cn(cls, 'text-pending')} aria-label={AUDIT_STATUS_LABEL.pending} />
  return <LuCircleDashed className={cn(cls, 'text-red-500 dark:text-red-400')} aria-label={AUDIT_STATUS_LABEL.missing} />
}

/** A letter grade as a coloured pill: A green, B light green, C yellow, D orange, F red, W grey. */
export function GradePill({ grade, className, title }: { grade: string | null | undefined; className?: string; title?: string }) {
  return (
    <span
      title={title}
      className={cn('mono inline-flex h-[18px] min-w-[22px] shrink-0 items-center justify-center rounded-[5px] px-1 text-[11px] leading-none font-semibold', gradeTone(grade), className)}
    >
      {grade || '—'}
    </span>
  )
}

/** Which requirement area a course counts toward, as a small coloured tag. */
export function CategoryTag({ category, label, className }: { category: Category; label?: string; className?: string }) {
  const c = CATEGORY[category]
  return (
    <span className={cn('inline-flex h-[18px] shrink-0 items-center rounded-[5px] border px-1.5 text-[10.5px] leading-none font-medium whitespace-nowrap', c.tag, className)}>
      {label ?? c.short}
    </span>
  )
}

export function CategoryDot({ category, className }: { category: Category | null; className?: string }) {
  if (!category) return null
  return <span className={cn('inline-block size-2 shrink-0 rounded-full', CATEGORY[category].dot, className)} aria-hidden />
}

/** The colour key: what each requirement-area colour means. */
export function CategoryLegend({ className }: { className?: string }) {
  return (
    <div className={cn('flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-muted-foreground', className)} aria-label="Colour key">
      {CATEGORY_ORDER.map((k) => (
        <Hint key={k} label={CATEGORY[k].hint}>
          <span className="inline-flex items-center gap-1.5">
            <CategoryDot category={k} />
            {CATEGORY[k].label}
          </span>
        </Hint>
      ))}
    </div>
  )
}

/** "★ 3.9 (20)" — a professor's RateMyProfessors score, or nothing when there isn't one. */
export function RatingValue({ prof, className, showCount = true }: { prof: Professor | null; className?: string; showCount?: boolean }) {
  const r = prof?.rmp
  if (!r || r.avgRating == null) return null
  return (
    <span className={cn('mono inline-flex items-center gap-0.5 text-[11px] text-foreground', className)}>
      <LuStar className="size-3 fill-amber-400 text-amber-400" aria-hidden />
      {r.avgRating.toFixed(1)}
      {showCount && <span className="text-muted-foreground">({r.numRatings})</span>}
    </span>
  )
}

/** A professor's name that opens their ratings; "Staff" when the section has no instructor yet. */
export function ProfessorLink({ profKey, name, className, rating = true }: { profKey?: string | null; name?: string; className?: string; rating?: boolean }) {
  const ui = useUi()
  const prof = professorFor(profKey)
  if (!profKey || !prof) return <span className={cn('text-muted-foreground', className)}>{name || 'Instructor not listed yet'}</span>
  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation()
        ui.openProfessor(profKey)
      }}
      className={cn(
        'inline-flex min-w-0 items-center gap-1.5 rounded-sm text-left underline-offset-2 hover:underline focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none',
        className,
      )}
      aria-label={`${prof.display} — RateMyProfessors rating`}
    >
      <span className="truncate">{prof.display}</span>
      {rating && <RatingValue prof={prof} />}
    </button>
  )
}

/** Small neutral tag ("Honors", "Online", "Full"). Destructive only for a real problem. */
export function Tag({ children, tone = 'neutral', className, title }: { children: ReactNode; tone?: 'neutral' | 'strong' | 'warn' | 'bad'; className?: string; title?: string }) {
  return (
    <span
      title={title}
      className={cn(
        'inline-flex h-[18px] shrink-0 items-center gap-1 rounded-[5px] border px-1.5 text-[10.5px] leading-none font-medium whitespace-nowrap',
        tone === 'neutral' && 'border-border bg-background text-muted-foreground',
        tone === 'strong' && 'border-transparent bg-primary text-primary-foreground',
        tone === 'warn' && 'border-pending/40 bg-pending-muted text-pending',
        tone === 'bad' && 'border-destructive/30 bg-destructive/8 text-destructive',
        className,
      )}
    >
      {children}
    </span>
  )
}

/** An icon with a tooltip — every icon that isn't self-evident says what it means. */
export function Hint({ label, children }: { label: ReactNode; children: ReactNode }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>{children}</TooltipTrigger>
      <TooltipContent className="max-w-72">{label}</TooltipContent>
    </Tooltip>
  )
}

/** A label/value row for stat lists. */
export function Stat({ label, value, className }: { label: ReactNode; value: ReactNode; className?: string }) {
  return (
    <div className={cn('flex items-baseline justify-between gap-3 text-sm', className)}>
      <span className="text-muted-foreground">{label}</span>
      <span className="mono text-right">{value}</span>
    </div>
  )
}
