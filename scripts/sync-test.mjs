/**
 * Two devices, one Firestore — against a LOCAL Firestore emulator, never the real data.
 * Checks the multi-plan sync: plans made, renamed, reordered and deleted on one device show up
 * on the other; each device keeps its own plan open; an edit made just before switching plans
 * lands in the plan it was made in; the first plan stays in planner/sharedSchedule unchanged in
 * shape (so older copies of the app keep working).
 *
 *   firebase emulators:start --only firestore --project gsu-grad-planner   (port 8085, see below)
 *   VITE_FIRESTORE_EMULATOR=127.0.0.1:8085 npm run dev -- --port 5299
 *   npm run test:sync
 *
 * The emulator's data is wiped and re-seeded from the synthetic student in
 * scripts/fixtures/demo.json. Every request to the real Firestore is blocked and counted.
 */
import fs from 'node:fs'
import path from 'node:path'
import { chromium } from 'playwright-core'
import { initializeApp } from 'firebase/app'
import { connectFirestoreEmulator, doc, getDoc, getFirestore, setDoc, terminate } from 'firebase/firestore'

const EMULATOR = process.env.EMULATOR || '127.0.0.1:8085'
const URL = process.env.URL || 'http://localhost:5299/gsu-grad-planner/'
const PROJECT = 'gsu-grad-planner'
const demo = JSON.parse(fs.readFileSync(path.join(import.meta.dirname, 'fixtures/demo.json'), 'utf8'))

let fails = 0
const ok = (label, cond, extra) => {
  if (!cond) fails++
  console.log(`${cond ? '  ok  ' : ' FAIL '} ${label}${!cond && extra !== undefined ? `  ${JSON.stringify(extra)}` : ''}`)
}

/* ── the emulator: wipe, seed, read ─────────────────────────────────────── */
const [host, port] = EMULATOR.split(':')
const res = await fetch(`http://${EMULATOR}/emulator/v1/projects/${PROJECT}/databases/(default)/documents`, { method: 'DELETE' }).catch(() => null)
if (!res?.ok) {
  console.error(`No Firestore emulator at ${EMULATOR} — start it first (see the top of this file).`)
  process.exit(2)
}
const app = initializeApp({ projectId: PROJECT, apiKey: 'emulator' }, 'sync-test')
const db = getFirestore(app)
connectFirestoreEmulator(db, host, Number(port))
await setDoc(doc(db, 'planner', 'academicRecord'), demo.record)
await setDoc(doc(db, 'planner', 'sharedSchedule'), demo.plan)
const read = async (id) => {
  const snap = await getDoc(doc(db, 'planner', id))
  return snap.exists() ? snap.data() : null
}
const ids = (planDoc, term) => (planDoc?.schedule?.[term] || []).map((e) => e.courseId)

/* ── two devices ─────────────────────────────────────────────────────────── */
const browser = await chromium.launch({ channel: process.env.CHROME_CHANNEL || 'chrome' })
let realCalls = 0
async function device(name) {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } })
  // Only the emulator may be reached.
  await ctx.route(/firestore\.googleapis\.com|firebaseinstallations\.googleapis\.com/, (r) => { realCalls++; return r.abort() })
  await ctx.addInitScript(() => localStorage.clear())
  const page = await ctx.newPage()
  const errs = []
  page.on('pageerror', (e) => errs.push(`${name}: ${e.message}`))
  page.on('console', (m) => { if (m.type() === 'error' && !/ERR_FAILED|Failed to fetch|Could not reach Cloud Firestore/i.test(m.text())) errs.push(`${name}: ${m.text().slice(0, 200)}`) })
  await page.goto(URL, { waitUntil: 'load' })
  await page.waitForFunction(() => document.querySelector('[data-sync]')?.getAttribute('data-sync') === 'online', null, { timeout: 20000 })
  await page.waitForTimeout(800)
  const tabs = () => page.locator('[data-plan-tabs] [role=tab]').allInnerTexts()
  const activeTab = () => page.locator('[data-plan-tabs] [role=tab][aria-selected=true]').innerText()
  const rows = (term) => page.locator(`section[data-term="${term}"] li[data-course]`).evaluateAll((els) => els.map((e) => e.getAttribute('data-course')))
  return { ctx, page, errs, tabs, activeTab, rows }
}
const settle = (page, ms = 1400) => page.waitForTimeout(ms)
async function waitFor(fn, label, timeout = 8000) {
  const t0 = Date.now()
  while (Date.now() - t0 < timeout) {
    if (await fn()) return true
    await new Promise((r) => setTimeout(r, 200))
  }
  console.log(`        (timed out waiting for: ${label})`)
  return false
}
async function drag(page, fromSel, toSel, dy = 0) {
  const a = await page.locator(fromSel).first().boundingBox()
  const t = await page.locator(toSel).first().boundingBox()
  await page.mouse.move(a.x + a.width / 2, a.y + a.height / 2)
  await page.mouse.down()
  await page.mouse.move(a.x + a.width / 2 + 2, a.y + a.height / 2 + 8, { steps: 3 })
  await page.mouse.move(t.x + t.width / 2, t.y + t.height / 2 + dy, { steps: 12 })
  await page.waitForTimeout(150)
  await page.mouse.up()
  await page.waitForTimeout(300)
}

