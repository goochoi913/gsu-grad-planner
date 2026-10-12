import { createContext, useContext, useMemo, useRef, useState, type ReactNode } from 'react'
import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  MouseSensor,
  TouchSensor,
  closestCenter,
  pointerWithin,
  useSensor,
  useSensors,
  type CollisionDetection,
  type DragEndEvent,
  type DragMoveEvent,
  type DragStartEvent,
  type Over,
  type Active,
} from '@dnd-kit/core'
import { sortableKeyboardCoordinates } from '@dnd-kit/sortable'
import { toast } from 'sonner'
import type { TermId } from '@/lib/types'
import { findCourse } from '@/lib/planner'
import { checkAdd, scheduledIn } from '@/lib/plan-ops'
import { getSnapshot, placeCourse, removeCourse } from '@/lib/store'
import { CATEGORY, categoryOf } from '@/lib/colors'
import { cn } from '@/lib/utils'

/*
 * Drag and drop for courses (dnd-kit): reorder within a term, move to another term, drag
 * from the course list into a term at a chosen spot, or back onto the course list to take
 * it out of the plan. Mouse: drag after moving a few pixels (a click still opens the course).
 * Touch: press and hold, then drag. Keyboard: Space picks a course up, arrows move it.
 *
 *   row:<term>:<course>   a course in a term (sortable)      term:<term>   a term (drop zone)
 *   lib:<course>          a course in the course list         past:<term>   a completed term (refuses)
 *   library               the course list (drop to remove)
 */

export type DragKind = 'row' | 'lib'
export interface DragItem {
  kind: DragKind
  courseId: string
  /** The term it is planned in, if any. */
  from: TermId | null
}
/** Where a course from another term (or the course list) would land. */
export interface DropTarget {
  termId: TermId
  index: number
  ok: boolean
  reason: string
}
interface DndState {
  active: DragItem | null
  target: DropTarget | null
  over: 'library' | 'past' | null
  overPast: TermId | null
}

const DndStateContext = createContext<DndState>({ active: null, target: null, over: null, overPast: null })
export const useCourseDnd = () => useContext(DndStateContext)

export const rowId = (termId: TermId, courseId: string) => `row:${termId}:${courseId}`

interface Data {
  kind: 'row' | 'lib' | 'term' | 'past' | 'library'
  courseId?: string
  termId?: TermId
}
const dataOf = (x: Active | Over | { data: { current?: unknown } } | null) => (x?.data.current ?? null) as Data | null

// A click right after a drag ends shouldn't open the course.
let draggedAt = 0
export const justDragged = () => Date.now() - draggedAt < 250

/** The term under the pointer, then the closest course inside it; the course list and past terms win outright. */
const detectCollisions: CollisionDetection = (args) => {
  if (!args.pointerCoordinates) return closestCenter(args)
  const under = pointerWithin(args)
  const kindOf = (id: string | number) => (args.droppableContainers.find((c) => c.id === id)?.data.current as Data | undefined)?.kind
  const special = under.find((c) => kindOf(c.id) === 'library' || kindOf(c.id) === 'past')
  if (special) return [special]
  const term = under.find((c) => kindOf(c.id) === 'term')
  if (!term) return []
  const termId = (args.droppableContainers.find((c) => c.id === term.id)!.data.current as Data).termId
  const rows = args.droppableContainers.filter((c) => {
    const d = c.data.current as Data | undefined
    return d?.kind === 'row' && d.termId === termId
  })
  return rows.length ? closestCenter({ ...args, droppableContainers: rows }) : [term]
}

/** Where a drop lands in a term: before or after the course it's over, or the end of an empty term. */
function insertion(active: Active, over: Over, termId: TermId): number {
  const entries = getSnapshot().plan.schedule[termId] || []
  const d = dataOf(over)
  if (d?.kind !== 'row') return entries.length
  const i = entries.findIndex((e) => e.courseId === d.courseId)
  const box = active.rect.current.translated
  const below = !!box && box.top + box.height / 2 > over.rect.top + over.rect.height / 2
  return i < 0 ? entries.length : i + (below ? 1 : 0)
}

