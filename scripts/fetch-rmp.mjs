#!/usr/bin/env node
/**
 * RateMyProfessors ratings for every Spring 2027 instructor → src/data/professors.json
 * (ProfessorsFile, see src/lib/schedule-types.ts)
 *
 *   node scripts/fetch-rmp.mjs            ask RMP (responses cached in .cache/rmp/)
 *   node scripts/fetch-rmp.mjs --offline  use the cache only
 *
 * RMP can't be called from the browser (no CORS), so the ratings ship with the app as a dated
 * snapshot; rerun this script to refresh them. Run scripts/build-schedule.mjs first — the
 * instructor list comes from src/data/spring2027.json.
 *
 * Matching is deliberately conservative: showing another professor's rating would mislead.
 * A profile is used only when the last name matches AND the first name matches the given or the
 * preferred name, at Georgia State (school 360). Several such profiles → the department that fits
 * the subject decides; still several → 'ambiguous', no rating. Corrections go in
 * data/sources/rmp-overrides.json: { "<professor key>": <RMP legacyId> | null }.
 */
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { parseInstructor } from './build-schedule.mjs'

const ROOT = path.resolve(import.meta.dirname, '..')
const SCHEDULE = path.join(ROOT, 'src/data/spring2027.json')
const OUT = path.join(ROOT, 'src/data/professors.json')
const OVERRIDES = path.join(ROOT, 'data/sources/rmp-overrides.json')
const REPORT = path.join(ROOT, 'data/sources/rmp-report.md')
const CACHE = path.join(ROOT, '.cache/rmp')

const SCHOOL = { id: 'U2Nob29sLTM2MA==', legacyId: 360, name: 'Georgia State University' }
const ENDPOINT = 'https://www.ratemyprofessors.com/graphql'
// RMP's own web client sends this public basic-auth header.
const HEADERS = {
  'content-type': 'application/json',
  authorization: 'Basic dGVzdDp0ZXN0',
  'user-agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0 Safari/537.36',
}
const OFFLINE = process.argv.includes('--offline')

const TEACHER_FIELDS = 'id legacyId firstName lastName department avgRating avgDifficulty numRatings wouldTakeAgainPercent school { legacyId name }'
const SEARCH = `query Search($text: String!, $schoolID: ID!) {
  newSearch { teachers(query: { text: $text, schoolID: $schoolID }, first: 20) { edges { node { ${TEACHER_FIELDS} } } } }
}`
const TEACHER = `query Teacher($id: ID!, $after: String) {
  node(id: $id) { ... on Teacher { ${TEACHER_FIELDS}
    ratings(first: 1000, after: $after) { edges { node { ratingTags class } } pageInfo { hasNextPage endCursor } } } }
}`

/** Subject → the RMP department(s) that fit it. */
const DEPARTMENTS = {
  CSC: /computer science/i,
  MATH: /math|statistic/i,
  PHYS: /physics|astronomy/i,
  ASTR: /astronomy|physics/i,
  ECON: /econ/i,
  ACCT: /accounting/i,
  BIOL: /biolog|science/i,
  CHEM: /chem/i,
  GEOL: /geo|earth/i,
  SCOM: /communication|speech|journalism|media|film/i,
  PHIL: /philosophy/i,
  JAPN: /japanese|language|asian/i,
  PERS: /.*/,
}

/* ─── network, cached ───────────────────────────────────────────────────── */

let lastCall = 0
async function gql(query, variables) {
  const key = crypto.createHash('sha1').update(JSON.stringify({ query, variables })).digest('hex')
  const file = path.join(CACHE, `${key}.json`)
  if (fs.existsSync(file)) return JSON.parse(fs.readFileSync(file, 'utf8'))
  if (OFFLINE) throw new Error(`not cached (offline): ${JSON.stringify(variables)}`)
  const wait = lastCall + 400 - Date.now()
  if (wait > 0) await new Promise((r) => setTimeout(r, wait))
  lastCall = Date.now()
  const res = await fetch(ENDPOINT, { method: 'POST', headers: HEADERS, body: JSON.stringify({ query, variables }) })
  if (!res.ok) throw new Error(`RMP HTTP ${res.status}`)
  const json = await res.json()
  if (json.errors?.length) throw new Error(`RMP: ${json.errors.map((e) => e.message).join('; ')}`)
  fs.mkdirSync(CACHE, { recursive: true })
  fs.writeFileSync(file, JSON.stringify(json))
  return json
}

