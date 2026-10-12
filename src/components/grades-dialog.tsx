import { useEffect, useMemo, useState } from 'react'
import { toast } from 'sonner'
import { LuCheck, LuLock, LuPlus, LuTriangleAlert, LuX } from 'react-icons/lu'
import { GRADE_OPTIONS, R2R_HOW_TO } from '@/data/degree'
import type { TermId } from '@/lib/types'
import { attemptsFor, catalogIdForCode, cleanCode, codeToId, conditionLabel, courseCode, courseGradeParts, findCourse, fmtCredits, round2, statusForGrade } from '@/lib/planner'
import { blockedAfterGrades, gradeVerdict, type GradeRow } from '@/lib/plan-ops'
import { finishTerm, recordWritable, type PlannerSnapshot } from '@/lib/store'
import { AppDialog } from '@/components/app-dialog'
import { confirmAction } from '@/components/confirm'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { cn } from '@/lib/utils'

/**
 * Finishing a term: real final grades (never the expected ones) for each planned
 * course — lecture and lab separately — and the term moves into the locked history.
 */
export function GradesDialog({ termId, onClose, snap }: { termId: TermId | null; onClose: () => void; snap: PlannerSnapshot }) {
  const sem = snap.semesters.find((s) => s.id === termId) ?? null
  const [rows, setRows] = useState<GradeRow[]>([])
  const [result, setResult] = useState<null | { label: string; counted: number; notCounted: number; blocked: string[]; replace: string[] }>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (!termId) return
    setResult(null)
    const out: GradeRow[] = []
    for (const e of snap.plan.schedule[termId] || []) {
      const c = findCourse(e.courseId)
      if (c) courseGradeParts(c).forEach((p) => out.push({ courseId: c.id, code: p.code, title: p.title, credits: p.credits, grade: '' }))
    }
    setRows(out)
    // only when the dialog opens for a term
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [termId])

  const ready = rows.length > 0 && rows.every((r) => r.grade && (r.grade === '__drop' || cleanCode(r.code)))
  const blocked = useMemo(() => (termId && ready ? blockedAfterGrades(snap.record, snap.semesters, snap.plan.schedule, termId, rows) : []), [termId, ready, rows, snap])
  const counted = rows.filter((r) => r.grade && r.grade !== '__drop' && cleanCode(r.code) && statusForGrade(cleanCode(r.code), r.grade) === 'counted').length

  const set = (i: number, patch: Partial<GradeRow>) => setRows((rs) => rs.map((r, j) => (j === i ? { ...r, ...patch } : r)))

  const submit = async () => {
    if (!sem || !recordWritable()) return
    const taken = rows.filter((r) => r.grade && r.grade !== '__drop').map((r) => ({ code: cleanCode(r.code), title: r.title.trim() || cleanCode(r.code), credits: round2(Number(r.credits) || 0), grade: r.grade }))
    if (taken.some((r) => !r.code)) { toast.warning('Every added course needs a code like CSC 4222.'); return }
    const ok = await confirmAction({
      title: `Finish ${sem.label}?`,
      description: 'Its courses and grades move into the locked history, and planning continues from the next term.',
      confirmLabel: `Finish ${sem.label}`,
    })
    if (!ok) return
    setBusy(true)
    const res = await finishTerm(sem.id, taken)
    setBusy(false)
    if (!res) return
    const replace = res.term.courses
      .filter((c) => c.status === 'counted' && attemptsFor(catalogIdForCode(c.code) || codeToId(c.code)).some((a) => a.term.key < sem.key && ['F', 'WF'].includes(a.rec.grade) && a.rec.gpa))
      .map((c) => c.code)
    setResult({
      label: sem.label,
      counted: res.term.courses.filter((c) => c.status === 'counted').length,
      notCounted: res.term.courses.filter((c) => c.status !== 'counted').length,
      blocked: res.blocked.map((b) => `${courseCode(b.courseId)} (${b.sem.label}) needs ${b.unmetText}`),
      replace,
    })
    toast.success(`${sem.label} is now part of the academic history.`)
  }

  return (
    <AppDialog
      open={!!termId}
      onOpenChange={(o) => !o && onClose()}
      size="lg"
      eyebrow="Finish a semester"
      title={result ? `${result.label} is finished` : `Enter final grades — ${sem?.label ?? ''}`}
      description={result ? undefined : `${counted} of ${rows.length} course${rows.length === 1 ? '' : 's'} counting so far · CSC and MATH courses need a C or better.`}
      footer={!result && (
        <div className="flex items-center gap-2">
          <Button onClick={submit} disabled={!ready || busy}>
            <LuLock className="size-4" aria-hidden />
            Finish {sem?.label}
          </Button>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
        </div>
      )}
    >
      {result ? (
        <div className="space-y-3 text-sm">
          <p className="flex items-center gap-2"><LuCheck className="size-4" aria-hidden /> Moved into the history: {result.counted} counted, {result.notCounted} not counted.</p>
          {result.blocked.length > 0 && (
            <div className="rounded-lg bg-destructive/8 p-3 text-destructive">
              <div className="mb-1 font-medium">These planned courses are now missing a prerequisite:</div>
              <ul className="list-disc pl-5">{result.blocked.map((b) => <li key={b}>{b}</li>)}</ul>
            </div>
          )}
          {result.replace.length > 0 && (
            <div className="rounded-lg bg-muted p-3 text-muted-foreground">
              <b className="text-foreground">Repeat to Replace for {result.replace.join(' and ')}:</b> {R2R_HOW_TO} Once it’s approved, open the Record and tick “Replaced by Repeat to Replace” on the earlier F.
            </div>
          )}
          <Button onClick={onClose}>Done</Button>
        </div>
      ) : (
        <div className="space-y-3">
          <p className="text-xs leading-relaxed text-muted-foreground">
            Pick each course’s final grade. Choose “Not taken” for a course dropped without a W — it goes back to the course list.
          </p>
          <ul className="space-y-2">
            {rows.map((r, i) => {
              const v = gradeVerdict(r)
              return (
                <li key={i} className="rounded-lg border p-2.5">
                  <div className="flex items-start gap-2">
                    <div className="min-w-0 flex-1">
                      {r.extra ? (
                        <div className="grid grid-cols-[1fr_4.5rem] gap-1.5 sm:grid-cols-[7rem_1fr_4.5rem]">
                          <Input value={r.code} onChange={(e) => set(i, { code: e.target.value })} placeholder="Code" className="h-9" aria-label="Course code" />
                          <Input value={r.title} onChange={(e) => set(i, { title: e.target.value })} placeholder="Title" className="col-span-2 h-9 sm:col-span-1" aria-label="Title" />
                          <Input type="number" min={0} max={20} step={0.5} value={r.credits} onChange={(e) => set(i, { credits: Number(e.target.value) })} className="h-9" aria-label="Credits" />
                        </div>
                      ) : (
                        <>
                          <div className="flex items-baseline gap-2">
                            <span className="mono text-sm font-semibold">{r.code}</span>
                            <span className="mono text-xs text-muted-foreground">{fmtCredits(r.credits)} cr</span>
                          </div>
                          <div className="truncate text-xs text-muted-foreground">{r.title}</div>
                        </>
                      )}
                    </div>
                    <Select value={r.grade || 'pick'} onValueChange={(g) => set(i, { grade: g === 'pick' ? '' : g })}>
                      <SelectTrigger className="w-28 shrink-0" aria-label={`Grade for ${r.code || 'course'}`}><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="pick">Grade…</SelectItem>
                        {GRADE_OPTIONS.map((g) => <SelectItem key={g} value={g}>{g}</SelectItem>)}
                        <SelectItem value="__drop">Not taken</SelectItem>
                      </SelectContent>
                    </Select>
                    {r.extra && (
                      <Button variant="ghost" size="icon" className="size-9 shrink-0" onClick={() => setRows((rs) => rs.filter((_, j) => j !== i))} aria-label="Remove row">
                        <LuX className="size-4" aria-hidden />
                      </Button>
                    )}
                  </div>
                  <div
                    className={cn(
                      'mt-1 text-xs',
                      v.cls === 'counted' && 'font-medium text-green-700 dark:text-green-400',
                      (v.cls === 'nocredit' || v.cls === 'notcounted') && 'text-destructive',
                      (v.cls === 'todo' || v.cls === 'drop') && 'text-muted-foreground',
                    )}
                  >
                    {v.cls === 'counted' ? '✓ ' : ''}{v.text}
                  </div>
                </li>
              )
            })}
            {!rows.length && <li className="text-sm text-muted-foreground">No courses are planned for {sem?.label}. Add the courses that were taken.</li>}
          </ul>
          <Button variant="outline" size="sm" onClick={() => setRows((rs) => [...rs, { courseId: null, code: '', title: '', credits: 3, grade: '', extra: true }])}>
            <LuPlus className="size-3.5" aria-hidden />
            Add a course taken this term that isn’t in the plan
          </Button>
          {!ready ? (
            <p className="text-xs text-muted-foreground">Pick a grade (or “Not taken”) for every course to finish {sem?.label}.</p>
          ) : blocked.length ? (
            <div className="rounded-lg bg-destructive/8 p-3 text-xs text-destructive">
              <div className="mb-1 flex items-center gap-1.5 font-medium"><LuTriangleAlert className="size-3.5" aria-hidden /> With these grades, planned courses would be missing a prerequisite:</div>
              <ul className="list-disc pl-5">
                {blocked.map((b) => <li key={b.id}><b>{courseCode(b.id)}</b> ({b.sem.label}) needs {b.unmet.map(conditionLabel).join(' and ')}</li>)}
              </ul>
              <div className="mt-1">Plan a retake before those courses, or move them later.</div>
            </div>
          ) : (
            <p className="flex items-center gap-1.5 text-xs"><LuCheck className="size-3.5" aria-hidden /> Every later planned course keeps its prerequisites.</p>
          )}
        </div>
      )}
    </AppDialog>
  )
}
