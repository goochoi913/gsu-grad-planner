import type { ReactNode } from 'react'
import { Dialog as DialogPrimitive } from 'radix-ui'
import { LuX } from 'react-icons/lu'
import { cn } from '@/lib/utils'

/**
 * Every dialog in the app: centred on a computer, a bottom sheet on a phone (full
 * width, rounded top, thumb-reachable close button). Header and footer stay put and
 * the body scrolls.
 */
export function AppDialog({
  open,
  onOpenChange,
  title,
  description,
  eyebrow,
  headerExtra,
  footer,
  children,
  size = 'md',
  bodyClassName,
  initialFocus,
  compactHeaderOnPhone = false,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  title: ReactNode
  description?: ReactNode
  /** Small line above the title (a course code, a section label). */
  eyebrow?: ReactNode
  headerExtra?: ReactNode
  footer?: ReactNode
  children: ReactNode
  /** wide: the section picker — options beside the week, a fixed height so the calendar can fill it. */
  size?: 'sm' | 'md' | 'lg' | 'xl' | 'wide'
  bodyClassName?: string
  /** Let the dialog put focus on its first field instead of the close button. */
  initialFocus?: boolean
  /** On a phone, show only the eyebrow and title (room for the section picker's week). */
  compactHeaderOnPhone?: boolean
}) {
  return (
    <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-black/40 backdrop-blur-[1px] data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:animate-in data-[state=open]:fade-in-0" />
        <DialogPrimitive.Content
          onOpenAutoFocus={initialFocus ? undefined : (e) => e.preventDefault()}
          className={cn(
            'fixed z-50 flex flex-col overflow-hidden border bg-background shadow-xl outline-none',
            // phone: a bottom sheet
            'inset-x-0 bottom-0 max-h-[92dvh] rounded-t-2xl pb-safe',
            'data-[state=open]:animate-in data-[state=open]:slide-in-from-bottom data-[state=closed]:animate-out data-[state=closed]:slide-out-to-bottom data-[state=open]:duration-300',
            // computer: centred
            'sm:inset-x-auto sm:top-1/2 sm:bottom-auto sm:left-1/2 sm:max-h-[88vh] sm:w-[calc(100%-2rem)] sm:-translate-x-1/2 sm:-translate-y-1/2 sm:rounded-xl sm:pb-0',
            'sm:data-[state=open]:slide-in-from-bottom-0 sm:data-[state=open]:zoom-in-95 sm:data-[state=closed]:slide-out-to-bottom-0 sm:data-[state=closed]:zoom-out-95 sm:data-[state=open]:fade-in-0 sm:data-[state=closed]:fade-out-0 sm:data-[state=open]:duration-200',
            size === 'sm' && 'sm:max-w-md',
            size === 'md' && 'sm:max-w-xl',
            size === 'lg' && 'sm:max-w-2xl',
            size === 'xl' && 'sm:max-w-4xl',
            size === 'wide' && 'h-[92dvh] sm:h-[90vh] sm:max-h-[90vh] sm:max-w-6xl',
          )}
        >
          <div className="mx-auto mt-2 h-1 w-10 shrink-0 rounded-full bg-muted-foreground/25 sm:hidden" aria-hidden />
          <div className="shrink-0 space-y-1 border-b px-5 pt-3 pb-3.5 pr-14 sm:px-6 sm:pt-5 sm:pb-4">
            {eyebrow && <div className="text-xs text-muted-foreground">{eyebrow}</div>}
            <DialogPrimitive.Title className="text-lg leading-snug font-semibold tracking-tight">{title}</DialogPrimitive.Title>
            {description ? (
              <DialogPrimitive.Description className={cn('text-sm text-muted-foreground', compactHeaderOnPhone && 'max-sm:sr-only')}>{description}</DialogPrimitive.Description>
            ) : (
              <DialogPrimitive.Description className="sr-only">{typeof title === 'string' ? title : 'Details'}</DialogPrimitive.Description>
            )}
            {headerExtra && <div className={cn(compactHeaderOnPhone && 'max-sm:hidden')}>{headerExtra}</div>}
          </div>
          <div className={cn('min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 py-4 sm:px-6 sm:py-5', bodyClassName)}>{children}</div>
          {footer && <div className="shrink-0 border-t bg-background px-5 py-3 sm:px-6">{footer}</div>}
          <DialogPrimitive.Close
            className="absolute top-3 right-3 flex size-9 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none sm:top-4 sm:right-4 sm:size-8"
            aria-label="Close"
          >
            <LuX className="size-4" />
          </DialogPrimitive.Close>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  )
}

/** A titled block inside a dialog body. */
export function DialogSection({ title, action, children, className }: { title?: ReactNode; action?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={cn('space-y-2.5 py-4 first:pt-0 last:pb-0 [&+&]:border-t', className)}>
      {(title || action) && (
        <div className="flex items-center gap-2">
          {title && <h3 className="flex-1 text-xs font-semibold tracking-wide text-muted-foreground uppercase">{title}</h3>}
          {action}
        </div>
      )}
      {children}
    </section>
  )
}
