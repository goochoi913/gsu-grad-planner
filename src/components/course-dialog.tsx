import { useEffect, useRef, useState } from 'react'
import { toast } from 'sonner'
import { LuCalendarRange, LuCheck, LuHourglass, LuPlus, LuRepeat, LuTrash2, LuTriangleAlert } from 'react-icons/lu'
import { BLOCK_TYPES, DAY_LABELS, DAY_ORDER, FOS_NOTE, OFFERING_TERMS, RPE_NOTE, SUBSTITUTIONS } from '@/data/degree'
import type { CatalogCourse, MeetingBlock, PrereqCondition, TermId } from '@/lib/types'
import {
  LINE_BY_ID,
  RECORD_STATUS,
  SEASONS,
  SEASON_META,
  attemptsFor,
  codeToId,
  conditionLabel,
  courseCode,
  findCourse,
  isCourseDone,
  offeringInfo,
} from '@/lib/planner'
import { cleanDescription, failedAttempts, lastPassingAttempt, roleText, scheduledIn, semesterCredits, unmetPrereqs } from '@/lib/plan-ops'
import { SCHEDULE_TERM_ID, isOfferedIn, scheduleFor, sectionCount } from '@/lib/schedule'
import { addCourse, removeCourse, setRepeatToReplace, updateBlocks, type PlannerSnapshot } from '@/lib/store'
import { genId, fmtTimeRange } from '@/lib/format'
import { AppDialog, DialogSection } from '@/components/app-dialog'
import { PickerFooter, PickerSections, PickerWeek } from '@/components/section-picker'
import { useSectionPicker, type SectionPicker } from '@/hooks/use-section-picker'
import { CategoryTag, GradePill, Tag } from '@/components/bits'
import { categoryOf } from '@/lib/colors'
import { confirmAction } from '@/components/confirm'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import { useUi } from '@/components/ui-context'
import { useMedia } from '@/hooks/use-media'
import { cn } from '@/lib/utils'

export const R2R_STATUS_TEXT: Record<string, string> = {
  applies: 'Replaces the earlier grade',
  pending: 'Pick an expected grade to see the effect',
  lower: 'Won’t replace it',
  limit: 'Over the 4-course limit',
  blocked: 'Not eligible',
  off: 'Switched off',
}

export function CourseDialog({ courseId, onClose, snap }: { courseId: string | null; onClose: () => void; snap: PlannerSnapshot }) {
  // Keep showing the last course while the dialog animates closed; start fresh each time one opens.
  const [shown, setShown] = useState({ id: courseId, n: 0, open: !!courseId })
  if (!!courseId !== shown.open || (courseId && courseId !== shown.id)) {
    const fresh = !!courseId && (!shown.open || courseId !== shown.id)
    setShown({ id: courseId ?? shown.id, n: fresh ? shown.n + 1 : shown.n, open: !!courseId })
  }
  const course = shown.id ? findCourse(shown.id) : null
  if (!course) return null
  return <CourseDialogFor key={`${course.id}:${shown.n}`} course={course} open={!!courseId} onClose={onClose} snap={snap} />
}

