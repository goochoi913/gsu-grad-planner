/**
 * Course hues — the one place the interface spends colour freely, because on a
 * calendar a colour is the fastest way to tell two classes apart. Soft tints on
 * a neutral ground; the same course keeps the same hue in the list and the grid.
 * (Full class names are spelled out so Tailwind keeps them.)
 */
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
