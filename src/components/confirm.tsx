import { useSyncExternalStore } from 'react'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { buttonVariants } from '@/components/ui/button'

/**
 * `await confirmAction({ … })` — the app's replacement for window.confirm(), rendered
 * by <ConfirmHost/> as a proper alert dialog that works the same on a phone.
 */
export interface ConfirmOptions {
  title: string
  description?: React.ReactNode
  confirmLabel?: string
  cancelLabel?: string
  destructive?: boolean
}

let current: (ConfirmOptions & { resolve: (ok: boolean) => void }) | null = null
const listeners = new Set<() => void>()
const emit = () => listeners.forEach((l) => l())

export function confirmAction(opts: ConfirmOptions): Promise<boolean> {
  return new Promise((resolve) => {
    current?.resolve(false)
    current = { ...opts, resolve }
    emit()
  })
}

function close(ok: boolean) {
  const c = current
  current = null
  emit()
  c?.resolve(ok)
}

export function ConfirmHost() {
  const c = useSyncExternalStore(
    (l) => {
      listeners.add(l)
      return () => listeners.delete(l)
    },
    () => current,
  )
  return (
    <AlertDialog open={!!c} onOpenChange={(o) => !o && close(false)}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{c?.title}</AlertDialogTitle>
          {c?.description && <AlertDialogDescription asChild={typeof c.description !== 'string'}>{typeof c.description === 'string' ? c.description : <div>{c.description}</div>}</AlertDialogDescription>}
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel onClick={() => close(false)}>{c?.cancelLabel ?? 'Cancel'}</AlertDialogCancel>
          <AlertDialogAction
            className={c?.destructive ? buttonVariants({ variant: 'destructive' }) : undefined}
            onClick={() => close(true)}
          >
            {c?.confirmLabel ?? 'OK'}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
