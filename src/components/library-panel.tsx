import { useMemo, useState } from 'react'
import { LuCheck, LuInfo, LuLock, LuPlus, LuRepeat, LuSearch } from 'react-icons/lu'
import { COURSES, FOS_NOTE, RPE_NOTE } from '@/data/degree'
import type { CatalogCourse, TermId } from '@/lib/types'
import { RECORD_STATUS, SEASONS, SEASON_META, conditionLabel, fmtCredits, isCourseDone, offeringInfo, round2 } from '@/lib/planner'
import { blockMeter, cleanDescription, coveredBy, failedAttempts, lastPassingAttempt, scheduledIn, semesterCredits, unmetPrereqsGlobal } from '@/lib/plan-ops'
import { SCHEDULE_TERM_ID, scheduleFor, sectionCount } from '@/lib/schedule'
import { addCourse, removeCourse, type PlannerSnapshot } from '@/lib/store'
import { readDrag } from '@/components/board'
import { Hint } from '@/components/bits'
import { Button } from '@/components/ui/button'
import { HoverCard, HoverCardContent, HoverCardTrigger } from '@/components/ui/hover-card'
import { Input } from '@/components/ui/input'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import { useUi } from '@/components/ui-context'
import { cn } from '@/lib/utils'

export interface LibraryFilter {
  q: string
  group: 'all' | 'major' | 'elective' | 'core' | 'rpe'
  toggles: string[]
}
export const EMPTY_FILTER: LibraryFilter = { q: '', group: 'all', toggles: [] }

interface Group {
  key: LibraryFilter['group']
  title: string
  note?: string
  badge: string
  subgroups: { title?: string; note?: string; courses: CatalogCourse[] }[]
}

const byCode = (a: CatalogCourse, b: CatalogCourse) => a.code.localeCompare(b.code)