function CourseDialogFor({ course, open, onClose, snap }: { course: CatalogCourse; open: boolean; onClose: () => void; snap: PlannerSnapshot }) {
  const wide = useMedia('(min-width: 1024px)')
  const tablet = useMedia('(min-width: 640px)')
  const dirtyRef = useRef(false)
  const done = isCourseDone(course.id)
  const inSem = done ? null : scheduledIn(snap.semesters, snap.plan.schedule, course.id)
  const picker = useSectionPicker(course, SCHEDULE_TERM_ID, snap)
  const offered = !!picker && isOfferedIn(course, SCHEDULE_TERM_ID)
  // Planned for a later term: the sections open on request ("Compare … sections").
  const [compare, setCompare] = useState(false)
  const pickerOn = !done && offered && (inSem === SCHEDULE_TERM_ID || !inSem || compare)

  const attemptClose = async () => {
    if (pickerOn && picker!.dirty && picker!.canSave) {
      const save = await confirmAction({
        title: `Save ${picker!.label}?`,
        description: `You picked it for ${course.title} but haven’t saved it yet.`,
        confirmLabel: 'Save',
        cancelLabel: 'Don’t save',
      })
      if (save) picker!.save()
      onClose()
      return
    }
    if (dirtyRef.current) {
      const ok = await confirmAction({ title: 'Discard the meeting-time changes?', description: 'You edited meeting times without saving them.', confirmLabel: 'Discard', destructive: true })
      if (!ok) return
    }
    dirtyRef.current = false
    onClose()
  }

  const header = {
    eyebrow: (
      <span className="mono">
        {course.code} · {course.credits} credits{course.kind !== 'Lecture' ? ` · ${course.kind}` : ''}
      </span>
    ),
    title: course.title,
    description: roleText(course, snap.audit),
    headerExtra: <HeaderTags course={course} snap={snap} />,
  }

  if (pickerOn && picker) {
    return (
      <AppDialog
        open={open}
        onOpenChange={(o) => !o && attemptClose()}
        size="wide"
        compactHeaderOnPhone
        {...header}
        bodyClassName="p-0 sm:p-0 lg:overflow-hidden"
        footer={<PickerFooter picker={picker} onCancel={() => { picker.reset(); onClose() }} onSave={() => { if (picker.save()) onClose() }} />}
      >
        <div className="lg:grid lg:h-full lg:grid-cols-[minmax(0,27rem)_minmax(0,1fr)]">
          <div className="sticky top-0 z-30 border-b bg-background/95 backdrop-blur lg:static lg:order-2 lg:h-full lg:min-h-0 lg:border-b-0 lg:bg-transparent lg:backdrop-blur-none">
            <PickerWeek picker={picker} snap={snap} fill={wide} isTouch={!wide} stackHeight={tablet ? 300 : 156} />
          </div>
          <div className="px-5 py-4 sm:px-6 lg:order-1 lg:h-full lg:min-h-0 lg:overflow-y-auto lg:overscroll-contain lg:border-r">
            <CourseBody course={course} snap={snap} dirtyRef={dirtyRef} picker={picker} />
          </div>
        </div>
      </AppDialog>
    )
  }

  return (
    <AppDialog open={open} onOpenChange={(o) => !o && attemptClose()} size="lg" {...header}>
      <CourseBody course={course} snap={snap} dirtyRef={dirtyRef} picker={null} onCompare={offered && !done ? () => setCompare(true) : undefined} />
    </AppDialog>
  )
}

function HeaderTags({ course, snap }: { course: CatalogCourse; snap: PlannerSnapshot }) {
  const sched = scheduleFor(SCHEDULE_TERM_ID)
  return (
    <div className="flex flex-wrap gap-1 pt-1">
      <CategoryTag category={categoryOf(course, snap.audit.roles[course.id])} />
      {SEASONS.map((s) => {
        const info = offeringInfo(course, s)
        return (
          <Tag key={s} title={info.text} tone="neutral" className={cn(info.level === 'none' && 'line-through opacity-60')}>
            {SEASON_META[s].label}
          </Tag>
        )
      })}
      {sched && isOfferedIn(course, SCHEDULE_TERM_ID) && <Tag tone="strong">Offered {sched.label}</Tag>}
      {sched && !isOfferedIn(course, SCHEDULE_TERM_ID) && <Tag>Not offered {sched.label}</Tag>}
    </div>
  )
}