async function search(text) {
  const json = await gql(SEARCH, { text, schoolID: SCHOOL.id })
  return (json.data?.newSearch?.teachers?.edges ?? []).map((e) => e.node).filter((t) => t?.school?.legacyId === SCHOOL.legacyId)
}

/**
 * The teacher's profile, plus what their ratings say: tag counts, and the course codes
 * reviewers named ("MATH 3020"), which is how a human checks that a profile is the right person.
 */
async function teacher(id) {
  let node = null
  const tags = new Map()
  const classes = new Map()
  let after = null
  for (let page = 0; page < 10; page++) {
    const json = await gql(TEACHER, after ? { id, after } : { id })
    const n = json.data?.node
    if (!n) return null
    node ??= n
    for (const e of n.ratings?.edges ?? []) {
      for (const tag of String(e.node?.ratingTags ?? '').split('--')) {
        let t = tag.trim()
        // RMP stores a few tags in capitals ("EXTRA CREDIT"); the rest are sentence case.
        if (t && t === t.toUpperCase()) t = t.charAt(0) + t.slice(1).toLowerCase()
        if (t) tags.set(t, (tags.get(t) ?? 0) + 1)
      }
      const c = String(e.node?.class ?? '')
        .toUpperCase()
        .replace(/[\s._-]+/g, '')
        .replace(/^([A-Z]+)(\d)/, '$1 $2')
      if (c) classes.set(c, (classes.get(c) ?? 0) + 1)
    }
    if (!n.ratings?.pageInfo?.hasNextPage) break
    after = n.ratings.pageInfo.endCursor
  }
  return { ...node, tags, classes }
}

const legacyToNodeId = (legacyId) => Buffer.from(`Teacher-${legacyId}`).toString('base64')

/* ─── matching ──────────────────────────────────────────────────────────── */

const norm = (s) =>
  String(s ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z]+/g, ' ')
    .trim()
const tokens = (s) => norm(s).split(' ').filter(Boolean)

/**
 * How well RMP's last name agrees: 2 = the same surname, 1 = part of a compound surname
 * ("Esfahani" for "Saghaeiannejad Esfahani", "Cruz" for "De La Cruz"), 0 = no.
 */
function lastMatch(rmpLast, person) {
  const r = tokens(rmpLast)
  if (!r.length) return 0
  let best = 0
  for (const last of person.lastNames) {
    const o = tokens(last)
    if (r.join(' ') === o.join(' ')) return 2
    if (r.every((t) => o.includes(t)) || o.every((t) => r.includes(t))) best = 1
  }
  return best
}

/** Edit distance, for one-letter spelling variants ("Alison" / "Allison"). */
function distance(a, b) {
  const d = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)])
  for (let j = 1; j <= b.length; j++) d[0][j] = j
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1))
    }
  }
  return d[a.length][b.length]
}

/**
 * How well RMP's first name agrees with the name the professor goes by — the first given name
 * or the preferred name, never a middle name ("Jae" is not "Yoon Jae"):
 * 3 = the same name, 2 = a shared prefix ("Alex" / "Alexander", "Soo" / "Soojin"),
 * 1 = one letter apart, allowed only with the exact surname ("Alison" / "Allison"), 0 = no.
 */
function firstMatch(rmpFirst, person, exactLast) {
  const r = tokens(rmpFirst).filter((t) => t.length > 1)
  if (!r.length) return 0
  const rJoined = r.join('')
  let best = 0
  for (const a of person.firstNames) {
    for (const b of [...r, rJoined]) {
      if (a === b) return 3
      if (a.length >= 3 && b.length >= 3 && (a.startsWith(b) || b.startsWith(a))) best = Math.max(best, 2)
      else if (exactLast && a.length >= 5 && b.length >= 5 && distance(a, b) === 1) best = Math.max(best, 1)
    }
  }
  return best
}

/** Name prefixes that are not the name someone goes by ("Md Mahfuzur" goes by Mahfuzur). */
const PREFIX_NAMES = new Set(['md', 'mohd', 'muhammad', 'mohammad', 'mohammed'])

function personFrom(name) {
  const p = parseInstructor(name)
  const given = tokens(p.given).filter((t) => t.length > 1)
  const firstNames = new Set()
  const first = given.find((t) => !PREFIX_NAMES.has(t)) ?? given[0]
  if (first) firstNames.add(first)
  if (given.length > 1) firstNames.add(given.join('')) // "Soo Jin" → "soojin"
  const lastNames = [p.last]
  if (p.preferred) {
    const pref = tokens(p.preferred)
    const lastToks = tokens(p.last)
    if (pref.length > 1 && pref.some((t) => lastToks.includes(t))) {
      // A full preferred name ("Hemanth Venkateswara"): its surname part counts as a last name too.
      lastNames.push(pref.filter((t) => lastToks.includes(t)).join(' '))
      pref.filter((t) => !lastToks.includes(t) && t.length > 1).forEach((t) => firstNames.add(t))
    } else pref.filter((t) => t.length > 1).forEach((t) => firstNames.add(t))
  }
  return { ...p, firstNames: [...firstNames], lastNames }
}

