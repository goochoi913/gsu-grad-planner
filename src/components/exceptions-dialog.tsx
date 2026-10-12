import { useEffect, useMemo, useState } from 'react'
import { toast } from 'sonner'
import { LuPencil, LuTrash2 } from 'react-icons/lu'
import { BLOCKS, REQUIREMENT_LINES, SUBSTITUTIONS } from '@/data/degree'
import { BLOCK_BY_KEY, LINE_BY_ID, MIRROR_LINE, cleanCode, courseCode, fmtCredits, round2, targetLabel } from '@/lib/planner'
import { recordWritable, removeException, saveException, type ExceptionFields, type PlannerSnapshot } from '@/lib/store'
import { AppDialog, DialogSection } from '@/components/app-dialog'
import { confirmAction } from '@/components/confirm'
import { AuditIcon } from '@/components/bits'
import type { ExceptionPrefill } from '@/components/ui-context'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectTrigger, SelectValue } from '@/components/ui/select'

interface Form {
  type: 'substitute' | 'waive'
  target: string
  course: string
  credits: string
  whole: boolean
  note: string
  pair: boolean
}
const BLANK: Form = { type: 'waive', target: 'advice.calc', course: '', credits: '', whole: false, note: '', pair: true }

/**
 * Advisor exceptions, recorded once the advisor has entered them in Degree Works:
 * a substitution puts a course on a requirement line; a waiver lowers the credits a
 * line or an area needs (or the whole requirement). Recorded ones count as met.
 */
