import { LuArrowUpRight, LuClock, LuGauge, LuMessageSquare, LuRepeat, LuSearch, LuStar } from 'react-icons/lu'
import { PROFESSORS, SCHEDULE_TERM_ID, meetingSummary, professorFor, scheduleFor, scheduleTitle, seatsText, isFull, sectionsTaughtBy, libraryCourseFor } from '@/lib/schedule'
import { fmtDate } from '@/lib/format'
import { AppDialog, DialogSection } from '@/components/app-dialog'
import { Button } from '@/components/ui/button'
import { useUi } from '@/components/ui-context'
import { cn } from '@/lib/utils'

/**
 * One professor: their RateMyProfessors numbers (Georgia State, school 360), a link
 * straight to their profile, and every section they teach in the released term.
 */
export function ProfessorDialog({ profKey, onClose }: { profKey: string | null; onClose: () => void }) {
  const ui = useUi()
  const prof = professorFor(profKey)
  const r = prof?.rmp
  const sched = scheduleFor(SCHEDULE_TERM_ID)
  const sections = profKey ? sectionsTaughtBy(SCHEDULE_TERM_ID, profKey) : []

  return (
    <AppDialog
      open={!!prof}
      onOpenChange={(o) => !o && onClose()}
      size="md"
      eyebrow={r?.department ? `${r.department} · Georgia State` : 'Georgia State University'}
      title={prof?.display ?? ''}
      description={prof && prof.display !== prof.name ? `Listed as ${prof.name}` : undefined}
    >
      {prof && (
        <>
          <DialogSection title="RateMyProfessors">
            {r ? (
              <div className="space-y-4">
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                  <Big icon={<LuStar className="size-4 fill-amber-400 text-amber-400" />} label="Rating" value={r.avgRating != null ? r.avgRating.toFixed(1) : '—'} suffix="/ 5" />
                  <Big icon={<LuGauge className="size-4" />} label="Difficulty" value={r.avgDifficulty != null ? r.avgDifficulty.toFixed(1) : '—'} suffix="/ 5" />
                  <Big icon={<LuRepeat className="size-4" />} label="Would take again" value={r.wouldTakeAgainPercent != null ? `${Math.round(r.wouldTakeAgainPercent)}%` : '—'} />
                  <Big icon={<LuMessageSquare className="size-4" />} label="Ratings" value={String(r.numRatings)} />
                </div>
                {r.tags.length > 0 && (
                  <div className="flex flex-wrap gap-1.5">
                    {r.tags.map((t) => (
                      <span key={t.name} className="rounded-full border px-2.5 py-0.5 text-xs text-muted-foreground">
                        {t.name} <span className="mono opacity-60">{t.count}</span>
                      </span>
                    ))}
                  </div>
                )}
                <div className="flex flex-wrap items-center gap-2">
                  <Button asChild size="sm">
                    <a href={r.url} target="_blank" rel="noreferrer">
                      Open on RateMyProfessors
                      <LuArrowUpRight className="size-3.5" aria-hidden />
                    </a>
                  </Button>
                  <span className="text-xs text-muted-foreground">
                    {r.firstName} {r.lastName} · ratings as of {fmtDate(PROFESSORS.fetchedAt)}
                  </span>
                </div>
              </div>
            ) : (
              <div className="space-y-3">
                <p className="text-sm text-muted-foreground">
                  {prof.match === 'ambiguous'
                    ? 'RateMyProfessors has more than one Georgia State professor by this name, so no rating is shown here — check which one teaches this course.'
                    : 'No RateMyProfessors profile was found for this name at Georgia State.'}
                </p>
                <Button asChild size="sm" variant="outline">
                  <a href={prof.searchUrl} target="_blank" rel="noreferrer">
                    <LuSearch className="size-3.5" aria-hidden />
                    Search RateMyProfessors
                    <LuArrowUpRight className="size-3.5" aria-hidden />
                  </a>
                </Button>
              </div>
            )}
          </DialogSection>

          <DialogSection title={`Teaching in ${sched?.label ?? 'the next term'}`}>
            {sections.length ? (
              <ul className="divide-y rounded-lg border">
                {sections.map((s) => {
                  const course = libraryCourseFor(s.codeId)
                  return (
                    <li key={s.crn}>
                      <button
                        type="button"
                        disabled={!course}
                        onClick={() => course && ui.openCourse(course.id, SCHEDULE_TERM_ID)}
                        className={cn('flex w-full items-start gap-3 px-3 py-2.5 text-left', course && 'hover:bg-accent/50')}
                      >
                        <div className="min-w-0 flex-1">
                          <div className="truncate text-sm font-semibold">{scheduleTitle(s.codeId, s.title)}</div>
                          <div className="mono text-xs text-muted-foreground">{s.code} · Sec {s.section}</div>
                          <div className="mt-0.5 inline-flex items-center gap-1.5 text-xs">
                            <LuClock className="size-3 text-muted-foreground" aria-hidden />
                            {meetingSummary(s).join(' · ')}
                          </div>
                        </div>
                        <span className={cn('mono shrink-0 text-[11px]', isFull(s) ? 'text-destructive' : 'text-muted-foreground')}>{seatsText(s)}</span>
                      </button>
                    </li>
                  )
                })}
              </ul>
            ) : (
              <p className="text-sm text-muted-foreground">No sections in the released schedule.</p>
            )}
          </DialogSection>
        </>
      )}
    </AppDialog>
  )
}

function Big({ icon, label, value, suffix }: { icon: React.ReactNode; label: string; value: string; suffix?: string }) {
  return (
    <div className="rounded-lg border px-3 py-2.5">
      <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
        {icon}
        {label}
      </div>
      <div className="mt-1 flex items-baseline gap-1">
        <span className="mono text-2xl font-semibold tracking-tight">{value}</span>
        {suffix && <span className="mono text-xs text-muted-foreground">{suffix}</span>}
      </div>
    </div>
  )
}