function deptFits(dept, subjects) {
  return subjects.some((s) => (DEPARTMENTS[s] ?? /.*/).test(dept ?? ''))
}

/** Profiles whose last name matches and whose first name matches as well as the best one does. */
function bestHits(found, person) {
  const scored = found
    .map((t) => {
      const last = lastMatch(t.lastName, person)
      return { t, last, first: last ? firstMatch(t.firstName, person, last === 2) : 0 }
    })
    .filter((x) => x.last && x.first)
  const top = Math.max(0, ...scored.map((x) => x.first))
  return scored.filter((x) => x.first === top).map((x) => x.t)
}

async function candidatesFor(person) {
  const firsts = person.firstNames
  const lastTokens = tokens(person.last)
  const queries = [
    person.display,
    ...firsts.map((f) => `${f} ${person.last}`),
    ...(lastTokens.length > 1 ? firsts.flatMap((f) => lastTokens.map((l) => `${f} ${l}`)) : []),
    person.last,
    ...(lastTokens.length > 1 ? lastTokens : []),
  ]
  const seen = new Map()
  for (const q of [...new Set(queries.map((q) => q.trim()).filter(Boolean))]) {
    for (const t of await search(q)) seen.set(t.id, t)
    const hits = bestHits([...seen.values()], person)
    if (hits.length) return { all: [...seen.values()], hits }
  }
  return { all: [...seen.values()], hits: [] }
}

/* ─── output ────────────────────────────────────────────────────────────── */

const round1 = (n) => Math.round(n * 10) / 10

function rating(t) {
  const has = t.numRatings > 0
  return {
    legacyId: t.legacyId,
    url: `https://www.ratemyprofessors.com/professor/${t.legacyId}`,
    firstName: String(t.firstName ?? '').trim(),
    lastName: String(t.lastName ?? '').trim(),
    department: String(t.department ?? '').trim(),
    avgRating: has && t.avgRating > 0 ? round1(t.avgRating) : null,
    avgDifficulty: has && t.avgDifficulty > 0 ? round1(t.avgDifficulty) : null,
    numRatings: t.numRatings ?? 0,
    wouldTakeAgainPercent: has && t.wouldTakeAgainPercent >= 0 ? Math.round(t.wouldTakeAgainPercent) : null,
    tags: [...(t.tags ?? new Map())]
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .slice(0, 5)
      .map(([name, count]) => ({ name, count })),
  }
}

function localIso(d) {
  const off = -d.getTimezoneOffset()
  const sign = off >= 0 ? '+' : '-'
  const pad = (n) => String(Math.floor(Math.abs(n))).padStart(2, '0')
  return `${new Date(d.getTime() + off * 60000).toISOString().slice(0, 19)}${sign}${pad(off / 60)}:${pad(off % 60)}`
}

