import { useEffect, useRef, useState } from 'react'
import { toast } from 'sonner'
import { LuDownload, LuPencil, LuPlus, LuTrash2, LuUpload } from 'react-icons/lu'
import { BLOCKS, GPA_RULES, GRADE_OPTIONS, REQUIREMENT_LINES } from '@/data/degree'
import type { RecordStatus, TermId } from '@/lib/types'
import {
  RECORD_STATUS,
  cleanCode,
  codeToId,
  fmtCredits,
  fmtGpa,
  hasGradePoints,
  normalizeRecord,
  recordForSave,
  round2,
  summarizeRecord,
  termById,
  type StoredRecord,
} from '@/lib/planner'
import { codeAutofill, gradeSuggestion, r2rSaveWarnings, recordTermOptions, recordWhere } from '@/lib/plan-ops'
import { deleteRecordCourse, findRecordCourse, importRecord, recordWritable, saveRecordCourse, type PlannerSnapshot } from '@/lib/store'
import { AppDialog } from '@/components/app-dialog'
import { confirmAction } from '@/components/confirm'
import type { RecordDialogOptions } from '@/components/ui-context'
import { GradePill, Tag } from '@/components/bits'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectTrigger, SelectValue } from '@/components/ui/select'
import { cn } from '@/lib/utils'

export function downloadRecordBackup(snap: PlannerSnapshot) {
  const blob = new Blob([JSON.stringify(recordForSave(snap.record), null, 2)], { type: 'application/json' })
  const a = document.createElement('a')
  a.href = URL.createObjectURL(blob)
  a.download = `academic-record-backup-${new Date().toISOString().slice(0, 10)}.json`
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(a.href), 1000)
}

interface Form {
  termId: TermId
  code: string
  title: string
  credits: string
  grade: string
  status: RecordStatus
  line: string
  gpa: boolean
  r2r: boolean
  transfer: boolean
  school: string
  note: string
}

const BLANK = (termId: TermId): Form => ({ termId, code: '', title: '', credits: '', grade: '', status: 'counted', line: 'auto', gpa: true, r2r: false, transfer: false, school: '', note: '' })

/**
 * The academic record: every past term and grade, stored only in Firebase. Fix a
 * grade, add a course to any past term, import the record file, download a backup.
 */
