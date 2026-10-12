import { cn } from '@/lib/utils'

/**
 * Bee's mark: a yellow honeycomb cell with two dark stripes — yellow is her favourite
 * colour. public/favicon.svg and public/pwa-source.svg are the same drawing.
 */
export function Logo({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" className={cn('shrink-0', className)} role="img" aria-label="Bee's Grad Planner" focusable="false">
      <path d="M16 2.5 27.7 9.25v13.5L16 29.5 4.3 22.75V9.25Z" fill="#facc15" stroke="#eab308" strokeWidth="1" strokeLinejoin="round" />
      <rect x="9.5" y="12" width="13" height="2.6" rx="1.3" fill="#171717" />
      <rect x="9.5" y="17.4" width="13" height="2.6" rx="1.3" fill="#171717" />
    </svg>
  )
}
