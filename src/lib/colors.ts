/**
 * Colour, spent where it tells things apart. The interface itself stays neutral;
 * colour marks meaning:
 *
 *   requirement area   which kind of course it is — Major (required), CSC elective,
 *                      Core & Field of Study, Program elective, extra credit
 *   grade              A green · B light green · C yellow · D orange · F red · W grey
 *   progress           done green, planned light green (Eunbee's colours), waiting on the
 *                      advisor amber, a real problem red
 *   course hues        soft tints that tell classes apart on the calendar
 *
 * Full class names are spelled out so Tailwind keeps them.
 */
import type { CatalogCourse } from '@/lib/types'
import type { UnitRole } from '@/lib/planner'

/* ─── Requirement areas ──────────────────────────────────────────────────── */

export type Category = 'major' | 'elective' | 'core' | 'rpe' | 'extra'

export interface CategoryStyle {
  label: string
  /** One-word name for tight spots. */
  short: string
  /** What it means, for the legend's tooltip. */
  hint: string
  dot: string
  /** Left edge of a course row. */
  edge: string
  text: string
  /** A soft tag: tinted background, coloured text, faint border. */
  tag: string
}

export const CATEGORY: Record<Category, CategoryStyle> = {
  major: {
    label: 'Major — required',
    short: 'Major',
    hint: 'Required for the CS major — she has to take these.',
    dot: 'bg-blue-500',
    edge: 'border-l-blue-500',
    text: 'text-blue-700 dark:text-blue-300',
    tag: 'border-blue-200 bg-blue-50 text-blue-700 dark:border-blue-400/30 dark:bg-blue-500/15 dark:text-blue-300',
  },
  elective: {
    label: 'CSC elective',
    short: 'CSC elective',
    hint: 'Counts toward the 16 credits of 3000/4000-level CSC electives — her choice which ones.',
    dot: 'bg-violet-500',
    edge: 'border-l-violet-500',
    text: 'text-violet-700 dark:text-violet-300',
    tag: 'border-violet-200 bg-violet-50 text-violet-700 dark:border-violet-400/30 dark:bg-violet-500/15 dark:text-violet-300',
  },
  core: {
    label: 'Core & Field of Study',
    short: 'Core',
    hint: 'IMPACTS Core, Program Advice and Field of Study requirements.',
    dot: 'bg-teal-500',
    edge: 'border-l-teal-500',
    text: 'text-teal-700 dark:text-teal-300',
    tag: 'border-teal-200 bg-teal-50 text-teal-700 dark:border-teal-400/30 dark:bg-teal-500/15 dark:text-teal-300',
  },
  rpe: {
    label: 'Program elective',
    short: 'Program elective',
    hint: 'Required Program Electives – CSC: any 2000–4000 level course, any subject.',
    dot: 'bg-pink-500',
    edge: 'border-l-pink-500',
    text: 'text-pink-700 dark:text-pink-300',
    tag: 'border-pink-200 bg-pink-50 text-pink-700 dark:border-pink-400/30 dark:bg-pink-500/15 dark:text-pink-300',
  },
  extra: {
    label: 'Extra credit',
    short: 'Extra',
    hint: 'Counts only toward the 120-credit total.',
    dot: 'bg-neutral-400',
    edge: 'border-l-neutral-300 dark:border-l-neutral-600',
    text: 'text-muted-foreground',
    tag: 'border-border bg-muted text-muted-foreground',
  },
}

export const CATEGORY_ORDER: Category[] = ['major', 'elective', 'core', 'rpe']

/** Where a course counts in the audit, as a colour family. */
export function categoryOfRole(role: UnitRole | null | undefined): Category | null {
  if (!role) return null
  if (!role.block) return 'extra'
  if (role.lineId === 'major.elec') return 'elective'
  if (role.block === 'major') return 'major'
  if (role.block === 'rpe') return 'rpe'
  return 'core'
}

/** Where a course is listed in the course list. */
export function categoryOfSection(course: CatalogCourse): Category {
  if (course.section === 'major') return 'major'
  if (course.section === 'elective') return 'elective'
  if (course.section === 'rpe') return 'rpe'
  return 'core'
}

/** A Degree Works block as a colour family (the rail and the audit). */
export function categoryOfBlock(key: string): Category | null {
  if (key === 'major') return 'major'
  if (key === 'rpe') return 'rpe'
  if (key === 'core' || key === 'fos' || key === 'advice') return 'core'
  return null
}

