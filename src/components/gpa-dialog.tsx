import { useEffect, useRef, useState } from 'react'
import { LuArrowUpRight, LuChevronDown, LuRepeat } from 'react-icons/lu'
import { GPA_OPEN_QUESTIONS, GPA_RULES, GPA_RULE_SUMMARY, GPA_SOURCES, R2R_HOW_TO } from '@/data/degree'
import type { TermId } from '@/lib/types'
import { PROJECTION_GRADES, fmtCredits, fmtDelta, fmtGpa, hasGradePoints, round2, targetNeeded, type GpaResult, type TargetResult } from '@/lib/planner'
import {
  clearAllProjectedGrades,
  fillTermGrades,
  setGpaTarget,
  setProjectedGrade,
  setRepeatToReplace,
  type PlannerSnapshot,
} from '@/lib/store'
import { AppDialog, DialogSection } from '@/components/app-dialog'
import { R2R_STATUS_TEXT } from '@/components/course-dialog'
import { confirmAction } from '@/components/confirm'
import { Tag } from '@/components/bits'
import { Button } from '@/components/ui/button'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import { cn } from '@/lib/utils'

function Delta({ v }: { v: number | null }) {
  if (v == null) return null
  return <span className={cn('mono ml-1 text-[11px]', v < 0 ? 'text-destructive' : 'text-muted-foreground')}>{fmtDelta(v)}</span>
}
function Cell({ g, d }: { g: GpaResult; d: number | null }) {
  return <><b className="mono font-semibold">{fmtGpa(g)}</b><Delta v={d} /></>
}

/**
 * What-if grades, term by term. Expected grades live in their own Firebase document
 * and never touch the record, the audit or the plan.
 */
