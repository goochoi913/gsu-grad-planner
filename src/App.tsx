import { useCallback, useEffect, useMemo, useState } from 'react'
import { LuBookOpen, LuCalendarDays, LuLayoutGrid, LuListChecks } from 'react-icons/lu'
import { useDefaultLayout, usePanelRef } from 'react-resizable-panels'
import type { TermId } from '@/lib/types'
import { semesterCredits } from '@/lib/plan-ops'
import { resetPlan, setCalSemester, usePlanner } from '@/lib/store'
import { useScheduleVersion } from '@/lib/schedule'
import { usePrefs, type View } from '@/hooks/use-prefs'
import { useIsMobile } from '@/hooks/use-mobile'
import { useMedia } from '@/hooks/use-media'
import { AppHeader } from '@/components/app-header'
import { AuditPanel } from '@/components/audit-panel'
import { Board } from '@/components/board'
import { ClassBrowser } from '@/components/class-browser'
import { CommandPalette } from '@/components/command-palette'
import { ConfirmHost, confirmAction } from '@/components/confirm'
import { CourseDialog } from '@/components/course-dialog'
import { CourseDndProvider } from '@/components/course-dnd'
import { ExceptionsDialog } from '@/components/exceptions-dialog'
import { GpaDialog } from '@/components/gpa-dialog'
import { GradesDialog } from '@/components/grades-dialog'
import { EMPTY_FILTER, LibraryPanel, type LibraryFilter } from '@/components/library-panel'
import { PanelHandle } from '@/components/panel-handle'
import { PlanDialogs } from '@/components/plans'
import { ProfessorDialog } from '@/components/professor-dialog'
import { ProgressRail } from '@/components/progress-rail'
import { RecordDialog, downloadRecordBackup } from '@/components/record-dialog'
import { ScheduleView } from '@/components/schedule-view'
import { SettingsSheet } from '@/components/settings-sheet'
import { SummaryView } from '@/components/summary-view'
import { UiContext, type ExceptionPrefill, type RecordDialogOptions, type UiApi } from '@/components/ui-context'
import { ResizablePanel, ResizablePanelGroup } from '@/components/ui/resizable'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { Toaster } from '@/components/ui/sonner'
import { TooltipProvider } from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'

type MobileSheet = 'library' | 'audit' | null

