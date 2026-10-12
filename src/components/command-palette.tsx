import { LuCalendarDays, LuChartLine, LuFileText, LuLayoutGrid, LuMoon, LuNotebookPen, LuPlus, LuSearch, LuSettings, LuSquarePen, LuSun, LuUser } from 'react-icons/lu'
import { COURSES } from '@/data/degree'
import type { TermId } from '@/lib/types'
import { isCourseDone } from '@/lib/planner'
import { allProfessors } from '@/lib/schedule'
import { addCourse, type PlannerSnapshot } from '@/lib/store'
import type { View } from '@/hooks/use-prefs'
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
} from '@/components/ui/command'
import { RatingValue } from '@/components/bits'

/** ⌘K: find a course or a professor, add a course to the focused term, jump anywhere. */
export function CommandPalette({
  open,
  onOpenChange,
  snap,
  focusedTerm,
  onOpenCourse,
  onOpenProfessor,
  onView,
  onOpenRecord,
  onOpenGpa,
  onOpenExceptions,
  onOpenSettings,
  onToggleTheme,
}: {
  open: boolean
  onOpenChange: (o: boolean) => void
  snap: PlannerSnapshot
  focusedTerm: TermId | null
  onOpenCourse: (id: string) => void
  onOpenProfessor: (key: string) => void
  onView: (v: View) => void
  onOpenRecord: () => void
  onOpenGpa: () => void
  onOpenExceptions: () => void
  onOpenSettings: () => void
  onToggleTheme: () => void
}) {
  const run = (fn: () => void) => {
    onOpenChange(false)
    requestAnimationFrame(fn)
  }
  const term = snap.semesters.find((s) => s.id === focusedTerm)
  const placeable = term ? COURSES.filter((c) => !isCourseDone(c.id) && !(snap.plan.schedule[term.id] || []).some((e) => e.courseId === c.id)) : []

  return (
    <CommandDialog open={open} onOpenChange={onOpenChange} title="Search" description="Find a course or a professor, or jump to a view">
      <CommandInput placeholder="Course, professor or action…" />
      <CommandList>
        <CommandEmpty>No results.</CommandEmpty>
        <CommandGroup heading="Courses">
          {COURSES.map((c) => (
            <CommandItem key={c.id} value={`${c.title} ${c.code}`} onSelect={() => run(() => onOpenCourse(c.id))}>
              <LuSearch className="size-3.5" aria-hidden />
              <span className="truncate">{c.title}</span>
              <span className="mono ml-auto shrink-0 text-xs text-muted-foreground">{c.code}</span>
            </CommandItem>
          ))}
        </CommandGroup>
        {term && placeable.length > 0 && (
          <>
            <CommandSeparator />
            <CommandGroup heading={`Add to ${term.label}`}>
              {placeable.map((c) => (
                <CommandItem key={`add-${c.id}`} value={`add ${c.title} ${c.code}`} onSelect={() => run(() => addCourse(c.id, term.id))}>
                  <LuPlus className="size-3.5" aria-hidden />
                  <span className="truncate">{c.title}</span>
                  <span className="mono ml-auto shrink-0 text-xs text-muted-foreground">{c.code}</span>
                </CommandItem>
              ))}
            </CommandGroup>
          </>
        )}
        <CommandSeparator />
        <CommandGroup heading="Professors">
          {allProfessors().map((p) => (
            <CommandItem key={p.key} value={`professor ${p.display} ${p.name}`} onSelect={() => run(() => onOpenProfessor(p.key))}>
              <LuUser className="size-3.5" aria-hidden />
              <span>{p.display}</span>
              <RatingValue prof={p} className="ml-auto" />
            </CommandItem>
          ))}
        </CommandGroup>
        <CommandSeparator />
        <CommandGroup heading="Go to">
          <CommandItem value="view plan board" onSelect={() => run(() => onView('plan'))}><LuLayoutGrid className="size-3.5" aria-hidden />Plan</CommandItem>
          <CommandItem value="view schedule calendar week day sections" onSelect={() => run(() => onView('schedule'))}><LuCalendarDays className="size-3.5" aria-hidden />Schedule & calendar</CommandItem>
          <CommandItem value="view summary report print" onSelect={() => run(() => onView('summary'))}><LuFileText className="size-3.5" aria-hidden />Summary</CommandItem>
          <CommandItem value="academic record grades" onSelect={() => run(onOpenRecord)}><LuNotebookPen className="size-3.5" aria-hidden />Academic record</CommandItem>
          <CommandItem value="gpa projection what if" onSelect={() => run(onOpenGpa)}><LuChartLine className="size-3.5" aria-hidden />GPA projection</CommandItem>
          <CommandItem value="advisor exceptions" onSelect={() => run(onOpenExceptions)}><LuSquarePen className="size-3.5" aria-hidden />Advisor exceptions</CommandItem>
          <CommandItem value="settings preferences" onSelect={() => run(onOpenSettings)}><LuSettings className="size-3.5" aria-hidden />Settings</CommandItem>
          <CommandItem value="toggle theme dark light" onSelect={() => run(onToggleTheme)}>
            <LuSun className="size-3.5 dark:hidden" aria-hidden />
            <LuMoon className="hidden size-3.5 dark:block" aria-hidden />
            Switch light / dark
          </CommandItem>
        </CommandGroup>
      </CommandList>
    </CommandDialog>
  )
}
