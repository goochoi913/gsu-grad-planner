import { LuChartLine, LuGraduationCap } from 'react-icons/lu'
import { fmtCredits, fmtGpa, round2 } from '@/lib/planner'
import { STATUS_TEXT, allMeters, type Meter } from '@/lib/plan-ops'
import type { PlannerSnapshot } from '@/lib/store'
import { AuditIcon, CategoryDot } from '@/components/bits'
import { PROGRESS, categoryOfBlock } from '@/lib/colors'
import { HoverCard, HoverCardContent, HoverCardTrigger } from '@/components/ui/hover-card'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'

/**
 * The degree at a glance, in one row: each Degree Works block as a small meter
 * (solid = done, light = planned, amber = waiting on an advisor exception), then
 * the total, the term the plan finishes, and the GPA. Tapping a block opens it in
 * the audit.
 */
export function ProgressRail({
  snap,
  onOpenBlock,
  onOpenGpa,
}: {
  snap: PlannerSnapshot
  onOpenBlock: (key: string) => void
  onOpenGpa: () => void
}) {
  const meters = allMeters(snap.audit)
  const last = [...snap.semesters].reverse().find((s) => (snap.plan.schedule[s.id] || []).length)
  const loading = snap.recordStatus === 'loading'

  return (
    <div className="flex items-center gap-1.5 overflow-x-auto px-3 py-1.5 no-scrollbar" data-print="hide" role="group" aria-label="Degree progress">
      {meters.map((m) => (
        <MeterChip key={m.key} meter={m} loading={loading} onClick={() => onOpenBlock(m.key)} />
      ))}
      <span className="mx-1 h-6 w-px shrink-0 bg-border" aria-hidden />
      {last && (
        <Tooltip>
          <TooltipTrigger asChild>
            <span className="flex shrink-0 items-center gap-1.5 rounded-md px-1.5 py-1 text-xs text-muted-foreground">
              <LuGraduationCap className="size-4" aria-hidden />
              <span className="mono text-foreground">{last.label}</span>
            </span>
          </TooltipTrigger>
          <TooltipContent>
            The plan finishes after {last.label}
            {snap.audit.pending.length ? ` · ${snap.audit.pending.length} advisor exception${snap.audit.pending.length > 1 ? 's' : ''} to record` : ''}
          </TooltipContent>
        </Tooltip>
      )}
      <button
        type="button"
        onClick={onOpenGpa}
        className="flex shrink-0 items-center gap-1.5 rounded-md px-1.5 py-1 text-xs text-muted-foreground hover:bg-accent hover:text-foreground"
        aria-label="GPA projection"
      >
        <LuChartLine className="size-4" aria-hidden />
        <span>GPA</span>
        <span className="mono text-foreground">{loading ? '…' : fmtGpa(snap.summary.gsu)}</span>
      </button>
    </div>
  )
}

function MeterChip({ meter: m, loading, onClick }: { meter: Meter; loading: boolean; onClick: () => void }) {
  const pct = (v: number) => (m.required ? Math.min(100, (v / m.required) * 100) : 0)
  const shown = round2(m.done + m.planned + m.pending)
  return (
    <HoverCard openDelay={250} closeDelay={60}>
      <HoverCardTrigger asChild>
        <button
          type="button"
          onClick={onClick}
          data-block={m.key}
          className={cn(
            'flex w-[6.4rem] shrink-0 flex-col sm:w-[8.4rem] gap-1 rounded-lg border bg-card px-2 py-1.5 text-left transition-colors hover:border-foreground/25 hover:bg-accent/40',
            'focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none',
            m.key === 'total' && 'border-foreground/15',
          )}
          aria-label={`${m.name}: ${fmtCredits(shown)} of ${fmtCredits(m.required)} credits, ${STATUS_TEXT[m.status]}`}
        >
          <span className="flex w-full items-center gap-1.5">
            <CategoryDot category={categoryOfBlock(m.key)} className="size-1.5" />
            <span className="min-w-0 flex-1 truncate text-[11px] font-medium">{m.short}</span>
            {!loading && <AuditIcon status={m.status} className="size-3" />}
          </span>
          <span className="block h-1 w-full overflow-hidden rounded-full bg-muted">
            <span className="relative block h-full">
              <span className={cn('absolute inset-y-0 left-0 rounded-full', PROGRESS.pending)} style={{ width: `${pct(shown)}%` }} />
              <span className={cn('absolute inset-y-0 left-0 rounded-full', PROGRESS.planned)} style={{ width: `${pct(m.done + m.planned)}%` }} />
              <span className={cn('absolute inset-y-0 left-0 rounded-full', PROGRESS.done)} style={{ width: `${pct(m.done)}%` }} />
            </span>
          </span>
          <span className="mono text-[10.5px] leading-none text-muted-foreground">
            {loading ? '…' : `${fmtCredits(shown)}/${fmtCredits(m.required)}`}
          </span>
        </button>
      </HoverCardTrigger>
      <HoverCardContent side="bottom" align="start" className="w-64 text-xs">
        <div className="mb-1.5 flex items-center gap-1.5 text-sm font-medium">
          <AuditIcon status={m.status} />
          {m.name}
        </div>
        <div className="space-y-1 text-muted-foreground">
          <Row swatch={PROGRESS.done} label={m.key === 'total' ? 'Earned' : 'Done (incl. waived)'} value={m.done} />
          <Row swatch={PROGRESS.planned} label="Planned" value={m.planned} />
          {m.pending > 0 && <Row swatch={PROGRESS.pending} label="Needs an advisor exception" value={m.pending} />}
          <div className="flex justify-between border-t pt-1 text-foreground">
            <span>Required</span>
            <span className="mono">{fmtCredits(m.required)} cr</span>
          </div>
        </div>
        <p className="mt-2 text-muted-foreground">{STATUS_TEXT[m.status][0].toUpperCase() + STATUS_TEXT[m.status].slice(1)}. Tap to see the details.</p>
      </HoverCardContent>
    </HoverCard>
  )
}

function Row({ swatch, label, value }: { swatch: string; label: string; value: number }) {
  return (
    <div className="flex items-center gap-2">
      <span className={cn('size-2 rounded-full', swatch)} aria-hidden />
      <span className="flex-1">{label}</span>
      <span className="mono text-foreground">{fmtCredits(value)} cr</span>
    </div>
  )
}