function CourseBody({ course, snap, dirtyRef, picker, onCompare }: {
  course: CatalogCourse
  snap: PlannerSnapshot
  dirtyRef: React.MutableRefObject<boolean>
  /** The section picker, when the dialog is showing it. */
  picker: SectionPicker | null
  /** Opens the picker for a course planned in another term. */
  onCompare?: () => void
}) {
  const { semesters, plan } = snap
  const done = isCourseDone(course.id)
  const inSem = done ? null : scheduledIn(semesters, plan.schedule, course.id)
  const sem = semesters.find((s) => s.id === inSem) ?? null
  const entry = inSem ? plan.schedule[inSem].find((e) => e.courseId === course.id) ?? null : null
  const passed = done ? lastPassingAttempt(course.id) : null
  const unmet = sem ? unmetPrereqs(semesters, plan.schedule, course.id, sem.id) : []
  const offer = sem ? offeringInfo(course, sem.season) : null
  const sub = SUBSTITUTIONS.find((s) => codeToId(s.course) === course.id)
  const subLine = sub && snap.audit.lineById[sub.line]
  const schedTerm = scheduleFor(SCHEDULE_TERM_ID)
  const termHasSchedule = !!(inSem && scheduleFor(inSem))
  const notes = [course.note, course.section === 'rpe' ? RPE_NOTE : '', course.section === 'fos' ? FOS_NOTE : ''].filter(Boolean)

  const moveTo = (value: string) => {
    if (value === 'none') {
      if (inSem) removeCourse(course.id, inSem)
      return
    }
    addCourse(course.id, value)
  }

  return (
    <div>
      <DialogSection title="In your plan">
        {done ? (
          <div className="flex items-center gap-2 text-sm">
            <LuCheck className="size-4" aria-hidden />
            Completed{passed ? <> with <b className="mono">{passed.rec.grade || '—'}</b> in {passed.term.label}</> : null}
          </div>
        ) : (
          <div className="flex flex-wrap items-center gap-2">
            <Select value={inSem ?? 'none'} onValueChange={moveTo}>
              <SelectTrigger className="w-52" aria-label="Term">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none">Not planned</SelectItem>
                {semesters.map((s) => {
                  const here = s.id === inSem
                  const over = !here && semesterCredits(plan.schedule, s.id) + course.credits > s.maxCredits
                  return (
                    <SelectItem key={s.id} value={s.id} disabled={over}>
                      {s.label}
                      {over && <span className="ml-1 text-xs text-muted-foreground">· would be over 18 cr</span>}
                      {!over && !here && offeringInfo(course, s.season).level === 'none' && <span className="ml-1 text-xs text-muted-foreground">· not usually offered</span>}
                    </SelectItem>
                  )
                })}
              </SelectContent>
            </Select>
            {inSem && (
              <Button variant="ghost" size="sm" className="text-muted-foreground hover:text-destructive" onClick={() => removeCourse(course.id, inSem)}>
                <LuTrash2 className="size-3.5" aria-hidden />
                Remove
              </Button>
            )}
          </div>
        )}
        <div className="space-y-1.5">
          {unmet.length > 0 && (
            <Warn tone="bad">Take first: {unmet.map(conditionLabel).join(' and ')} — it has to be in an earlier term.</Warn>
          )}
          {offer?.level === 'none' && <Warn>{offer.text}. Check PAWS before counting on it.</Warn>}
          {sub && subLine && (subLine.substitutions.length ? (
            <Warn tone="ok">Advisor substitution recorded: {sub.label}.</Warn>
          ) : (
            <Warn tone="pending">
              {sub.label} needs an advisor exception in Degree Works: “{sub.applyNote}” on {LINE_BY_ID[sub.line].label}, and “{sub.completeNote}” on {sub.complete.map((id) => LINE_BY_ID[id].label).join(', ')}. Ask for it before registering.
            </Warn>
          ))}
        </div>
      </DialogSection>

      {picker && (
        <DialogSection title={`${picker.term.label} sections`}>
          <PickerSections picker={picker} snap={snap} />
        </DialogSection>
      )}
      {!picker && onCompare && schedTerm && (
        <DialogSection title={`${schedTerm.label} sections`}>
          <p className="text-xs text-muted-foreground">
            {sem ? `Planned for ${sem.label}. ` : ''}GSU has {sectionCount(course, SCHEDULE_TERM_ID)} section{sectionCount(course, SCHEDULE_TERM_ID) === 1 ? '' : 's'} of it in {schedTerm.label}.
          </p>
          <Button variant="outline" size="sm" onClick={onCompare}>
            <LuCalendarRange className="size-3.5" aria-hidden />
            See them on your {schedTerm.label} week
          </Button>
        </DialogSection>
      )}

      <Attempts course={course} snap={snap} />

      <DialogSection title="About">
        <p className="text-sm leading-relaxed text-muted-foreground">{cleanDescription(course.description)}</p>
        <div className="space-y-1.5 pt-1">
          <div className="text-xs font-medium">Prerequisites</div>
          <div className="flex flex-wrap items-center gap-1.5">
            {course.prereq.length ? course.prereq.map((cond, i) => <PrereqCond key={i} cond={cond} snap={snap} />) : <Chip tone="done">No course prerequisites</Chip>}
          </div>
          <p className="text-xs text-muted-foreground">Catalog: {course.prereqText}</p>
        </div>
        {notes.length > 0 && <p className="rounded-md bg-muted px-3 py-2 text-xs leading-relaxed text-muted-foreground">{notes.join(' ')}</p>}
      </DialogSection>

      <DialogSection title="When GSU offered it">
        <OfferingGrid course={course} />
      </DialogSection>

      {inSem && !termHasSchedule && (
        <DialogSection title={`Meeting times · ${sem?.label}`}>
          <BlockEditor key={inSem} courseId={course.id} termId={inSem} blocks={entry?.blocks ?? []} dirtyRef={dirtyRef} />
        </DialogSection>
      )}
    </div>
  )
}

