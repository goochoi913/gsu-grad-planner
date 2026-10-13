import { useMemo } from 'react'
import { useDraggable, useDroppable } from '@dnd-kit/core'
import { LuInfo, LuLock, LuPlus, LuRepeat, LuSearch } from 'react-icons/lu'
import { COURSES, FOS_NOTE, RPE_NOTE } from '@/data/degree'
import type { CatalogCourse, TermId } from '@/lib/types'
import { RECORD_STATUS, SEASONS, SEASON_META, conditionLabel, fmtCredits, offeringInfo, round2 } from '@/lib/planner'
import { blockMeter, cleanDescription, coveredBy, failedAttempts, scheduledIn, semesterCredits, unmetPrereqsGlobal } from '@/lib/plan-ops'
import { SCHEDULE_TERM_ID, scheduleFor, sectionCount, useScheduleVersion } from '@/lib/schedule'
import { NEED_TEXT, courseNeed, type CourseNeed } from '@/lib/relevance'
import { addCourse, type PlannerSnapshot } from '@/lib/store'
import { justDragged, useCourseDnd } from '@/components/course-dnd'
import { CategoryDot, Hint } from '@/components/bits'
import { CATEGORY, categoryOfSection, type Category } from '@/lib/colors'
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
  /** needed: options for requirements still open · all: every option. Courses in the plan or passed are never listed. */
  scope: 'needed' | 'all'
}
export const EMPTY_FILTER: LibraryFilter = { q: '', group: 'all', toggles: [], scope: 'needed' }

