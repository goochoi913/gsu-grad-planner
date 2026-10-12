/**
 * Browser checks for the flows Eunbee uses: placing and moving courses, the 18-credit cap,
 * the course list's "what you still need", choosing sections in the section picker (preview on
 * the week, then Save; clashes can't be saved), the week and day calendars, breaks between
 * classes, the CRN list, professor ratings, the class browser, live seat counts, the record,
 * final grades, the GPA projection, advisor exceptions, suggested paths, reset + undo, search,
 * themes — on a computer and at phone size.
 *
 * Runs entirely on the synthetic fixture (scripts/fixtures/demo.json, loaded through
 * localStorage["bee-planner:fixture"]) with every Firebase request blocked, so Eunbee's real
 * plan and record are never touched.
 *
 *   npm run dev -- --port 5199
 *   npm run test:flows                (URL=… to point elsewhere)
 */
import fs from 'node:fs'
import path from 'node:path'
import { chromium } from 'playwright-core'

const URL = process.env.URL || 'http://localhost:5199/gsu-grad-planner/'
const FIXTURE = fs.readFileSync(path.join(import.meta.dirname, 'fixtures/demo.json'), 'utf8')
const BUNDLED = fs.readFileSync(path.join(import.meta.dirname, '../src/data/spring2027.json'), 'utf8')
const browser = await chromium.launch({ channel: process.env.CHROME_CHANNEL || 'chrome' })
let fails = 0
const ok = (label, cond, extra) => {
  if (!cond) fails++
  console.log(`${cond ? '  ok  ' : ' FAIL '} ${label}${!cond && extra ? `  ${JSON.stringify(extra)}` : ''}`)
}

