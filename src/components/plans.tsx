import { useEffect, useMemo, useState, useSyncExternalStore } from 'react'
import {
  DndContext,
  KeyboardSensor,
  MouseSensor,
  TouchSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core'
import { restrictToHorizontalAxis, restrictToParentElement, restrictToVerticalAxis } from '@dnd-kit/modifiers'
import {
  SortableContext,
  arrayMove,
  horizontalListSortingStrategy,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import {
  LuArrowLeftRight,
  LuCheck,
  LuChevronDown,
  LuCopy,
  LuEllipsis,
  LuGripVertical,
  LuLayers,
  LuLoaderCircle,
  LuPencil,
  LuPlus,
  LuTrash2,
} from 'react-icons/lu'
import type { PlanDoc, Term } from '@/lib/types'
import { buildSemesters, computeAudit, findCourse, fmtCredits, termIdKey } from '@/lib/planner'
import { OFFERED_PATHS, pathTitle } from '@/lib/plan-ops'
import { PLAN_NAME_MAX, nextPlanName, type PlanMeta } from '@/lib/plans'
import {
  createPlan,
  deletePlan,
  duplicatePlan,
  loadPlan,
  renamePlan,
  reorderPlans,
  switchPlan,
  usePlanner,
  type PlanStart,
  type PlannerSnapshot,
} from '@/lib/store'
import { AppDialog } from '@/components/app-dialog'
import { confirmAction } from '@/components/confirm'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { cn } from '@/lib/utils'

/*
 * Plans: as many named versions of the plan as you like — hers, yours, "what if I take the
 * capstone in Fall" — to build, switch between and compare. Tabs on the board (drag to
 * reorder), a switcher in the header for the other views, and dialogs to make, rename, manage
 * and compare them.
 */

/* ─── Opening the dialogs from anywhere ─────────────────────────────────── */

type PlanDialog = { kind: 'new' } | { kind: 'rename'; planId: string } | { kind: 'manage' } | { kind: 'compare' } | null
let dialog: PlanDialog = null
const dialogListeners = new Set<() => void>()
export function openPlanDialog(next: PlanDialog) {
  dialog = next
  dialogListeners.forEach((l) => l())
}
const useDialog = () => useSyncExternalStore((l) => { dialogListeners.add(l); return () => dialogListeners.delete(l) }, () => dialog)

async function askDelete(meta: PlanMeta) {
  const ok = await confirmAction({
    title: `Delete “${meta.name}”?`,
    description: 'Its courses and chosen sections go away on both devices. Past terms, grades and the other plans stay. You can undo right after.',
    confirmLabel: 'Delete plan',
    destructive: true,
  })
  if (ok) await deletePlan(meta.id)
}

function PlanMenuItems({ meta, snap }: { meta: PlanMeta; snap: PlannerSnapshot }) {
  return (
    <>
      <DropdownMenuItem onClick={() => openPlanDialog({ kind: 'rename', planId: meta.id })}>
        <LuPencil className="size-4" aria-hidden />
        Rename…
      </DropdownMenuItem>
      <DropdownMenuItem onClick={() => void duplicatePlan(meta.id)}>
        <LuCopy className="size-4" aria-hidden />
        Duplicate
      </DropdownMenuItem>
      <DropdownMenuItem variant="destructive" disabled={snap.plans.length < 2} onClick={() => void askDelete(meta)}>
        <LuTrash2 className="size-4" aria-hidden />
        Delete…
      </DropdownMenuItem>
      <DropdownMenuSeparator />
      <DropdownMenuItem onClick={() => openPlanDialog({ kind: 'manage' })}>
        <LuLayers className="size-4" aria-hidden />
        Manage plans…
      </DropdownMenuItem>
      <DropdownMenuItem disabled={snap.plans.length < 2} onClick={() => openPlanDialog({ kind: 'compare' })}>
        <LuArrowLeftRight className="size-4" aria-hidden />
        Compare plans…
      </DropdownMenuItem>
    </>
  )
}

/* ─── Tabs on the board ─────────────────────────────────────────────────── */

function useListSensors(touchDelay = 250) {
  return useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 6 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: touchDelay, tolerance: 8 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  )
}

function reorderedIds(plans: PlanMeta[], { active, over }: DragEndEvent): string[] | null {
  if (!over || active.id === over.id) return null
  const ids = plans.map((p) => p.id)
  const from = ids.indexOf(String(active.id)), to = ids.indexOf(String(over.id))
  return from < 0 || to < 0 ? null : arrayMove(ids, from, to)
}

/** One tab per plan — click to open it, drag to reorder; the open one has its menu. */
export function PlanTabs({ snap }: { snap: PlannerSnapshot }) {
  const sensors = useListSensors()
  return (
    <div className="flex min-w-0 items-center gap-2">
      <DndContext
        sensors={sensors}
        collisionDetection={closestCenter}
        modifiers={[restrictToHorizontalAxis, restrictToParentElement]}
        onDragEnd={(e) => {
          const ids = reorderedIds(snap.plans, e)
          if (ids) void reorderPlans(ids)
        }}
      >
        <SortableContext items={snap.plans.map((p) => p.id)} strategy={horizontalListSortingStrategy}>
          <div role="tablist" aria-label="Plans" className="no-scrollbar flex min-w-0 items-center gap-1 overflow-x-auto rounded-lg bg-muted/70 p-1" data-plan-tabs>
            {snap.plans.map((p) => (
              <PlanTab key={p.id} meta={p} snap={snap} />
            ))}
          </div>
        </SortableContext>
      </DndContext>
      <Button variant="outline" size="sm" className="h-8 shrink-0 gap-1 px-2.5 text-xs" onClick={() => openPlanDialog({ kind: 'new' })} aria-label="New plan">
        <LuPlus className="size-3.5" aria-hidden />
        <span className="hidden sm:inline">New plan</span>
      </Button>
      {snap.plans.length > 1 && (
        <Button variant="ghost" size="sm" className="h-8 shrink-0 gap-1 px-2.5 text-xs" onClick={() => openPlanDialog({ kind: 'compare' })} aria-label="Compare plans">
          <LuArrowLeftRight className="size-3.5" aria-hidden />
          <span className="hidden sm:inline">Compare</span>
        </Button>
      )}
    </div>
  )
}

function PlanTab({ meta, snap }: { meta: PlanMeta; snap: PlannerSnapshot }) {
  const active = meta.id === snap.activePlanId
  const { setNodeRef, attributes, listeners, transform, transition, isDragging } = useSortable({ id: meta.id })
  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Translate.toString(transform), transition }}
      className={cn(
        'flex shrink-0 items-center rounded-md transition-colors',
        active ? 'bg-background shadow-sm ring-1 ring-border' : 'text-muted-foreground hover:bg-background/60 hover:text-foreground',
        isDragging && 'z-10 opacity-70 shadow-md',
      )}
      data-plan={meta.id}
    >
      <button
        type="button"
        {...attributes}
        {...listeners}
        role="tab"
        aria-selected={active}
        onClick={() => { if (!active) void switchPlan(meta.id) }}
        onDoubleClick={() => openPlanDialog({ kind: 'rename', planId: meta.id })}
        className={cn(
          'flex h-7 max-w-52 cursor-pointer items-center gap-1.5 rounded-md px-2.5 text-[13px] whitespace-nowrap select-none [-webkit-touch-callout:none] focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none',
          active && 'font-semibold text-foreground',
          active && 'pr-1',
        )}
        title={active ? 'Open on this device — double-click to rename, drag to reorder' : `Open “${meta.name}” — drag to reorder`}
      >
        <span className="truncate">{meta.name}</span>
        {active && snap.planStatus === 'loading' && <LuLoaderCircle className="size-3 shrink-0 animate-spin text-muted-foreground" aria-label="Loading" />}
      </button>
      {active && (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon" className="mr-0.5 size-6 text-muted-foreground" aria-label={`More for “${meta.name}”`}>
              <LuEllipsis className="size-3.5" aria-hidden />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="w-52">
            <PlanMenuItems meta={meta} snap={snap} />
          </DropdownMenuContent>
        </DropdownMenu>
      )}
    </div>
  )
}