export function LibraryPanel({
  snap,
  filter,
  setFilter,
  targetTerm,
  setTargetTerm,
  onAfterAdd,
}: {
  snap: PlannerSnapshot
  filter: LibraryFilter
  setFilter: (f: LibraryFilter) => void
  targetTerm: TermId | null
  setTargetTerm: (t: TermId) => void
  onAfterAdd?: () => void
}) {
  const ui = useUi()
  const [dropOver, setDropOver] = useState(false)
  const scheduleTerm = scheduleFor(SCHEDULE_TERM_ID)
  const springLabel = scheduleTerm ? `${scheduleTerm.label.split(' ')[0].slice(0, 3)} ’${scheduleTerm.label.slice(-2)}` : ''
  const audit = snap.audit

  const groups: Group[] = useMemo(() => {
    const majors = COURSES.filter((c) => c.section === 'major')
    const fos = audit.blockByKey.fos
    const fosLeft = round2(Math.max(0, (fos.credits ?? 0) - fos.done - fos.planned - fos.pendingCredits))
    const rpe = audit.blockByKey.rpe
    const rpeLeft = round2(Math.max(0, (rpe.credits ?? 0) - rpe.done - rpe.planned - rpe.pendingCredits - rpe.waived))
    const meter = (key: string) => {
      const m = blockMeter(audit.blockByKey[key])
      return `${fmtCredits(m.done + m.planned + m.pending)}/${fmtCredits(m.required)}`
    }
    const majorLines = audit.lines.filter((l) => l.block === 'major' && l.id !== 'major.elec')
    const elec = audit.lineById['major.elec']
    return [
      {
        key: 'major', title: 'Major — required', badge: `${meter('major')} · ${majorLines.filter((l) => l.status !== 'missing').length}/${majorLines.length}`,
        subgroups: [
          { courses: majors.filter((c) => c.tag === 'req') },
          { title: 'Pick one: Operating Systems or Programming Language Concepts', courses: majors.filter((c) => c.tag === 'osplc') },
          { title: 'Capstone', note: 'CSC 4350 in one term (with an advisor exception), or CSC 4351 (Fall) then CSC 4352 (Spring).', courses: majors.filter((c) => c.tag === 'capstone').sort((a, b) => Number(b.id === 'CSC4350') - Number(a.id === 'CSC4350')) },
        ],
      },
      {
        key: 'elective', title: 'Major — CSC electives', badge: `${fmtCredits(elec.done + elec.planned + elec.pendingCredits)}/16 cr`,
        note: 'Choose 16 credits (usually 4 courses) of CSC 3000/4000. A second OS/PLC course also counts here.',
        subgroups: [
          { courses: COURSES.filter((c) => c.section === 'elective' && c.tag !== 'rare').sort(byCode) },
          { title: 'In the catalog, not offered Spring 2024 – Fall 2026', note: 'New or dormant courses — check PAWS before counting on them.', courses: COURSES.filter((c) => c.tag === 'rare').sort(byCode) },
        ],
      },
      {
        key: 'core', title: 'IMPACTS Core & Field of Study', badge: `${meter('core')} · ${meter('fos')}`,
        subgroups: [
          { title: 'IMPACTS Core · Lab Science Sequence', note: audit.lineById['core.labseq'].note, courses: COURSES.filter((c) => c.tag === 'labseq') },
          { title: `Field of Study · pick from this list${fosLeft ? ` (${fmtCredits(fosLeft)} cr to 18)` : ''}`, note: FOS_NOTE, courses: COURSES.filter((c) => c.tag === 'fos') },
        ],
      },
      {
        key: 'rpe', title: 'Required Program Electives – CSC', badge: `${meter('rpe')} cr`,
        subgroups: [
          { title: rpeLeft ? `${fmtCredits(rpeLeft)} more credits · any subject, 2000–4000 level` : 'Covered', note: RPE_NOTE, courses: COURSES.filter((c) => c.section === 'rpe') },
        ],
      },
    ]
  }, [audit])

  const visible = useMemo(() => {
    const words = filter.q.trim().toLowerCase().split(/\s+/).filter(Boolean)
    const springOnly = filter.toggles.includes('spring')
    const hideDone = filter.toggles.includes('notdone')
    const keep = (c: CatalogCourse) => {
      if (springOnly && !sectionCount(c, SCHEDULE_TERM_ID)) return false
      if (hideDone && isCourseDone(c.id)) return false
      if (!words.length) return true
      const hay = `${c.code} ${c.parts.map((p) => p.code).join(' ')} ${c.title} ${c.description}`.toLowerCase().replace(/\s+/g, ' ')
      const compact = hay.replace(/ /g, '')
      return words.every((w) => hay.includes(w) || compact.includes(w))
    }
    return groups
      .filter((g) => filter.group === 'all' || g.key === filter.group)
      .map((g) => ({ ...g, subgroups: g.subgroups.map((s) => ({ ...s, courses: s.courses.filter(keep) })).filter((s) => s.courses.length) }))
      .filter((g) => g.subgroups.length)
  }, [groups, filter])

  const count = visible.reduce((n, g) => n + g.subgroups.reduce((m, s) => m + s.courses.length, 0), 0)

  return (
    <div
      className={cn('flex h-full min-h-0 flex-col bg-sidebar', dropOver && 'ring-2 ring-primary/40 ring-inset')}
      onDragOver={(e) => {
        if (!ui.dragging) return
        e.preventDefault()
        setDropOver(true)
      }}
      onDragLeave={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node)) setDropOver(false)
      }}
      onDrop={(e) => {
        e.preventDefault()
        setDropOver(false)
        const d = readDrag(e)
        ui.setDragging(null)
        if (d?.from) removeCourse(d.courseId, d.from)
      }}
    >
      <div className="space-y-2 border-b p-3">
        <div className="relative">
          <LuSearch className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground" aria-hidden />
          <Input
            type="search"
            value={filter.q}
            onChange={(e) => setFilter({ ...filter, q: e.target.value })}
            placeholder="Search courses…"
            className="h-9 pl-8 text-sm"
            aria-label="Search courses"
          />
        </div>
        <div className="flex items-center gap-1.5">
          <Select value={filter.group} onValueChange={(v) => setFilter({ ...filter, group: v as LibraryFilter['group'] })}>
            <SelectTrigger size="sm" className="h-8 min-w-0 flex-1 text-xs" aria-label="Requirement area">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All areas</SelectItem>
              <SelectItem value="major">Major — required</SelectItem>
              <SelectItem value="elective">CSC electives</SelectItem>
              <SelectItem value="core">Core & Field of Study</SelectItem>
              <SelectItem value="rpe">Program electives</SelectItem>
            </SelectContent>
          </Select>
          <ToggleGroup
            type="multiple"
            size="sm"
            variant="outline"
            value={filter.toggles}
            onValueChange={(v) => setFilter({ ...filter, toggles: v })}
          >
            {scheduleTerm && (
              <ToggleGroupItem value="spring" className="h-8 px-2 text-xs" aria-label={`Offered in ${scheduleTerm.label}`}>
                {springLabel}
              </ToggleGroupItem>
            )}
            <ToggleGroupItem value="notdone" className="h-8 px-2 text-xs" aria-label="Hide completed courses">
              To do
            </ToggleGroupItem>
          </ToggleGroup>
        </div>
        {targetTerm && (
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <span>Add to</span>
            <Select value={targetTerm} onValueChange={setTargetTerm}>
              <SelectTrigger size="sm" className="h-7 w-auto gap-1 px-2 text-xs font-medium text-foreground" aria-label="Term to add courses to">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {snap.semesters.map((s) => (
                  <SelectItem key={s.id} value={s.id}>
                    {s.label} <span className="mono text-muted-foreground">· {fmtCredits(semesterCredits(snap.plan.schedule, s.id))}/{s.maxCredits} cr</span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}
      </div>

      <ScrollArea className="min-h-0 w-full flex-1 [&>[data-slot=scroll-area-viewport]>div]:!block">
        {visible.map((g) => (
          <section key={g.key} aria-label={g.title}>
            <div className="sticky top-0 z-10 flex items-center gap-2 border-b bg-sidebar/95 px-3 py-1.5 backdrop-blur">
              <span className="text-[11px] font-semibold tracking-wider text-muted-foreground uppercase">{g.title}</span>
              {g.note && (
                <Hint label={g.note}>
                  <LuInfo className="size-3 text-muted-foreground" aria-label={g.note} />
                </Hint>
              )}
              <span className="mono ml-auto text-[10.5px] text-muted-foreground">{g.badge}</span>
            </div>
            {g.subgroups.map((s, i) => (
              <div key={i}>
                {s.title && (
                  <div className="flex items-center gap-1.5 bg-muted/50 px-3 py-1 text-[11px] text-muted-foreground">
                    <span className="min-w-0 flex-1 truncate">{s.title}</span>
                    {s.note && (
                      <Hint label={s.note}>
                        <LuInfo className="size-3 shrink-0" aria-label={s.note} />
                      </Hint>
                    )}
                  </div>
                )}
                <div className="divide-y">
                  {s.courses.map((c) => (
                    <LibraryRow key={c.id} course={c} snap={snap} targetTerm={targetTerm} springLabel={springLabel} onAfterAdd={onAfterAdd} />
                  ))}
                </div>
              </div>
            ))}
          </section>
        ))}
        {!count && (
          <div className="space-y-2 p-6 text-center">
            <p className="text-sm text-muted-foreground">Nothing matches.</p>
            <Button variant="outline" size="sm" onClick={() => setFilter(EMPTY_FILTER)}>
              Clear filters
            </Button>
          </div>
        )}
      </ScrollArea>
      <div className="border-t px-3 py-1.5 text-[11px] text-muted-foreground">
        <span className="mono">{count}</span> of <span className="mono">{COURSES.length}</span> courses
      </div>
    </div>
  )
}

function SeasonLetters({ course }: { course: CatalogCourse }) {
  const tips = SEASONS.map((s) => offeringInfo(course, s).text).join(' · ')
  return (
    <Hint label={tips}>
      <span className="mono inline-flex gap-1 text-[10px]">
        {SEASONS.map((s) => {
          const level = offeringInfo(course, s).level
          return (
            <span
              key={s}
              className={cn(
                level === 'regular' && 'text-foreground/80',
                level === 'sometimes' && 'text-muted-foreground',
                level === 'none' && 'text-muted-foreground/35 line-through',
              )}
            >
              {SEASON_META[s].short}
            </span>
          )
        })}
      </span>
    </Hint>
  )
}

function LibraryRow({
  course,
  snap,
  targetTerm,
  springLabel,
  onAfterAdd,
}: {
  course: CatalogCourse
  snap: PlannerSnapshot
  targetTerm: TermId | null
  springLabel: string
  onAfterAdd?: () => void
}) {
  const ui = useUi()
  const done = isCourseDone(course.id)
  const inSem = done ? null : scheduledIn(snap.semesters, snap.plan.schedule, course.id)
  const sem = inSem ? snap.semesters.find((s) => s.id === inSem) : null
  const unmet = done ? [] : unmetPrereqsGlobal(snap.semesters, snap.plan.schedule, course.id)
  const covered = inSem || done ? '' : coveredBy(course, snap.audit)
  const retake = done ? [] : failedAttempts(course.id)
  const passed = done ? lastPassingAttempt(course.id) : null
  const sections = sectionCount(course, SCHEDULE_TERM_ID)
  const target = snap.semesters.find((s) => s.id === targetTerm) ?? null

  return (
    <HoverCard openDelay={450} closeDelay={60}>
      <HoverCardTrigger asChild>
        <div
          role="button"
          tabIndex={0}
          draggable={!done && !ui.isMobile}
          onDragStart={(e) => {
            e.dataTransfer.setData('text/plain', `${course.id}|${inSem ?? ''}`)
            e.dataTransfer.effectAllowed = 'move'
            ui.setDragging(course.id)
          }}
          onDragEnd={() => ui.setDragging(null)}
          onClick={() => ui.openCourse(course.id, inSem)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault()
              ui.openCourse(course.id, inSem)
            }
          }}
          data-course={course.id}
          className={cn(
            'group flex items-start gap-2 px-3 py-2 transition-colors hover:bg-accent/60 focus-visible:bg-accent focus-visible:outline-none',
            !done && !ui.isMobile && 'cursor-grab',
            inSem && 'border-l-2 border-l-primary',
            done && 'opacity-65',
          )}
        >
          <div className="min-w-0 flex-1 space-y-0.5">
            <div className="flex items-baseline gap-2">
              <span className="mono shrink-0 text-[12.5px] font-semibold">{course.code}</span>
              <span className="min-w-0 flex-1 truncate text-[12.5px] text-muted-foreground">{course.title}</span>
            </div>
            <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] text-muted-foreground">
              <span className="mono">{course.credits} cr</span>
              {!done && <SeasonLetters course={course} />}
              {done && (
                <span className="inline-flex items-center gap-1 text-foreground/80">
                  <LuCheck className="size-3" aria-hidden />
                  {passed?.rec.grade || 'Done'}
                  {passed && <span className="mono">· {passed.term.shortLabel}</span>}
                </span>
              )}
              {covered && (
                <Hint label={covered}>
                  <span>covered</span>
                </Hint>
              )}
              {retake.length > 0 && (
                <Hint label={`Earlier: ${retake.map((a) => `${a.rec.grade || RECORD_STATUS[a.rec.status].short} (${a.term.label})`).join(', ')}`}>
                  <span className="inline-flex items-center gap-0.5">
                    <LuRepeat className="size-3" aria-hidden /> retake
                  </span>
                </Hint>
              )}
              {unmet.length > 0 && (
                <Hint label={`Needs first: ${unmet.map(conditionLabel).join(', ')}`}>
                  <span className="inline-flex items-center gap-0.5">
                    <LuLock className="size-3" aria-hidden /> needs {unmet.map(conditionLabel)[0]}
                  </span>
                </Hint>
              )}
              {!done && springLabel && sections > 0 && (
                <span className="mono">
                  {sections} sec · {springLabel}
                </span>
              )}
            </div>
          </div>
          {sem ? (
            <span className="mono mt-0.5 shrink-0 rounded-md bg-secondary px-1.5 py-0.5 text-[10px] text-secondary-foreground">{sem.shortLabel}</span>
          ) : !done && target ? (
            <Hint label={`Add to ${target.label}`}>
              <Button
                size="icon"
                variant="ghost"
                className="-mr-1 size-8 shrink-0 text-muted-foreground hover:text-foreground"
                onClick={(e) => {
                  e.stopPropagation()
                  if (addCourse(course.id, target.id)) onAfterAdd?.()
                }}
                aria-label={`Add ${course.code} to ${target.label}`}
              >
                <LuPlus className="size-4" aria-hidden />
              </Button>
            </Hint>
          ) : null}
        </div>
      </HoverCardTrigger>
      {!ui.isMobile && (
        <HoverCardContent side="right" align="start" className="w-80">
          <div className="mono text-xs font-semibold">{course.code}</div>
          <div className="mb-2 text-sm leading-snug">{course.title}</div>
          <p className="line-clamp-5 text-xs leading-relaxed text-muted-foreground">{cleanDescription(course.description)}</p>
          <p className="mt-2 text-xs text-muted-foreground">Prerequisites: {course.prereqText}</p>
        </HoverCardContent>
      )}
    </HoverCard>
  )
}