function Warn({ children, tone = 'neutral' }: { children: React.ReactNode; tone?: 'neutral' | 'bad' | 'pending' | 'ok' }) {
  return (
    <div
      className={cn(
        'flex items-start gap-2 rounded-md px-3 py-2 text-xs leading-relaxed',
        tone === 'neutral' && 'bg-muted text-muted-foreground',
        tone === 'bad' && 'bg-destructive/8 text-destructive',
        tone === 'pending' && 'bg-pending-muted text-pending',
        tone === 'ok' && 'bg-muted text-foreground',
      )}
    >
      {tone === 'pending' ? <LuHourglass className="mt-0.5 size-3.5 shrink-0" aria-hidden /> : tone === 'ok' ? <LuCheck className="mt-0.5 size-3.5 shrink-0" aria-hidden /> : <LuTriangleAlert className="mt-0.5 size-3.5 shrink-0" aria-hidden />}
      <span>{children}</span>
    </div>
  )
}

/* ─── Earlier attempts and Repeat to Replace ────────────────────────────── */

function Attempts({ course, snap }: { course: CatalogCourse; snap: PlannerSnapshot }) {
  const ui = useUi()
  const list = attemptsFor(course.id)
  const retakes = snap.gpa.candidates.filter((c) => c.courseId === course.id)
  if (!list.length && !retakes.length) return null
  return (
    <DialogSection title="On the record">
      <ul className="divide-y rounded-lg border">
        {list.map(({ rec, term }) => (
          <li key={rec.id}>
            <button type="button" onClick={() => ui.openRecord({ recordId: rec.id })} className="flex w-full items-center gap-3 px-3 py-2 text-left text-sm hover:bg-accent/50">
              <span className="min-w-0 flex-1">
                <span className="block truncate font-medium">{rec.title || rec.code}</span>
                <span className="block text-xs text-muted-foreground">
                  <span className="mono">{rec.code}</span> · {term.label} · {RECORD_STATUS[rec.status].short}{rec.transfer ? ' · transfer' : ''}{rec.r2r ? ' · replaced' : ''}
                </span>
              </span>
              <GradePill grade={rec.grade} />
            </button>
          </li>
        ))}
      </ul>
      {retakes.map((c) => (
        <div key={c.codeId} className="flex items-start gap-3 rounded-lg border px-3 py-2.5">
          <Switch id={`r2r-${c.codeId}`} checked={c.on} onCheckedChange={(v) => setRepeatToReplace(c.codeId, v)} aria-label={`Repeat to Replace for ${c.code}`} />
          <Label htmlFor={`r2r-${c.codeId}`} className="block flex-1 space-y-0.5 text-xs leading-relaxed font-normal">
            <span className="flex items-center gap-1.5 text-sm font-medium"><LuRepeat className="size-3.5" aria-hidden /> Repeat to Replace</span>
            <span className="block text-muted-foreground">
              For the GPA estimate: leave out the {c.first.rec.grade} from {c.first.term.label} after the {c.term.label} retake{c.code !== course.code ? ` (${c.code})` : ''}.
            </span>
            <span className="block">{R2R_STATUS_TEXT[c.status]}{c.note ? ` — ${c.note}` : ''}</span>
          </Label>
        </div>
      ))}
      {retakes.length > 0 && (
        <Button variant="outline" size="sm" onClick={() => ui.openGpa(retakes[0].term.id)}>
          See the GPA effect
        </Button>
      )}
    </DialogSection>
  )
}