/** The role in the audit when there is one, else the course-list section. */
export function categoryOf(course: CatalogCourse, role: UnitRole | null | undefined): Category {
  return categoryOfRole(role) ?? categoryOfSection(course)
}

/* ─── Grades ─────────────────────────────────────────────────────────────── */

/** Pill colours for a letter grade. */
export function gradeTone(grade: string | null | undefined): string {
  const g = (grade || '').toUpperCase()
  if (/^A/.test(g) || g === 'S') return 'bg-green-100 text-green-800 dark:bg-green-500/20 dark:text-green-300'
  if (/^B/.test(g)) return 'bg-lime-100 text-lime-800 dark:bg-lime-500/20 dark:text-lime-300'
  if (/^C/.test(g)) return 'bg-yellow-100 text-yellow-800 dark:bg-yellow-400/20 dark:text-yellow-200'
  if (g === 'D') return 'bg-orange-100 text-orange-800 dark:bg-orange-500/20 dark:text-orange-300'
  if (g === 'F' || g === 'WF' || g === 'U') return 'bg-red-100 text-red-700 dark:bg-red-500/20 dark:text-red-300'
  return 'bg-muted text-muted-foreground'
}

/** Text colour only, for grades inside tables and selects. */
export function gradeText(grade: string | null | undefined): string {
  const g = (grade || '').toUpperCase()
  if (/^A/.test(g) || g === 'S') return 'text-green-700 dark:text-green-400'
  if (/^B/.test(g)) return 'text-lime-700 dark:text-lime-400'
  if (/^C/.test(g)) return 'text-yellow-700 dark:text-yellow-300'
  if (g === 'D') return 'text-orange-700 dark:text-orange-400'
  if (g === 'F' || g === 'WF' || g === 'U') return 'text-red-600 dark:text-red-400'
  return 'text-muted-foreground'
}

/* ─── Progress ───────────────────────────────────────────────────────────── */

export const PROGRESS = {
  done: 'bg-green-600 dark:bg-green-500',
  planned: 'bg-green-300 dark:bg-green-700',
  pending: 'bg-amber-400 dark:bg-amber-500',
}

/* ─── Calendar: one soft hue per class ───────────────────────────────────── */

export interface CourseColor {
  /** Event block background + text. */
  block: string
  /** Left edge of a block or list row. */
  edge: string
  /** A small dot. */
  dot: string
}

export const COURSE_COLORS: CourseColor[] = [
  { block: 'bg-sky-500/12 text-sky-950 dark:bg-sky-400/16 dark:text-sky-50', edge: 'border-l-sky-500', dot: 'bg-sky-500' },
  { block: 'bg-violet-500/12 text-violet-950 dark:bg-violet-400/16 dark:text-violet-50', edge: 'border-l-violet-500', dot: 'bg-violet-500' },
  { block: 'bg-emerald-500/12 text-emerald-950 dark:bg-emerald-400/16 dark:text-emerald-50', edge: 'border-l-emerald-500', dot: 'bg-emerald-500' },
  { block: 'bg-amber-500/14 text-amber-950 dark:bg-amber-400/16 dark:text-amber-50', edge: 'border-l-amber-500', dot: 'bg-amber-500' },
  { block: 'bg-rose-500/12 text-rose-950 dark:bg-rose-400/16 dark:text-rose-50', edge: 'border-l-rose-500', dot: 'bg-rose-500' },
  { block: 'bg-teal-500/12 text-teal-950 dark:bg-teal-400/16 dark:text-teal-50', edge: 'border-l-teal-500', dot: 'bg-teal-500' },
  { block: 'bg-indigo-500/12 text-indigo-950 dark:bg-indigo-400/16 dark:text-indigo-50', edge: 'border-l-indigo-500', dot: 'bg-indigo-500' },
  { block: 'bg-orange-500/12 text-orange-950 dark:bg-orange-400/16 dark:text-orange-50', edge: 'border-l-orange-500', dot: 'bg-orange-500' },
]

export function courseColor(index: number): CourseColor {
  return COURSE_COLORS[((index % COURSE_COLORS.length) + COURSE_COLORS.length) % COURSE_COLORS.length]
}
