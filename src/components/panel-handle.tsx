import { LuChevronLeft as ChevronLeft, LuChevronRight as ChevronRight } from 'react-icons/lu'
import { ResizableHandle } from '@/components/ui/resizable'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'

/**
 * A resize handle that carries its own open/close tab.
 *
 * The tab rides the boundary between the sidebar and the board, so when the sidebar
 * collapses to zero width the tab ends up flush against the edge of the window — the
 * only thing left of a closed panel is the grip that reopens it. Dragging still works
 * on the rest of the handle; the button stops pointer events so a click is a click and
 * not the start of a drag.
 */
export function PanelHandle({
  side,
  open,
  label,
  onToggle,
}: {
  side: 'left' | 'right'
  open: boolean
  label: string
  onToggle: () => void
}) {
  // Open: the chevron points outward, toward where the panel will go.
  // Closed: it points inward, toward where the panel will come back from.
  const pointsLeft = side === 'left' ? open : !open
  const Chevron = pointsLeft ? ChevronLeft : ChevronRight

  return (
    <ResizableHandle
      // Never disabled: a disabled separator makes its own tab unclickable, which
      // would strand a collapsed panel. Dragging a collapsed separator simply
      // pulls the panel back open, which is the behaviour you would expect anyway.
      className={cn('relative w-px transition-colors', open ? 'bg-border hover:bg-primary/40' : 'bg-transparent')}
    >
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            type="button"
            onPointerDown={(e) => e.stopPropagation()}
            onClick={(e) => {
              e.stopPropagation()
              onToggle()
            }}
            aria-label={open ? `Hide ${label}` : `Show ${label}`}
            aria-expanded={open}
            className={cn(
              'absolute top-1/2 z-20 flex h-14 w-[18px] -translate-y-1/2 items-center justify-center',
              'border bg-background text-muted-foreground shadow-sm',
              'transition-colors hover:bg-accent hover:text-foreground',
              'focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none',
              side === 'left'
                ? 'left-0 rounded-r-md border-l-0'
                : 'right-0 rounded-l-md border-r-0',
            )}
          >
            <Chevron className="size-3.5" aria-hidden />
          </button>
        </TooltipTrigger>
        <TooltipContent side={side === 'left' ? 'right' : 'left'}>
          {open ? `Hide ${label}` : `Show ${label}`}
        </TooltipContent>
      </Tooltip>
    </ResizableHandle>
  )
}