async function open({ mobile = false, fixture = FIXTURE, live = null } = {}) {
  const ctx = await browser.newContext(mobile
    ? { viewport: { width: 393, height: 852 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true }
    : { viewport: { width: 1440, height: 900 } })
  let firebaseCalls = 0
  let liveCalls = 0
  await ctx.route(/googleapis\.com|firebaseinstallations/, (r) => { firebaseCalls++; return r.abort() })
  // The published seat counts: a given copy, or the bundled one (as the live site has it — no swap).
  await ctx.route(/\/live\/spring2027\.json/, (r) => {
    liveCalls++
    return r.fulfill({ status: 200, contentType: 'application/json', body: live ? JSON.stringify(live) : BUNDLED })
  })
  await ctx.addInitScript((f) => {
    localStorage.clear()
    localStorage.setItem('bee-planner:fixture', f)
  }, fixture)
  const page = await ctx.newPage()
  const errs = []
  page.on('pageerror', (e) => errs.push(e.message))
  page.on('console', (m) => {
    if (m.type() === 'error' && !/googleapis|firestore|ERR_FAILED|Failed to fetch/i.test(m.text())) errs.push(m.text().slice(0, 200))
  })
  await page.goto(URL, { waitUntil: 'load' })
  await page.waitForSelector('section[data-term]')
  const snap = () => page.evaluate(() => window.__beePlanner.getSnapshot())
  const plan = () => page.evaluate(() => window.__beePlanner.buildPlanPayload())
  const overflow = () => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
  const toastText = async () => (await page.locator('[data-sonner-toast]').allInnerTexts()).join(' | ')
  const clearToasts = () => page.evaluate(() => document.querySelectorAll('[data-sonner-toast] button[aria-label="Close toast"]').forEach((b) => b.click()))
  return { ctx, page, errs, snap, plan, overflow, toastText, clearToasts, firebaseCalls: () => firebaseCalls, liveCalls: () => liveCalls }
}
const wait = (page, ms = 350) => page.waitForTimeout(ms)
/** Taps a section card on its "Section N" label (the professor's name inside it opens their ratings). */
const pick = (scope, crn) => scope.locator(`[role=radio][data-crn="${crn}"]`).getByText(/^Section \d+$/).click()
const term = (page, id) => page.locator(`section[data-term="${id}"]`)
const courseIds = (plan, id) => (plan.schedule[id] || []).map((e) => e.courseId)

/* ── the board ───────────────────────────────────────────────────────────── */
{
  const t = await open()
  const { page } = t
  ok('the plan opens in fixture mode (no Firebase)', (await page.locator('[data-sync="fixture"]').count()) === 1)
  ok('upcoming terms come first, completed terms after', await page.evaluate(() => {
    const plan = document.querySelector('section[data-term]')
    const done = document.querySelector('section[aria-label="Completed terms"]')
    return !!plan && !!done && !!(plan.compareDocumentPosition(done) & Node.DOCUMENT_POSITION_FOLLOWING)
  }))
  ok('Spring 2027 shows 17/18 credits', /17\/18 cr/.test(await term(page, 'spring2027').locator('header').innerText()))
  ok('a term over 18 credits is flagged (Fall 2027 holds 20)', /20\/18 cr/.test(await term(page, 'fall2027').locator('header').innerText()) && (await term(page, 'fall2027').getAttribute('class')).includes('border-destructive'))
  ok('six Degree Works meters in the rail', (await page.locator('[aria-label="Degree progress"] button[data-block]').count()) === 6)
  ok('the latest completed term is expanded, earlier ones are chips', (await page.locator('section[aria-label="Fall 2025 (completed)"] li').count()) > 0 && (await page.locator('section[aria-label="Fall 2023 (completed)"] li').count()) === 0)
  ok('no horizontal overflow at 1440px', (await t.overflow()) <= 1)
  ok('plan rows lead with the course name, then the code', /^Software Development \(CTW\)\s*\n?CSC 3350/.test((await term(page, 'spring2027').locator('li[role=button]', { hasText: 'CSC 3350' }).innerText()).trim()))

  // the course list opens on what she still needs
  const needs = await page.locator('[data-need]').evaluateAll((els) => els.map((e) => e.getAttribute('data-need')))
  ok('the course list shows only courses still needed (planned, or for an open requirement)', needs.length > 0 && needs.every((n) => n === 'planned' || n === 'open'), needs)
  ok('  … and says so', /you still need/.test(await page.locator('text=/you still need/').first().innerText()))
  await page.getByRole('button', { name: 'Show all options' }).click()
  await wait(page)
  const all = await page.locator('[data-need]').evaluateAll((els) => els.map((e) => e.getAttribute('data-need')))
  ok('“Show all options” adds the alternatives, marked not needed', all.length > needs.length && all.includes('covered') && /not needed/.test(await page.locator('[data-need=covered]').first().innerText()))
  ok('  … but never courses GSU hasn’t offered or scheduled (CSC 4340 Compilers)', (await page.locator('[data-course="CSC4340"]').count()) === 0 && !all.includes('unavailable'))
  await page.getByRole('button', { name: 'Only what you need' }).click()
  await wait(page)

  // the 18-credit cap: CSC 4740 (4 cr) does not fit in Spring 2027 (17 cr), the focused term.
  // Electives are covered in this plan, so a search offers it among the other options.
  await page.locator('input[aria-label="Search courses"]').fill('4740')
  await wait(page)
  ok('searching for a course she doesn’t need offers the other options', (await page.locator('[data-course="CSC4740"]').count()) === 0 && (await page.getByRole('button', { name: /Show 1 other option/ }).count()) === 1)
  await page.getByRole('button', { name: /Show 1 other option/ }).click()
  await wait(page)
  await page.locator('[data-course="CSC4740"] button[aria-label="Add CSC 4740 to Spring 2027"]').click()
  await wait(page)
  ok('a course that would pass 18 credits is refused', !courseIds(await t.plan(), 'spring2027').includes('CSC4740') && /18-credit limit/.test(await t.toastText()), await t.toastText())
  await t.clearToasts()

  // choose Summer 2027 as the target and add it there
  await page.locator('[aria-label="Term to add courses to"]').click()
  await page.getByRole('option', { name: /Summer 2027/ }).click()
  await wait(page)
  await page.locator('[data-course="CSC4740"] button[aria-label="Add CSC 4740 to Summer 2027"]').click()
  await wait(page, 500)
  ok('a course is added to the chosen term', courseIds(await t.plan(), 'summer2027').includes('CSC4740'))
  await page.locator('[data-sonner-toast] button', { hasText: 'Undo' }).first().click()
  await wait(page, 400)
  ok('  … and Undo takes it back out', !courseIds(await t.plan(), 'summer2027').includes('CSC4740'))
  await t.clearToasts()

  // drag and drop: from the course list into a term, and between terms (a move, not a copy)
  const drag = (fromSel, toTerm) => page.evaluate(([fromSel, toTerm]) => {
    const dt = new DataTransfer()
    document.querySelector(fromSel).dispatchEvent(new DragEvent('dragstart', { dataTransfer: dt, bubbles: true }))
    const target = document.querySelector(`section[data-term="${toTerm}"]`)
    target.dispatchEvent(new DragEvent('dragover', { dataTransfer: dt, bubbles: true, cancelable: true }))
    target.dispatchEvent(new DragEvent('drop', { dataTransfer: dt, bubbles: true, cancelable: true }))
  }, [fromSel, toTerm])
  // Summer 2027 holds 12 cr and Fall 2027 18: move a Fall course into Summer, then fill the gap from the list
  await drag('section[data-term="fall2027"] li[role=button]', 'summer2027')
  await wait(page, 500)
  let p = await t.plan()
  const moved = courseIds(p, 'summer2027').filter((id) => !['CSC4520', 'CSC4350', 'CSC4320'].includes(id))
  ok('dragging a course to another term moves it', moved.length === 1 && !courseIds(p, 'fall2027').includes(moved[0]), { moved, fall: courseIds(p, 'fall2027') })
  // Fall 2027 started over the cap (20 cr) and now holds 16: a 2-credit course fits
  await page.locator('input[aria-label="Search courses"]').fill('4351')
  await wait(page)
  await drag('[data-course="CSC4351"]', 'fall2027')
  await wait(page, 500)
  ok('drag and drop from the course list places the course', courseIds(await t.plan(), 'fall2027').includes('CSC4351'))

  // remove from a term (hover trash) and undo
  const row = term(page, 'fall2027').locator('li[role=button]', { hasText: 'CSC 4351' })
  await row.hover()
  await row.locator('button[aria-label="Remove CSC 4351"]').click()
  await wait(page, 400)
  ok('removing a course takes it out of the term', !courseIds(await t.plan(), 'fall2027').includes('CSC4351'))

  // a completed-term drop is refused
  ok('past terms are locked (lock icon present)', (await page.locator('section[aria-label="Fall 2025 (completed)"] [aria-label="Locked"]').count()) === 1)
  ok('no page errors on the board', t.errs.length === 0, t.errs)
  ok('Firebase was never contacted', t.firebaseCalls() === 0)
  await t.ctx.close()
}

/* ── the section picker: preview on the week, then Save ─────────────────── */
{
  const t = await open()
  const { page } = t
  const sectionsOf = async (courseId) => (await t.plan()).schedule.spring2027.find((e) => e.courseId === courseId)?.sections
  await term(page, 'spring2027').locator('li[role=button]', { hasText: 'CSC 3350' }).click()
  await wait(page, 600)
  const dialog = page.locator('[role=dialog]')
  ok('a planned course opens its details', await dialog.isVisible())
  ok('  … with the Spring 2027 sections', /Spring 2027 sections/i.test(await dialog.innerText()))
  ok('  … beside a calendar of the week', (await dialog.locator('[data-picker-week] [data-calendar=week]').count()) === 1)
  ok('  … each section with its professor’s rating', (await dialog.locator('[aria-label$="RateMyProfessors rating"]').count()) >= 3)
  ok('  … and a clash warning where a section overlaps, by name', /Overlaps Computer Organization & Programming/.test(await dialog.innerText()))

  await pick(dialog, '17250')
  await wait(page, 400)
  ok('tapping a section previews it — nothing is saved yet', !(await sectionsOf('CSC3350')))
  ok('  … it shows on the week (Tue & Thu)', (await dialog.locator('[data-picker-week] [data-preview]').count()) === 2)
  ok('  … and the footer says it fits and isn’t saved', /fits your week.*Not saved yet/.test(await dialog.locator('[data-picker-footer]').innerText()))

  await pick(dialog, '17252')
  await wait(page, 400)
  ok('an overlapping section can be previewed (shown in red on the week)', (await dialog.locator('[data-picker-week] [data-preview][data-conflict]').count()) > 0)
  ok('  … but not saved', await dialog.locator('[data-picker-save]').isDisabled())
  ok('  … and the footer says why', /overlaps .*choose another to save/i.test(await dialog.locator('[data-picker-footer]').innerText()))

  await pick(dialog, '17250')
  await wait(page, 300)
  await dialog.locator('[data-picker-save]').click()
  await wait(page, 500)
  const entry = (await t.plan()).schedule.spring2027.find((e) => e.courseId === 'CSC3350')
  ok('Save writes the CRN into the plan', entry.sections?.CSC3350 === '17250')
  ok('  … with its meeting times as blocks (for older copies of the app)', entry.blocks.length > 0 && entry.blocks.every((b) => b.crn === '17250'))
  ok('  … closes the picker and confirms', !(await dialog.isVisible()) && /saved/i.test(await t.toastText()), await t.toastText())
  ok('the plan row shows the chosen section', /Sec 4/.test(await term(page, 'spring2027').locator('li[role=button]', { hasText: 'CSC 3350' }).innerText()))
  await page.locator('[data-sonner-toast] button', { hasText: 'Undo' }).first().click()
  await wait(page, 400)
  ok('  … and Undo takes it back', !(await sectionsOf('CSC3350')))
  await page.locator('[data-sonner-toast] button[aria-label="Close toast"]').first().click().catch(() => {})

  // a short break shows on the week; closing with an unsaved choice asks first
  await term(page, 'spring2027').locator('li[role=button]', { hasText: 'MATH 2641' }).click()
  await wait(page, 600)
  await pick(dialog, '16637')
  await wait(page, 400)
  ok('a 15-minute break before the next class is labelled on the week (Mon & Wed)', (await dialog.locator('[data-picker-week] [data-gap="15"]').count()) === 2)
  ok('  … and in the footer', /15-min break/.test(await dialog.locator('[data-picker-footer]').innerText()))
  await page.keyboard.press('Escape')
  await wait(page, 400)
  const ask = page.getByRole('alertdialog')
  ok('closing with an unsaved section asks to save it', /Save Section 4\?/.test(await ask.innerText()))
  await ask.getByRole('button', { name: 'Don’t save' }).click()
  await wait(page, 500)
  ok('  … “Don’t save” leaves the plan alone', !(await sectionsOf('MATH2641')) && !(await dialog.isVisible()))
  await term(page, 'spring2027').locator('li[role=button]', { hasText: 'MATH 2641' }).click()
  await wait(page, 600)
  ok('  … and the next time it opens fresh', (await dialog.locator('[role=radio][aria-checked=true]').count()) === 0)
  await pick(dialog, '16637')
  await page.keyboard.press('Escape')
  await wait(page, 400)
  await page.getByRole('alertdialog').getByRole('button', { name: 'Save', exact: true }).click()
  await wait(page, 500)
  ok('  … “Save” keeps it', (await sectionsOf('MATH2641'))?.MATH2641 === '16637')

  // a lecture and its lab are previewed and saved together
  await term(page, 'spring2027').locator('li[role=button]', { hasText: 'CSC 3210' }).click()
  await wait(page, 600)
  ok('a lecture + lab course lists both, with what is saved marked', (await dialog.locator('[role=radiogroup]').count()) === 2 && (await dialog.locator('[data-saved]').count()) === 2)
  await pick(dialog, '20708')
  await wait(page, 300)
  ok('  … a lab that overlaps its own lecture can’t be saved', /overlaps Computer Organization & Programming \(Wed\)/i.test(await dialog.locator('[data-picker-footer]').innerText()) && await dialog.locator('[data-picker-save]').isDisabled())
  await dialog.getByRole('button', { name: 'Cancel' }).click()
  await wait(page, 400)
  ok('  … and Cancel closes without saving', !(await dialog.isVisible()) && (await sectionsOf('CSC3210'))?.CSC3210L === '20706')

  // the Schedule view
  await t.clearToasts()
  await page.getByRole('radio', { name: /Schedule/ }).click()
  await wait(page, 600)
  ok('the Schedule view shows the week', (await page.locator('[role=list][aria-label="Monday"] [role=listitem]').count()) > 0)
  ok('  … with the classes by name (Linear Algebra I on Monday)', /Linear Algebra I/.test(await page.locator('[role=list][aria-label="Monday"]').innerText()))
  ok('  … and the CRN list includes it', /16637/.test(await page.locator('text=CRNs for registration').locator('..').locator('..').innerText()))
  ok('time conflicts are counted', /time conflict/.test(await page.locator('main').innerText()))
  await page.getByRole('radio', { name: 'Day' }).click()
  await page.getByRole('tab', { name: /Wed/ }).click()
  await wait(page, 400)
  const dayText = () => page.locator('[data-calendar="day"]').innerText()
  ok('the Day view lists Wednesday’s classes', /Linear Algebra I/.test(await dayText()) && /Computer Organization & Programming Lab/.test(await dayText()))
  ok('  … with the break between them', (await page.locator('[data-calendar="day"] [data-gap="15"]').count()) === 1)
  await page.getByRole('tab', { name: /Thu/ }).click()
  await wait(page, 300)
  ok('  … and Thursday’s (System-Level Programming’s Thursday meeting)', /System-Level Programming/.test(await dayText()))

  // a class card opens the picker; a saved section can be unselected (tap it again, or Unselect), then Save
  await page.getByRole('radio', { name: 'Week' }).click()
  await page.locator('aside [data-course="MATH2641"]').click()
  await wait(page, 600)
  ok('a class card in Schedule opens the picker, with an Unselect button on the saved section', (await dialog.getByRole('button', { name: 'Unselect Section 4' }).count()) === 1)
  await pick(dialog, '16637')
  await wait(page, 300)
  ok('  … tapping the saved section again unselects it (not saved until Save)', (await dialog.locator('[role=radio][aria-checked=true]').count()) === 0 && (await sectionsOf('MATH2641'))?.MATH2641 === '16637' && /Section 4 will be unselected/.test(await dialog.locator('[data-picker-footer]').innerText()))
  await pick(dialog, '16637')
  await wait(page, 300)
  ok('  … tapping it once more selects it again', (await dialog.locator('[role=radio][data-crn="16637"][aria-checked=true]').count()) === 1 && /Saved: Section 4/.test(await dialog.locator('[data-picker-footer]').innerText()))
  await dialog.getByRole('button', { name: 'Unselect Section 4' }).click()
  await wait(page, 300)
  await dialog.locator('[data-picker-save]').click()
  await wait(page, 500)
  ok('  … Unselect then Save takes it out of the plan', !(await sectionsOf('MATH2641')) && /section unselected/.test(await t.toastText()), await t.toastText())

  // professors
  await page.locator('button[aria-label="Lan Gao — RateMyProfessors rating"]').first().click()
  await wait(page, 500)
  const prof = page.locator('[role=dialog]')
  const href = await prof.locator('a', { hasText: 'Open on RateMyProfessors' }).getAttribute('href')
  ok('a professor opens with their RateMyProfessors numbers', /Rating/.test(await prof.innerText()) && /Would take again/.test(await prof.innerText()))
  ok('  … and a direct link to their RMP profile', /^https:\/\/www\.ratemyprofessors\.com\/professor\/\d+$/.test(href || ''), href)
  ok('  … and the classes they teach, by name', /Computer Organization & Programming/.test(await prof.innerText()) && /Web Programming/.test(await prof.innerText()))
  await page.keyboard.press('Escape')
  await wait(page)

  // every class, including ones outside the CSVs
  await page.getByRole('button', { name: 'All classes' }).click()
  await wait(page, 400)
  const browser = page.locator('[role=dialog]')
  ok('the class browser opens on the classes she needs', /Classes you need/.test(await browser.innerText()) && (await browser.locator('li[data-code="ECON2106"]').count()) === 0)
  await browser.getByRole('radio', { name: /Every class/ }).click()
  await page.locator('input[aria-label="Search classes"]').fill('ECON 2106')
  await wait(page, 300)
  const econ = browser.locator('li[data-code="ECON2106"]')
  ok('  … “Every class” finds courses beyond the CSVs (ECON 2106)', (await econ.count()) === 1)
  await econ.locator('button').first().click()
  await wait(page, 300)
  ok('  … and lists their sections', (await browser.locator('[data-crn]').count()) > 1)
  await page.locator('input[aria-label="Search classes"]').fill('16141')
  await wait(page, 300)
  ok('Honors sections are gone (CSC 4520-8, CRN 16141)', (await browser.locator('li[data-code]').count()) === 0)
  await page.keyboard.press('Escape')
  ok('no page errors in Schedule', t.errs.length === 0, t.errs)
  await t.ctx.close()
}

/* ── live seat counts ───────────────────────────────────────────────────── */
{
  const bundled = JSON.parse(fs.readFileSync(path.join(import.meta.dirname, '../src/data/spring2027.json'), 'utf8'))
  const live = JSON.parse(JSON.stringify(bundled))
  live.sources.banner.fetchedAt = new Date().toISOString()
  const sec = live.courses.find((c) => c.codeId === 'CSC3350').sections.find((x) => x.crn === '17250')
  sec.seats = { remaining: 0, capacity: 90, full: true, asOf: live.sources.banner.fetchedAt, source: 'banner' }
  sec.waitlist = { capacity: 99, count: 7, remaining: 92 }
  const t = await open({ live })
  const { page } = t
  await wait(page, 800)
  ok('the app asks for the published seat counts when it opens', t.liveCalls() >= 1)
  await term(page, 'spring2027').locator('li[role=button]', { hasText: 'CSC 3350' }).click()
  await wait(page, 600)
  ok('fresher seat counts replace the bundled ones', /Full · waitlist 7\/99/.test(await page.locator('[role=dialog] [data-crn="17250"]').innerText()))
  ok('  … and say how fresh they are', /updated just now/.test(await page.locator('[role=dialog] [data-picker-sections]').innerText()))
  ok('no page errors with live data', t.errs.length === 0, t.errs)
  await t.ctx.close()
}

/* ── the record, final grades, GPA, exceptions ─────────────────────────── */
{
  const t = await open()
  const { page } = t
  // GPA projection: an expected grade makes a retake replace the F
  await page.getByRole('banner').getByRole('button', { name: 'GPA', exact: true }).click()
  await wait(page, 500)
  const gpa = page.locator('[role=dialog]')
  ok('the GPA projection opens', /What-if grades/.test(await gpa.innerText()))
  ok('a planned retake starts out waiting for an expected grade', /Pick an expected grade/.test(await gpa.locator('label', { hasText: 'CSC 3320' }).innerText()))
  await gpa.locator('[aria-label="Expected grade for CSC 3320"]').click()
  await page.getByRole('option', { name: 'A', exact: true }).click()
  await wait(page, 400)
  ok('an expected grade switches Repeat to Replace on for the retake', /Replaces the earlier grade/.test(await gpa.locator('label', { hasText: 'CSC 3320' }).innerText()))
  ok('  … stored only in the projection, not the record', (await t.snap()).projection.grades.CSC3320 === 'A')
  await page.keyboard.press('Escape')
  await wait(page)

  // the record: change a grade
  const before = (await t.snap()).summary.gsu.gpa
  await page.getByRole('banner').getByRole('button', { name: 'Record', exact: true }).click()
  await wait(page, 500)
  await page.locator('[role=dialog] button[aria-label="Edit ACCT 2101"]').click()
  await wait(page, 300)
  await page.locator('[role=dialog] button[role=combobox]', { hasText: /^B$/ }).click()
  await page.getByRole('option', { name: 'A', exact: true }).click()
  await page.locator('[role=dialog] button', { hasText: /^Save$/ }).click()
  await wait(page, 500)
  const after = (await t.snap()).summary.gsu.gpa
  ok('editing a grade in the record changes the GPA', after > before, { before, after })
  await page.keyboard.press('Escape')
  await wait(page)

  // an advisor exception from the audit
  const pendingBefore = (await t.snap()).audit.pending.length
  await page.locator('section', { hasText: 'Needs an advisor exception' }).locator('button', { hasText: 'Record' }).nth(1).click()
  await wait(page, 500)
  await page.locator('[role=dialog] button', { hasText: 'Save exception' }).click()
  await wait(page, 500)
  const pendingAfter = (await t.snap()).audit.pending.length
  ok('recording the CSC 4350 substitution (with “course not needed”) clears pending items', pendingAfter <= pendingBefore - 2, { pendingBefore, pendingAfter })
  await page.keyboard.press('Escape')
  await wait(page)

  // finish Spring 2027 with final grades
  await page.locator('[aria-label="More for Spring 2027"]').click()
  await page.getByRole('menuitem', { name: /Enter final grades/ }).click()
  await wait(page, 500)
  const grades = page.locator('[role=dialog]')
  const n = await grades.locator('button[aria-label^="Grade for"]').count()
  for (let i = 0; i < n; i++) {
    await grades.locator('button[aria-label^="Grade for"]').nth(i).click()
    await page.getByRole('option', { name: 'B', exact: true }).click()
    await wait(page, 120)
  }
  await grades.locator('button', { hasText: 'Finish Spring 2027' }).click()
  await page.getByRole('alertdialog').getByRole('button', { name: /Finish Spring 2027/ }).click()
  await wait(page, 700)
  const s = await t.snap()
  ok('finishing a term moves it into the record', s.record.terms.some((x) => x.id === 'spring2027' && x.courses.length === n))
  ok('  … and planning continues from Summer 2027', s.semesters[0].id === 'summer2027')
  ok('  … and the board shows it as a completed term', (await page.locator('section[aria-label="Spring 2027 (completed)"]').count()) === 1)
  ok('no page errors in the record flows', t.errs.length === 0, t.errs)
  await t.ctx.close()
}

/* ── paths, reset, search, theme, summary ─────────────────────────────── */
{
  const t = await open()
  const { page } = t
  await page.getByRole('button', { name: /Custom plan/ }).click()
  await page.getByRole('menuitem', { name: /4 semesters/ }).click()
  await page.getByRole('alertdialog').getByRole('button', { name: 'Switch' }).click()
  await wait(page, 500)
  ok('a suggested path replaces the planned terms (after confirming)', (await t.plan()).lastTermId === 'spring2028')

  await page.getByRole('button', { name: 'More', exact: true }).click()
  await page.getByRole('menuitem', { name: /Clear planned terms/ }).click()
  await page.getByRole('alertdialog').getByRole('button', { name: 'Clear' }).click()
  await wait(page, 400)
  ok('reset clears every planned term', Object.values((await t.plan()).schedule).every((l) => !l.length))
  ok('  … but keeps the record', (await t.snap()).record.terms.length === 7)
  await page.locator('[data-sonner-toast] button', { hasText: 'Undo' }).first().click()
  await wait(page, 400)
  ok('  … and Undo brings the plan back', Object.values((await t.plan()).schedule).some((l) => l.length))

  await page.keyboard.press('Meta+k')
  await wait(page, 300)
  await page.keyboard.type('Yang')
  await wait(page, 300)
  ok('⌘K finds professors', (await page.getByRole('option', { name: /Yang Li/ }).count()) > 0)
  await page.keyboard.press('Escape')

  await page.locator('button[aria-label="Settings"]').click()
  await page.getByRole('radio', { name: 'Dark' }).click()
  await wait(page, 300)
  ok('the dark theme applies', await page.evaluate(() => document.documentElement.classList.contains('dark')))
  await page.keyboard.press('Escape')

  await page.getByRole('radio', { name: /Summary/ }).click()
  await wait(page, 400)
  const sum = await page.locator('main').innerText()
  ok('the Summary view has its numbered sections', ['Where things stand', 'Degree Works requirements', 'The plan, term by term', 'Completed terms', 'Confirm with the advisor'].every((h) => sum.includes(h)))
  ok('no page errors', t.errs.length === 0, t.errs)
  await t.ctx.close()
}

/* ── terms and hand-entered meeting times ─────────────────────────────── */
{
  const t = await open()
  const { page } = t
  await page.getByRole('button', { name: /Add Spring 2028/ }).click()
  await wait(page, 400)
  ok('a term can be added at the end', (await t.plan()).lastTermId === 'spring2028' && (await term(page, 'spring2028').count()) === 1)
  await page.locator('[aria-label="More for Spring 2028"]').click()
  await page.getByRole('menuitem', { name: /Remove Spring 2028/ }).click()
  await wait(page, 400)
  ok('  … and removed again while it is empty', (await t.plan()).lastTermId === 'fall2027')

  // Summer 2027 has no released schedule: meeting times are typed in by hand
  await term(page, 'summer2027').locator('li[role=button]', { hasText: 'CSC 4520' }).click()
  await wait(page, 500)
  const dialog = page.locator('[role=dialog]')
  ok('a term without a schedule offers hand-entered meeting times', /Meeting times · Summer 2027/i.test(await dialog.innerText()))
  ok('  … and offers to compare its Spring 2027 sections', (await dialog.getByRole('button', { name: /See them on your Spring 2027 week/ }).count()) === 1)
  await dialog.getByRole('button', { name: 'Add a meeting time' }).click()
  await dialog.getByRole('button', { name: 'Mon', exact: true }).click()
  await dialog.getByRole('button', { name: 'Wed', exact: true }).click()
  await dialog.locator('input[type=time]').nth(0).fill('13:00')
  await dialog.locator('input[type=time]').nth(1).fill('15:30')
  await dialog.locator('input[aria-label="Location"]').fill('Langdale 300')
  await dialog.getByRole('button', { name: 'Save meeting times' }).click()
  await wait(page, 400)
  const blocks = (await t.plan()).schedule.summer2027.find((e) => e.courseId === 'CSC4520').blocks
  ok('  … and saving stores them as meeting blocks', blocks.length === 1 && blocks[0].days.join() === 'M,W' && blocks[0].startTime === '13:00' && blocks[0].endTime === '15:30', blocks)
  await dialog.getByRole('button', { name: /See them on your Spring 2027 week/ }).click()
  await wait(page, 500)
  await dialog.locator('[role=radio][data-crn]').first().getByText(/^Section \d+$/).click()
  await wait(page, 300)
  ok('  … where saving would move it — refused while Spring 2027 is full', /Move to Spring 2027/.test(await dialog.locator('[data-picker-save]').innerText()) && await dialog.locator('[data-picker-save]').isDisabled() && /18-credit limit/.test(await dialog.locator('[data-picker-footer]').innerText()))
  await dialog.getByRole('button', { name: 'Cancel' }).click()
  await wait(page, 400)
  await term(page, 'summer2027').locator('li[role=button]', { hasText: 'CSC 4520' }).click()
  await wait(page, 500)
  await page.keyboard.press('Escape')
  await wait(page, 400)
  await page.getByRole('radio', { name: /Schedule/ }).click()
  await wait(page, 400)
  await page.locator('aside [aria-label="Term"]').click()
  await page.getByRole('option', { name: /Summer 2027/ }).click()
  await wait(page, 500)
  ok('  … which appear on that term’s calendar', /Design & Analysis of Algorithms/.test(await page.locator('[role=list][aria-label="Monday"]').innerText()) && /4520/.test(await page.locator('[role=list][aria-label="Wednesday"]').innerText()))
  ok('no page errors', t.errs.length === 0, t.errs)
  await t.ctx.close()
}

/* ── on a phone ─────────────────────────────────────────────────────────── */
{
  const t = await open({ mobile: true })
  const { page } = t
  ok('the bottom tab bar is there', (await page.getByRole('navigation', { name: 'Main' }).count()) === 1)
  ok('no horizontal overflow on Plan (393px)', (await t.overflow()) <= 1)

  // add a course she needs in a few taps, found by its name: Courses → search → +
  let taps = 0
  await page.locator('nav button', { hasText: 'Courses' }).click(); taps++
  await wait(page, 500)
  await page.locator('[role=dialog] input[aria-label="Search courses"]').fill('ethics of computing')
  await wait(page, 300)
  await page.locator('[role=dialog] [aria-label="Term to add courses to"]').click(); taps++
  await page.getByRole('option', { name: /Summer 2027/ }).click(); taps++
  await page.locator('[role=dialog] button[aria-label="Add PHIL 2920 to Summer 2027"]').click(); taps++
  await wait(page, 500)
  ok(`a course is found by name and added in ${taps} taps`, courseIds(await t.plan(), 'summer2027').includes('PHIL2920') && taps <= 4)
  await page.keyboard.press('Escape')
  await wait(page, 400)

  // choose a section from the plan: open, preview, Save
  await term(page, 'spring2027').locator('li[role=button]', { hasText: 'MATH 2641' }).click()
  await wait(page, 600)
  const sheet = page.locator('[role=dialog]')
  ok('the section picker opens as a bottom sheet', await sheet.isVisible())
  ok('  … with the week on top of the options', await sheet.locator('[data-picker-week]').isVisible())
  ok('  … and no horizontal overflow', (await t.overflow()) <= 1 && (await sheet.evaluate((d) => d.scrollWidth - d.clientWidth)) <= 1)
  await pick(sheet, '16637')
  await wait(page, 300)
  ok('  … a tap previews the section on the week', (await sheet.locator('[data-picker-week] [data-preview]').count()) === 2 && !(await t.plan()).schedule.spring2027.find((e) => e.courseId === 'MATH2641').sections)
  await sheet.locator('[data-picker-save]').click()
  await wait(page, 500)
  ok('  … and Save keeps it', (await t.plan()).schedule.spring2027.find((e) => e.courseId === 'MATH2641').sections?.MATH2641 === '16637')

  await page.locator('nav button', { hasText: 'Schedule' }).click()
  await wait(page, 500)
  ok('Schedule on a phone: no horizontal overflow (week)', (await t.overflow()) <= 1 && (await page.evaluate(() => { const v = document.querySelector('main [data-slot=scroll-area-viewport]'); return v.scrollWidth - v.clientWidth })) <= 1)
  await page.getByRole('radio', { name: 'Day' }).click()
  await page.getByRole('tab', { name: /Wed/ }).click()
  await wait(page, 400)
  ok('Schedule on a phone: the Day view stays inside the screen', (await page.evaluate(() => { const v = document.querySelector('main [data-slot=scroll-area-viewport]'); return v.scrollLeft })) === 0)

  await page.locator('nav button', { hasText: 'Audit' }).click()
  await wait(page, 500)
  ok('the audit opens as a sheet', /Degree audit/.test(await page.locator('[role=dialog]').innerText()))
  ok('no page errors on the phone', t.errs.length === 0, t.errs)
  await t.ctx.close()
}

await browser.close()
console.log(fails ? `\n${fails} check(s) FAILED` : '\nAll flow checks passed.')
process.exit(fails ? 1 : 0)