const A = await device('A')
const B = await device('B')
const seededSpring = ids(demo.plan, 'spring2027')

ok('both devices open the first plan, named for her', JSON.stringify(await A.tabs()) === JSON.stringify(['Eunbee’s plan']) && JSON.stringify(await B.tabs()) === JSON.stringify(['Eunbee’s plan']))
ok('  … from planner/sharedSchedule, unchanged by opening it', JSON.stringify(await A.rows('spring2027')) === JSON.stringify(seededSpring) && JSON.stringify(ids(await read('sharedSchedule'), 'spring2027')) === JSON.stringify(seededSpring))
ok('no plan list is written just by opening the app', (await read('planIndex')) === null)

// A makes a copy
await A.page.locator('button[aria-label="New plan"]').click()
await A.page.locator('#plan-name').fill('Second')
await A.page.locator('[data-create-plan]').click()
await settle(A.page)
const index = await read('planIndex')
const second = index?.order?.find((id) => id !== 'main')
ok('A makes a plan: it opens on A', (await A.activeTab()) === 'Second')
ok('  … the list is saved with both plans', JSON.stringify(index?.order) === JSON.stringify(['main', second]) && index?.names?.main === 'Eunbee’s plan' && index?.names?.[second] === 'Second', index)
ok('  … its document is a copy of the first plan', JSON.stringify(ids(await read(`plan-${second}`), 'spring2027')) === JSON.stringify(seededSpring))
ok('B sees the new plan in its tabs…', await waitFor(async () => JSON.stringify(await B.tabs()) === JSON.stringify(['Eunbee’s plan', 'Second']), 'B tabs'))
ok('  … but keeps its own plan open', (await B.activeTab()) === 'Eunbee’s plan')

// A reorders a course in its plan
await drag(A.page, 'section[data-term=spring2027] li[data-course] >> nth=0', 'section[data-term=spring2027] li[data-course] >> nth=2')
await settle(A.page)
const reordered = [...seededSpring.slice(1, 3), seededSpring[0], ...seededSpring.slice(3)]
ok('A drags a course down its term: the new order is saved to A’s plan', JSON.stringify(ids(await read(`plan-${second}`), 'spring2027')) === JSON.stringify(reordered), ids(await read(`plan-${second}`), 'spring2027'))
ok('  … and the first plan is untouched', JSON.stringify(ids(await read('sharedSchedule'), 'spring2027')) === JSON.stringify(seededSpring))
ok('  … and B, on the first plan, still shows the old order', JSON.stringify(await B.rows('spring2027')) === JSON.stringify(seededSpring))
await B.page.locator('[data-plan-tabs] [role=tab]', { hasText: 'Second' }).click()
ok('B opens the other plan and sees A’s order', await waitFor(async () => JSON.stringify(await B.rows('spring2027')) === JSON.stringify(reordered), 'B order'))

