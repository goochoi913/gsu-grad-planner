#!/usr/bin/env node
/**
 * Spring 2027 class schedule → src/data/spring2027.json (TermSchedule, see src/lib/schedule-types.ts)
 *
 *   node scripts/build-schedule.mjs            fetch GSU's class search, then build
 *   node scripts/build-schedule.mjs --offline  build from data/sources/banner-202701.json only
 *   node scripts/build-schedule.mjs --live     fetch GSU's class search and write only public/live/spring2027.json
 *                                              (the deploy job's seat refresh; fails instead of falling back)
 *
 * Sources, in order of authority:
 *   1. data/sources/Spring 2027 - CSC Classes.csv and Spring 2027 - Other Classes.csv — copied from
 *      GSU's class schedule. Every section in them is kept exactly as listed.
 *   2. GSU's public class search (Banner, term 202701). It adds what the CSV lacks — fresher seat
 *      counts, waitlists, Honors / online attributes — and the sections of library courses the CSVs
 *      don't cover. When it disagrees with a CSV row, the CSV value stays and the difference is written
 *      to section.notes and data/sources/schedule-report.md.
 *
 * A compact snapshot of the class-search data is committed as data/sources/banner-202701.json, so
 * `--offline` rebuilds the same file without the network. Raw responses are cached in .cache/banner/.
 *
 * Left out: Honors sections (Honors College students only) and sections GSU lists with no seats
 * at all (capacity 0 — not open for registration). Both are listed in the report.
 *
 * `--live` is what keeps seat counts fresh: the deploy job runs it every 30 minutes in registration
 * season and publishes the result next to the app, which loads it at runtime (src/lib/live-schedule.ts).
 * It never touches src/data/, so the app's own files — and the installed PWA — stay unchanged.
 */
import fs from 'node:fs'
import path from 'node:path'
import vm from 'node:vm'
import { execFileSync } from 'node:child_process'
import { pathToFileURL } from 'node:url'

const ROOT = path.resolve(import.meta.dirname, '..')
const SOURCES = path.join(ROOT, 'data/sources')
const CSV_FILES = ['Spring 2027 - CSC Classes.csv', 'Spring 2027 - Other Classes.csv']
const CSV_META = path.join(SOURCES, 'csv-meta.json')
const SNAPSHOT = path.join(SOURCES, 'banner-202701.json')
const REPORT = path.join(SOURCES, 'schedule-report.md')
const OUT = path.join(ROOT, 'src/data/spring2027.json')
const LIVE_OUT = path.join(ROOT, 'public/live/spring2027.json')
const CACHE = path.join(ROOT, '.cache/banner')

export const TERM = {
  termId: 'spring2027',
  label: 'Spring 2027',
  bannerTerm: '202701',
  classesStart: '2027-01-11',
  classesEnd: '2027-05-04',
}

const BANNER = 'https://registration.gosolar.gsu.edu/StudentRegistrationSsb/ssb'
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0 Safari/537.36'

/** The campuses the CSVs cover. Sections elsewhere (Perimeter College, graduate online) are left out. */
const CSV_CAMPUSES = new Set(['Atlanta', 'Online - Atl US (Mand. Fees)', 'Off Campus-Tech & USG Fee only'])

/** Honors sections and courses ("HON SOFTWARE ENGINEERING", "HONORS THESIS I") are for Honors College students. */
const HONORS = /^HON\b|\bHONORS\b/i

/** Class-search attributes worth showing; the rest are degree-area codes. */
const KEEP_ATTRIBUTES = [
  /honors/i,
  /synchronous online/i,
  /asynchronous online/i,
  /hybrid/i,
  /critical thinking/i,
  /\bctw\b/i,
  /zero.*(textbook|cost)/i,
  /low.*(textbook|cost)/i,
  /signature experience/i,
  /service.learning/i,
  /study abroad/i,
]

const DAY_NAMES = {
  Monday: 'M',
  Tuesday: 'T',
  Wednesday: 'W',
  Thursday: 'Th',
  Friday: 'F',
  Saturday: 'Sa',
  Sunday: 'Su',
}
const DAY_ORDER = ['M', 'T', 'W', 'Th', 'F', 'Sa', 'Su']
const DAY_WORD = { M: 'Mon', T: 'Tue', W: 'Wed', Th: 'Thu', F: 'Fri', Sa: 'Sat', Su: 'Sun' }

/* ─── small helpers ─────────────────────────────────────────────────────── */