function targetFor(item: DragItem, active: Active, over: Over | null): Pick<DndState, 'target' | 'over' | 'overPast'> {
  const d = dataOf(over)
  if (!over || !d) return { target: null, over: null, overPast: null }
  if (d.kind === 'library') return { target: null, over: item.from ? 'library' : null, overPast: null }
  if (d.kind === 'past') return { target: null, over: 'past', overPast: d.termId ?? null }
  const termId = d.termId!
  // Within the same term the list itself shows the new order.
  if (item.kind === 'row' && item.from === termId) return { target: null, over: null, overPast: null }
  const snap = getSnapshot()
  const check = item.from === termId ? { ok: true as const, warnings: [] } : checkAdd(snap.semesters, snap.plan.schedule, item.courseId, termId)
  return {
    target: { termId, index: insertion(active, over, termId), ok: check.ok, reason: check.ok ? '' : check.reason },
    over: null,
    overPast: null,
  }
}

export function CourseDndProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<DndState>({ active: null, target: null, over: null, overPast: null })
  const last = useRef('')
  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 6 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 220, tolerance: 8 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates, keyboardCodes: { start: ['Space'], cancel: ['Escape'], end: ['Space', 'Enter'] } }),
  )

  const reset = () => {
    last.current = ''
    setState({ active: null, target: null, over: null, overPast: null })
  }

  const onDragStart = ({ active }: DragStartEvent) => {
    const d = dataOf(active)
    if (!d?.courseId) return
    const snap = getSnapshot()
    const from = d.kind === 'row' ? d.termId ?? null : scheduledIn(snap.semesters, snap.plan.schedule, d.courseId)
    setState({ active: { kind: d.kind as DragKind, courseId: d.courseId, from }, target: null, over: null, overPast: null })
  }

  const onDragMove = ({ active, over }: DragMoveEvent) => {
    if (!state.active) return
    const next = targetFor(state.active, active, over)
    const key = JSON.stringify(next)
    if (key === last.current) return
    last.current = key
    setState((s) => ({ ...s, ...next }))
  }

  const onDragEnd = ({ active, over }: DragEndEvent) => {
    const item = state.active
    reset()
    draggedAt = Date.now()
    const d = dataOf(over)
    if (!item || !over || !d) return
    if (d.kind === 'library') {
      if (item.from) removeCourse(item.courseId, item.from)
      return
    }
    if (d.kind === 'past') {
      toast.warning('That term is finished. Use the Record to fix a grade or add a course.')
      return
    }
    const termId = d.termId!
    if (item.kind === 'row' && item.from === termId) {
      // Reordered within the term: it takes the place of the course it was dropped on.
      if (d.kind !== 'row' || d.courseId === item.courseId) return
      const entries = getSnapshot().plan.schedule[termId] || []
      const to = entries.findIndex((e) => e.courseId === d.courseId)
      if (to >= 0) placeCourse(item.courseId, termId, to)
      return
    }
    let index = insertion(active, over, termId)
    // From the course list onto its own term: the course's current slot doesn't count.
    if (item.from === termId) {
      const cur = (getSnapshot().plan.schedule[termId] || []).findIndex((e) => e.courseId === item.courseId)
      if (cur >= 0 && index > cur) index--
    }
    placeCourse(item.courseId, termId, index)
  }

  const value = useMemo(() => state, [state])
  return (
    <DndStateContext.Provider value={value}>
      <DndContext sensors={sensors} collisionDetection={detectCollisions} onDragStart={onDragStart} onDragMove={onDragMove} onDragOver={onDragMove} onDragEnd={onDragEnd} onDragCancel={reset}>
        {children}
        <DragOverlay dropAnimation={null}>{state.active ? <DragPreview item={state.active} target={state.target} /> : null}</DragOverlay>
      </DndContext>
    </DndStateContext.Provider>
  )
}

/** The card that follows the pointer. */
function DragPreview({ item, target }: { item: DragItem; target: DropTarget | null }) {
  const course = findCourse(item.courseId)
  if (!course) return null
  const cat = categoryOf(course, getSnapshot().audit.roles[course.id])
  return (
    <div
      className={cn(
        'w-72 max-w-[80vw] cursor-grabbing rounded-lg border border-l-[3px] bg-card px-2.5 py-2 shadow-xl ring-1 ring-foreground/10',
        CATEGORY[cat].edge,
        target && !target.ok && 'ring-2 ring-destructive',
      )}
    >
      <div className="truncate text-[13px] font-semibold">{course.title}</div>
      <div className="mono text-[11px] text-muted-foreground">
        {course.code} · {course.credits} cr
      </div>
      {target && !target.ok && <div className="mt-0.5 text-[11px] font-medium text-destructive">{target.reason}</div>}
    </div>
  )
}
