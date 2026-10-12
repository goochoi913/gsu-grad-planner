import { cn } from '@/lib/utils'

/**
 * Bee's mark: a honeycomb cell with two stripes. It follows the text colour, so it
 * reads in light and dark mode alike; public/favicon.svg is the same drawing.
 */
export function Logo({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" className={cn('shrink-0', className)} role="img" aria-label="Bee's Grad Planner" focusable="false">
      <path
        d="M16 2.5 27.7 9.25v13.5L16 29.5 4.3 22.75V9.25Z"
        className="fill-foreground"
        strokeLinejoin="round"
      />
      <rect x="9.5" y="12" width="13" height="2.6" rx="1.3" className="fill-background" />
      <rect x="9.5" y="17.4" width="13" height="2.6" rx="1.3" className="fill-background" />
    </svg>
  )
}
