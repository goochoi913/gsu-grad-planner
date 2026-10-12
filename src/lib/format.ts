/** Small formatting helpers shared by the views. */

export function genId(prefix = ''): string {
  return `${prefix}${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`
}

/** "14:30" → 870 */
export function timeToMin(t: string | null | undefined): number {
  if (!t) return 0
  const [h, m] = t.split(':').map(Number)
  return h * 60 + m
}

/** "14:30" → "2:30 PM" */
export function fmtTime(t: string | null | undefined): string {
  if (!t) return ''
  const [h, m] = t.split(':').map(Number)
  return `${h % 12 || 12}:${m.toString().padStart(2, '0')} ${h >= 12 ? 'PM' : 'AM'}`
}

/** "14:30" → "2:30" and the meridiem separately, for compact ranges: "2:30–3:45 PM". */
export function fmtTimeRange(start: string | null | undefined, end: string | null | undefined): string {
  if (!start || !end) return ''
  const s = fmtTime(start), e = fmtTime(end)
  const sm = s.slice(-2), em = e.slice(-2)
  return sm === em ? `${s.slice(0, -3)}–${e}` : `${s}–${e}`
}

/** "14:00" → "2 PM", "14:30" → "2:30" — for calendar hour labels. */
export function fmtHour(h: number): string {
  return h === 12 ? '12 PM' : h > 12 ? `${h - 12} PM` : h === 0 ? '12 AM' : `${h} AM`
}

export const DAY_NAMES: Record<string, { short: string; long: string; letter: string }> = {
  M: { short: 'Mon', long: 'Monday', letter: 'M' },
  T: { short: 'Tue', long: 'Tuesday', letter: 'T' },
  W: { short: 'Wed', long: 'Wednesday', letter: 'W' },
  Th: { short: 'Thu', long: 'Thursday', letter: 'Th' },
  F: { short: 'Fri', long: 'Friday', letter: 'F' },
  Sa: { short: 'Sat', long: 'Saturday', letter: 'Sa' },
  Su: { short: 'Sun', long: 'Sunday', letter: 'Su' },
}

/** ["M","W"] → "MW", ["T","Th"] → "TTh" */
export function fmtDays(days: string[] | null | undefined): string {
  return days?.length ? days.join('') : ''
}

/** ["M","W"] → "Mon & Wed", ["T","Th"] → "Tue & Thu", three or more → "Mon, Wed, Fri" */
export function fmtDaysLong(days: string[]): string {
  const names = days.map((d) => DAY_NAMES[d]?.short ?? d)
  return names.length === 2 ? `${names[0]} & ${names[1]}` : names.join(', ')
}

/** "2027-01-11" → "Jan 11" */
export function fmtShortDate(iso: string): string {
  const [y, m, d] = iso.split('-').map(Number)
  return new Date(y, m - 1, d).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

/** An ISO timestamp → "Oct 12, 2026" */
export function fmtDate(iso: string | number | Date): string {
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

export function clone<T>(v: T): T {
  return JSON.parse(JSON.stringify(v)) as T
}

export function plural(n: number, one: string, many = `${one}s`): string {
  return `${n} ${n === 1 ? one : many}`
}