/* ─── Prerequisites ──────────────────────────────────────────────────────── */

function Chip({ children, tone }: { children: React.ReactNode; tone: 'done' | 'placed' | 'missing' | 'alt' }) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-md border px-2 py-0.5 text-xs',
        tone === 'done' && 'border-foreground/20 bg-background',
        tone === 'placed' && 'border-dashed text-muted-foreground',
        tone === 'missing' && 'border-destructive/40 bg-destructive/5 text-destructive',
        tone === 'alt' && 'text-muted-foreground',
      )}
    >
      {children}
    </span>
  )
}

function PrereqChip({ id, snap }: { id: string; snap: PlannerSnapshot }) {
  const code = courseCode(id)
  if (isCourseDone(id)) {
    const a = lastPassingAttempt(id)
    return <Chip tone="done"><LuCheck className="size-3" aria-hidden /><span className="mono">{code}</span>{a ? <span className="text-muted-foreground">· {a.rec.grade || 'done'} {a.term.shortLabel}</span> : null}</Chip>
  }
  const sid = scheduledIn(snap.semesters, snap.plan.schedule, id)
  if (sid) return <Chip tone="placed"><span className="mono">{code}</span>· {snap.semesters.find((s) => s.id === sid)?.shortLabel}</Chip>
  const failed = failedAttempts(id)
  if (failed.length) return <Chip tone="missing"><span className="mono">{code}</span>· {failed[failed.length - 1].rec.grade || 'not passed'}, retake</Chip>
  if (!findCourse(id)) return <Chip tone="alt"><span className="mono">{code}</span></Chip>
  return <Chip tone="missing"><span className="mono">{code}</span>· not planned</Chip>
}

function PrereqCond({ cond, snap }: { cond: PrereqCondition; snap: PlannerSnapshot }) {
  if (!Array.isArray(cond)) return <PrereqChip id={cond} snap={snap} />
  return (
    <span className="inline-flex flex-wrap items-center gap-1 rounded-lg border border-dashed px-1 py-0.5">
      {cond.map((id, i) => (
        <span key={id} className="inline-flex items-center gap-1">
          {i > 0 && <span className="text-[10px] text-muted-foreground">or</span>}
          <PrereqChip id={id} snap={snap} />
        </span>
      ))}
    </span>
  )
}

/* ─── Offering history ───────────────────────────────────────────────────── */

function OfferingGrid({ course }: { course: CatalogCourse }) {
  return (
    <div className="space-y-1.5">
      {SEASONS.map((season) => (
        <div key={season} className="flex flex-wrap items-center gap-1.5">
          <span className="w-14 text-xs text-muted-foreground">{SEASON_META[season].label}</span>
          {OFFERING_TERMS.map((t, i) => t.season !== season ? null : (
            <span
              key={i}
              title={`${SEASON_META[season].label} ${t.year}: ${course.offered[i]} section(s)`}
              className={cn('mono rounded-md border px-1.5 py-0.5 text-[11px]', course.offered[i] ? 'border-foreground/20 bg-foreground text-background' : 'border-dashed text-muted-foreground/60')}
            >
              {t.year}
            </span>
          ))}
          <span className="text-[11px] text-muted-foreground">{offeringInfo(course, season).text}</span>
        </div>
      ))}
      <p className="text-[11px] text-muted-foreground">From GSU class schedules, Spring 2024 – Fall 2026 — past offerings, not a promise.</p>
    </div>
  )
}

/* ─── Hand-entered meeting times (terms without a released schedule) ─────── */

