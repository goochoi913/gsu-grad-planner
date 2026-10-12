import { useEffect, useRef, useState } from 'react'
import {
  LuChartLine,
  LuCheck,
  LuChevronDown,
  LuCircleAlert,
  LuDownload,
  LuNotebookPen,
  LuSquarePen,
  LuTriangleAlert,
} from 'react-icons/lu'
import { DEGREE, DEGREE_RULES, PLANNER_NOTES } from '@/data/degree'
import type { AcademicRecord } from '@/lib/types'
import {
  MIRROR_LINE,
  RECORD_STATUS,
  fmtCredits,
  fmtGpa,
  type AuditUnit,
  type BlockResult,
  type LineResult,
} from '@/lib/planner'
import { advisorChecklist } from '@/lib/planner'
import { auditHeadline, blockMeter, statusSentence, stillNeededText } from '@/lib/plan-ops'
import type { PlannerSnapshot } from '@/lib/store'
import { AUDIT_STATUS_LABEL, AuditIcon, CategoryDot, GradePill } from '@/components/bits'
import { categoryOfBlock } from '@/lib/colors'
import { Button } from '@/components/ui/button'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import { ScrollArea } from '@/components/ui/scroll-area'
import { useUi, type ExceptionPrefill } from '@/components/ui-context'
import { cn } from '@/lib/utils'

/**
 * The Degree Works audit: one row per requirement, with the courses that fill it one
 * tap away. Anything that needs the advisor bubbles up; rules and notes stay folded.
 */
