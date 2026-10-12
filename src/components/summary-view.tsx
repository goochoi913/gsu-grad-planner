import { DEGREE } from '@/data/degree'
import { advisorChecklist, findCourse, fmtCredits, fmtGpa } from '@/lib/planner'
import { auditHeadline, blockMeter, roleShort, semesterCredits, statusSentence } from '@/lib/plan-ops'
import { SCHEDULE_TERM_ID, breaksBetween, locationText, partPicks, scheduleFor, termEvents, timedMeetings } from '@/lib/schedule'
import { fmtDaysLong, fmtTimeRange } from '@/lib/format'
import type { PlannerSnapshot } from '@/lib/store'
import { AuditIcon } from '@/components/bits'
import { WeekCalendar } from '@/components/calendar'
import { Logo } from '@/components/logo'
import { Separator } from '@/components/ui/separator'
import { cn } from '@/lib/utils'
import { CATEGORY, categoryOf, gradeText } from '@/lib/colors'

/**
 * The read, as opposed to the work: one scrolling column of numbered sections. This
 * is also what prints.
 */
export function SummaryView({ snap }: { snap: PlannerSnapshot }) {
  const { audit: a, summary: s, record, semesters, plan } = snap
  const last = [...semesters].reverse().find((t) => (plan.schedule[t.id] || []).length)
  const checklist = advisorChecklist(a, record, semesters, plan.schedule)
  const sched = scheduleFor(SCHEDULE_TERM_ID)
  const springEntries = plan.schedule[SCHEDULE_TERM_ID] || []
  const spring = semesters.find((t) => t.id === SCHEDULE_TERM_ID)
  const { events, days } = termEvents(SCHEDULE_TERM_ID, springEntries)
  const graded = snap.gpa.withR2R.filter((w) => w.graded)

  return (
    <div className="mx-auto max-w-3xl space-y-8 px-4 py-8 sm:px-6 print:max-w-none print:px-0 print:py-0">
      <header className="flex items-center gap-3">
        <Logo className="size-9" />
        <div>
          <h1 className="text-lg font-semibold tracking-tight">Eunbee’s degree plan</h1>
          <p className="text-xs text-muted-foreground">
            Georgia State University · {DEGREE.program} · catalog {DEGREE.catalogYear}
            {last ? ` · finishing after ${last.label}` : ''}
          </p>
        </div>
      </header>

      <Section n="01" title="Where things stand">
        <div className={cn('rounded-lg border p-4', a.status === 'incomplete' && 'border-destructive/40 bg-destructive/5')}>
          <div className={cn('text-base font-medium', a.status === 'incomplete' && 'text-destructive')}>{auditHeadline(a, snap.recordStatus)}</div>
          <p className="mt-1 text-sm text-muted-foreground">{statusSentence(a, snap.recordStatus)}</p>
          <div className="mt-3 flex flex-wrap gap-x-6 gap-y-1 text-xs text-muted-foreground">
            <span><span className="mono text-foreground">{fmtCredits(a.total.done)}</span> credits applied</span>
            <span><span className="mono text-foreground">+{fmtCredits(a.total.planned)}</span> planned of {a.total.required}</span>
            <span>GSU GPA <span className="mono text-foreground">{fmtGpa(s.gsu)}</span></span>
            <span>with transfer <span className="mono text-foreground">{fmtGpa(s.overall)}</span></span>
          </div>
        </div>
      </Section>

      <Section n="02" title="Degree Works requirements">
        <ul className="divide-y rounded-lg border">
          {a.blocks.map((b) => {
            const m = blockMeter(b)
            return (
              <li key={b.key} className="px-3 py-2 print-break-avoid">
                <div className="flex items-center gap-2 text-sm font-medium">
                  <AuditIcon status={b.status} />
                  {b.name}
                  <span className="mono ml-auto text-xs font-normal text-muted-foreground">{fmtCredits(m.done + m.planned + m.pending)}/{fmtCredits(m.required)} cr</span>
                </div>
                <ul className="mt-1 space-y-0.5 pl-5">
                  {b.lines.map((l) => (
                    <li key={l.id} className="flex items-center gap-2 text-xs">
                      <AuditIcon status={l.status} className="size-3" />
                      <span className="min-w-0 flex-1 truncate">{l.label}</span>
                      <span className="mono shrink-0 text-muted-foreground">{[...new Set(l.units.map((u) => u.code))].join(', ')}</span>
                    </li>
                  ))}
                </ul>
              </li>
            )
          })}
        </ul>
      </Section>

      {sched && spring && springEntries.length > 0 && (
        <Section n="03" title={`${sched.label} classes`}>
          <div className="overflow-x-auto rounded-lg border">
            <table className="w-full min-w-[32rem] text-sm">
              <thead className="bg-muted/50 text-left text-[11px] text-muted-foreground">
                <tr>
                  <th className="px-3 py-1.5 font-medium">Course</th>
                  <th className="px-3 py-1.5 font-medium">Section · CRN</th>
                  <th className="px-3 py-1.5 font-medium">When · where</th>
                  <th className="px-3 py-1.5 font-medium">Professor</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {springEntries.flatMap((e) => {
                  const c = findCourse(e.courseId)!
                  return partPicks(c, e, SCHEDULE_TERM_ID).map((p) => (
                    <tr key={p.part.codeId} className="align-top">
                      <td className="px-3 py-1.5"><span className="font-semibold">{p.part.title}</span><div className="mono text-xs text-muted-foreground">{p.part.code}</div></td>
                      <td className="mono px-3 py-1.5 text-xs">{p.picked ? `${p.picked.section} · ${p.picked.crn}` : p.sections.length ? 'not chosen' : 'not offered'}</td>
                      <td className="px-3 py-1.5 text-xs">
                        {p.picked ? (timedMeetings(p.picked).length ? timedMeetings(p.picked).map((m, i) => <div key={i}>{fmtDaysLong(m.days)} {fmtTimeRange(m.start, m.end)} · {locationText(m)}</div>) : 'No set time') : '—'}
                      </td>
                      <td className="px-3 py-1.5 text-xs">{p.picked?.instructors.map((i) => i.display).join(', ') || '—'}</td>
                    </tr>
                  ))
                })}
              </tbody>
            </table>
          </div>
          {events.length > 0 && (
            <div className="rounded-lg border p-3 print-break-avoid">
              <WeekCalendar events={events} days={days} gaps={breaksBetween(events)} />
            </div>
          )}
        </Section>
      )}

      <Section n="04" title="The plan, term by term">
        <div className="space-y-3">
          {semesters.filter((t) => (plan.schedule[t.id] || []).length).map((t) => (
            <div key={t.id} className="rounded-lg border print-break-avoid">
              <div className="flex items-baseline gap-3 border-b px-3 py-2">
                <h3 className="text-sm font-medium">{t.label}</h3>
                <span className="mono ml-auto text-xs text-muted-foreground">{fmtCredits(semesterCredits(plan.schedule, t.id))} cr</span>
              </div>
              <ul className="divide-y">
                {(plan.schedule[t.id] || []).map((e) => {
                  const c = findCourse(e.courseId)!
                  return (
                    <li key={e.courseId} className="flex items-baseline gap-2 px-3 py-1.5 text-sm">
                      <span className="min-w-0 flex-1 truncate font-medium">{c.title}</span>
                      <span className="mono shrink-0 text-xs text-muted-foreground">{c.code}</span>
                      <span className={cn('shrink-0 text-xs', CATEGORY[categoryOf(c, a.roles[c.id])].text)}>{roleShort(a.roles[c.id])}</span>
                    </li>
                  )
                })}
              </ul>
            </div>
          ))}
        </div>
      </Section>

      {record.terms.length > 0 && (
        <Section n="05" title="Completed terms">
          <div className="overflow-x-auto rounded-lg border">
            <table className="w-full min-w-[30rem] text-sm">
              <thead className="bg-muted/50 text-left text-[11px] text-muted-foreground">
                <tr>
                  <th className="px-3 py-1.5 font-medium">Term</th>
                  <th className="px-3 py-1.5 font-medium">Courses</th>
                  <th className="px-3 py-1.5 text-right font-medium">Credits</th>
                  <th className="px-3 py-1.5 text-right font-medium">GPA</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {record.terms.map((t) => {
                  const info = s.byTerm[t.id]
                  return (
                    <tr key={t.id} className="align-top">
                      <td className="px-3 py-1.5 whitespace-nowrap">{t.label}</td>
                      <td className="px-3 py-1.5 text-xs">
                        {t.courses.map((c, i) => (
                          <span key={c.id} title={c.code}>
                            {i > 0 && ' · '}
                            {c.title || c.code} <b className={cn('mono', gradeText(c.grade))}>{c.grade || '—'}</b>
                          </span>
                        ))}
                      </td>
                      <td className="mono px-3 py-1.5 text-right">{fmtCredits(info.earned)}</td>
                      <td className="mono px-3 py-1.5 text-right">{info.transferOnly ? '≈' : ''}{fmtGpa(info.termGpa)}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </Section>
      )}

      <Section n="06" title="Confirm with the advisor">
        <ol className="space-y-1.5 text-sm">
          {checklist.map((item, i) => (
            <li key={i} className={cn('flex gap-2', item.done && 'text-muted-foreground')}>
              <span className="mono w-4 shrink-0 text-right text-xs text-muted-foreground">{item.done ? '✓' : i + 1}</span>
              <span>{item.text}</span>
            </li>
          ))}
        </ol>
      </Section>

      {graded.length > 0 && (
        <Section n="07" title="GPA outlook (estimates)">
          <ul className="divide-y rounded-lg border text-sm">
            {graded.map((w) => (
              <li key={w.term.id} className="flex flex-wrap items-baseline gap-x-4 gap-y-0.5 px-3 py-1.5">
                <span className="w-28">{w.term.label}</span>
                <span>term <b className="mono">{fmtGpa(w.termGpa)}</b></span>
                <span>GSU <b className="mono">{fmtGpa(w.cumGsu)}</b></span>
                <span>with transfer <b className="mono">{fmtGpa(w.cumOverall)}</b></span>
              </li>
            ))}
          </ul>
          <p className="text-xs text-muted-foreground">From the expected grades picked in the GPA projection — GSU calculates the official GPA after grades post.</p>
        </Section>
      )}

      <Separator />
      <p className="text-[11px] leading-relaxed text-muted-foreground">
        Requirements follow Degree Works and the GSU 2024–2025 catalog. Class times and professors come from the Spring 2027 schedule; offering history is informational. Always confirm in PAWS before registering.
      </p>
    </div>
  )
}

function Section({ n, title, children }: { n: string; title: string; children: React.ReactNode }) {
  return (
    <section className="space-y-3">
      <div className="flex items-center gap-2">
        <span className="mono rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">{n}</span>
        <h2 className="text-sm font-semibold tracking-tight">{title}</h2>
      </div>
      {children}
    </section>
  )
}