export function ExceptionsDialog({ opts, onClose, snap }: { opts: { prefill?: ExceptionPrefill; editId?: string } | null; onClose: () => void; snap: PlannerSnapshot }) {
  const { record, audit } = snap
  const [form, setForm] = useState<Form>(BLANK)
  const [editingId, setEditingId] = useState<string | null>(null)

  const fromPrefill = (p: ExceptionPrefill): Form => ({
    type: p.type, target: p.target, course: p.course || '', whole: p.type === 'waive' && p.credits == null,
    credits: p.credits != null ? String(p.credits) : '',
    note: p.note || (p.type === 'substitute' ? SUBSTITUTIONS.find((s) => s.line === p.target)?.applyNote || '' : ''), pair: true,
  })

  useEffect(() => {
    if (!opts) return
    if (opts.editId) {
      const x = record.exceptions.find((e) => e.id === opts.editId)
      if (x) { setForm(fromPrefill(x)); setEditingId(x.id); return }
    }
    setEditingId(null)
    setForm(opts.prefill ? fromPrefill(opts.prefill) : BLANK)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [opts])

  const sub = form.type === 'substitute'
  // A substitution goes on a line, never an area total.
  const target = sub && BLOCK_BY_KEY[form.target] ? (MIRROR_LINE[form.target] || REQUIREMENT_LINES.find((l) => l.block === form.target)!.id) : form.target
  const rule = sub ? SUBSTITUTIONS.find((s) => s.line === target) : undefined
  const pairOpen = !!rule && !editingId && rule.complete.some((id) => !record.exceptions.some((x) => x.type === 'waive' && x.target === id))
  const line = audit.lineById[target]
  const courseOptions = useMemo(() => [...new Set([
    ...record.terms.flatMap((t) => t.courses.map((c) => c.code)),
    ...snap.semesters.flatMap((s) => (snap.plan.schedule[s.id] || []).map((e) => courseCode(e.courseId))),
  ])].sort(), [record, snap.semesters, snap.plan.schedule])

  const submit = async () => {
    if (!recordWritable()) return
    const course = cleanCode(form.course)
    const credits = Number(form.credits)
    if (sub && !course) { toast.warning('Enter the course that substitutes, like CSC 4350.'); return }
    if (sub && !LINE_BY_ID[target]) { toast.warning('A substitution goes on a requirement line.'); return }
    if (!sub && !form.whole && !(credits > 0 && credits <= 20)) { toast.warning('Enter the credits waived (for example 0.67) or tick “Whole requirement”.'); return }
    const fields: ExceptionFields = { type: form.type, target, course: sub ? course : '', credits: !sub && !form.whole ? round2(credits) : null, note: form.note.trim() }
    const also: ExceptionFields[] = pairOpen && form.pair && rule ? rule.complete.map((id) => ({ type: 'waive' as const, target: id, course: '', credits: null, note: rule.completeNote })) : []
    await saveException(fields, editingId, also)
    setEditingId(null)
    setForm(BLANK)
  }

  return (
    <AppDialog
      open={!!opts}
      onOpenChange={(o) => !o && onClose()}
      size="lg"
      eyebrow="Advisor exceptions"
      title={editingId ? `Edit: ${targetLabel(form.target)}` : 'Record an exception'}
      description="Record it once the advisor has entered it in Degree Works."
    >
      <DialogSection>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div className="space-y-1.5 sm:col-span-2">
            <Label className="text-xs text-muted-foreground">Type</Label>
            <Select value={form.type} onValueChange={(v) => setForm({ ...form, type: v as Form['type'] })}>
              <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="substitute">Substitution — a course satisfies this line</SelectItem>
                <SelectItem value="waive">Credit waiver — fewer credits, or none, needed</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5 sm:col-span-2">
            <Label className="text-xs text-muted-foreground">Requirement</Label>
            <Select value={target} onValueChange={(v) => setForm({ ...form, target: v })}>
              <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
              <SelectContent>
                {BLOCKS.map((b) => (
                  <SelectGroup key={b.key}>
                    <SelectLabel>{b.name}</SelectLabel>
                    {b.credits != null && <SelectItem value={b.key} disabled={sub}>{b.name} — area total ({b.credits} cr)</SelectItem>}
                    {REQUIREMENT_LINES.filter((l) => l.block === b.key).map((l) => <SelectItem key={l.id} value={l.id}>{l.label}</SelectItem>)}
                  </SelectGroup>
                ))}
              </SelectContent>
            </Select>
          </div>
          {sub ? (
            <div className="space-y-1.5">
              <Label className="text-xs text-muted-foreground">Course</Label>
              <Input value={form.course} onChange={(e) => setForm({ ...form, course: e.target.value })} placeholder="e.g. CSC 4350" maxLength={16} list="ex-course-options" />
              <datalist id="ex-course-options">{courseOptions.map((c) => <option key={c} value={c} />)}</datalist>
            </div>
          ) : (
            <>
              {!form.whole && (
                <div className="space-y-1.5">
                  <Label className="text-xs text-muted-foreground">Credits waived</Label>
                  <Input type="number" inputMode="decimal" min={0.01} max={20} step={0.01} value={form.credits} onChange={(e) => setForm({ ...form, credits: e.target.value })} placeholder="0.67" />
                </div>
              )}
              <div className="flex items-center gap-2 pt-5">
                <Checkbox id="ex-whole" checked={form.whole} onCheckedChange={(v) => setForm({ ...form, whole: v === true })} />
                <Label htmlFor="ex-whole" className="text-sm font-normal">Whole requirement (course not needed)</Label>
              </div>
            </>
          )}
          {pairOpen && rule && (
            <div className="flex items-start gap-2 sm:col-span-2">
              <Checkbox id="ex-pair" checked={form.pair} onCheckedChange={(v) => setForm({ ...form, pair: v === true })} className="mt-0.5" />
              <Label htmlFor="ex-pair" className="text-sm leading-snug font-normal">Also record “{rule.completeNote}” on {rule.complete.map((id) => LINE_BY_ID[id].label).join(', ')}</Label>
            </div>
          )}
          <div className="space-y-1.5 sm:col-span-2">
            <Label className="text-xs text-muted-foreground">Note</Label>
            <Input value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} placeholder="e.g. Entered by the advisor on 01/15/2027" maxLength={200} />
          </div>
        </div>
        <p className="text-xs text-muted-foreground">
          {sub ? 'The course fills this line like Degree Works “Apply Here”.' : line ? `${line.label} needs ${line.credits != null ? `${line.credits} cr` : `${line.count} course`}; a waiver counts as met right away.` : 'Lowers the credits this area needs.'}
        </p>
        <div className="flex flex-wrap gap-2">
          <Button size="sm" onClick={submit}>Save exception</Button>
          {editingId && (
            <>
              <Button size="sm" variant="ghost" onClick={() => { setEditingId(null); setForm(BLANK) }}>Cancel</Button>
              <Button
                size="sm"
                variant="ghost"
                className="ml-auto text-destructive hover:text-destructive"
                onClick={async () => {
                  if (await confirmAction({ title: 'Remove this exception?', description: 'The requirement goes back to its normal status.', confirmLabel: 'Remove', destructive: true })) {
                    await removeException(editingId)
                    setEditingId(null)
                    setForm(BLANK)
                  }
                }}
              >
                <LuTrash2 className="size-3.5" aria-hidden />
                Remove
              </Button>
            </>
          )}
        </div>
      </DialogSection>

      <DialogSection title="Recorded">
        {record.exceptions.length ? (
          <ul className="divide-y rounded-lg border">
            {record.exceptions.map((x) => (
              <li key={x.id} className="flex items-center gap-2 px-3 py-2">
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-medium">
                    {x.type === 'substitute' ? <>Substitution · <span className="mono">{x.course}</span></> : x.credits == null ? 'Not needed (force complete)' : `${fmtCredits(x.credits)} cr waived`}
                  </div>
                  <div className="truncate text-xs text-muted-foreground">{targetLabel(x.target)}</div>
                  {x.note && <div className="truncate text-[11px] text-muted-foreground">{x.note}</div>}
                </div>
                <Button variant="ghost" size="icon" className="size-8" onClick={() => { setEditingId(x.id); setForm(fromPrefill(x)) }} aria-label="Edit">
                  <LuPencil className="size-3.5" aria-hidden />
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  className="size-8 hover:text-destructive"
                  onClick={async () => {
                    if (await confirmAction({ title: 'Remove this exception?', confirmLabel: 'Remove', destructive: true })) {
                      if (editingId === x.id) { setEditingId(null); setForm(BLANK) }
                      removeException(x.id)
                    }
                  }}
                  aria-label="Remove"
                >
                  <LuTrash2 className="size-3.5" aria-hidden />
                </Button>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-muted-foreground">None recorded yet.</p>
        )}
      </DialogSection>

      {audit.pending.length > 0 && (
        <DialogSection title={`Still pending in the plan (${audit.pending.length})`}>
          <ul className="divide-y rounded-lg border border-pending/40">
            {audit.pending.map((p, i) => {
              const prefill: ExceptionPrefill = p.kind === 'substitute' ? { type: 'substitute', target: p.target, course: p.course }
                : p.kind === 'complete' ? { type: 'waive', target: p.target, credits: null, note: p.rule.completeNote }
                : { type: 'waive', target: p.target, credits: p.credits, note: 'Fractional transfer credit (quarter-to-semester conversion)' }
              const text = p.kind === 'substitute' ? `${p.course} substitution` : p.kind === 'complete' ? 'Course not needed because of substitution' : `${fmtCredits(p.credits)} cr waiver`
              return (
                <li key={i} className="flex items-center gap-2 px-3 py-2">
                  <AuditIcon status="pending" />
                  <div className="min-w-0 flex-1">
                    <div className="text-sm">{text}</div>
                    <div className="truncate text-xs text-muted-foreground">{targetLabel(p.target)}</div>
                  </div>
                  <Button size="xs" variant="outline" onClick={() => { setEditingId(null); setForm(fromPrefill(prefill)) }}>Fill in</Button>
                </li>
              )
            })}
          </ul>
        </DialogSection>
      )}
    </AppDialog>
  )
}