async function main() {
  const schedule = JSON.parse(fs.readFileSync(SCHEDULE, 'utf8'))
  const overrideFile = fs.existsSync(OVERRIDES) ? JSON.parse(fs.readFileSync(OVERRIDES, 'utf8')) : {}
  const overrides = Object.fromEntries(Object.entries(overrideFile).filter(([k]) => !k.startsWith('_')))
  /** Why each override was made: "_why": { "<key>": "reason" } */
  const why = overrideFile._why && typeof overrideFile._why === 'object' ? overrideFile._why : {}

  /* every instructor, with the subjects and courses they teach */
  const people = new Map()
  for (const c of schedule.courses) {
    for (const s of c.sections) {
      for (const i of s.instructors) {
        if (!people.has(i.key)) people.set(i.key, { ...i, subjects: new Set(), codes: new Set() })
        people.get(i.key).subjects.add(s.subject)
        people.get(i.key).codes.add(s.code)
      }
    }
  }

  const professors = {}
  const rows = []
  for (const [key, inst] of [...people].sort(([a], [b]) => a.localeCompare(b))) {
    const person = personFrom(inst.name)
    const subjects = [...inst.subjects]
    let match = 'none'
    let chosen = null
    let note = ''
    if (Object.prototype.hasOwnProperty.call(overrides, key)) {
      match = 'override'
      if (overrides[key] != null) {
        chosen = await teacher(legacyToNodeId(overrides[key]))
        if (!chosen) throw new Error(`Override for ${key}: RMP has no teacher ${overrides[key]}`)
        if (chosen.school?.legacyId !== SCHOOL.legacyId) note = `override is at ${chosen.school?.name}`
      } else note = 'forced no match'
      if (why[key]) note = [note, why[key]].filter(Boolean).join(' — ')
    } else {
      const { hits } = await candidatesFor(person)
      let pool = hits
      if (pool.length > 1) {
        const fit = pool.filter((t) => deptFits(t.department, subjects))
        if (fit.length) pool = fit
      }
      if (pool.length === 1) {
        match = 'exact'
        chosen = await teacher(pool[0].id)
        if (!deptFits(chosen.department, subjects)) note = `department “${chosen.department}” vs ${subjects.join('/')}`
      } else if (pool.length > 1) {
        match = 'ambiguous'
        note = pool.map((t) => `${t.firstName.trim()} ${t.lastName.trim()} (${t.department}, ${t.numRatings} ratings, #${t.legacyId})`).join(' | ')
      }
    }
    const r = chosen ? rating(chosen) : null
    professors[key] = {
      key,
      name: inst.name,
      display: inst.display,
      searchUrl: `https://www.ratemyprofessors.com/search/professors/${SCHOOL.legacyId}?q=${encodeURIComponent(inst.display)}`,
      rmp: r,
      match,
    }
    const reviewed = [...(chosen?.classes ?? new Map())]
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .slice(0, 3)
      .map(([c, n]) => `${c} ×${n}`)
      .join(', ')
    rows.push({ key, display: inst.display, subjects: subjects.join('/'), codes: [...inst.codes].join(', '), r, match, note, reviewed })
  }

  const out = { schoolId: SCHOOL.legacyId, schoolName: SCHOOL.name, fetchedAt: localIso(new Date()), professors }
  fs.writeFileSync(OUT, `${JSON.stringify(out, null, 1)}\n`)

  /* review table */
  const line = (r) =>
    [
      r.key.padEnd(40),
      r.display.padEnd(32),
      r.subjects.padEnd(9),
      (r.r ? `${r.r.firstName} ${r.r.lastName}` : '—').padEnd(30),
      (r.r?.department ?? '').padEnd(22),
      String(r.r?.avgRating ?? '—').padStart(4),
      String(r.r?.numRatings ?? '').padStart(4),
      r.match.padEnd(9),
      (r.reviewed || '').padEnd(42),
      r.note,
    ].join(' ')
  console.log(rows.map(line).join('\n'))
  const count = (m) => rows.filter((r) => r.match === m).length
  const rated = rows.filter((r) => r.r)
  console.log(
    `\nWrote ${path.relative(ROOT, OUT)}: ${rows.length} professors — ${rated.length} with an RMP profile (${count('exact')} exact, ${rows.filter((r) => r.match === 'override' && r.r).length} override), ${count('ambiguous')} ambiguous, ${count('none')} no match.`,
  )

  const md = [
    '# RateMyProfessors matches',
    '',
    `Generated ${out.fetchedAt} by \`scripts/fetch-rmp.mjs\` (Georgia State University, RMP school ${SCHOOL.legacyId}).`,
    'A rating is shown only for a confident match. Fix a wrong or missing one in `data/sources/rmp-overrides.json` and rerun.',
    '',
    'The “Reviewed classes” column lists the course codes RMP reviewers named most often — a quick check that a profile is the right person.',
    '',
    '| Professor | Teaches | RMP profile | Department | Rating | Difficulty | # ratings | Reviewed classes (top 3) | Match | Note |',
    '|---|---|---|---|---:|---:|---:|---|---|---|',
    ...rows.map(
      (r) =>
        `| ${r.display} (\`${r.key}\`) | ${r.codes} | ${r.r ? `[${r.r.firstName} ${r.r.lastName}](${r.r.url})` : '—'} | ${r.r?.department ?? ''} | ${r.r?.avgRating ?? '—'} | ${r.r?.avgDifficulty ?? '—'} | ${r.r?.numRatings ?? ''} | ${r.reviewed || '—'} | ${r.match} | ${r.note.replace(/\|/g, '/')} |`,
    ),
    '',
  ]
  fs.writeFileSync(REPORT, md.join('\n'))
  console.log(`Report: ${path.relative(ROOT, REPORT)}`)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