export function RecordDialog({ opts, onClose, snap }: { opts: RecordDialogOptions | null; onClose: () => void; snap: PlannerSnapshot }) {
  const { record: rec, summary: s } = snap
  const fileRef = useRef<HTMLInputElement>(null)
  const formRef = useRef<HTMLDivElement>(null)
  const termOptions = recordTermOptions(rec, snap.startKey)
  const defaultTerm = rec.terms[rec.terms.length - 1]?.id ?? termOptions.others[0]?.id ?? ''
  const [form, setForm] = useState<Form | null>(null)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [statusTouched, setStatusTouched] = useState(false)
  const [hint, setHint] = useState('')
  const [preview, setPreview] = useState<{ name: string; data: StoredRecord; text: string } | null>(null)

  const startAdd = (termId?: string) => {
    setEditingId(null)
    setStatusTouched(false)
    setHint('')
    setForm(BLANK(termId || defaultTerm))
    requestAnimationFrame(() => formRef.current?.scrollIntoView({ block: 'nearest' }))
  }

  const startEdit = (id: string) => {
    const found = findRecordCourse(id)
    if (!found) return
    const { rec: c, term } = found
    setEditingId(id)
    setStatusTouched(true)
    setHint([c.equiv ? `Satisfied by: ${c.equiv}.` : '', c.note].filter(Boolean).join(' '))
    setForm({ termId: term.id, code: c.code, title: c.title, credits: String(c.credits), grade: c.grade, status: c.status, line: c.line || 'auto', gpa: c.gpa, r2r: c.r2r, transfer: c.transfer, school: c.school, note: c.note })
    requestAnimationFrame(() => formRef.current?.scrollIntoView({ block: 'nearest' }))
  }

  // Opening options: edit one course, add to a term, or import right away.
  useEffect(() => {
    if (!opts) return
    setPreview(null)
    if (opts.recordId && findRecordCourse(opts.recordId)) startEdit(opts.recordId)
    else if (opts.add) startAdd(opts.termId)
    else setForm(null)
    if (opts.importNow) requestAnimationFrame(() => fileRef.current?.click())
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [opts])

  const patch = (p: Partial<Form>) => setForm((f) => (f ? { ...f, ...p } : f))

  const onGrade = (grade: string) => {
    if (!form) return
    const code = cleanCode(form.code) || form.code
    const sug = gradeSuggestion(code, grade)
    const editingUnused = editingId && findRecordCourse(editingId)?.rec.status === 'unused'
    patch({ grade, gpa: sug.gpa, status: !statusTouched || !editingUnused ? sug.status : form.status, r2r: hasGradePoints(grade) && !form.transfer ? form.r2r : false })
    setHint(sug.hint)
  }

  const onCode = (code: string) => {
    patch({ code })
    if (editingId || !form) return
    const fill = codeAutofill(code)
    if (!fill) { setHint(''); return }
    setForm((f) => (f ? { ...f, code, title: f.title || fill.title, credits: f.credits || String(fill.credits) } : f))
    setHint(`Matches ${fill.match} in the course list.`)
  }

  const r2rAllowed = !!form && !form.transfer && hasGradePoints(form.grade)

  const submit = async () => {
    if (!form || !recordWritable()) return
    const code = cleanCode(form.code)
    const credits = Number(form.credits)
    if (!code) { toast.warning('Enter a course code like MATH 2641.'); return }
    if (!termById(form.termId)) { toast.warning('Pick the term the course was taken.'); return }
    if (!(credits >= 0 && credits <= 20) || form.credits === '') { toast.warning('Credits must be between 0 and 20.'); return }
    const r2r = r2rAllowed && form.r2r
    if (r2r) {
      const warn = r2rSaveWarnings(rec, editingId, form.termId, code, form.grade, GPA_RULES.r2rMaxCourses)
      if (warn.length && !(await confirmAction({ title: 'Mark this grade as replaced anyway?', description: warn.join(' '), confirmLabel: 'Mark replaced' }))) return
    }
    const dup = rec.terms.find((t) => t.id === form.termId)?.courses.find((c) => c.id !== editingId && codeToId(c.code) === codeToId(code))
    if (dup && !(await confirmAction({ title: `${termById(form.termId)?.label} already has ${dup.code}`, description: 'Add it again?', confirmLabel: 'Add again' }))) return
    await saveRecordCourse(form.termId, {
      code, title: form.title.trim() || code, credits: round2(credits), grade: form.grade, status: form.status,
      line: form.status === 'counted' ? form.line : '', gpa: form.gpa, transfer: form.transfer, school: form.transfer ? form.school.trim() : '',
      equiv: editingId ? findRecordCourse(editingId)?.rec.equiv || '' : '', note: form.note.trim(), r2r,
    }, editingId)
    setForm(null)
    setEditingId(null)
  }

  const remove = async (id: string) => {
    const found = findRecordCourse(id)
    if (!found) return
    if (!(await confirmAction({ title: `Delete ${found.rec.code} (${found.term.label})?`, description: 'It is removed from the academic record in Firebase.', confirmLabel: 'Delete', destructive: true }))) return
    if (editingId === id) { setForm(null); setEditingId(null) }
    deleteRecordCourse(id)
  }

  const onFile = (file: File) => {
    const reader = new FileReader()
    reader.onload = () => {
      let parsed: unknown = null
      try { parsed = JSON.parse(String(reader.result)) } catch { /* not JSON */ }
      const r = parsed ? normalizeRecord(parsed) : null
      if (!r || !r.terms.length) { toast.warning('That file has no terms and courses in the record format.'); return }
      const sum = summarizeRecord(r)
      const data = recordForSave(r)
      const keepEx = !r.exceptions.length && rec.exceptions.length > 0
      if (keepEx) data.exceptions = recordForSave(rec).exceptions
      setPreview({
        name: file.name,
        data,
        text: `${r.terms.length} terms (${r.terms[0].label} – ${r.terms[r.terms.length - 1].label}), ${sum.courseCount} courses, ${fmtCredits(sum.earned)} cr earned, GSU GPA ${fmtGpa(sum.gsu)} · with transfer ${fmtGpa(sum.overall)}.${rec.terms.length ? ` This replaces the ${rec.terms.length} terms on the record now.${keepEx ? ` The ${rec.exceptions.length} recorded exception(s) are kept.` : ''}` : ''}`,
      })
    }
    reader.readAsText(file)
  }

  return (
    <AppDialog
      open={!!opts}
      onOpenChange={(o) => !o && onClose()}
      size="lg"
      eyebrow="Academic record"
      title="Past terms and grades"
      description={rec.terms.length ? `${rec.terms.length} terms · ${s.courseCount} courses · ${fmtCredits(s.earned)} cr earned · GSU GPA ${fmtGpa(s.gsu)} · with transfer ${fmtGpa(s.overall)}` : 'No record yet — import the record file.'}
      headerExtra={<p className="text-[11px] text-muted-foreground">Stored only in Firebase — never in the site’s code.</p>}
    >
      <div className="space-y-4">
        <div className="flex flex-wrap gap-2">
          <Button size="sm" onClick={() => recordWritable() && startAdd()}>
            <LuPlus className="size-3.5" aria-hidden />
            Add a course
          </Button>
          <Button size="sm" variant="outline" onClick={() => recordWritable() && fileRef.current?.click()}>
            <LuUpload className="size-3.5" aria-hidden />
            Import file
          </Button>
          <Button size="sm" variant="outline" onClick={() => downloadRecordBackup(snap)}>
            <LuDownload className="size-3.5" aria-hidden />
            Download backup
          </Button>
          <input
            ref={fileRef}
            type="file"
            accept=".json,application/json"
            className="sr-only"
            onChange={(e) => {
              const f = e.target.files?.[0]
              e.target.value = ''
              if (f) onFile(f)
            }}
          />
        </div>

        {preview && (
          <div className="space-y-2 rounded-lg border bg-muted/50 p-3 text-sm">
            <div><b>{preview.name}</b>: {preview.text}</div>
            <div className="flex gap-2">
              <Button size="sm" onClick={async () => { const d = preview.data; setPreview(null); await importRecord(d) }}>
                {rec.terms.length ? 'Replace the record' : 'Import'}
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setPreview(null)}>Cancel</Button>
            </div>
          </div>
        )}

        {form && (
          <div ref={formRef} className="space-y-3 rounded-xl border p-3 sm:p-4">
            <div className="text-sm font-semibold">{editingId ? `Edit ${form.code}` : 'Add a course to a past term'}</div>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <Field label="Term">
                <Select value={form.termId} onValueChange={(v) => patch({ termId: v })}>
                  <SelectTrigger className="w-full"><SelectValue placeholder="Term" /></SelectTrigger>
                  <SelectContent>
                    {termOptions.onRecord.length > 0 && (
                      <SelectGroup>
                        <SelectLabel>Terms on the record</SelectLabel>
                        {termOptions.onRecord.map((t) => <SelectItem key={t.id} value={t.id}>{t.label}</SelectItem>)}
                      </SelectGroup>
                    )}
                    <SelectGroup>
                      <SelectLabel>Another past term</SelectLabel>
                      {termOptions.others.map((t) => <SelectItem key={t.id} value={t.id}>{t.label}</SelectItem>)}
                    </SelectGroup>
                  </SelectContent>
                </Select>
              </Field>
              <Field label="Course code">
                <Input value={form.code} onChange={(e) => onCode(e.target.value)} placeholder="e.g. MATH 2641" maxLength={16} autoCapitalize="characters" />
              </Field>
              <Field label="Title" wide>
                <Input value={form.title} onChange={(e) => patch({ title: e.target.value })} placeholder="e.g. Linear Algebra I" maxLength={80} />
              </Field>
              <Field label="Credits">
                <Input type="number" inputMode="decimal" min={0} max={20} step={0.01} value={form.credits} onChange={(e) => patch({ credits: e.target.value })} placeholder="3" />
              </Field>
              <Field label="Grade">
                <Select value={form.grade || 'none'} onValueChange={(v) => onGrade(v === 'none' ? '' : v)}>
                  <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">— no grade —</SelectItem>
                    {GRADE_OPTIONS.map((g) => <SelectItem key={g} value={g}>{g}</SelectItem>)}
                  </SelectContent>
                </Select>
              </Field>
              <Field label="Status" wide>
                <Select value={form.status} onValueChange={(v) => { setStatusTouched(true); patch({ status: v as RecordStatus }) }}>
                  <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {Object.entries(RECORD_STATUS).map(([k, v]) => <SelectItem key={k} value={k}>{v.label}</SelectItem>)}
                  </SelectContent>
                </Select>
              </Field>
              <Field label="Counts toward" wide>
                <Select value={form.line} onValueChange={(v) => patch({ line: v })} disabled={form.status !== 'counted'}>
                  <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="auto">Automatic — the requirement it fits best</SelectItem>
                    <SelectItem value="elective">Elective credit only (counts toward 120)</SelectItem>
                    {BLOCKS.filter((b) => !b.shared).map((b) => (
                      <SelectGroup key={b.key}>
                        <SelectLabel>{b.name}</SelectLabel>
                        {REQUIREMENT_LINES.filter((l) => l.block === b.key).map((l) => <SelectItem key={l.id} value={l.id}>{l.label}</SelectItem>)}
                      </SelectGroup>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
              <Check id="rec-gpa" checked={form.gpa} onChange={(v) => patch({ gpa: v })} label="Counts in GPA" />
              <Check id="rec-transfer" checked={form.transfer} onChange={(v) => patch({ transfer: v, r2r: v ? false : form.r2r })} label="Transfer course" />
              {r2rAllowed && (
                <Check id="rec-r2r" wide checked={form.r2r} onChange={(v) => patch({ r2r: v })} label="Replaced by Repeat to Replace (approved by the Registrar) — left out of the GPA" />
              )}
              {form.transfer && (
                <Field label="Transfer school" wide>
                  <Input value={form.school} onChange={(e) => patch({ school: e.target.value })} placeholder="School name" maxLength={60} />
                </Field>
              )}
              <Field label="Note" wide>
                <Input value={form.note} onChange={(e) => patch({ note: e.target.value })} placeholder="Optional" maxLength={300} />
              </Field>
            </div>
            {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
            <div className="flex flex-wrap gap-2">
              <Button size="sm" onClick={submit}>Save</Button>
              <Button size="sm" variant="ghost" onClick={() => { setForm(null); setEditingId(null) }}>Cancel</Button>
              {editingId && (
                <Button size="sm" variant="ghost" className="ml-auto text-destructive hover:text-destructive" onClick={() => remove(editingId)}>
                  <LuTrash2 className="size-3.5" aria-hidden />
                  Delete
                </Button>
              )}
            </div>
          </div>
        )}

        <div className="space-y-3">
          {[...rec.terms].reverse().map((t) => {
            const info = s.byTerm[t.id]
            return (
              <div key={t.id} className="overflow-hidden rounded-lg border">
                <div className="flex items-center gap-2 bg-muted/60 px-3 py-1.5 text-xs">
                  <span className="font-semibold">{t.label}</span>
                  {info.school && <span className="truncate text-muted-foreground">· {info.school}</span>}
                  <span className="mono ml-auto text-muted-foreground">{fmtCredits(info.earned)} cr{info.termGpa.gpa != null ? ` · ${info.transferOnly ? '≈' : ''}${fmtGpa(info.termGpa)} GPA` : ''}</span>
                </div>
                <ul className="divide-y">
                  {t.courses.map((c) => (
                    <li key={c.id} className={cn('flex items-center gap-2 px-3 py-2', c.id === editingId && 'bg-accent/60')}>
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-1.5">
                          <span className={cn('text-sm font-semibold', c.status === 'nocredit' && 'text-destructive')}>{c.title || c.code}</span>
                          <GradePill grade={c.grade} />
                          {c.transfer && <Tag>transfer</Tag>}
                          {c.r2r && <Tag>replaced</Tag>}
                          {!c.gpa && <Tag>not in GPA</Tag>}
                        </div>
                        <div className="truncate text-[11px] text-muted-foreground">
                          <span className="mono">{c.code}</span> · {fmtCredits(c.credits)} cr ·{' '}
                          <span className={cn(c.status === 'counted' && 'text-green-700 dark:text-green-400', c.status === 'nocredit' && 'text-destructive', c.status === 'notcounted' && 'text-orange-700 dark:text-orange-400')}>
                            {recordWhere(c, snap.audit)}
                          </span>
                        </div>
                      </div>
                      <Button variant="ghost" size="icon" className="size-8 text-muted-foreground" onClick={() => recordWritable() && startEdit(c.id)} aria-label={`Edit ${c.code}`}>
                        <LuPencil className="size-3.5" aria-hidden />
                      </Button>
                      <Button variant="ghost" size="icon" className="size-8 text-muted-foreground hover:text-destructive" onClick={() => recordWritable() && remove(c.id)} aria-label={`Delete ${c.code}`}>
                        <LuTrash2 className="size-3.5" aria-hidden />
                      </Button>
                    </li>
                  ))}
                </ul>
              </div>
            )
          })}
          {!rec.terms.length && <p className="text-sm text-muted-foreground">Nothing on the record yet. Import the record file, or add courses one at a time.</p>}
        </div>
        <div className="flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-muted-foreground">
          {Object.entries(RECORD_STATUS).map(([k, v]) => <span key={k}>{v.icon} {v.label}</span>)}
        </div>
      </div>
    </AppDialog>
  )
}

function Field({ label, children, wide }: { label: string; children: React.ReactNode; wide?: boolean }) {
  return (
    <div className={cn('space-y-1.5', wide && 'sm:col-span-2')}>
      <Label className="text-xs text-muted-foreground">{label}</Label>
      {children}
    </div>
  )
}

function Check({ id, checked, onChange, label, wide }: { id: string; checked: boolean; onChange: (v: boolean) => void; label: string; wide?: boolean }) {
  return (
    <div className={cn('flex items-start gap-2 pt-1', wide && 'sm:col-span-2')}>
      <Checkbox id={id} checked={checked} onCheckedChange={(v) => onChange(v === true)} className="mt-0.5" />
      <Label htmlFor={id} className="text-sm leading-snug font-normal">{label}</Label>
    </div>
  )
}
