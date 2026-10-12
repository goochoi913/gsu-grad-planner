# Bee's Grad Planner

A degree planner for Bee's B.S. in Computer Science at Georgia State University: the academic
timeline with every past grade, a Degree Works–style audit, GPA projections with Repeat to
Replace, and the **Spring 2027 class schedule** — every section with its professor, days, times,
room and seats, each professor's RateMyProfessors rating one tap away, and a weekly and daily
calendar of the sections she picks.

**Live:** <https://goochoi913.github.io/gsu-grad-planner/> — also installable on a phone's home
screen (Safari → Share → Add to Home Screen; Chrome → Install app).

---

## What it does

| | |
|---|---|
| **Plan** | Upcoming terms as cards: credits against the 18-credit cap, the estimated GPA after each term, and every warning that matters (prerequisite order, a term the course isn't usually offered, an advisor exception, a time conflict). Drag courses between terms on a computer, or tap **Add course** on a phone. Completed terms sit below, locked, with term and cumulative GPAs. |
| **Schedule** | The released Spring 2027 schedule. Choose a section for each class (lecture and lab separately); the **week** and **day** calendars fill in, clashes turn red, and the **CRNs for registration** list is ready to copy into PAWS. Terms without a released schedule take hand-entered meeting times. |
| **All classes** | Every class and section in the schedule — not just the ones in the plan — searchable by course, title, professor or CRN. |
| **Professors** | Each professor's RateMyProfessors rating, difficulty, would-take-again and number of ratings, their most-used tags, a direct link to their profile, and the sections they teach. |
| **Degree audit** | The Degree Works blocks — IMPACTS Core, Program Advice, Field of Study, Major, Required Program Electives – CSC — line by line with the courses that fill them, advisor exceptions (record them once the advisor enters them), and the "confirm with your advisor" checklist. |
| **Record** | Past terms and grades, stored only in Firebase. Fix a grade, add a course to a past term, import the record file, download a backup. **Enter final grades** at the end of a term locks it into the history. |
| **GPA** | What-if grades per term, the GSU and GSU + transfer GPA after each term with and without Repeat to Replace, and the average needed to reach a target GPA. |
| **Summary** | One calm, printable page: where things stand, the requirements, the Spring 2027 classes with CRNs and the week, the plan term by term, completed terms, the advisor checklist. |

Search everything with **⌘K** (Ctrl+K). Light and dark themes follow the system, with an
override in Settings.

## Interface

[shadcn/ui](https://ui.shadcn.com) on Tailwind v4 with the **neutral** palette, icons from
[react-icons](https://react-icons.github.io/react-icons/) (the Lucide set). The surfaces stay
neutral; colour marks meaning, so things can be told apart at a glance (`src/lib/colors.ts`):

| Colour | Means |
|---|---|
| Blue | **Major — required**: she has to take it |
| Purple | **CSC elective**: one of the 16 elective credits, her choice |
| Teal | **Core & Field of Study** (IMPACTS Core, Program Advice, Field of Study) |
| Pink | **Program elective**: Required Program Electives – CSC, any subject 2000–4000 |
| Grey | Extra credit — counts only toward the 120 total |
| Grades | A green · B light green · C yellow · D orange · F red · W grey |
| Progress | done green, planned light green, waiting on an advisor exception amber, a real problem (an F, a time conflict, a full section, a term over 18 credits) red |
| Calendar | one soft hue per class |

The logo is a yellow honeycomb cell — Bee's favourite colour.

On a computer: a one-line header, the Degree Works progress rail, then three resizable panes —
course list, plan, audit — either side panel collapses. On a phone: a bottom tab bar (Plan ·
Schedule · Courses · Audit), with the course list and the audit as full-height sheets and every
dialog as a bottom sheet.

## Where the data comes from

| File | Contents | Source |
|---|---|---|
| `src/data/degree.ts` | Degree Works blocks and requirement lines, the course list, prerequisites, offering history, suggested paths, GPA rules | GSU 2024–25 catalog and Degree Works; prerequisites from the 2026–27 catalog and PAWS |
| `src/data/spring2027.json` | Every Spring 2027 section | **The CSVs in `data/sources/`** (copied from GSU's class schedule — the main source), enriched from GSU's public class search: fresher seat counts, waitlists, Honors/online attributes, and the sections of course-list courses the CSVs don't cover |
| `src/data/professors.json` | RateMyProfessors data for every instructor | RateMyProfessors, Georgia State (school 360) |

Bee's **academic record is never in this repository** — it lives only in Firebase.

### Refreshing the schedule and the ratings

```bash
npm run data:schedule   # re-read the CSVs and GSU's class search → src/data/spring2027.json
npm run data:rmp        # re-fetch RateMyProfessors → src/data/professors.json
```

`data/sources/schedule-report.md` lists every difference between the CSVs and GSU's class search
and every section added from it; `data/sources/rmp-report.md` lists how each professor was
matched. Matching is deliberately conservative — a wrong professor's rating would mislead — so
an unsure name shows a RateMyProfessors search link instead. To fix a match by hand, put the
professor's RMP id (the number in their profile URL) in `data/sources/rmp-overrides.json`.

For a new term's schedule, drop its CSVs in `data/sources/`, update `TERM` and `CSV_FILES` in
`scripts/build-schedule.mjs`, and add the JSON to `SCHEDULES` in `src/lib/schedule.ts`.

The deploy workflow also refreshes seat counts from GSU's class search every six hours from
October through January (registration season). If the class search is unreachable it uses the
committed snapshot.

## Firebase

Three documents in the `gsu-grad-planner` project, unchanged from the original planner:

| Document | Contents |
|---|---|
| `planner/sharedSchedule` | the plan: upcoming terms, courses, chosen sections (`sections: { CSC3210: "14634" }`), meeting times |
| `planner/academicRecord` | past terms with grades, and advisor exceptions — stored only here |
| `planner/gpaProjection` | expected grades, Repeat to Replace switches, the GPA target |

Both devices see changes live. The plan is cached in the browser so the app opens instantly; the
record is never cached outside Firebase. There is no sign-in, by choice — anyone with the link can
read and edit, so keep the link private.

## Development

```bash
npm install
npm run dev            # http://localhost:5173/gsu-grad-planner/
npm run build          # type-check and build to dist/
```

### Tests

| Command | What it checks |
|---|---|
| `npm test` | The planning logic (`src/lib/planner.ts`) against 212 golden results recorded from the original planner, plus the section-picking additions. Runs before every deploy. |
| `npm run test:flows` | Browser checks on a computer and a phone: placing, moving and removing courses, the 18-credit cap, choosing sections, the week and day calendars, the CRN list, professors, the class browser, the record, final grades, the GPA projection, exceptions, paths, reset + undo, ⌘K, themes, no horizontal scrolling. Needs `npm run dev -- --port 5199` running and Google Chrome. Uses the synthetic student in `scripts/fixtures/demo.json` and blocks Firebase, so Bee's data is never touched. |
| `npm run lint` | oxlint |

`node scripts/make-golden.mjs` re-records the golden results from the original JavaScript
(read from git history), if the battery in `scripts/fixtures/scenarios.mjs` changes.

## Deploying

`.github/workflows/deploy.yml` runs the logic tests, builds, and publishes to GitHub Pages on every
push to `main` (Settings → Pages → Source: **GitHub Actions**). The site is a PWA: a service worker
caches the app so it opens fast and updates itself on the next visit after a deploy.

## Project layout

```
src/
  data/            degree.ts (the degree), spring2027.json (sections), professors.json (ratings)
  lib/
    planner.ts     terms, record, GPA engine, Degree Works audit, projections, paths, plan normalization
    plan-ops.ts    planning rules the views apply: adding/moving courses, the cap, wording
    schedule.ts    sections, chosen sections, calendar events and conflicts, professors
    store.ts       app state and Firebase sync
    firebase.ts    the three Firestore documents
  components/      the views: board, schedule-view + calendar, library-panel, audit-panel, dialogs
    ui/            shadcn/ui primitives
scripts/
  build-schedule.mjs, fetch-rmp.mjs   the schedule and ratings data
  logic-test.ts, make-golden.mjs      logic tests against the original planner
  flow-test.mjs                       browser tests
data/sources/      the Spring 2027 CSVs, the class-search snapshot, reports
```