function BlockEditor({ courseId, termId, blocks, dirtyRef }: { courseId: string; termId: TermId; blocks: MeetingBlock[]; dirtyRef: React.MutableRefObject<boolean> }) {
  const [draft, setDraft] = useState<MeetingBlock[]>(blocks)
  const [dirty, setDirty] = useState(false)
  useEffect(() => { dirtyRef.current = dirty }, [dirty, dirtyRef])
  const edit = (i: number, patch: Partial<MeetingBlock>) => {
    setDraft((d) => d.map((b, j) => (j === i ? { ...b, ...patch } : b)))
    setDirty(true)
  }
  return (
    <div className="space-y-2">
      <p className="text-xs text-muted-foreground">GSU hasn’t released this term’s class schedule yet. Enter times you know and they show on the calendar.</p>
      {draft.map((b, i) => (
        <div key={b.id} className="space-y-2 rounded-lg border p-3">
          <div className="flex items-center gap-2">
            <Select value={b.type} onValueChange={(v) => edit(i, { type: v })}>
              <SelectTrigger size="sm" className="w-36" aria-label="Meeting type"><SelectValue /></SelectTrigger>
              <SelectContent>
                {BLOCK_TYPES.map((t) => <SelectItem key={t} value={t}>{t}</SelectItem>)}
              </SelectContent>
            </Select>
            <div className="flex-1" />
            <Button variant="ghost" size="icon" className="size-8 text-muted-foreground" onClick={() => { setDraft((d) => d.filter((_, j) => j !== i)); setDirty(true) }} aria-label="Remove this meeting">
              <LuTrash2 className="size-4" aria-hidden />
            </Button>
          </div>
          <div className="flex gap-1" role="group" aria-label="Days">
            {DAY_ORDER.map((d) => {
              const on = b.days.includes(d)
              return (
                <button
                  key={d}
                  type="button"
                  aria-pressed={on}
                  onClick={() => edit(i, { days: on ? b.days.filter((x) => x !== d) : DAY_ORDER.filter((x) => x === d || b.days.includes(x)) })}
                  className={cn('h-8 flex-1 rounded-md border text-xs', on ? 'border-primary bg-primary text-primary-foreground' : 'hover:bg-accent')}
                >
                  {DAY_LABELS[d]}
                </button>
              )
            })}
          </div>
          <div className="grid grid-cols-2 gap-2">
            <label className="space-y-1 text-xs text-muted-foreground">Start<Input type="time" value={b.startTime} onChange={(e) => edit(i, { startTime: e.target.value })} className="h-9" /></label>
            <label className="space-y-1 text-xs text-muted-foreground">End<Input type="time" value={b.endTime} onChange={(e) => edit(i, { endTime: e.target.value })} className="h-9" /></label>
          </div>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
            <Input placeholder="Room" value={b.location} onChange={(e) => edit(i, { location: e.target.value })} className="h-9" aria-label="Location" />
            <Input placeholder="Instructor" value={b.instructor} onChange={(e) => edit(i, { instructor: e.target.value })} className="h-9" aria-label="Instructor" />
            <Input placeholder="CRN" value={b.crn} onChange={(e) => edit(i, { crn: e.target.value })} className="h-9" inputMode="numeric" aria-label="CRN" />
          </div>
        </div>
      ))}
      <div className="flex flex-wrap gap-2">
        <Button variant="outline" size="sm" onClick={() => { setDraft((d) => [...d, { id: genId(), type: 'Lecture', days: [], startTime: '09:00', endTime: '10:15', location: '', instructor: '', crn: '' }]); setDirty(true) }}>
          <LuPlus className="size-3.5" aria-hidden />
          Add a meeting time
        </Button>
        {dirty && (
          <Button
            size="sm"
            onClick={() => {
              const bad = draft.find((b) => b.days.length && b.startTime && b.endTime && b.endTime <= b.startTime)
              if (bad) { toast.warning(`A meeting ends before it starts (${fmtTimeRange(bad.startTime, bad.endTime)}).`); return }
              updateBlocks(courseId, termId, draft)
              setDirty(false)
              toast.success('Meeting times saved')
            }}
          >
            Save meeting times
          </Button>
        )}
      </div>
    </div>
  )
}