/* ─── Header switcher (every view) ──────────────────────────────────────── */

export function PlanSwitcher({ compact = false }: { compact?: boolean }) {
  const snap = usePlanner()
  const active = snap.plans.find((p) => p.id === snap.activePlanId) ?? snap.plans[0]
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className={cn(
            'flex max-w-44 min-w-0 items-center gap-1 rounded-md text-left text-[11px] text-muted-foreground hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none',
            compact && 'max-w-32',
          )}
          aria-label={`Plan: ${active.name}. Switch plans`}
          data-plan-switcher
        >
          <LuLayers className="size-3 shrink-0" aria-hidden />
          <span className="truncate">{active.name}</span>
          {snap.planStatus === 'loading' ? <LuLoaderCircle className="size-3 shrink-0 animate-spin" aria-hidden /> : <LuChevronDown className="size-3 shrink-0" aria-hidden />}
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-60">
        <DropdownMenuLabel className="text-xs font-normal text-muted-foreground">Plans — this device has one open</DropdownMenuLabel>
        {snap.plans.map((p) => (
          <DropdownMenuItem key={p.id} onClick={() => void switchPlan(p.id)}>
            <LuCheck className={cn('size-4', p.id === snap.activePlanId ? 'opacity-100' : 'opacity-0')} aria-hidden />
            <span className="truncate">{p.name}</span>
          </DropdownMenuItem>
        ))}
        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={() => openPlanDialog({ kind: 'new' })}>
          <LuPlus className="size-4" aria-hidden />
          New plan…
        </DropdownMenuItem>
        <PlanMenuItems meta={active} snap={snap} />
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

/* ─── Dialogs ───────────────────────────────────────────────────────────── */

export function PlanDialogs() {
  const d = useDialog()
  const snap = usePlanner()
  const close = () => openPlanDialog(null)
  return (
    <>
      <NewPlanDialog open={d?.kind === 'new'} onClose={close} snap={snap} />
      <RenamePlanDialog planId={d?.kind === 'rename' ? d.planId : null} onClose={close} snap={snap} />
      <ManagePlansDialog open={d?.kind === 'manage'} onClose={close} snap={snap} />
      <ComparePlansDialog open={d?.kind === 'compare'} onClose={close} snap={snap} />
    </>
  )
}

function NewPlanDialog({ open, onClose, snap }: { open: boolean; onClose: () => void; snap: PlannerSnapshot }) {
  const active = snap.plans.find((p) => p.id === snap.activePlanId) ?? snap.plans[0]
  const [name, setName] = useState('')
  const [start, setStart] = useState('copy')
  const [busy, setBusy] = useState(false)
  const [shown, setShown] = useState(false)
  // A fresh form each time it opens.
  if (open !== shown) {
    setShown(open)
    if (open) {
      setName(nextPlanName(snap.plans))
      setStart('copy')
      setBusy(false)
    }
  }
  const options: { value: string; label: string; hint: string }[] = [
    { value: 'copy', label: `A copy of “${active.name}”`, hint: 'Same courses and sections — change anything after.' },
    { value: 'empty', label: 'An empty plan', hint: 'The terms with no courses, to fill from the course list.' },
    ...OFFERED_PATHS.map((p) => ({ value: `path:${p.id}`, label: `The ${pathTitle(p)}`, hint: `Graduate ${p.graduation}. ${p.note}` })),
  ]
  const submit = async () => {
    if (busy) return
    setBusy(true)
    const how: PlanStart = start === 'copy' || start === 'empty' ? start : { pathId: start.slice(5) }
    const ok = await createPlan(name, how)
    setBusy(false)
    if (ok) onClose()
  }
  return (
    <AppDialog
      open={open}
      onOpenChange={(o) => !o && onClose()}
      size="sm"
      title="New plan"
      description="Plans are shared with the other device; each device opens its own."
      initialFocus
      footer={
        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={() => void submit()} disabled={busy || !name.trim()} data-create-plan>
            {busy && <LuLoaderCircle className="size-4 animate-spin" aria-hidden />}
            Make plan
          </Button>
        </div>
      }
    >
      <form className="space-y-4" onSubmit={(e) => { e.preventDefault(); void submit() }}>
        <div className="space-y-1.5">
          <Label htmlFor="plan-name">Name</Label>
          <Input id="plan-name" value={name} onChange={(e) => setName(e.target.value)} maxLength={PLAN_NAME_MAX} autoComplete="off" onFocus={(e) => e.currentTarget.select()} />
        </div>
        <fieldset className="space-y-1.5">
          <legend className="pb-1 text-sm font-medium">Start from</legend>
          {options.map((o) => (
            <label key={o.value} className={cn('flex cursor-pointer items-start gap-3 rounded-lg border px-3 py-2.5 transition-colors hover:bg-accent/50', start === o.value && 'border-foreground/60 bg-accent/40')}>
              <input type="radio" name="plan-start" value={o.value} checked={start === o.value} onChange={() => setStart(o.value)} className="mt-1 accent-foreground" />
              <span className="space-y-0.5">
                <span className="block text-sm font-medium">{o.label}</span>
                <span className="block text-xs text-muted-foreground">{o.hint}</span>
              </span>
            </label>
          ))}
        </fieldset>
        <button type="submit" hidden />
      </form>
    </AppDialog>
  )
}

function RenamePlanDialog({ planId, onClose, snap }: { planId: string | null; onClose: () => void; snap: PlannerSnapshot }) {
  const meta = snap.plans.find((p) => p.id === planId) ?? null
  const [name, setName] = useState('')
  const [shown, setShown] = useState<string | null>(null)
  if (planId !== shown) {
    setShown(planId)
    if (meta) setName(meta.name)
  }
  const submit = async () => {
    if (!meta) return
    if (name.trim() && name.trim() !== meta.name) await renamePlan(meta.id, name)
    onClose()
  }
  return (
    <AppDialog
      open={!!meta}
      onOpenChange={(o) => !o && onClose()}
      size="sm"
      title="Rename plan"
      initialFocus
      footer={
        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={() => void submit()} disabled={!name.trim()}>Save</Button>
        </div>
      }
    >
      <form onSubmit={(e) => { e.preventDefault(); void submit() }} className="space-y-1.5">
        <Label htmlFor="plan-rename">Name</Label>
        <Input id="plan-rename" value={name} onChange={(e) => setName(e.target.value)} maxLength={PLAN_NAME_MAX} autoComplete="off" onFocus={(e) => e.currentTarget.select()} />
      </form>
    </AppDialog>
  )
}

/* ─── Manage: reorder, rename, duplicate, delete ────────────────────────── */

function ManagePlansDialog({ open, onClose, snap }: { open: boolean; onClose: () => void; snap: PlannerSnapshot }) {
  const sensors = useListSensors(150)
  return (
    <AppDialog
      open={open}
      onOpenChange={(o) => !o && onClose()}
      size="md"
      title="Your plans"
      description="Drag the handle to reorder. Plans are shared; each device opens its own."
      footer={
        <div className="flex justify-between gap-2">
          <Button variant="outline" onClick={() => openPlanDialog({ kind: 'new' })}>
            <LuPlus className="size-4" aria-hidden />
            New plan
          </Button>
          <Button onClick={onClose}>Done</Button>
        </div>
      }
    >
      <DndContext
        sensors={sensors}
        collisionDetection={closestCenter}
        modifiers={[restrictToVerticalAxis, restrictToParentElement]}
        onDragEnd={(e) => {
          const ids = reorderedIds(snap.plans, e)
          if (ids) void reorderPlans(ids)
        }}
      >
        <SortableContext items={snap.plans.map((p) => p.id)} strategy={verticalListSortingStrategy}>
          <ul className="space-y-2" data-manage-plans>
            {snap.plans.map((p) => (
              <ManageRow key={p.id} meta={p} snap={snap} />
            ))}
          </ul>
        </SortableContext>
      </DndContext>
    </AppDialog>
  )
}

function ManageRow({ meta, snap }: { meta: PlanMeta; snap: PlannerSnapshot }) {
  const { setNodeRef, setActivatorNodeRef, attributes, listeners, transform, transition, isDragging } = useSortable({ id: meta.id })
  const [name, setName] = useState(meta.name)
  const [was, setWas] = useState(meta.name)
  if (meta.name !== was) {
    setWas(meta.name)
    setName(meta.name)
  }
  const active = meta.id === snap.activePlanId
  const commit = () => {
    if (name.trim() && name.trim() !== meta.name) void renamePlan(meta.id, name)
    else setName(meta.name)
  }
  return (
    <li
      ref={setNodeRef}
      style={{ transform: CSS.Translate.toString(transform), transition }}
      className={cn('flex items-center gap-2 rounded-lg border bg-card p-2', active && 'border-foreground/40', isDragging && 'z-10 shadow-lg')}
      data-plan-row={meta.id}
    >
      <button
        ref={setActivatorNodeRef}
        type="button"
        {...attributes}
        {...listeners}
        className="flex size-9 shrink-0 cursor-grab touch-none items-center justify-center rounded-md text-muted-foreground hover:bg-accent active:cursor-grabbing"
        aria-label={`Drag to reorder “${meta.name}”`}
      >
        <LuGripVertical className="size-4" aria-hidden />
      </button>
      <div className="min-w-0 flex-1">
        <Input
          value={name}
          onChange={(e) => setName(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur() }}
          maxLength={PLAN_NAME_MAX}
          className="h-9"
          aria-label={`Name of “${meta.name}”`}
        />
        {active && <div className="pt-1 pl-1 text-[11px] text-muted-foreground">Open on this device</div>}
      </div>
      {!active && (
        <Button variant="ghost" size="sm" className="h-9" onClick={() => void switchPlan(meta.id)}>
          Open
        </Button>
      )}
      <Button variant="ghost" size="icon" className="size-9 text-muted-foreground" onClick={() => void duplicatePlan(meta.id)} aria-label={`Duplicate “${meta.name}”`}>
        <LuCopy className="size-4" aria-hidden />
      </Button>
      <Button
        variant="ghost"
        size="icon"
        className="size-9 text-muted-foreground hover:text-destructive"
        disabled={snap.plans.length < 2}
        onClick={() => void askDelete(meta)}
        aria-label={`Delete “${meta.name}”`}
      >
        <LuTrash2 className="size-4" aria-hidden />
      </Button>
    </li>
  )
}

/* ─── Compare two plans ─────────────────────────────────────────────────── */

interface Side {
  meta: PlanMeta
  plan: PlanDoc
  semesters: Term[]
  graduation: Term | null
  credits: number
  missing: number
  pending: number
  termOf: Map<string, string>
}

function sideOf(meta: PlanMeta, plan: PlanDoc, snap: PlannerSnapshot): Side {
  const start = snap.startKey
  const semesters = buildSemesters(start, Math.max(start, termIdKey(plan.lastTermId)) - start + 1)
  const audit = computeAudit(snap.record, plan.schedule, semesters)
  const termOf = new Map<string, string>()
  for (const s of semesters) for (const e of plan.schedule[s.id] || []) termOf.set(e.courseId, s.id)
  const credits = semesters.reduce((n, s) => n + (plan.schedule[s.id] || []).reduce((m, e) => m + (findCourse(e.courseId)?.credits ?? 0), 0), 0)
  return {
    meta, plan, semesters,
    graduation: [...semesters].reverse().find((s) => (plan.schedule[s.id] || []).length) ?? null,
    credits, missing: audit.missing, pending: audit.pending.length, termOf,
  }
}

function ComparePlansDialog({ open, onClose, snap }: { open: boolean; onClose: () => void; snap: PlannerSnapshot }) {
  const [aId, setAId] = useState(snap.activePlanId)
  const [bId, setBId] = useState<string>('')
  const [shown, setShown] = useState(false)
  if (open !== shown) {
    setShown(open)
    if (open) {
      setAId(snap.activePlanId)
      setBId(snap.plans.find((p) => p.id !== snap.activePlanId)?.id ?? '')
    }
  }
  const [docs, setDocs] = useState<Record<string, PlanDoc | null>>({})
  useEffect(() => {
    if (!open) return
    let live = true
    for (const id of [aId, bId]) {
      if (!id) continue
      void loadPlan(id).then((d) => { if (live) setDocs((m) => ({ ...m, [id]: d })) })
    }
    return () => { live = false }
  }, [open, aId, bId, snap.plan])

  const a = snap.plans.find((p) => p.id === aId), b = snap.plans.find((p) => p.id === bId)
  const sides = useMemo(() => (a && b && docs[a.id] && docs[b.id] ? [sideOf(a, docs[a.id]!, snap), sideOf(b, docs[b.id]!, snap)] : null), [a, b, docs, snap])

  const pick = (value: string, set: (v: string) => void, other: string) => (
    <Select value={value} onValueChange={set}>
      <SelectTrigger className="h-9 w-full min-w-0" aria-label="Plan to compare"><SelectValue /></SelectTrigger>
      <SelectContent>
        {snap.plans.map((p) => <SelectItem key={p.id} value={p.id} disabled={p.id === other}>{p.name}</SelectItem>)}
      </SelectContent>
    </Select>
  )

  return (
    <AppDialog open={open} onOpenChange={(o) => !o && onClose()} size="xl" title="Compare plans" description="Courses only one plan has are highlighted; a course in a different term says where the other plan has it.">
      <div className="space-y-4" data-compare>
        <div className="grid grid-cols-2 gap-3">
          {pick(aId, setAId, bId)}
          {pick(bId, setBId, aId)}
        </div>
        {!sides ? (
          <p className="flex items-center gap-2 py-6 text-sm text-muted-foreground"><LuLoaderCircle className="size-4 animate-spin" aria-hidden /> Loading the plans…</p>
        ) : (
          <CompareTable sides={sides as [Side, Side]} />
        )}
      </div>
    </AppDialog>
  )
}

function CompareTable({ sides }: { sides: [Side, Side] }) {
  const [A, B] = sides
  const terms = [...new Map([...A.semesters, ...B.semesters].map((t) => [t.id, t])).values()].sort((x, y) => x.key - y.key)
  const short = (id: string) => [...A.semesters, ...B.semesters].find((t) => t.id === id)?.shortLabel ?? id
  const status = (s: Side) => (s.missing ? `${s.missing} requirement${s.missing > 1 ? 's' : ''} still open` : s.pending ? `Covered · ${s.pending} advisor exception${s.pending > 1 ? 's' : ''} to go` : 'Covers everything')

  const cell = (self: Side, other: Side, termId: string) => {
    const entries = self.plan.schedule[termId] || []
    if (!entries.length) return <span className="text-xs text-muted-foreground">—</span>
    return (
      <ul className="space-y-1">
        {entries.map((e) => {
          const c = findCourse(e.courseId)
          const there = other.termOf.get(e.courseId)
          const only = !there
          const moved = there && there !== termId
          return (
            <li key={e.courseId} className={cn('rounded-md px-2 py-1 text-[12.5px] leading-snug sm:text-[13px]', only ? 'bg-yellow-100 dark:bg-yellow-400/15' : moved ? 'bg-muted' : '')} data-diff={only ? 'only' : moved ? 'moved' : 'same'}>
              <span className={cn(only && 'font-medium')}>{c?.title ?? e.courseId}</span>
              <span className="mono ml-1.5 text-[11px] text-muted-foreground">{c?.code}</span>
              {moved && <span className="ml-1.5 text-[11px] text-muted-foreground">· {other.meta.name}: {short(there!)}</span>}
            </li>
          )
        })}
      </ul>
    )
  }

  // A phone stacks each row's label above the two plans; a computer gives it its own column.
  const row = 'grid grid-cols-2 border-b last:border-b-0 sm:grid-cols-[8rem_1fr_1fr]'
  const label = 'col-span-2 px-3 pt-2 sm:col-span-1 sm:py-2'
  return (
    <div className="overflow-hidden rounded-lg border">
      <div className={cn(row, 'sticky top-0 z-10 bg-muted text-xs font-medium')}>
        <div className="hidden px-3 py-2 sm:block" />
        <div className="truncate px-3 py-2">{A.meta.name}</div>
        <div className="truncate border-l px-3 py-2">{B.meta.name}</div>
      </div>
      {[
        ['Graduates', A.graduation?.label ?? '—', B.graduation?.label ?? '—'],
        ['Planned credits', fmtCredits(A.credits), fmtCredits(B.credits)],
        ['Requirements', status(A), status(B)],
      ].map(([what, x, y]) => (
        <div key={what} className={cn(row, 'text-sm')}>
          <div className={cn(label, 'text-xs text-muted-foreground')}>{what}</div>
          <div className={cn('px-3 py-2', x !== y && 'font-medium')}>{x}</div>
          <div className={cn('border-l px-3 py-2', x !== y && 'font-medium')}>{y}</div>
        </div>
      ))}
      {terms.map((t) => {
        const ca = (A.plan.schedule[t.id] || []).reduce((n, e) => n + (findCourse(e.courseId)?.credits ?? 0), 0)
        const cb = (B.plan.schedule[t.id] || []).reduce((n, e) => n + (findCourse(e.courseId)?.credits ?? 0), 0)
        return (
          <div key={t.id} className={row} data-compare-term={t.id}>
            <div className={cn(label, 'flex items-baseline gap-2 sm:block')}>
              <div className="text-sm font-medium">{t.label}</div>
              <div className="mono text-[11px] text-muted-foreground">{fmtCredits(ca)} · {fmtCredits(cb)} cr</div>
            </div>
            <div className="min-w-0 px-2 py-2">{cell(A, B, t.id)}</div>
            <div className="min-w-0 border-l px-2 py-2">{cell(B, A, t.id)}</div>
          </div>
        )
      })}
    </div>
  )
}