interface Group {
  key: LibraryFilter['group']
  category: Category
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
  const dnd = useCourseDnd()
  const ui = useUi()
  // Drop a planned course here to take it out of the plan.
  const { setNodeRef } = useDroppable({ id: 'library', data: { kind: 'library' } })
  const dropOver = dnd.over === 'library'
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
        key: 'major', category: 'major', title: 'Major — required', badge: `${meter('major')} · ${majorLines.filter((l) => l.status !== 'missing').length}/${majorLines.length}`,
        subgroups: [
          { courses: majors.filter((c) => c.tag === 'req') },
          { title: 'Pick one: Operating Systems or Programming Language Concepts', courses: majors.filter((c) => c.tag === 'osplc') },
          { title: 'Capstone', note: 'CSC 4350 in one term (with an advisor exception), or CSC 4351 (Fall) then CSC 4352 (Spring).', courses: majors.filter((c) => c.tag === 'capstone').sort((a, b) => Number(b.id === 'CSC4350') - Number(a.id === 'CSC4350')) },
        ],
      },
      {
        key: 'elective', category: 'elective', title: 'Major — CSC electives', badge: `${fmtCredits(elec.done + elec.planned + elec.pendingCredits)}/16 cr`,
        note: 'Choose 16 credits (usually 4 courses) of CSC 3000/4000. A second OS/PLC course also counts here.',
        subgroups: [
          { courses: COURSES.filter((c) => c.section === 'elective' && c.tag !== 'rare').sort(byCode) },
          { title: 'Rarely offered — not Spring 2024 – Fall 2026, but on a new schedule', note: 'New or dormant courses — check PAWS before counting on them.', courses: COURSES.filter((c) => c.tag === 'rare').sort(byCode) },
        ],
      },
      {
        key: 'core', category: 'core', title: 'IMPACTS Core & Field of Study', badge: `${meter('core')} · ${meter('fos')}`,
        subgroups: [
          { title: 'IMPACTS Core · Lab Science Sequence', note: audit.lineById['core.labseq'].note, courses: COURSES.filter((c) => c.tag === 'labseq') },
          { title: `Field of Study · pick from this list${fosLeft ? ` (${fmtCredits(fosLeft)} cr to 18)` : ''}`, note: FOS_NOTE, courses: COURSES.filter((c) => c.tag === 'fos') },
        ],
      },
      {
        key: 'rpe', category: 'rpe', title: 'Required Program Electives – CSC', badge: `${meter('rpe')} cr`,
        subgroups: [
          { title: rpeLeft ? `${fmtCredits(rpeLeft)} more credits · any subject, 2000–4000 level` : 'Covered', note: RPE_NOTE, courses: COURSES.filter((c) => c.section === 'rpe') },
        ],
      },
    ]
  }, [audit])

  // What she still needs, worked out from the record and the plan (src/lib/relevance.ts).
  const version = useScheduleVersion()
  const needs = useMemo(() => new Map(COURSES.map((c) => [c.id, courseNeed(c, snap)])), [snap, version]) // eslint-disable-line react-hooks/exhaustive-deps

  const words = filter.q.trim().toLowerCase().split(/\s+/).filter(Boolean)
  const matches = (c: CatalogCourse) => {
    if (!words.length) return true
    const hay = `${c.title} ${c.code} ${c.parts.map((p) => p.code).join(' ')} ${c.description}`.toLowerCase().replace(/\s+/g, ' ')
    const compact = hay.replace(/ /g, '')
    return words.every((w) => hay.includes(w) || compact.includes(w))
  }
  const filterBy = (scope: LibraryFilter['scope']) => {
    const springOnly = filter.toggles.includes('spring')
    const keep = (c: CatalogCourse) => {
      const need = needs.get(c.id)!
      // Only what's left to place: a course in the plan (or already passed) is on the board, not here.
      if (need.why === 'unavailable' || need.why === 'planned' || need.why === 'done') return false
      if (scope === 'needed' && !need.needed) return false
      if (springOnly && !sectionCount(c, SCHEDULE_TERM_ID)) return false
      return matches(c)
    }
    return groups
      .filter((g) => filter.group === 'all' || g.key === filter.group)
      .map((g) => ({ ...g, subgroups: g.subgroups.map((s) => ({ ...s, courses: s.courses.filter(keep) })).filter((s) => s.courses.length) }))
      .filter((g) => g.subgroups.length)
  }
  const visible = filterBy(filter.scope)
  const countOf = (gs: Group[]) => gs.reduce((n, g) => n + g.subgroups.reduce((m, s) => m + s.courses.length, 0), 0)
  const allCount = countOf(filterBy('all'))

  const count = countOf(visible)
  const more = filter.scope === 'needed' ? allCount - count : 0
  const unfiltered = !words.length && filter.group === 'all' && !filter.toggles.length
  // A search for a course that's already in the plan says where it is.
  const placed = words.length
    ? COURSES.filter((c) => needs.get(c.id)!.why === 'planned' && matches(c)).map((c) => ({ course: c, sem: snap.semesters.find((s) => s.id === scheduledIn(snap.semesters, snap.plan.schedule, c.id))! }))
    : []

  return (
    <div ref={setNodeRef} className={cn('relative flex h-full min-h-0 flex-col bg-sidebar', dropOver && 'ring-2 ring-primary/40 ring-inset')}>
      {dropOver && (
        <div className="pointer-events-none absolute inset-x-3 top-3 z-20 rounded-lg border border-dashed border-primary bg-background/95 px-3 py-2 text-center text-xs font-medium shadow-sm">
          Drop to take it out of the plan
        </div>
      )}
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
              <CategoryDot category={g.category} />
              <span className={cn('text-[11px] font-semibold tracking-wider uppercase', CATEGORY[g.category].text)}>{g.title}</span>
              {g.note && (
                <Hint label={g.note}>
                  <LuInfo className="size-3 text-muted-foreground" aria-label={g.note} />
                </Hint>
              )}
              <span className="mono ml-auto text-[10.5px] text-muted-foreground">{g.badge}</span>
            </div>
            {g.subgroups.map((s, i) => (
              <div key={i} className="px-2.5 pt-2 pb-1 last:pb-2.5">
                {s.title && (
                  <div className="flex items-center gap-1.5 px-1 pb-1.5 text-[11px] text-muted-foreground">
                    <span className="min-w-0 flex-1 truncate">{s.title}</span>
                    {s.note && (
                      <Hint label={s.note}>
                        <LuInfo className="size-3 shrink-0" aria-label={s.note} />
                      </Hint>
                    )}
                  </div>
                )}
                <div className="space-y-1.5">
                  {s.courses.map((c) => (
                    <LibraryRow key={c.id} course={c} need={needs.get(c.id)!} snap={snap} targetTerm={targetTerm} springLabel={springLabel} onAfterAdd={onAfterAdd} />
                  ))}
                </div>
              </div>
            ))}
          </section>
        ))}
        {!count && (
          <div className="space-y-2 p-6 text-center">
            <p className="text-sm text-muted-foreground">
              {filter.scope === 'needed' && unfiltered ? 'Everything she needs is in the plan.' : more ? 'Nothing she still needs matches.' : 'Nothing matches.'}
            </p>
            {more > 0 ? (
              <Button variant="outline" size="sm" onClick={() => setFilter({ ...filter, scope: 'all' })}>
                Show {more} other option{more === 1 ? '' : 's'}
              </Button>
            ) : (
              !unfiltered && (
                <Button variant="outline" size="sm" onClick={() => setFilter(EMPTY_FILTER)}>
                  Clear filters
                </Button>
              )
            )}
          </div>
        )}
        {placed.length > 0 && (
          <div className="space-y-1 border-t px-3 py-2.5 text-[11px] text-muted-foreground" data-placed>
            <div>Already in the plan</div>
            {placed.map(({ course, sem }) => (
              <button
                key={course.id}
                type="button"
                className="flex w-full items-center gap-2 rounded-sm text-left hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none"
                onClick={() => ui.openCourse(course.id, sem.id)}
              >
                <span className="min-w-0 flex-1 truncate text-[12px] font-medium text-foreground/80">{course.title}</span>
                <span className="mono shrink-0">{sem.shortLabel}</span>
              </button>
            ))}
          </div>
        )}
      </ScrollArea>
      <div className="flex items-center gap-2 border-t px-3 py-1.5 text-[11px] text-muted-foreground">
        <span className="min-w-0 flex-1 truncate">
          <span className="mono">{count}</span> {filter.scope === 'needed' ? `course${count === 1 ? '' : 's'} you still need` : `course${count === 1 ? '' : 's'}`}
        </span>
        {filter.scope === 'needed' ? (
          more > 0 && (
            <button type="button" className="shrink-0 font-medium text-foreground underline-offset-2 hover:underline" onClick={() => setFilter({ ...filter, scope: 'all' })}>
              Show all options
            </button>
          )
        ) : (
          <button type="button" className="shrink-0 font-medium text-foreground underline-offset-2 hover:underline" onClick={() => setFilter({ ...filter, scope: 'needed' })}>
            Only what you need
          </button>
        )}
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
  need,
  snap,
  targetTerm,
  springLabel,
  onAfterAdd,
}: {
  course: CatalogCourse
  need: CourseNeed
  snap: PlannerSnapshot
  targetTerm: TermId | null
  springLabel: string
  onAfterAdd?: () => void
}) {
  const ui = useUi()
  // (Only courses not yet in the plan or passed are listed.)
  // Drag into a term (on a computer); on a phone the list is a sheet over the plan, so the + button adds.
  const canDrag = !ui.isMobile
  const { setNodeRef, attributes, listeners, isDragging } = useDraggable({ id: `lib:${course.id}`, data: { kind: 'lib', courseId: course.id }, disabled: !canDrag })
  const unmet = unmetPrereqsGlobal(snap.semesters, snap.plan.schedule, course.id)
  const covered = need.why === 'covered' ? coveredBy(course, snap.audit) || NEED_TEXT.covered : ''
  const retake = failedAttempts(course.id)
  const sections = sectionCount(course, SCHEDULE_TERM_ID)
  const target = snap.semesters.find((s) => s.id === targetTerm) ?? null

  return (
    <HoverCard openDelay={450} closeDelay={60}>
      <HoverCardTrigger asChild>
        <div
          ref={setNodeRef}
          // (When it can't be dragged the row is still a button: no aria-disabled from the drag library.)
          {...(canDrag ? attributes : {})}
          {...(canDrag ? listeners : {})}
          role="button"
          tabIndex={0}
          onClick={() => { if (!justDragged()) ui.openCourse(course.id) }}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault()
              ui.openCourse(course.id)
            }
          }}
          data-course={course.id}
          data-need={need.why}
          className={cn(
            // A card like the ones in the terms: inset from the panel's edges, the category colour on its left.
            'group flex items-start gap-2 rounded-lg border border-l-[3px] bg-card px-2.5 py-2 shadow-xs transition-colors hover:bg-accent focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none',
            CATEGORY[categoryOfSection(course)].edge,
            canDrag && 'cursor-grab',
            need.why === 'covered' && 'opacity-60',
            isDragging && 'opacity-40',
          )}
        >
          <div className="min-w-0 flex-1 space-y-0.5">
            <div className="truncate text-[13px] leading-snug font-semibold">{course.title}</div>
            <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] text-muted-foreground">
              <span className="mono">{course.code}</span>
              <span className="mono">{course.credits} cr</span>
              <SeasonLetters course={course} />
              {covered && (
                <Hint label={covered}>
                  <span>not needed</span>
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
              {springLabel && sections > 0 && (
                <span className="mono">
                  {sections} sec · {springLabel}
                </span>
              )}
            </div>
          </div>
          {target && (
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
          )}
        </div>
      </HoverCardTrigger>
      {!ui.isMobile && (
        <HoverCardContent side="right" align="start" className="w-80">
          <div className="text-sm leading-snug font-semibold">{course.title}</div>
          <div className="mono mb-2 text-xs text-muted-foreground">{course.code} · {course.credits} credits</div>
          <p className="line-clamp-5 text-xs leading-relaxed text-muted-foreground">{cleanDescription(course.description)}</p>
          <p className="mt-2 text-xs text-muted-foreground">Prerequisites: {course.prereqText}</p>
        </HoverCardContent>
      )}
    </HoverCard>
  )
}