export function decodeEntities(s) {
  return String(s ?? '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&#039;|&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
}

const clean = (s) => decodeEntities(s).replace(/\s+/g, ' ').trim()

export function codeToId(code) {
  return String(code || '').toUpperCase().replace(/[^A-Z0-9]/g, '')
}

export function slug(s) {
  return String(s || '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

/** "02" → "2", "004" → "4" (keeps letters, e.g. "H01" stays "H01"). */
function stripZeros(s) {
  const t = String(s ?? '').trim()
  return /^\d+$/.test(t) ? String(Number(t)) : t
}

/** "MM/DD/YYYY" → "YYYY-MM-DD" */
function isoDate(mdy) {
  const m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(String(mdy || '').trim())
  return m ? `${m[3]}-${m[1].padStart(2, '0')}-${m[2].padStart(2, '0')}` : null
}

/** "02:15 PM" → "14:15" */
function to24(t) {
  const m = /^(\d{1,2}):(\d{2})\s*([AP])M$/i.exec(String(t || '').trim())
  if (!m) return null
  let h = Number(m[1]) % 12
  if (m[3].toUpperCase() === 'P') h += 12
  return `${String(h).padStart(2, '0')}:${m[2]}`
}

/** "1400" → "14:00" */
function hhmm(t) {
  const s = String(t ?? '').trim()
  return /^\d{4}$/.test(s) ? `${s.slice(0, 2)}:${s.slice(2)}` : null
}

/** "14:15" → "2:15 PM" */
export function fmt12(t) {
  if (!t) return ''
  const [h, m] = t.split(':').map(Number)
  return `${h % 12 || 12}:${String(m).padStart(2, '0')} ${h >= 12 ? 'PM' : 'AM'}`
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
function shortDate(iso) {
  const [, m, d] = iso.split('-').map(Number)
  return `${MONTHS[m - 1]} ${d}`
}

/** Course number sort key: numeric part, then '' < 'K' < 'L' so a lab follows its lecture. */
function numberKey(num) {
  const m = /^(\d+)([A-Z]*)$/.exec(num)
  return m ? [Number(m[1]), m[2]] : [Number.MAX_SAFE_INTEGER, num]
}

function compareCourses(a, b) {
  if (a.subject !== b.subject) return a.subject < b.subject ? -1 : 1
  const [na, sa] = numberKey(a.number)
  const [nb, sb] = numberKey(b.number)
  return na - nb || (sa < sb ? -1 : sa > sb ? 1 : 0)
}

function compareSections(a, b) {
  const na = Number(a.section)
  const nb = Number(b.section)
  if (Number.isFinite(na) && Number.isFinite(nb) && na !== nb) return na - nb
  return a.section.localeCompare(b.section, 'en', { numeric: true }) || a.crn.localeCompare(b.crn)
}

/* ─── CSV (RFC 4180) ────────────────────────────────────────────────────── */

export function parseCsv(text) {
  const rows = []
  let row = []
  let field = ''
  let quoted = false
  const src = text.replace(/^﻿/, '')
  for (let i = 0; i < src.length; i++) {
    const ch = src[i]
    if (quoted) {
      if (ch === '"') {
        if (src[i + 1] === '"') {
          field += '"'
          i++
        } else quoted = false
      } else field += ch
    } else if (ch === '"') quoted = true
    else if (ch === ',') {
      row.push(field)
      field = ''
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && src[i + 1] === '\n') i++
      row.push(field)
      field = ''
      if (row.some((f) => f !== '')) rows.push(row)
      row = []
    } else field += ch
  }
  if (field !== '' || row.length) {
    row.push(field)
    if (row.some((f) => f !== '')) rows.push(row)
  }
  const [header, ...body] = rows
  return body.map((r) => Object.fromEntries(header.map((h, i) => [h.trim(), (r[i] ?? '').trim()])))
}

/* ─── instructor names ──────────────────────────────────────────────────── */

/**
 * "Saghaeiannejad Esfahani, Sayed Hossein (Hossein) (Primary)" →
 *   { name: "Saghaeiannejad Esfahani, Sayed Hossein (Hossein)", display: "Hossein Saghaeiannejad Esfahani",
 *     key: "saghaeiannejad-esfahani|sayed-hossein", last, given, preferred, primary }
 * GSU lists "Last, Given (Preferred) Middle-initial"; a preferred name with a space is already a full name.
 */
export function parseInstructor(raw, primaryHint = false) {
  let s = clean(raw)
  const primary = primaryHint || /\(Primary\)/i.test(s)
  s = s
    .replace(/\(Primary\)/gi, '')
    .replace(/\s+\.(?=\s|$)/g, '')
    .replace(/\s+/g, ' ')
    .trim()
  const comma = s.indexOf(',')
  const last = (comma >= 0 ? s.slice(0, comma) : s).trim()
  const rest = comma >= 0 ? s.slice(comma + 1).trim() : ''
  const pm = /\(([^)]*)\)/.exec(rest)
  const before = (pm ? rest.slice(0, pm.index) : rest).trim()
  const givenTokens = before.split(' ').filter(Boolean)
  while (givenTokens.length > 1 && /^[A-Za-z]\.$/.test(givenTokens.at(-1))) givenTokens.pop()
  const given = givenTokens.join(' ')
  // The preferred name, minus a title ("Dr. Toppar"). When what is left is only the surname
  // ("Shahbazi, Farideh (Shahbazi)") it says nothing about the first name, so it is ignored.
  let preferred = (pm ? pm[1] : '').replace(/^(dr|prof|professor|mr|mrs|ms|mx|miss)\.?\s+/i, '').trim()
  const lastTokens = slug(last).split('-')
  const prefTokens = slug(preferred).split('-').filter(Boolean)
  if (!prefTokens.length || prefTokens.every((t) => lastTokens.includes(t))) preferred = ''
  // A preferred name that carries the surname is already a full name ("Hemanth Venkateswara").
  const display = preferred
    ? preferred.includes(' ') && prefTokens.some((t) => lastTokens.includes(t))
      ? preferred
      : `${preferred} ${last}`
    : `${given} ${last}`.trim()
  return { name: s, display, key: `${slug(last)}|${slug(given)}`, last, given, preferred, primary }
}

/* ─── meetings ──────────────────────────────────────────────────────────── */

const NO_BUILDING = new Set(['', 'online', 'not applicable', 'none', 'tba', 'n/a'])
const NO_ROOM = new Set(['', 'na', 'nappl', 'none', 'tba', 'n/a', 'online'])

function placeOf(building, room) {
  const b = clean(building)
  const r = clean(room)
  return {
    building: NO_BUILDING.has(b.toLowerCase()) ? null : b,
    room: NO_ROOM.has(r.toLowerCase()) ? null : r,
    online: b.toLowerCase() === 'online',
  }
}

const MEETING_RE =
  /^Start Date:\s*(\d{1,2}\/\d{1,2}\/\d{4})\s+End Date:\s*(\d{1,2}\/\d{1,2}\/\d{4})\s+(.*?)\s*Building:\s*(.*?)\s*Room:\s*(.*)$/

/** One "Start Date: … Building: … Room: …" segment of the CSV's meeting column. */
function parseCsvMeeting(segment) {
  const m = MEETING_RE.exec(segment.trim())
  if (!m) throw new Error(`Unrecognised meeting: ${segment}`)
  const [, sd, ed, when, building, room] = m
  let days = []
  let start = null
  let end = null
  if (!/^TBA$/i.test(when.trim())) {
    const t = /^([A-Za-z,\s]+?)\s+(\d{1,2}:\d{2}\s*[AP]M)\s*-\s*(\d{1,2}:\d{2}\s*[AP]M)$/i.exec(when.trim())
    if (!t) throw new Error(`Unrecognised meeting time: ${when}`)
    days = t[1]
      .split(',')
      .map((d) => DAY_NAMES[d.trim()])
      .filter(Boolean)
    start = to24(t[2])
    end = to24(t[3])
  }
  const place = placeOf(building, room)
  return {
    days: sortDays(days),
    start,
    end,
    building: place.building,
    room: place.room,
    startDate: isoDate(sd),
    endDate: isoDate(ed),
    online: place.online,
  }
}

function sortDays(days) {
  return [...new Set(days)].sort((a, b) => DAY_ORDER.indexOf(a) - DAY_ORDER.indexOf(b))
}

/**
 * Identical day/time/date rows that differ only by room (a class split across rooms) become one
 * meeting with both rooms, so the calendar doesn't draw a section overlapping itself.
 */
function mergeMeetings(meetings, log) {
  const out = []
  for (const m of meetings) {
    const twin = out.find(
      (o) =>
        o.days.join() === m.days.join() &&
        o.start === m.start &&
        o.end === m.end &&
        o.startDate === m.startDate &&
        o.endDate === m.endDate &&
        o.building === m.building &&
        o.online === m.online &&
        m.days.length > 0,
    )
    if (twin) {
      if (m.room && twin.room !== m.room) twin.room = twin.room ? `${twin.room} & ${m.room}` : m.room
      log?.()
    } else out.push({ ...m })
  }
  return out
}

function meetingText(m) {
  const when = m.days.length && m.start ? `${m.days.map((d) => DAY_WORD[d]).join('/')} ${fmt12(m.start)}–${fmt12(m.end)}` : 'TBA'
  const where = m.online ? 'online' : m.building ? `${m.building}${m.room ? ` ${m.room}` : ''}` : 'no room'
  return `${when}, ${where}`
}

function meetingSig(m) {
  return [m.days.join(''), m.start ?? '', m.end ?? '', m.building ?? '', m.room ?? '', m.online ? 'online' : '', m.startDate, m.endDate].join('|')
}

/* ─── sections ──────────────────────────────────────────────────────────── */

function sessionFor(meetings) {
  const starts = meetings.map((m) => m.startDate).filter(Boolean).sort()
  const ends = meetings.map((m) => m.endDate).filter(Boolean).sort()
  if (!starts.length) return null
  const start = starts[0]
  const end = ends.at(-1)
  if (start === TERM.classesStart && end === TERM.classesEnd) return null
  const mid = (Date.parse(TERM.classesStart) + Date.parse(TERM.classesEnd)) / 2
  const centre = (Date.parse(start) + Date.parse(end)) / 2
  const half = start === TERM.classesStart ? 'First half' : end === TERM.classesEnd ? 'Second half' : centre < mid ? 'First half' : 'Second half'
  return { label: `${half} (${shortDate(start)} – ${shortDate(end)})`, start, end }
}

function modeFor({ campus, meetings, attributes }) {
  const timed = meetings.filter((m) => m.days.length && m.start)
  const onlineCampus = /^online/i.test(campus)
  const attr = (re) => attributes.some((a) => re.test(a))
  // No set meeting time: online on your own schedule, or arranged with the instructor
  // (research, thesis, directed study — GSU tags many of these "Hybrid", which tells a
  // student nothing about when to show up).
  if (!timed.length) {
    return onlineCampus || meetings.some((m) => m.online) || attr(/asynchronous online/i) ? 'online-async' : 'arranged'
  }
  if (attr(/hybrid/i)) return 'hybrid'
  if (timed.some((m) => m.online) && timed.some((m) => !m.online && m.building)) return 'hybrid'
  if (timed.every((m) => m.online) || attr(/^synchronous online/i) || (onlineCampus && timed.every((m) => !m.building))) {
    return 'online-sync'
  }
  return 'in-person'
}

function parseSeats(status) {
  const t = clean(status)
  const m = /(\d+)\s+of\s+(\d+)\s+seats\s+remain/i.exec(t)
  const remaining = m ? Number(m[1]) : 0
  const capacity = m ? Number(m[2]) : 0
  return { remaining, capacity, full: /FULL/i.test(t) || remaining <= 0 }
}

function parseHours(h) {
  const t = clean(h)
  if (/^\d+(\.\d+)?$/.test(t)) return { credits: Number(t), creditsText: t }
  return { credits: null, creditsText: t }
}

/** Strip the schedule type the CSV appends to the title ("… Lecture/Supervised Laboratory"). */
function csvTitle(title, scheduleType) {
  const t = clean(title)
  const st = clean(scheduleType)
  return st && t.endsWith(` ${st}`) ? t.slice(0, -st.length - 1).trim() : t
}

function sectionFromCsv(row, file, asOf, stats) {
  const subject = clean(row.Subject).toUpperCase()
  const number = clean(row['Course Number']).toUpperCase()
  const scheduleType = clean(row['Schedule Type'])
  const segs = clean(row['Term Dates / Meeting Times / Location'])
    .split(/;\s*(?=Start Date:)/)
    .filter(Boolean)
  const meetings = mergeMeetings(segs.map(parseCsvMeeting), () =>
    stats.mergedMeetings.push(`${subject} ${number} section ${stripZeros(row.Section)} (CRN ${clean(row.CRN)})`),
  )
  const instructorRaw = clean(row.Instructor)
  const instructors = instructorRaw
    ? instructorRaw
        .split(/;\s*/)
        .filter(Boolean)
        .map((r) => parseInstructor(r))
    : []
  const seats = parseSeats(row.Status)
  const title = csvTitle(row.Title, scheduleType)
  const campus = clean(row.Campus)
  return {
    crn: clean(row.CRN),
    subject,
    number,
    code: `${subject} ${number}`,
    codeId: codeToId(`${subject}${number}`),
    section: stripZeros(row.Section),
    title,
    ...parseHours(row.Hours),
    scheduleType,
    campus,
    mode: modeFor({ campus, meetings, attributes: [] }),
    instructors: instructors.map(({ name, display, key, primary }) => ({ name, display, key, primary })),
    meetings,
    seats: { ...seats, asOf, source: 'csv' },
    waitlist: null,
    honors: HONORS.test(title),
    session: sessionFor(meetings),
    attributes: [],
    source: 'csv',
    notes: [],
    _file: file,
  }
}

/* ─── GSU class search (Banner 9) ───────────────────────────────────────── */

class Banner {
  cookies = new Map()

  header() {
    return [...this.cookies].map(([k, v]) => `${k}=${v}`).join('; ')
  }

  async call(urlPath, { method = 'GET', form } = {}) {
    const headers = {
      'user-agent': UA,
      accept: 'application/json, text/javascript, */*; q=0.01',
      'x-requested-with': 'XMLHttpRequest',
    }
    if (this.cookies.size) headers.cookie = this.header()
    let body
    if (form) {
      headers['content-type'] = 'application/x-www-form-urlencoded; charset=UTF-8'
      body = new URLSearchParams(form).toString()
    }
    const res = await fetch(`${BANNER}${urlPath}`, { method, headers, body, redirect: 'manual' })
    for (const c of res.headers.getSetCookie?.() ?? []) {
      const pair = c.split(';')[0]
      const i = pair.indexOf('=')
      if (i > 0) this.cookies.set(pair.slice(0, i).trim(), pair.slice(i + 1).trim())
    }
    const text = await res.text()
    if (res.status >= 400) throw new Error(`${method} ${urlPath} → HTTP ${res.status}`)
    return text
  }

  async open(term) {
    await this.call(`/classSearch/getTerms?searchTerm=&offset=1&max=10`)
    await this.call(`/term/search?mode=search`, {
      method: 'POST',
      form: { term, studyPath: '', studyPathText: '', startDatepicker: '', endDatepicker: '' },
    })
  }

  async subject(term, subject) {
    await this.call(`/classSearch/resetDataForm`, { method: 'POST', form: {} })
    const out = []
    let total = Infinity
    for (let offset = 0; offset < total; offset += 500) {
      const q = new URLSearchParams({
        txt_subject: subject,
        txt_term: term,
        startDatepicker: '',
        endDatepicker: '',
        pageOffset: String(offset),
        pageMaxSize: '500',
        sortColumn: 'subjectDescription',
        sortDirection: 'asc',
      })
      const text = await this.call(`/searchResults/searchResults?${q}`)
      fs.writeFileSync(path.join(CACHE, `${subject}-${offset}.json`), text)
      const json = JSON.parse(text)
      if (!json.success) throw new Error(`class search for ${subject} failed`)
      total = json.totalCount ?? 0
      const data = json.data ?? []
      out.push(...data)
      if (!data.length) break
      await sleep(400)
    }
    const wrong = out.filter((s) => s.subject !== subject || s.term !== term)
    if (wrong.length) throw new Error(`class search for ${subject} returned ${wrong.length} rows for another subject/term`)
    return { total, sections: out }
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

/** The fields this script uses, from one raw class-search row. */
function compactBanner(s) {
  return {
    crn: String(s.courseReferenceNumber),
    subject: s.subject,
    number: s.courseNumber,
    sequence: s.sequenceNumber,
    title: clean(s.courseTitle),
    campus: clean(s.campusDescription),
    scheduleType: clean(s.scheduleTypeDescription),
    /** A section can fix its own hours inside a variable course's range ("1 TO 6" → 2). */
    credits: s.creditHours ?? null,
    creditLow: s.creditHourLow ?? null,
    creditHigh: s.creditHourHigh ?? null,
    capacity: s.maximumEnrollment ?? 0,
    enrolled: s.enrollment ?? 0,
    seatsAvailable: s.seatsAvailable ?? 0,
    open: !!s.openSection,
    waitCapacity: s.waitCapacity ?? 0,
    waitCount: s.waitCount ?? 0,
    waitAvailable: s.waitAvailable ?? 0,
    linked: !!s.isSectionLinked,
    linkIdentifier: s.linkIdentifier ?? null,
    partOfTerm: s.partOfTerm ?? null,
    instructionalMethod: clean(s.instructionalMethodDescription ?? ''),
    faculty: (s.faculty ?? []).map((f) => ({ name: clean(f.displayName), primary: !!f.primaryIndicator })),
    meetings: (s.meetingsFaculty ?? []).map((mf) => {
      const t = mf.meetingTime ?? {}
      return {
        days: DAY_ORDER.filter((d, i) => t[['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'][i]]),
        start: hhmm(t.beginTime),
        end: hhmm(t.endTime),
        building: clean(t.buildingDescription ?? t.building ?? ''),
        buildingCode: clean(t.building ?? ''),
        room: clean(t.room ?? ''),
        startDate: isoDate(t.startDate),
        endDate: isoDate(t.endDate),
        type: clean(t.meetingTypeDescription ?? ''),
      }
    }),
    attributes: keptAttributes((s.sectionAttributes ?? []).map((a) => clean(a.description))),
  }
}

function bannerMeetings(b) {
  const raw = b.meetings.map((m) => {
    const online = /^online$/i.test(m.building) || /^online$/i.test(m.buildingCode)
    const place = placeOf(online ? 'Online' : m.building, m.room)
    return {
      days: sortDays(m.days),
      start: m.days.length ? m.start : null,
      end: m.days.length ? m.end : null,
      building: place.building,
      room: place.room,
      startDate: m.startDate,
      endDate: m.endDate,
      online: place.online,
    }
  })
  return { meetings: mergeMeetings(raw) }
}

const keptAttributes = (attrs) => [...new Set(attrs.filter((a) => KEEP_ATTRIBUTES.some((re) => re.test(a))))].sort()

/** Section hours: the section's own fixed value, else the course's (possibly variable) range. */
function bannerCredits(b) {
  if (b.credits != null) return { credits: b.credits, creditsText: String(b.credits) }
  if (b.creditHigh != null && b.creditHigh !== b.creditLow) return { credits: null, creditsText: `${b.creditLow} TO ${b.creditHigh}` }
  return { credits: b.creditLow, creditsText: String(b.creditLow) }
}

function sectionFromBanner(b, asOf) {
  const { meetings } = bannerMeetings(b)
  const attributes = keptAttributes(b.attributes)
  const { credits, creditsText } = bannerCredits(b)
  return {
    crn: b.crn,
    subject: b.subject,
    number: b.number,
    code: `${b.subject} ${b.number}`,
    codeId: codeToId(`${b.subject}${b.number}`),
    section: stripZeros(b.sequence),
    title: b.title,
    credits,
    creditsText,
    scheduleType: b.scheduleType,
    campus: b.campus,
    mode: modeFor({ campus: b.campus, meetings, attributes }),
    instructors: b.faculty.map((f) => {
      const p = parseInstructor(f.name, f.primary)
      return { name: p.name, display: p.display, key: p.key, primary: f.primary }
    }),
    meetings,
    seats: {
      remaining: Math.max(0, b.seatsAvailable),
      capacity: b.capacity,
      full: !b.open || b.seatsAvailable <= 0,
      asOf,
      source: 'banner',
    },
    waitlist: b.waitCapacity > 0 ? { capacity: b.waitCapacity, count: b.waitCount, remaining: b.waitAvailable } : null,
    honors: HONORS.test(b.title) || attributes.some((a) => /honors/i.test(a)),
    session: sessionFor(meetings),
    attributes,
    source: 'banner',
    notes: ["Not in your CSV — listed on GSU's class search"],
  }
}

/* ─── library courses (the planner's COURSES) ───────────────────────────── */

async function loadLibrary() {
  const pick = (COURSES, from) => {
    const codes = new Set()
    for (const c of COURSES) {
      codes.add(codeToId(c.id))
      for (const p of c.parts ?? []) codes.add(codeToId(p.code))
      for (const a of c.aliases ?? []) codes.add(codeToId(a))
    }
    return { codes, from }
  }
  try {
    const mod = await import(pathToFileURL(path.join(ROOT, 'src/data/degree.ts')).href)
    if (Array.isArray(mod.COURSES) && mod.COURSES.length) return pick(mod.COURSES, 'src/data/degree.ts')
  } catch {
    /* not there yet, or not loadable without the bundler — try the original data file */
  }
  const runDataJs = (text, from) => {
    const ctx = vm.createContext({})
    vm.runInContext(`${text}\n;globalThis.__COURSES = COURSES;`, ctx)
    return pick(ctx.__COURSES, from)
  }
  const file = path.join(ROOT, 'js/data.js')
  if (fs.existsSync(file)) return runDataJs(fs.readFileSync(file, 'utf8'), 'js/data.js')
  const text = execFileSync('git', ['show', 'HEAD:js/data.js'], { cwd: ROOT, encoding: 'utf8' })
  return runDataJs(text, 'git HEAD:js/data.js')
}

/* ─── comparison (CSV ↔ class search) ───────────────────────────────────── */

function compare(sec, b) {
  const diffs = []
  const { meetings } = bannerMeetings(b)
  const csvSigs = sec.meetings.map(meetingSig).sort().join(' ; ')
  const banSigs = meetings.map(meetingSig).sort().join(' ; ')
  if (csvSigs !== banSigs) {
    diffs.push({
      field: 'meetings',
      csv: sec.meetings.map(meetingText).join('; '),
      banner: meetings.map(meetingText).join('; '),
      note: `GSU's class search now lists ${meetings.map(meetingText).join('; ') || 'no meetings'} (CSV: ${sec.meetings.map(meetingText).join('; ') || 'none'}).`,
    })
  }
  const csvKeys = sec.instructors.map((i) => i.key).sort().join(', ')
  const banInstr = b.faculty.map((f) => parseInstructor(f.name, f.primary))
  const banKeys = banInstr.map((i) => i.key).sort().join(', ')
  if (csvKeys !== banKeys) {
    const names = (list) => list.map((i) => i.display).join(' & ') || 'no instructor'
    diffs.push({
      field: 'instructor',
      csv: names(sec.instructors),
      banner: names(banInstr),
      note: `GSU's class search now lists ${banInstr.length ? `the instructor as ${names(banInstr)}` : 'no instructor'} (CSV: ${names(sec.instructors)}).`,
    })
  }
  const banCredits = bannerCredits(b).creditsText
  if (banCredits !== sec.creditsText) {
    diffs.push({
      field: 'credits',
      csv: sec.creditsText,
      banner: banCredits,
      note: `GSU's class search now lists ${banCredits} credit hours (CSV: ${sec.creditsText}).`,
    })
  }
  if (b.title !== sec.title) {
    diffs.push({ field: 'title', csv: sec.title, banner: b.title, note: `GSU's class search now titles it “${b.title}” (CSV: “${sec.title}”).` })
  }
  if (b.campus !== sec.campus) {
    diffs.push({ field: 'campus', csv: sec.campus, banner: b.campus, note: `GSU's class search now lists the campus as ${b.campus} (CSV: ${sec.campus}).` })
  }
  if (b.scheduleType !== sec.scheduleType) {
    diffs.push({
      field: 'schedule type',
      csv: sec.scheduleType,
      banner: b.scheduleType,
      note: `GSU's class search now lists it as ${b.scheduleType} (CSV: ${sec.scheduleType}).`,
    })
  }
  return diffs
}

/* ─── main ──────────────────────────────────────────────────────────────── */

function csvCopiedAt() {
  let meta = {}
  if (fs.existsSync(CSV_META)) meta = JSON.parse(fs.readFileSync(CSV_META, 'utf8'))
  let changed = false
  for (const file of CSV_FILES) {
    if (meta[file]) continue
    const t = fs.statSync(path.join(SOURCES, file)).mtime
    meta[file] = localIso(t)
    changed = true
  }
  if (changed) {
    meta._comment = 'When each CSV was copied from GSU (the file’s modified time on first build). Seat counts from a CSV are as of this time.'
    fs.writeFileSync(CSV_META, `${JSON.stringify(meta, null, 2)}\n`)
  }
  return meta
}

/** ISO timestamp with the local UTC offset: "2026-10-12T09:28:15-04:00". */
function localIso(d) {
  const off = -d.getTimezoneOffset()
  const sign = off >= 0 ? '+' : '-'
  const pad = (n) => String(Math.floor(Math.abs(n))).padStart(2, '0')
  const local = new Date(d.getTime() + off * 60000).toISOString().slice(0, 19)
  return `${local}${sign}${pad(off / 60)}:${pad(off % 60)}`
}

/** `--cache`: rebuild from the raw responses in .cache/banner/ without the network. */
function readBannerCache(subjects) {
  const all = []
  const totals = {}
  let newest = 0
  for (const subject of subjects) {
    const files = fs
      .readdirSync(CACHE)
      .filter((f) => f.startsWith(`${subject}-`) && f.endsWith('.json'))
      .sort((a, b) => Number(a.slice(subject.length + 1, -5)) - Number(b.slice(subject.length + 1, -5)))
    if (!files.length) throw new Error(`no cached class search for ${subject}`)
    for (const f of files) {
      const json = JSON.parse(fs.readFileSync(path.join(CACHE, f), 'utf8'))
      totals[subject] = json.totalCount ?? 0
      all.push(...(json.data ?? []))
      newest = Math.max(newest, fs.statSync(path.join(CACHE, f)).mtimeMs)
    }
  }
  return { fetchedAt: localIso(new Date(newest)), totals, sections: all }
}

async function fetchBanner(subjects) {
  if (process.argv.includes('--cache')) return readBannerCache(subjects)
  fs.mkdirSync(CACHE, { recursive: true })
  const client = new Banner()
  await client.open(TERM.bannerTerm)
  const all = []
  const totals = {}
  for (const subject of subjects) {
    const { total, sections } = await client.subject(TERM.bannerTerm, subject)
    totals[subject] = total
    all.push(...sections)
    console.log(`  class search ${subject}: ${sections.length} sections`)
    await sleep(400)
  }
  return { fetchedAt: localIso(new Date()), totals, sections: all }
}

/** Sections she can't register for: Honors College only, or no seats offered at all. */
function leftOutReason(s) {
  if (s.honors) return 'Honors'
  if (s.seats.capacity === 0) return 'no seats offered (capacity 0)'
  return null
}

async function main() {
  const live = process.argv.includes('--live')
  const offline = !live && process.argv.includes('--offline')
  const stats = { mergedMeetings: [] }

  /* 1. the CSVs */
  const copied = csvCopiedAt()
  const csvSections = []
  const csvSources = []
  for (const file of CSV_FILES) {
    const rows = parseCsv(fs.readFileSync(path.join(SOURCES, file), 'utf8'))
    csvSources.push({ file: `data/sources/${file}`, rows: rows.length })
    for (const row of rows) csvSections.push(sectionFromCsv(row, file, copied[file], stats))
  }
  const dupCrn = csvSections.map((s) => s.crn).filter((c, i, a) => a.indexOf(c) !== i)
  if (dupCrn.length) throw new Error(`Duplicate CRNs in the CSVs: ${dupCrn.join(', ')}`)
  const csvSubjects = [...new Set(csvSections.map((s) => s.subject))]
  const csvCodes = new Set(csvSections.map((s) => s.codeId))

  /* 2. the library's course codes (lecture, lab parts, K aliases) */
  const library = await loadLibrary()
  const libSubjects = [...new Set([...library.codes].map((c) => /^[A-Z]+/.exec(c)[0]))]
  const subjects = [...new Set([...csvSubjects, ...libSubjects])].sort()

  /* 3. GSU's class search: fetch, or reuse the committed snapshot */
  let snapshot = null
  if (!offline) {
    try {
      console.log(`Fetching GSU class search (term ${TERM.bannerTerm}) for ${subjects.join(', ')}…`)
      const fetched = await fetchBanner(subjects)
      // Keep only what the build can use: CSV CRNs, every section of a CSV or library course,
      // and undergraduate CSC.
      const csvCrns = new Set(csvSections.map((s) => s.crn))
      // Sections on other campuses are only counted in the report, so they keep just their ids.
      const relevant = fetched.sections
        .map(compactBanner)
        .filter((b) => {
          const id = codeToId(`${b.subject}${b.number}`)
          return csvCrns.has(b.crn) || csvCodes.has(id) || library.codes.has(id) || (b.subject === 'CSC' && parseInt(b.number, 10) < 5000)
        })
        .map((b) => (csvCrns.has(b.crn) || CSV_CAMPUSES.has(b.campus) ? b : { crn: b.crn, subject: b.subject, number: b.number, sequence: b.sequence, campus: b.campus }))
      relevant.sort((a, b) => compareCourses(a, b) || Number(a.sequence) - Number(b.sequence) || a.crn.localeCompare(b.crn))
      snapshot = {
        _comment: "Compact copy of GSU's public class search (Banner) for Spring 2027, written by scripts/build-schedule.mjs. Only the sections and fields the build uses.",
        term: TERM.bannerTerm,
        fetchedAt: fetched.fetchedAt,
        subjects,
        totals: fetched.totals,
        sections: relevant,
      }
      // One section per line: small, and a refresh diffs readably.
      const { sections: rows, ...head } = snapshot
      const headJson = JSON.stringify(head, null, 1).replace(/\n}$/, '')
      if (!live) fs.writeFileSync(SNAPSHOT, `${headJson},\n "sections": [\n${rows.map((r) => `  ${JSON.stringify(r)}`).join(',\n')}\n ]\n}\n`)
    } catch (err) {
      if (live) throw new Error(`class search unavailable (${err.message}) — no live file written`)
      console.warn(`! Class search unavailable (${err.message}) — using the committed snapshot.`)
    }
  }
  if (!snapshot && fs.existsSync(SNAPSHOT)) snapshot = JSON.parse(fs.readFileSync(SNAPSHOT, 'utf8'))
  if (!snapshot) console.warn('! No class-search data: building from the CSVs alone.')

  /* 4. merge */
  const byCrn = new Map((snapshot?.sections ?? []).map((b) => [b.crn, b]))
  const discrepancies = []
  const seatChanges = []
  const missingFromBanner = []
  let checked = 0
  for (const sec of csvSections) {
    const b = byCrn.get(sec.crn)
    if (!b) {
      if (snapshot) {
        missingFromBanner.push(sec)
        sec.notes.push(`Not found on GSU's class search on ${shortDate(snapshot.fetchedAt.slice(0, 10))} — check PAWS; it may have been cancelled or renumbered.`)
      }
      continue
    }
    checked++
    if (b.subject !== sec.subject || b.number !== sec.number || stripZeros(b.sequence) !== sec.section) {
      const d = { field: 'course/section', csv: `${sec.code}-${sec.section}`, banner: `${b.subject} ${b.number}-${stripZeros(b.sequence)}` }
      d.note = `GSU's class search lists CRN ${sec.crn} as ${d.banner} (CSV: ${d.csv}).`
      discrepancies.push({ sec, ...d })
      sec.notes.push(d.note)
    }
    for (const d of compare(sec, b)) {
      discrepancies.push({ sec, ...d })
      sec.notes.push(d.note)
    }
    const remaining = Math.max(0, b.seatsAvailable)
    if (remaining !== sec.seats.remaining || b.capacity !== sec.seats.capacity) {
      seatChanges.push({ sec, csv: `${sec.seats.remaining}/${sec.seats.capacity}`, banner: `${remaining}/${b.capacity}` })
    }
    sec.seats = { remaining, capacity: b.capacity, full: !b.open || b.seatsAvailable <= 0, asOf: snapshot.fetchedAt, source: 'banner' }
    sec.waitlist = b.waitCapacity > 0 ? { capacity: b.waitCapacity, count: b.waitCount, remaining: b.waitAvailable } : null
    sec.attributes = keptAttributes(b.attributes)
    sec.honors = sec.honors || sec.attributes.some((a) => /honors/i.test(a))
    sec.mode = modeFor({ campus: sec.campus, meetings: sec.meetings, attributes: sec.attributes })
    if (b.linked) sec.notes.push(`GSU links this section to others (link ${b.linkIdentifier}) — PAWS may require registering for them together.`)
  }

  /* 5. sections to add from the class search */
  const added = []
  const notAddedOther = []
  if (snapshot) {
    const csvCrns = new Set(csvSections.map((s) => s.crn))
    for (const b of snapshot.sections) {
      if (csvCrns.has(b.crn) || !CSV_CAMPUSES.has(b.campus)) continue
      const id = codeToId(`${b.subject}${b.number}`)
      const cscUndergrad = b.subject === 'CSC' && parseInt(b.number, 10) < 5000
      const libraryGap = library.codes.has(id) && !csvCodes.has(id)
      if (cscUndergrad || libraryGap) added.push(sectionFromBanner(b, snapshot.fetchedAt))
      else if (csvCodes.has(id)) notAddedOther.push(b)
    }
  }

  /* 6. assemble — without the sections she can't register for */
  const leftOut = []
  const sections = [...csvSections, ...added]
    .filter((s) => {
      const why = leftOutReason(s)
      if (why) leftOut.push({ sec: s, why })
      return !why
    })
    .map((s) => {
      const { _file, ...rest } = s
      return rest
    })
  const courses = new Map()
  for (const s of sections) {
    if (!courses.has(s.codeId)) courses.set(s.codeId, { subject: s.subject, number: s.number, code: s.code, codeId: s.codeId, title: '', sections: [] })
    courses.get(s.codeId).sections.push(s)
  }
  const list = [...courses.values()].sort(compareCourses)
  for (const c of list) {
    c.sections.sort(compareSections)
    c.title = c.sections[0].title
  }

  const out = {
    ...TERM,
    generatedAt: localIso(new Date()),
    sources: {
      csv: csvSources,
      banner: snapshot ? { fetchedAt: snapshot.fetchedAt, subjects: snapshot.subjects, added: added.length, checked } : null,
    },
    courses: list,
  }
  if (live) {
    fs.mkdirSync(path.dirname(LIVE_OUT), { recursive: true })
    fs.writeFileSync(LIVE_OUT, JSON.stringify(out))
    console.log(`Wrote ${path.relative(ROOT, LIVE_OUT)}: ${list.length} courses, ${sections.length} sections, seats as of ${snapshot.fetchedAt}`)
    return
  }
  fs.mkdirSync(path.dirname(OUT), { recursive: true })
  fs.writeFileSync(OUT, `${JSON.stringify(out, null, 1)}\n`)

  writeReport({ out, csvSections, added, discrepancies, seatChanges, missingFromBanner, notAddedOther, stats, library, snapshot, copied, leftOut })

  const bySubject = (arr) =>
    Object.entries(arr.reduce((m, s) => ((m[s.subject] = (m[s.subject] ?? 0) + 1), m), {}))
      .map(([k, v]) => `${k} ${v}`)
      .join(', ')
  console.log(`\nWrote ${path.relative(ROOT, OUT)}: ${list.length} courses, ${sections.length} sections`)
  console.log(`  from the CSVs: ${csvSections.length} (${bySubject(csvSections)})`)
  console.log(`  added from GSU's class search: ${added.length} (${bySubject(added) || 'none'})`)
  console.log(`  left out (Honors, or no seats offered): ${leftOut.length}${leftOut.length ? ` — ${leftOut.map(({ sec }) => `${sec.code}-${sec.section}`).join(', ')}` : ''}`)
  console.log(`  CSV CRNs checked against the class search: ${checked}/${csvSections.length}; discrepancies: ${discrepancies.length}; seat changes: ${seatChanges.length}`)
  console.log(`  library courses read from ${library.from}`)
  console.log(`Report: ${path.relative(ROOT, REPORT)}`)
}

/* ─── report ────────────────────────────────────────────────────────────── */

function writeReport({ out, csvSections, added, discrepancies, seatChanges, missingFromBanner, notAddedOther, stats, library, snapshot, copied, leftOut }) {
  const L = []
  const tag = (s) => `${s.code}-${s.section} (CRN ${s.crn})`
  const all = out.courses.flatMap((c) => c.sections)
  L.push(`# Spring 2027 class schedule — build report`, '')
  L.push(`Generated ${out.generatedAt} by \`scripts/build-schedule.mjs\`.`, '')
  L.push(`## Sources`, '')
  for (const s of out.sources.csv) L.push(`- \`${s.file}\` — ${s.rows} sections (copied ${copied[path.basename(s.file)]})`)
  if (snapshot) {
    L.push(`- GSU class search (term ${out.bannerTerm}), fetched ${snapshot.fetchedAt} — subjects ${snapshot.subjects.join(', ')}`)
    L.push(`  - sections listed per subject: ${Object.entries(snapshot.totals ?? {}).map(([k, v]) => `${k} ${v}`).join(', ')}`)
  } else L.push(`- GSU class search: not available for this build`)
  L.push('')
  L.push(`## Counts`, '')
  L.push(`- Courses: ${out.courses.length}; sections: ${all.length}`)
  L.push(`- From the CSVs: ${csvSections.length}; added from the class search: ${added.length}; left out: ${leftOut.length}`)
  const subj = {}
  for (const s of all) {
    subj[s.subject] ??= { csv: 0, banner: 0 }
    subj[s.subject][s.source]++
  }
  L.push('', '| Subject | From CSV | Added from class search |', '|---|---:|---:|')
  for (const [k, v] of Object.entries(subj).sort()) L.push(`| ${k} | ${v.csv} | ${v.banner} |`)
  L.push('')
  if (snapshot) L.push(`- CSV CRNs found on the class search: ${out.sources.banner.checked} of ${csvSections.length}`, '')

  L.push(`## Left out`, '')
  if (!leftOut.length) L.push('Nothing.')
  else {
    L.push('Sections she can’t register for are not in the app:', '')
    for (const { sec, why } of leftOut) L.push(`- ${tag(sec)} — ${why} · ${sec.instructors.map((i) => i.display).join(' & ') || 'no instructor listed'} · ${sec.meetings.map(meetingText).join('; ') || 'no meetings'}`)
  }
  L.push('')

  L.push(`## CSV ↔ class search differences`, '')
  if (!snapshot) L.push('Not checked (no class-search data).')
  else if (!discrepancies.length && !missingFromBanner.length) L.push('None — every CSV section matches GSU’s class search (instructor, meeting days/times, rooms, credits, title, campus, schedule type).')
  else {
    if (discrepancies.length) {
      L.push('The CSV value is kept; each difference is also shown on the section in the app.', '')
      L.push('| Section | Field | CSV | Class search |', '|---|---|---|---|')
      for (const d of discrepancies) L.push(`| ${tag(d.sec)} | ${d.field} | ${d.csv} | ${d.banner} |`)
      L.push('')
    }
    for (const s of missingFromBanner) L.push(`- ${tag(s)}: not found on the class search`)
  }
  L.push('')

  L.push(`## Seat counts`, '')
  if (!snapshot) L.push('CSV seat counts are used.')
  else {
    L.push(`Seat counts come from the class search (fresher than the CSV copy). ${seatChanges.length ? `${seatChanges.length} changed since the CSV was copied:` : 'None changed since the CSV was copied.'}`, '')
    for (const c of seatChanges) L.push(`- ${tag(c.sec)}: ${c.csv} → ${c.banner} (remaining/capacity)`)
  }
  L.push('')

  L.push(`## Sections added from GSU's class search`, '')
  if (!added.length) L.push('None.')
  else {
    const byCourse = new Map()
    for (const s of added) {
      if (!byCourse.has(s.code)) byCourse.set(s.code, [])
      byCourse.get(s.code).push(s)
    }
    for (const [code, list] of [...byCourse].sort(([a], [b]) => compareCourses(parseCode(a), parseCode(b)))) {
      L.push(`### ${code} — ${list[0].title}`, '')
      for (const s of list.sort(compareSections)) {
        L.push(
          `- Section ${s.section}, CRN ${s.crn}: ${s.instructors.map((i) => i.display).join(' & ') || 'no instructor listed'} · ${s.meetings.map(meetingText).join('; ') || 'no meetings'} · ${s.campus} · ${s.seats.remaining}/${s.seats.capacity} seats${s.honors ? ' · Honors' : ''}${s.session ? ` · ${s.session.label}` : ''}`,
        )
      }
      L.push('')
    }
  }

  if (notAddedOther.length) {
    L.push(`## Not added: more sections of non-CSC courses already in the CSV`, '')
    L.push('The CSV is the main source for these courses, so these class-search sections (same campuses) were not added:', '')
    const byCourse = new Map()
    for (const b of notAddedOther) {
      const code = `${b.subject} ${b.number}`
      byCourse.set(code, [...(byCourse.get(code) ?? []), b])
    }
    for (const [code, list] of byCourse) {
      L.push(`- ${code}: ${list.length} — ${list.map((b) => `sec ${stripZeros(b.sequence)} (CRN ${b.crn}, ${b.campus})`).join(', ')}`)
    }
    L.push('')
  }

  if (snapshot) {
    const csvIds = new Set(csvSections.map((s) => s.codeId))
    const addedIds = new Set(added.map((s) => s.codeId))
    const pretty = (id) => id.replace(/^([A-Z]+)(\d)/, '$1 $2')
    const elsewhere = []
    const none = []
    for (const id of [...library.codes].sort()) {
      if (csvIds.has(id) || addedIds.has(id)) continue
      const other = snapshot.sections.filter((b) => codeToId(`${b.subject}${b.number}`) === id)
      if (other.length) elsewhere.push(`${pretty(id)} (only: ${[...new Set(other.map((b) => b.campus))].join(', ')})`)
      else none.push(pretty(id))
    }
    L.push(`## Library courses with no Spring 2027 section here`, '')
    if (elsewhere.length) {
      L.push(`- Only on campuses outside the CSVs' (Perimeter College, its "Online" consortium campus, or graduate online), so not added: ${elsewhere.join('; ')}`)
    }
    L.push(`- Not on GSU's class search for Spring 2027 at all: ${none.join(', ') || 'none'}`, '')
  }

  L.push(`## Worth knowing`, '')
  const full = all.filter((s) => s.seats.full)
  if (full.length) L.push(`- Full sections: ${full.map((s) => `${tag(s)} ${s.seats.remaining}/${s.seats.capacity}`).join('; ')}`)
  const half = all.filter((s) => s.session)
  if (half.length) L.push(`- Part-of-term sections: ${half.map((s) => `${tag(s)} ${s.session.label}`).join('; ')}`)
  const variable = all.filter((s) => s.credits == null)
  if (variable.length) L.push(`- Variable credit hours: ${variable.map((s) => `${tag(s)} ${s.creditsText}`).join('; ')}`)
  const tiny = all.filter((s) => s.seats.capacity > 0 && s.seats.capacity <= 5 && s.mode !== 'arranged')
  if (tiny.length) {
    L.push(
      `- Very small scheduled sections (≤5 seats — often reserved or cross-listed): ${tiny
        .map((s) => `${tag(s)} ${s.seats.capacity} seats, ${s.meetings.map(meetingText).join('; ')}`)
        .join('; ')}`,
    )
  }
  const short = all.filter((s) => s.meetings.some((m) => m.start && m.end && minutes(m.end) - minutes(m.start) < 50 && s.credits >= 3 && m.days.length <= 2))
  if (short.length) {
    L.push(
      `- Unusually short meetings for the credit hours: ${short.map((s) => `${tag(s)} ${s.credits} cr, ${s.meetings.map(meetingText).join('; ')}`).join('; ')}`,
    )
  }
  const noRoom = all.filter((s) => s.meetings.some((m) => m.start && !m.building && !m.online))
  if (noRoom.length) L.push(`- Timed meetings with no building listed: ${noRoom.map((s) => `${tag(s)} ${s.meetings.map(meetingText).join('; ')}`).join('; ')}`)
  if (stats.mergedMeetings.length) L.push(`- Same day and time listed in two rooms, merged into one meeting: ${[...new Set(stats.mergedMeetings)].join('; ')}`)
  const noInstr = all.filter((s) => !s.instructors.length && !/laboratory$/i.test(s.scheduleType) && s.scheduleType !== 'Supervised Laboratory')
  if (noInstr.length) L.push(`- No instructor listed (not a lab): ${noInstr.map(tag).join('; ')}`)
  const linked = all.filter((s) => s.notes.some((n) => /links this section/.test(n)))
  if (linked.length) L.push(`- Linked sections: ${linked.map(tag).join('; ')}`)
  L.push('')
  fs.writeFileSync(REPORT, `${L.join('\n')}\n`)
}

function parseCode(code) {
  const [subject, number] = code.split(' ')
  return { subject, number }
}

function minutes(t) {
  const [h, m] = t.split(':').map(Number)
  return h * 60 + m
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  main().catch((err) => {
    console.error(err)
    process.exit(1)
  })
}