export default function App() {
  const snap = usePlanner()
  // Re-render everything when fresher seat counts arrive (src/lib/live-schedule.ts).
  useScheduleVersion()
  const { prefs, set: setPref } = usePrefs()
  const isMobile = useIsMobile()
  const wide = useMedia('(min-width: 1024px)')

  const [course, setCourse] = useState<string | null>(null)
  const [profKey, setProfKey] = useState<string | null>(null)
  const [recordOpts, setRecordOpts] = useState<RecordDialogOptions | null>(null)
  const [gradesTerm, setGradesTerm] = useState<TermId | null>(null)
  const [gpa, setGpa] = useState<{ termId?: TermId } | null>(null)
  const [exceptionOpts, setExceptionOpts] = useState<{ prefill?: ExceptionPrefill; editId?: string } | null>(null)
  const [browser, setBrowser] = useState<string | null>(null)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [commandOpen, setCommandOpen] = useState(false)
  const [sheet, setSheet] = useState<MobileSheet>(null)
  const [filter, setFilter] = useState<LibraryFilter>(EMPTY_FILTER)
  const [focusedRaw, setFocusedTerm] = useState<TermId | null>(null)
  const [auditFocus, setAuditFocus] = useState<string | null>(null)
  // Completed terms start hidden (a clean board); Show/Hide on the board is for this visit.
  const [showPast, setShowPast] = useState(() => prefs.showPastOnOpen)

  const libraryRef = usePanelRef()
  const auditRef = usePanelRef()
  const layout = useDefaultLayout({ id: 'bee-planner-layout', panelIds: ['library', 'board', 'audit'] })

  // The term the course list's [+] adds into: the one picked, else the first with room.
  const focusedTerm = useMemo(() => {
    if (focusedRaw && snap.semesters.some((s) => s.id === focusedRaw)) return focusedRaw
    return (snap.semesters.find((s) => semesterCredits(snap.plan.schedule, s.id) < s.maxCredits) ?? snap.semesters[0])?.id ?? null
  }, [focusedRaw, snap.semesters, snap.plan.schedule])

  const view: View = prefs.view
  const setView = useCallback((v: View) => {
    setPref('view', v)
    setSheet(null)
  }, [setPref])

  /* ⌘K */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key.toLowerCase() === 'k' && (e.metaKey || e.ctrlKey)) {
        e.preventDefault()
        setCommandOpen((o) => !o)
      }
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [])

  const openLibrary = useCallback((termId?: TermId) => {
    if (termId) setFocusedTerm(termId)
    if (isMobile) setSheet('library')
    else {
      if (view !== 'plan') setPref('view', 'plan')
      if (!prefs.libraryOpen) {
        setPref('libraryOpen', true)
        requestAnimationFrame(() => libraryRef.current?.expand())
      }
    }
  }, [isMobile, view, prefs.libraryOpen, setPref, libraryRef])

  const openAudit = useCallback((blockKey?: string) => {
    setAuditFocus(blockKey ?? null)
    if (isMobile) setSheet('audit')
    else {
      if (view !== 'plan') setPref('view', 'plan')
      if (!prefs.auditOpen) {
        setPref('auditOpen', true)
        requestAnimationFrame(() => auditRef.current?.expand())
      }
    }
  }, [isMobile, view, prefs.auditOpen, setPref, auditRef])

  const ui: UiApi = useMemo(() => ({
    openCourse: (id: string) => { setProfKey(null); setCourse(id) },
    openProfessor: (key: string) => setProfKey(key),
    openRecord: (opts?: RecordDialogOptions) => setRecordOpts({ ...(opts ?? {}) }),
    openGrades: (termId: TermId) => setGradesTerm(termId),
    openGpa: (termId?: TermId) => setGpa({ termId }),
    openExceptions: (opts?: { prefill?: ExceptionPrefill; editId?: string }) => setExceptionOpts({ ...(opts ?? {}) }),
    openClassBrowser: (q?: string) => setBrowser(q ?? ''),
    openAudit,
    openLibrary,
    setView: (v: View) => {
      if (v === 'schedule' && focusedRaw) setCalSemester(focusedRaw)
      setView(v)
    },
    focusedTerm,
    setFocusedTerm: (t: TermId) => { setFocusedTerm(t); setCalSemester(t) },
    isMobile,
  }), [openAudit, openLibrary, setView, focusedTerm, focusedRaw, isMobile])

  const toggleLibrary = () => {
    const next = !prefs.libraryOpen
    setPref('libraryOpen', next)
    if (next) libraryRef.current?.expand()
    else libraryRef.current?.collapse()
  }
  const toggleAudit = () => {
    const next = !prefs.auditOpen
    setPref('auditOpen', next)
    if (next) auditRef.current?.expand()
    else auditRef.current?.collapse()
  }

  const print = () => {
    setView('summary')
    setTimeout(() => window.print(), 200)
  }

  const askReset = async () => {
    const ok = await confirmAction({
      title: 'Clear the planned terms?',
      description: 'Every planned course leaves the upcoming terms. Past terms, grades and advisor exceptions are kept. You can undo right after.',
      confirmLabel: 'Clear',
      destructive: true,
    })
    if (ok) resetPlan()
  }

  const library = (
    <LibraryPanel
      snap={snap}
      filter={filter}
      setFilter={setFilter}
      targetTerm={focusedTerm}
      setTargetTerm={(t) => setFocusedTerm(t)}
    />
  )
  const audit = <AuditPanel snap={snap} focusBlock={auditFocus} onFocusDone={() => setAuditFocus(null)} />
  const board = <Board snap={snap} showPast={showPast} onShowPast={setShowPast} />
  const scheduleTerm = snap.semesters.some((s) => s.id === snap.plan.calSemester) ? snap.plan.calSemester : snap.semesters[0].id

  return (
    <UiContext.Provider value={ui}>
      <TooltipProvider delayDuration={250}>
        <CourseDndProvider>
        <div className="flex h-dvh flex-col overflow-hidden">
          <AppHeader
            view={view}
            onView={setView}
            sync={snap.sync}
            isMobile={isMobile}
            onOpenCommand={() => setCommandOpen(true)}
            onOpenSettings={() => setSettingsOpen(true)}
            onOpenRecord={() => ui.openRecord()}
            onOpenGpa={() => ui.openGpa()}
            onOpenExceptions={() => ui.openExceptions()}
            onDownloadRecord={() => downloadRecordBackup(snap)}
            onPrint={print}
            onResetPlan={askReset}
          />
          <div className="shrink-0 border-b bg-background" data-print="hide">
            <ProgressRail snap={snap} onOpenBlock={(key) => openAudit(key)} onOpenGpa={() => ui.openGpa()} />
          </div>

          <main className="min-h-0 flex-1">
            {view === 'summary' ? (
              <ScrollArea className="h-full print-full [&>[data-slot=scroll-area-viewport]>div]:!block">
                <SummaryView snap={snap} />
              </ScrollArea>
            ) : view === 'schedule' ? (
              <ScheduleView termId={scheduleTerm} onTerm={setCalSemester} prefs={prefs} setPref={setPref} wide={wide} />
            ) : isMobile ? (
              <ScrollArea className="h-full bg-board [&>[data-slot=scroll-area-viewport]>div]:!block">{board}</ScrollArea>
            ) : (
              <ResizablePanelGroup orientation="horizontal" defaultLayout={layout.defaultLayout} onLayoutChanged={layout.onLayoutChanged} className="h-full">
                <ResizablePanel
                  panelRef={libraryRef}
                  id="library"
                  defaultSize="24%"
                  minSize="16%"
                  maxSize="34%"
                  collapsible
                  collapsedSize={0}
                  onResize={(size) => setPref('libraryOpen', size.inPixels > 4)}
                  className="min-w-0"
                >
                  {library}
                </ResizablePanel>
                <PanelHandle side="left" open={prefs.libraryOpen} label="course list" onToggle={toggleLibrary} />
                <ResizablePanel id="board" defaultSize="50%" minSize="30%" className="min-w-0">
                  <div className="h-full bg-board">
                    <ScrollArea className="h-full [&>[data-slot=scroll-area-viewport]>div]:!block">{board}</ScrollArea>
                  </div>
                </ResizablePanel>
                <PanelHandle side="right" open={prefs.auditOpen} label="degree audit" onToggle={toggleAudit} />
                <ResizablePanel
                  panelRef={auditRef}
                  id="audit"
                  defaultSize="26%"
                  minSize="18%"
                  maxSize="36%"
                  collapsible
                  collapsedSize={0}
                  onResize={(size) => setPref('auditOpen', size.inPixels > 4)}
                  className="min-w-0"
                >
                  {audit}
                </ResizablePanel>
              </ResizablePanelGroup>
            )}
          </main>

          {isMobile && (
            <nav className="flex shrink-0 border-t bg-background pb-safe" aria-label="Main" data-print="hide">
              {(
                [
                  { id: 'plan', label: 'Plan', Icon: LuLayoutGrid, active: view === 'plan' && !sheet, onClick: () => setView('plan') },
                  { id: 'schedule', label: 'Schedule', Icon: LuCalendarDays, active: view === 'schedule' && !sheet, onClick: () => setView('schedule') },
                  { id: 'courses', label: 'Courses', Icon: LuBookOpen, active: sheet === 'library', onClick: () => setSheet('library') },
                  { id: 'audit', label: 'Audit', Icon: LuListChecks, active: sheet === 'audit', onClick: () => setSheet('audit') },
                ] as const
              ).map(({ id, label, Icon, active, onClick }) => (
                <button
                  key={id}
                  type="button"
                  onClick={onClick}
                  aria-current={active ? 'page' : undefined}
                  className={cn('flex min-h-14 flex-1 flex-col items-center justify-center gap-0.5 text-[11px] transition-colors', active ? 'font-medium text-foreground' : 'text-muted-foreground')}
                >
                  <Icon className="size-5" aria-hidden />
                  {label}
                </button>
              ))}
            </nav>
          )}
        </div>

        {isMobile && (
          <>
            <Sheet open={sheet === 'library'} onOpenChange={(o) => setSheet(o ? 'library' : null)}>
              <SheetContent side="bottom" className="h-[88dvh] gap-0 rounded-t-2xl p-0 pb-safe">
                <SheetHeader className="border-b py-3">
                  <SheetTitle className="text-sm">Courses</SheetTitle>
                  <SheetDescription className="sr-only">Find a course and add it to a term</SheetDescription>
                </SheetHeader>
                <div className="min-h-0 flex-1 overflow-hidden">{library}</div>
              </SheetContent>
            </Sheet>
            <Sheet open={sheet === 'audit'} onOpenChange={(o) => setSheet(o ? 'audit' : null)}>
              <SheetContent side="bottom" className="h-[88dvh] gap-0 rounded-t-2xl p-0 pb-safe">
                <SheetHeader className="border-b py-3">
                  <SheetTitle className="text-sm">Degree audit</SheetTitle>
                  <SheetDescription className="sr-only">Degree Works requirements and what is still needed</SheetDescription>
                </SheetHeader>
                <div className="min-h-0 flex-1 overflow-hidden">{audit}</div>
              </SheetContent>
            </Sheet>
          </>
        )}

        <CourseDialog courseId={course} onClose={() => setCourse(null)} snap={snap} />
        <ProfessorDialog profKey={profKey} onClose={() => setProfKey(null)} />
        <RecordDialog opts={recordOpts} onClose={() => setRecordOpts(null)} snap={snap} />
        <GradesDialog termId={gradesTerm} onClose={() => setGradesTerm(null)} snap={snap} />
        <GpaDialog open={!!gpa} focusTerm={gpa?.termId} onClose={() => setGpa(null)} snap={snap} />
        <ExceptionsDialog opts={exceptionOpts} onClose={() => setExceptionOpts(null)} snap={snap} />
        <ClassBrowser query={browser} onClose={() => setBrowser(null)} snap={snap} />
        <PlanDialogs />
        <SettingsSheet
          open={settingsOpen}
          onOpenChange={setSettingsOpen}
          prefs={prefs}
          onPref={(k, v) => {
            setPref(k, v)
            if (k === 'showPastOnOpen') setShowPast(v as boolean)
          }}
        />
        <CommandPalette
          open={commandOpen}
          onOpenChange={setCommandOpen}
          snap={snap}
          focusedTerm={focusedTerm}
          onOpenCourse={(id) => ui.openCourse(id)}
          onOpenProfessor={(k) => ui.openProfessor(k)}
          onView={setView}
          onOpenRecord={() => ui.openRecord()}
          onOpenGpa={() => ui.openGpa()}
          onOpenExceptions={() => ui.openExceptions()}
          onOpenSettings={() => setSettingsOpen(true)}
          onToggleTheme={() => setPref('theme', document.documentElement.classList.contains('dark') ? 'light' : 'dark')}
        />
        </CourseDndProvider>
        <ConfirmHost />
        <Toaster
          position={isMobile ? 'top-center' : 'bottom-center'}
          theme={prefs.theme}
          closeButton
          toastOptions={{ duration: 4500 }}
        />
      </TooltipProvider>
    </UiContext.Provider>
  )
}