// rename on A shows on B
await A.page.locator('[data-plan-tabs] button[aria-label^="More for"]').click()
await A.page.getByRole('menuitem', { name: /Rename/ }).click()
await A.page.locator('#plan-rename').fill('Mine')
await A.page.getByRole('button', { name: 'Save', exact: true }).click()
await settle(A.page, 800)
ok('A renames it: saved', (await read('planIndex'))?.names?.[second] === 'Mine')
ok('  … and B’s tab says so', await waitFor(async () => (await B.tabs()).includes('Mine'), 'B rename'))

// an edit right before switching lands in the plan it was made in
await A.page.locator('[data-plan-tabs] [role=tab]', { hasText: 'Eunbee’s plan' }).click()
await waitFor(async () => (await A.activeTab()) === 'Eunbee’s plan', 'A on main')
await A.page.waitForTimeout(700)
const victim = seededSpring[seededSpring.length - 1]
const row = A.page.locator(`section[data-term=spring2027] li[data-course="${victim}"]`)
await row.hover()
await row.locator('button[aria-label^="Remove"]').click()
await A.page.locator('[data-plan-tabs] [role=tab]', { hasText: 'Mine' }).click() // inside the 500 ms save delay
await settle(A.page, 1800)
ok('an edit made just before switching is saved to the plan it was made in', !ids(await read('sharedSchedule'), 'spring2027').includes(victim))
ok('  … and not to the plan opened next', ids(await read(`plan-${second}`), 'spring2027').includes(victim))
ok('  … and B (on “Mine”) still has that course', (await B.rows('spring2027')).includes(victim))

// reorder the tabs on A
await drag(A.page, '[data-plan-tabs] [role=tab] >> text=Mine', '[data-plan-tabs] [role=tab] >> text=Eunbee’s plan')
await settle(A.page, 900)
ok('A drags its tab first: the order is saved', JSON.stringify((await read('planIndex'))?.order) === JSON.stringify([second, 'main']), (await read('planIndex'))?.order)
ok('  … and B’s tabs follow', await waitFor(async () => JSON.stringify(await B.tabs()) === JSON.stringify(['Mine', 'Eunbee’s plan']), 'B order'))

// delete on A while B has it open; then Undo
await A.page.locator('[data-plan-tabs] button[aria-label^="More for"]').click()
await A.page.getByRole('menuitem', { name: /Delete/ }).click()
await A.page.getByRole('alertdialog').getByRole('button', { name: 'Delete plan' }).click()
await settle(A.page, 1200)
ok('A deletes “Mine”: its document and its list entry are gone', (await read(`plan-${second}`)) === null && !(await read('planIndex'))?.order?.includes(second))
ok('  … A moves to the remaining plan', (await A.activeTab()) === 'Eunbee’s plan')
ok('  … B, which had it open, moves to the first plan and is told why', await waitFor(async () => (await B.activeTab()) === 'Eunbee’s plan' && /deleted on the other device/.test((await B.page.locator('[data-sonner-toast]').allInnerTexts()).join(' ')), 'B moved'))
await A.page.locator('[data-sonner-toast] button', { hasText: 'Undo' }).first().click()
await settle(A.page, 1200)
ok('Undo brings it back for both', (await read(`plan-${second}`)) !== null && await waitFor(async () => (await B.tabs()).includes('Mine'), 'B undo'))
ok('  … with its courses', ids(await read(`plan-${second}`), 'spring2027').includes(victim))

// the first plan's document keeps the shape older copies of the app read
const main = await read('sharedSchedule')
ok('planner/sharedSchedule keeps its original fields', JSON.stringify(Object.keys(main).filter((k) => k !== 'updatedAt').sort()) === JSON.stringify(['calSemester', 'expandedTerms', 'lastTermId', 'schedule', 'sectionsCollapsed', 'sidebarCollapsed', 'version', 'view']), Object.keys(main))
ok('nothing reached the real Firestore', realCalls === 0, realCalls)
ok('no page errors on either device', A.errs.length + B.errs.length === 0, [...A.errs, ...B.errs])

await browser.close()
await terminate(db)
console.log(fails ? `\n${fails} check(s) FAILED` : '\nAll sync checks passed.')
process.exit(fails ? 1 : 0)