export function GpaDialog({ open, focusTerm, onClose, snap }: { open: boolean; focusTerm?: TermId; onClose: () => void; snap: PlannerSnapshot }) {
  const g = snap.gpa
  const rep = snap.record.reported
  const matches = rep?.gsuGpa != null && rep.gsuGpa === g.current.gsu.gpa && rep.overallGpa === g.current.overall.gpa
  const termRefs = useRef<Record<string, HTMLDivElement | null>>({})

  useEffect(() => {
    if (!open || !focusTerm) return
    const t = setTimeout(() => termRefs.current[focusTerm]?.scrollIntoView({ block: 'start' }), 180)
    return () => clearTimeout(t)
  }, [open, focusTerm])

  const used = g.r2rUsed + g.r2rReserved
  const lastIdx = g.withR2R.map((w) => w.graded > 0).lastIndexOf(true)
  const gain = lastIdx >= 0 && g.withR2R[lastIdx].replaced ? { w: g.withR2R[lastIdx], o: g.withoutR2R[lastIdx] } : null

  return (
    <AppDialog
      open={open}
      onOpenChange={(o) => !o && onClose()}
      size="xl"
      eyebrow="GPA projection"
      title="What-if grades, term by term"
      description={snap.record.terms.length
        ? <>Now: GSU <b className="mono text-foreground">{fmtGpa(g.current.gsu)}</b> · GSU + transfer <b className="mono text-foreground">{fmtGpa(g.current.overall)}</b>{matches ? ' · matches Degree Works' : ''}</>
        : 'Import the academic record to project from real grades.'}
      headerExtra={<p className="text-[11px] text-muted-foreground">Estimates from the grades you pick — GSU calculates the official GPA after grades post.</p>}
    >
      <DialogSection title="Projected GPA after each term">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-[11px] text-muted-foreground">
              <th className="py-1.5 pr-2 font-medium">Term</th>
              <th className="py-1.5 pr-2 font-medium">Term GPA</th>
              <th className="py-1.5 pr-2 font-medium">GSU GPA</th>
              <th className="py-1.5 font-medium">GSU + transfer</th>
            </tr>
          </thead>
          <tbody className="divide-y">
            <tr className="bg-muted/40">
              <td className="py-1.5 pr-2 font-medium">Now</td>
              <td className="py-1.5 pr-2 text-muted-foreground">—</td>
              <td className="py-1.5 pr-2"><b className="mono">{fmtGpa(g.current.gsu)}</b></td>
              <td className="py-1.5"><b className="mono">{fmtGpa(g.current.overall)}</b></td>
            </tr>
            {g.withR2R.map((w, i) => {
              const o = g.withoutR2R[i]
              if (!w.total) return null
              const differs = w.replaced > 0 && (o.cumGsu.gpa !== w.cumGsu.gpa || o.cumOverall.gpa !== w.cumOverall.gpa)
              return (
                <tr key={w.term.id} className={cn('align-top', !w.graded && 'text-muted-foreground')}>
                  <td className="py-1.5 pr-2">
                    <div>{w.term.label}</div>
                    <div className="mono text-[11px] text-muted-foreground">{w.graded}/{w.total} graded</div>
                  </td>
                  <td className="py-1.5 pr-2">{w.graded ? <Cell g={w.termGpa} d={w.deltaTerm} /> : '—'}</td>
                  <td className="py-1.5 pr-2">
                    <Cell g={w.cumGsu} d={w.deltaGsu} />
                    {differs && <div className="mono text-[11px] text-muted-foreground">without R2R {fmtGpa(o.cumGsu)}</div>}
                  </td>
                  <td className="py-1.5">
                    <Cell g={w.cumOverall} d={w.deltaOverall} />
                    {differs && <div className="mono text-[11px] text-muted-foreground">without R2R {fmtGpa(o.cumOverall)}</div>}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
        <p className="text-[11px] leading-relaxed text-muted-foreground">
          ▲▼ = change from her current GPA (the term GPA is compared with the current GSU GPA). Repeat to Replace (R2R) is applied as switched below; “without R2R” shows the same grades if none were replaced. Courses without an expected grade are left out.
        </p>
      </DialogSection>

      <DialogSection title="Repeat to Replace" action={<Tag tone={used > GPA_RULES.r2rMaxCourses ? 'bad' : 'neutral'}>{used} of {GPA_RULES.r2rMaxCourses} courses</Tag>}>
        {g.candidates.length ? (
          <div className="space-y-2">
            {g.candidates.map((c) => (
              <div key={`${c.codeId}-${c.term.id}`} className="flex items-start gap-3 rounded-lg border px-3 py-2.5">
                <Switch id={`gpa-r2r-${c.codeId}`} checked={c.on} onCheckedChange={(v) => setRepeatToReplace(c.codeId, v)} aria-label={`Repeat to Replace for ${c.code}`} />
                <Label htmlFor={`gpa-r2r-${c.codeId}`} className="block flex-1 space-y-0.5 text-xs leading-relaxed font-normal">
                  <span className="flex items-center gap-1.5 text-sm font-medium"><LuRepeat className="size-3.5" aria-hidden /><span className="mono">{c.code}</span></span>
                  <span className="block text-muted-foreground">
                    Retake in {c.term.label} · first grade <b className="mono text-foreground">{c.first.rec.grade || '—'}</b> ({c.first.term.label}){c.grade ? <> · expected <b className="mono text-foreground">{c.grade}</b></> : null}
                  </span>
                  <span className={cn('block', (c.status === 'blocked' || c.status === 'limit' || c.status === 'lower') && 'text-destructive')}>
                    {R2R_STATUS_TEXT[c.status]}{c.note ? ` — ${c.note}` : ''}
                  </span>
                </Label>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">No planned course repeats an earlier GSU grade.</p>
        )}
        {gain && gain.w.cumGsu.gpa != null && gain.o.cumGsu.gpa != null && gain.w.cumOverall.gpa != null && gain.o.cumOverall.gpa != null && (
          <p className="rounded-md bg-muted px-3 py-2 text-xs leading-relaxed">
            After {gain.w.term.label}, Repeat to Replace adds <b className="mono">{fmtDelta(round2(gain.w.cumGsu.gpa - gain.o.cumGsu.gpa))}</b> to the GSU GPA ({fmtGpa(gain.o.cumGsu)} → {fmtGpa(gain.w.cumGsu)}) and <b className="mono">{fmtDelta(round2(gain.w.cumOverall.gpa - gain.o.cumOverall.gpa))}</b> to the GSU + transfer GPA ({fmtGpa(gain.o.cumOverall)} → {fmtGpa(gain.w.cumOverall)}).
          </p>
        )}
        <p className="text-xs leading-relaxed text-muted-foreground">
          <b className="text-foreground">How and when to request it:</b> {R2R_HOW_TO} Only the first recorded grade can be replaced, and an approval can’t be undone. After it’s approved, tick “Replaced by Repeat to Replace” on the earlier grade in the Record.
        </p>
      </DialogSection>

      <DialogSection
        title="Expected grades"
        action={
          <Button
            size="xs"
            variant="ghost"
            onClick={async () => {
              if (await confirmAction({ title: 'Clear every expected grade?', description: 'Real grades, the record and the plan are not affected.', confirmLabel: 'Clear', destructive: true })) clearAllProjectedGrades()
            }}
          >
            Reset all
          </Button>
        }
      >
        <p className="text-xs text-muted-foreground">Only for estimates — they never mark a course completed. Real grades go in through “Enter final grades” when a term ends.</p>
        <div className="space-y-3">
          {g.terms.map((t, i) => {
            const w = g.withR2R[i]
            return (
              <div key={t.term.id} ref={(el) => { termRefs.current[t.term.id] = el }} className="scroll-mt-4 rounded-xl border">
                <div className="flex flex-wrap items-center gap-2 border-b bg-muted/40 px-3 py-2">
                  <span className="text-sm font-semibold">{t.term.label}</span>
                  <span className="mono text-xs text-muted-foreground">{fmtCredits(t.hours)} cr</span>
                  {t.rows.length > 0 && (
                    <span className="ml-auto flex gap-1">
                      {['A', 'B', 'C'].map((l) => (
                        <Button key={l} size="xs" variant="outline" onClick={() => fillTermGrades(t.term.id, l)}>All {l}</Button>
                      ))}
                      <Button size="xs" variant="ghost" onClick={() => fillTermGrades(t.term.id, '')}>Clear</Button>
                    </span>
                  )}
                </div>
                <ul className="divide-y">
                  {t.rows.map((r) => (
                    <li key={r.codeId} className={cn('flex items-center gap-2 px-3 py-1.5', !r.grade && 'text-muted-foreground')}>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-1.5">
                          <span className="mono text-sm font-semibold text-foreground">{r.code}</span>
                          {r.candidate && <Tag>retake</Tag>}
                        </div>
                        <div className="truncate text-xs">{r.title}</div>
                      </div>
                      <span className="mono text-xs">{fmtCredits(r.credits)} cr</span>
                      <Select value={r.grade || 'none'} onValueChange={(v) => setProjectedGrade(r.codeId, v === 'none' ? '' : v)}>
                        <SelectTrigger size="sm" className="w-20" aria-label={`Expected grade for ${r.code}`}><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="none">—</SelectItem>
                          {PROJECTION_GRADES.map((l) => <SelectItem key={l} value={l}>{l}</SelectItem>)}
                        </SelectContent>
                      </Select>
                    </li>
                  ))}
                  {!t.rows.length && <li className="px-3 py-2 text-xs text-muted-foreground">No courses planned for this term.</li>}
                </ul>
                {t.graded > 0 && (
                  <div className="border-t px-3 py-1.5 text-xs">
                    Estimated: term <Cell g={w.termGpa} d={null} /> · GSU <Cell g={w.cumGsu} d={w.deltaGsu} /> · GSU + transfer <Cell g={w.cumOverall} d={w.deltaOverall} />
                  </div>
                )}
              </div>
            )
          })}
        </div>
      </DialogSection>

      <TargetSection snap={snap} />

      <DialogSection>
        <Collapsible>
          <CollapsibleTrigger className="group flex w-full items-center gap-1.5 text-left text-xs font-semibold tracking-wide text-muted-foreground uppercase">
            <LuChevronDown className="size-3.5 transition-transform group-data-[state=closed]:-rotate-90" aria-hidden />
            How GSU calculates GPA · open questions
          </CollapsibleTrigger>
          <CollapsibleContent className="space-y-3 pt-3">
            <ul className="list-disc space-y-1.5 pl-4 text-xs leading-relaxed text-muted-foreground">
              {GPA_RULE_SUMMARY.map((x) => <li key={x}>{x}</li>)}
            </ul>
            <div className="text-xs font-medium">To confirm with the Registrar or her advisor</div>
            <ul className="list-disc space-y-1.5 pl-4 text-xs leading-relaxed text-muted-foreground">
              {openQuestions(snap).map((x) => <li key={x}>{x}</li>)}
            </ul>
            <div className="flex flex-wrap gap-x-3 gap-y-1 text-xs">
              {GPA_SOURCES.map((s) => (
                <a key={s.url} href={s.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-0.5 text-muted-foreground underline-offset-2 hover:text-foreground hover:underline">
                  {s.label}<LuArrowUpRight className="size-3" aria-hidden />
                </a>
              ))}
            </div>
          </CollapsibleContent>
        </Collapsible>
      </DialogSection>
    </AppDialog>
  )
}

function openQuestions(snap: PlannerSnapshot): string[] {
  const notCounted = snap.record.terms.flatMap((t) => t.courses
    .filter((c) => c.transfer && hasGradePoints(c.grade) && c.gpa === false)
    .map((c) => `${c.code} ${c.grade} (${t.label})`))
  const open = [...GPA_OPEN_QUESTIONS]
  if (notCounted.length) open.unshift(`Degree Works leaves ${notCounted.join(' and ')} out as “Not counted” (“Max of zero classes/credits exceeded”). Her official GSU + transfer GPA matches only without them, but no catalog rule says why (each course was retaken later) — confirm with the Registrar.`)
  return open
}

function TargetSection({ snap }: { snap: PlannerSnapshot }) {
  const t = snap.projection.target
  const terms = snap.semesters.filter((s) => (snap.plan.schedule[s.id] || []).length)
  const termId = terms.some((s) => s.id === t.termId) ? t.termId : terms[0]?.id || ''
  const [value, setValue] = useState(t.gpa.toFixed(2))
  useEffect(() => setValue(t.gpa.toFixed(2)), [t.gpa])

  const scopes: [('overall' | 'gsu'), string][] = [['overall', 'GSU + transfer GPA'], ['gsu', 'GSU GPA']]
  return (
    <DialogSection title="Target GPA">
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <span>Reach</span>
        <Input
          type="number"
          inputMode="decimal"
          min={1}
          max={GPA_RULES.maxGradePoints}
          step={0.01}
          value={value}
          onChange={(e) => {
            setValue(e.target.value)
            const v = Number(e.target.value)
            if (v > 0 && v <= GPA_RULES.maxGradePoints) setGpaTarget({ gpa: round2(v) })
          }}
          className="h-9 w-24"
          aria-label="Target GPA"
        />
        <span>by the end of</span>
        <Select value={termId} onValueChange={(v) => setGpaTarget({ termId: v })} disabled={!terms.length}>
          <SelectTrigger className="h-9 w-40" aria-label="Target term"><SelectValue placeholder="—" /></SelectTrigger>
          <SelectContent>
            {terms.map((s) => <SelectItem key={s.id} value={s.id}>{s.label}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>
      {!termId ? (
        <p className="text-sm text-muted-foreground">Plan some courses first.</p>
      ) : (
        <div className="space-y-2">
          {scopes.map(([scope, label]) => {
            const on = targetNeeded(snap.record, snap.plan.schedule, snap.semesters, snap.projection, termId, t.gpa, scope, true)
            const off = targetNeeded(snap.record, snap.plan.schedule, snap.semesters, snap.projection, termId, t.gpa, scope, false)
            return (
              <div key={scope} className="rounded-lg border p-3">
                <div className="mb-1.5 flex items-baseline gap-2 text-sm font-medium">
                  {label}
                  <span className="mono text-xs font-normal text-muted-foreground">now {fmtGpa({ gpa: off.now })}</span>
                </div>
                <div className="grid gap-1.5 text-xs sm:grid-cols-2">
                  <div><span className="text-muted-foreground">With R2R: </span><TargetText r={on} target={t.gpa} /></div>
                  <div><span className="text-muted-foreground">Without R2R: </span><TargetText r={off} target={t.gpa} /></div>
                </div>
              </div>
            )
          })}
          <p className="text-[11px] leading-relaxed text-muted-foreground">
            The average is weighted by credits across every course planned through {snap.semesters.find((s) => s.id === termId)?.label} (A 4.00 · A− 3.70 · B+ 3.30 · B 3.00). A target counts once the official GPA rounds to it. Retakes switched on above are assumed to beat their old grade.
          </p>
        </div>
      )}
    </DialogSection>
  )
}

function TargetText({ r, target }: { r: TargetResult; target: number }) {
  if (r.status === 'none') return <>No courses planned by then</>
  if (r.status === 'already') return <>Already there — any passing grades keep it at {target.toFixed(2)} or higher</>
  if (r.status === 'unreachable') return <><b className="text-destructive">Not reachable</b> — even all A+ gives {r.allAPlus?.toFixed(2)} (all A: {r.allA?.toFixed(2)})</>
  return <>Needs a <b className="mono">{r.needed.toFixed(2)}</b> average over {fmtCredits(r.hours)} cr — about all <b>{r.atLeast}</b>{r.atLeast === 'A+' ? ' (A+ is rare)' : ''} · all A gives {r.allA?.toFixed(2)}</>
}