export function AuditPanel({ snap, focusBlock, onFocusDone }: { snap: PlannerSnapshot; focusBlock?: string | null; onFocusDone?: () => void }) {
  const ui = useUi()
  const { audit: a, summary: s, record: rec } = snap
  const rep = rec.reported
  const gpaMatches = rep?.gsuGpa != null && s.gsu.gpa != null && rep.gsuGpa === s.gsu.gpa && rep.overallGpa === s.overall.gpa
  const checklist = advisorChecklist(a, rec, snap.semesters, snap.plan.schedule)
  const [open, setOpen] = useState<Record<string, boolean>>({})
  const blockRefs = useRef<Record<string, HTMLDivElement | null>>({})

  useEffect(() => {
    if (!focusBlock) return
    if (focusBlock !== 'total') setOpen((o) => ({ ...o, [focusBlock]: true }))
    requestAnimationFrame(() => {
      blockRefs.current[focusBlock]?.scrollIntoView({ block: 'start', behavior: 'smooth' })
      onFocusDone?.()
    })
  }, [focusBlock, onFocusDone])

  const loading = snap.recordStatus === 'loading'

  return (
    <div className="flex h-full min-h-0 flex-col bg-sidebar">
      <div className="border-b px-3 py-3">
        <div className="text-[10px] font-semibold tracking-wider text-muted-foreground uppercase">Degree audit</div>
        <div className={cn('text-base leading-snug font-medium', a.status === 'incomplete' && snap.recordStatus === 'ready' && 'text-destructive')}>
          {loading ? 'Loading your record…' : auditHeadline(a, snap.recordStatus)}
        </div>
        {!loading && <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">{statusSentence(a, snap.recordStatus)}</p>}
        <div className="mt-2.5 grid grid-cols-4 gap-1.5">
          <Mini label="applied" value={fmtCredits(a.total.done)} />
          <Mini label="planned" value={`+${fmtCredits(a.total.planned)}`} />
          <Mini label="GSU GPA" value={fmtGpa(s.gsu)} />
          <Mini label="w/ transfer" value={fmtGpa(s.overall)} />
        </div>
        {rep?.gsuGpa != null && s.gsu.gpa != null && (
          <p className="mt-1.5 text-[11px] text-muted-foreground">
            {gpaMatches ? (
              <span className="inline-flex items-center gap-1"><LuCheck className="size-3" aria-hidden /> GPA matches Degree Works ({rep.auditDate}).</span>
            ) : (
              <>Estimated — Degree Works showed {rep.gsuGpa.toFixed(2)} GSU / {rep.overallGpa?.toFixed(2)} with transfer on {rep.auditDate}.</>
            )}
          </p>
        )}
      </div>

      <ScrollArea className="min-h-0 w-full flex-1 [&>[data-slot=scroll-area-viewport]>div]:!block">
        <div className="space-y-1 p-2 pb-6">
          {snap.recordStatus === 'missing' && (
            <Button className="mb-2 w-full" size="sm" onClick={() => ui.openRecord({ importNow: true })}>
              <LuDownload className="size-4" aria-hidden />
              Import the academic record
            </Button>
          )}
          {snap.recordStatus === 'offline' && (
            <p className="mb-2 rounded-md bg-destructive/10 px-2.5 py-2 text-xs text-destructive">Firebase is unreachable, so completed courses and grades are not shown.</p>
          )}

          {a.pending.length > 0 && (
            <section className="mb-2 space-y-1 rounded-lg border border-pending/40 bg-pending-muted p-2">
              <div className="flex items-center gap-1.5 px-1 text-xs font-medium text-pending">
                <AuditIcon status="pending" />
                Needs an advisor exception ({a.pending.length})
              </div>
              {a.pending.map((p, i) => {
                const prefill: ExceptionPrefill = p.kind === 'substitute' ? { type: 'substitute', target: p.target, course: p.course }
                  : p.kind === 'complete' ? { type: 'waive', target: p.target, credits: null, note: p.rule.completeNote }
                  : { type: 'waive', target: p.target, credits: p.credits, note: 'Fractional transfer credit (quarter-to-semester conversion)' }
                const line = a.lineById[p.target]
                const where = line ? `${a.blockByKey[line.block].name} · ${line.label}` : `${a.blockByKey[p.target]?.name} (area total)`
                const what = p.kind === 'substitute' ? `${p.course} substitution` : p.kind === 'complete' ? 'Course not needed because of the substitution' : `${fmtCredits(p.credits)} cr waiver`
                return (
                  <div key={i} className="flex items-center gap-2 rounded-md bg-background/70 px-2 py-1.5">
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-xs font-medium">{what}</div>
                      <div className="truncate text-[11px] text-muted-foreground">{where}</div>
                    </div>
                    <Button size="xs" variant="outline" onClick={() => ui.openExceptions({ prefill })}>
                      Record
                    </Button>
                  </div>
                )
              })}
            </section>
          )}

          {a.blocks.map((b) => (
            <div key={b.key} ref={(el) => { blockRefs.current[b.key] = el }} className="scroll-mt-2">
              <BlockSection
                block={b}
                open={open[b.key] ?? b.status !== 'met'}
                onOpenChange={(o) => setOpen((x) => ({ ...x, [b.key]: o }))}
                loading={loading}
              />
            </div>
          ))}

          <div ref={(el) => { blockRefs.current.total = el }} className="flex items-center gap-2 rounded-md px-2 py-2 text-xs">
            <AuditIcon status={a.total.status} />
            <span className="flex-1 font-medium">Total credits</span>
            <span className="mono text-muted-foreground">
              {fmtCredits(a.total.done)} + {fmtCredits(a.total.planned)} / {a.total.required}
            </span>
          </div>

          {a.dHours > 12 && (
            <Flag>{fmtCredits(a.dHours)} hours of D grades apply — GSU allows at most 12.</Flag>
          )}
          {a.rpeGpa.gpa != null && a.rpeGpa.gpa < 2 && (
            <Flag>Required Program Electives – CSC needs a C average (currently {fmtGpa(a.rpeGpa)}).</Flag>
          )}

          <Fold title="Confirm with your advisor" defaultOpen badge={checklist.filter((i) => !i.done).length}>
            <ol className="space-y-1.5">
              {checklist.map((item, i) => (
                <li key={i} className={cn('flex gap-2 text-xs leading-relaxed', item.done && 'text-muted-foreground')}>
                  {item.done ? <LuCheck className="mt-0.5 size-3.5 shrink-0" aria-hidden /> : <span className="mono mt-px w-3.5 shrink-0 text-center text-muted-foreground">{i + 1}</span>}
                  <span>{item.text}</span>
                </li>
              ))}
            </ol>
          </Fold>

          {rec.terms.length > 0 && <NotApplied rec={rec} />}

          <Fold title="Rules to remember">
            <ul className="list-disc space-y-1.5 pl-4 text-xs leading-relaxed text-muted-foreground">
              {DEGREE_RULES.map((r) => <li key={r}>{r}</li>)}
            </ul>
          </Fold>
          <Fold title="Notes">
            <ul className="list-disc space-y-1.5 pl-4 text-xs leading-relaxed text-muted-foreground">
              {PLANNER_NOTES.map((r) => <li key={r}>{r}</li>)}
            </ul>
            <p className="mt-2 text-[11px] text-muted-foreground">{DEGREE.program} · catalog {DEGREE.catalogYear}{rec.source ? ` · ${rec.source}` : ''}</p>
          </Fold>

          <div className="grid grid-cols-1 gap-1.5 pt-2 sm:grid-cols-3">
            <Button variant="outline" size="sm" className="text-xs" onClick={() => ui.openRecord()}>
              <LuNotebookPen className="size-3.5" aria-hidden />
              Record
            </Button>
            <Button variant="outline" size="sm" className="text-xs" onClick={() => ui.openExceptions()}>
              <LuSquarePen className="size-3.5" aria-hidden />
              Exceptions ({rec.exceptions.length})
            </Button>
            <Button variant="outline" size="sm" className="text-xs" onClick={() => ui.openGpa()}>
              <LuChartLine className="size-3.5" aria-hidden />
              GPA
            </Button>
          </div>
        </div>
      </ScrollArea>
    </div>
  )
}

function Mini({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border bg-background px-1.5 py-1 text-center">
      <div className="mono text-sm font-semibold">{value}</div>
      <div className="truncate text-[10px] text-muted-foreground">{label}</div>
    </div>
  )
}

function Flag({ children }: { children: React.ReactNode }) {
  return (
    <p className="flex items-start gap-1.5 rounded-md bg-destructive/10 px-2.5 py-2 text-xs text-destructive">
      <LuTriangleAlert className="mt-0.5 size-3.5 shrink-0" aria-hidden />
      {children}
    </p>
  )
}

function Fold({ title, children, defaultOpen = false, badge }: { title: string; children: React.ReactNode; defaultOpen?: boolean; badge?: number }) {
  return (
    <Collapsible defaultOpen={defaultOpen} className="rounded-md">
      <CollapsibleTrigger className="group flex w-full items-center gap-1.5 rounded-md px-2 py-2 text-left text-xs font-medium hover:bg-accent">
        <LuChevronDown className="size-3.5 text-muted-foreground transition-transform group-data-[state=closed]:-rotate-90" aria-hidden />
        <span className="flex-1">{title}</span>
        {!!badge && <span className="mono rounded-full bg-secondary px-1.5 text-[10px] text-secondary-foreground">{badge}</span>}
      </CollapsibleTrigger>
      <CollapsibleContent className="px-2 pt-1 pb-2">{children}</CollapsibleContent>
    </Collapsible>
  )
}

function BlockSection({ block: b, open, onOpenChange, loading }: { block: BlockResult; open: boolean; onOpenChange: (o: boolean) => void; loading: boolean }) {
  const ui = useUi()
  const m = blockMeter(b)
  const showTotal = b.credits != null && !MIRROR_LINE[b.key]
  return (
    <Collapsible open={open} onOpenChange={onOpenChange} className="rounded-lg border bg-card">
      <CollapsibleTrigger className="group flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left hover:bg-accent/50" data-block={b.key}>
        {!loading && <AuditIcon status={b.status} />}
        <CategoryDot category={categoryOfBlock(b.key)} />
        <span className="min-w-0 flex-1 truncate text-[13px] font-medium">{b.name}</span>
        <span className="mono text-[11px] text-muted-foreground">
          {fmtCredits(m.done + m.planned + m.pending)}/{fmtCredits(m.required)}
        </span>
        <LuChevronDown className="size-3.5 text-muted-foreground transition-transform group-data-[state=closed]:-rotate-90" aria-hidden />
      </CollapsibleTrigger>
      <CollapsibleContent className="space-y-0.5 border-t px-1.5 py-1.5">
        {b.note && <p className="px-1.5 pb-1 text-[11px] leading-relaxed text-muted-foreground">{b.note}</p>}
        {showTotal && (b.waivers.length > 0 || b.pendingWaiver > 0 || b.creditStatus === 'missing') && (
          <div className="space-y-1 px-1.5 pb-1 text-xs">
            {b.waivers.map((w) => (
              <button key={w.id} type="button" className="block w-full text-left text-muted-foreground hover:text-foreground" onClick={() => ui.openExceptions({ editId: w.id })}>
                Area total: {w.credits == null ? 'waived' : `${fmtCredits(w.credits)} cr waived`}{w.note ? ` · ${w.note}` : ''}
              </button>
            ))}
            {b.pendingWaiver > 0 && (
              <div className="flex items-center gap-2 text-pending">
                <span className="flex-1">Area total ends {fmtCredits(b.pendingWaiver)} cr short — needs an advisor waiver</span>
                <Button size="xs" variant="outline" onClick={() => ui.openExceptions({ prefill: { type: 'waive', target: b.key, credits: b.pendingWaiver, note: 'Fractional transfer credit (quarter-to-semester conversion)' } })}>Record</Button>
              </div>
            )}
            {b.creditStatus === 'missing' && <div className="text-destructive">Area total needs {fmtCredits(b.short)} more cr</div>}
          </div>
        )}
        {b.lines.map((l, i) => {
          const head = l.group && l.group !== b.lines[i - 1]?.group ? l.group : ''
          return (
            <div key={l.id}>
              {head && <div className="px-1.5 pt-1.5 pb-0.5 text-[10px] font-semibold tracking-wide text-muted-foreground uppercase">{head}</div>}
              <LineRow line={l} loading={loading} />
            </div>
          )
        })}
      </CollapsibleContent>
    </Collapsible>
  )
}

function LineRow({ line: l, loading }: { line: LineResult; loading: boolean }) {
  const ui = useUi()
  const [open, setOpen] = useState(false)
  const isMirror = MIRROR_LINE[l.block] === l.id
  const shown = l.forced ? l.credits : l.credits != null ? Math.min(l.credits, l.done + l.planned + l.pendingCredits + l.waived + l.pendingWaiver) : null
  return (
    <div className={cn('rounded-md', open && 'bg-accent/40')}>
      <button
        type="button"
        onClick={() => setOpen(!open)}
        aria-expanded={open}
        className="flex w-full items-center gap-2 rounded-md px-1.5 py-1.5 text-left hover:bg-accent/60"
      >
        {!loading && <AuditIcon status={l.status} className="size-3" />}
        {l.id === 'major.elec' && <CategoryDot category="elective" className="size-1.5" />}
        <span className={cn('min-w-0 flex-1 truncate text-xs', l.status === 'missing' && 'font-medium')}>{l.label}</span>
        {l.credits != null && shown != null && (
          <span className="mono shrink-0 text-[11px] text-muted-foreground">
            {fmtCredits(shown)}/{fmtCredits(l.credits)}
          </span>
        )}
        {l.credits == null && l.count != null && (
          <span className="mono shrink-0 text-[11px] text-muted-foreground">{l.units.length}/{l.count}</span>
        )}
      </button>
      {open && (
        <div className="space-y-1 px-1.5 pt-0.5 pb-2 pl-6 text-xs">
          <div className="text-[11px] text-muted-foreground">{AUDIT_STATUS_LABEL[l.status]}</div>
          {l.units.map((u, i) => <UnitRow key={i} u={u} />)}
          {l.substitutions.map((x) => (
            <button key={x.id} type="button" onClick={() => ui.openExceptions({ editId: x.id })} className="block w-full text-left hover:underline">
              Substitution: <b className="mono">{x.course}</b>{x.note ? <span className="text-muted-foreground"> · {x.note}</span> : null}
            </button>
          ))}
          {l.waivers.map((w) => (
            <button key={w.id} type="button" onClick={() => ui.openExceptions({ editId: w.id })} className="block w-full text-left hover:underline">
              Exception: {w.credits == null ? 'requirement not needed' : `${fmtCredits(w.credits)} cr waived`}{w.note ? <span className="text-muted-foreground"> · {w.note}</span> : null}
            </button>
          ))}
          {l.pendingSub && (
            <PendingRow text={`Needs the advisor to enter the ${l.pendingSub.course} substitution`} onRecord={() => ui.openExceptions({ prefill: { type: 'substitute', target: l.id, course: l.pendingSub!.course } })} />
          )}
          {!l.pendingSub && l.pendingComplete && (
            <PendingRow text={`Not needed because of the ${l.pendingComplete.course} substitution — needs the advisor`} onRecord={() => ui.openExceptions({ prefill: { type: 'waive', target: l.id, credits: null, note: l.pendingComplete!.completeNote } })} />
          )}
          {l.pendingWaiver > 0 && (
            <PendingRow text={`${fmtCredits(l.pendingWaiver)} cr short — needs an advisor waiver`} onRecord={() => ui.openExceptions({ prefill: { type: 'waive', target: isMirror ? l.block : l.id, credits: l.pendingWaiver, note: 'Fractional transfer credit (quarter-to-semester conversion)' } })} />
          )}
          {l.status === 'missing' && (
            <div className="flex items-start gap-1.5 text-destructive">
              <LuCircleAlert className="mt-0.5 size-3.5 shrink-0" aria-hidden />
              Still needed: {stillNeededText(l)}
            </div>
          )}
          {l.note && l.status !== 'met' && <p className="text-[11px] leading-relaxed text-muted-foreground">{l.note}</p>}
        </div>
      )}
    </div>
  )
}

function PendingRow({ text, onRecord }: { text: string; onRecord: () => void }) {
  return (
    <div className="flex items-center gap-2 text-pending">
      <AuditIcon status="pending" className="size-3" />
      <span className="flex-1">{text}</span>
      <Button size="xs" variant="outline" onClick={onRecord}>Record</Button>
    </div>
  )
}

function UnitRow({ u }: { u: AuditUnit }) {
  const ui = useUi()
  if (u.kind === 'done') {
    return (
      <button type="button" onClick={() => ui.openRecord({ recordId: u.rec.id })} className="flex w-full items-baseline gap-2 text-left hover:underline">
        {u.pending ? <AuditIcon status="pending" className="size-3 self-center" /> : <LuCheck className="size-3 shrink-0 self-center" aria-hidden />}
        <span className="mono font-semibold">{u.code}</span>
        <span className="min-w-0 flex-1 truncate text-muted-foreground">{u.rec.title}</span>
        <GradePill grade={u.grade} />
        <span className="mono shrink-0 text-[11px] text-muted-foreground">{u.term.shortLabel}{u.rec.transfer ? ' · tr' : ''}</span>
      </button>
    )
  }
  return (
    <button type="button" onClick={() => ui.openCourse(u.courseId, u.term.id)} className="flex w-full items-baseline gap-2 text-left hover:underline">
      <AuditIcon status={u.pending ? 'pending' : 'planned'} className="size-3 self-center" />
      <span className="mono font-semibold">{u.code}</span>
      <span className="min-w-0 flex-1 truncate text-muted-foreground">{u.course.title}</span>
      <span className="mono shrink-0 text-[11px] text-muted-foreground">{u.term.shortLabel}</span>
    </button>
  )
}

function NotApplied({ rec }: { rec: AcademicRecord }) {
  const ui = useUi()
  const recs = rec.terms.flatMap((t) => t.courses.map((c) => ({ c, t })))
  const groups = (['unused', 'nocredit', 'notcounted'] as const)
    .map((st) => ({ st, items: recs.filter((x) => x.c.status === st) }))
    .filter((g) => g.items.length)
  if (!groups.length) return null
  const total = groups.reduce((n, g) => n + g.items.length, 0)
  return (
    <Fold title="Not applied to a requirement" badge={total}>
      <div className="space-y-2">
        {groups.map(({ st, items }) => (
          <div key={st}>
            <div className="mb-1 text-[11px] text-muted-foreground">{RECORD_STATUS[st].label} ({items.length})</div>
            <div className="flex flex-wrap gap-1">
              {items.map(({ c, t }) => (
                <button
                  key={c.id}
                  type="button"
                  onClick={() => ui.openRecord({ recordId: c.id })}
                  className={cn('mono inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-[11px] hover:bg-accent', st === 'nocredit' && 'border-destructive/30 text-destructive')}
                >
                  {c.code} <GradePill grade={c.grade} /> <span className="text-muted-foreground">{t.shortLabel}</span>
                </button>
              ))}
            </div>
          </div>
        ))}
      </div>
    </Fold>
  )
}
