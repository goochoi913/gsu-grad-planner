import {
  LuCalendarDays,
  LuChartLine,
  LuCloud,
  LuCloudOff,
  LuCommand,
  LuDownload,
  LuEllipsis,
  LuFileText,
  LuFlaskConical,
  LuLayoutGrid,
  LuNotebookPen,
  LuPrinter,
  LuRotateCcw,
  LuSettings,
  LuSquarePen,
} from 'react-icons/lu'
import type { SyncStatus } from '@/lib/store'
import type { View } from '@/hooks/use-prefs'
import { Logo } from '@/components/logo'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'

const SYNC_LABEL: Record<SyncStatus, string> = {
  connecting: 'Connecting…',
  online: 'Saved to Firebase',
  saving: 'Saving…',
  error: 'Offline — changes are kept on this device',
  fixture: 'Test data — nothing is saved',
}

export function AppHeader({
  view,
  onView,
  sync,
  isMobile,
  onOpenCommand,
  onOpenSettings,
  onOpenRecord,
  onOpenGpa,
  onOpenExceptions,
  onDownloadRecord,
  onPrint,
  onResetPlan,
}: {
  view: View
  onView: (v: View) => void
  sync: SyncStatus
  isMobile: boolean
  onOpenCommand: () => void
  onOpenSettings: () => void
  onOpenRecord: () => void
  onOpenGpa: () => void
  onOpenExceptions: () => void
  onDownloadRecord: () => void
  onPrint: () => void
  onResetPlan: () => void
}) {
  return (
    <header className="shrink-0 border-b bg-background pt-safe" data-print="hide">
      <div className="flex h-12 items-center gap-2 px-3">
        <Logo className="size-6" />
        <div className="min-w-0 leading-tight">
          <div className="truncate text-sm font-semibold tracking-tight">Bee’s Planner</div>
          <div className="hidden truncate text-[11px] text-muted-foreground sm:block">GSU · B.S. Computer Science</div>
        </div>

        <div className="flex-1" />

        {!isMobile && (
          <ToggleGroup
            type="single"
            size="sm"
            variant="outline"
            value={view}
            onValueChange={(v) => v && onView(v as View)}
            aria-label="View"
          >
            <ToggleGroupItem value="plan" className="px-2.5 text-xs">
              <LuLayoutGrid className="size-3.5" aria-hidden />
              Plan
            </ToggleGroupItem>
            <ToggleGroupItem value="schedule" className="px-2.5 text-xs">
              <LuCalendarDays className="size-3.5" aria-hidden />
              Schedule
            </ToggleGroupItem>
            <ToggleGroupItem value="summary" className="px-2.5 text-xs">
              <LuFileText className="size-3.5" aria-hidden />
              Summary
            </ToggleGroupItem>
          </ToggleGroup>
        )}

        {!isMobile && (
          <>
            <Button variant="ghost" size="sm" className="h-8 px-2.5 text-xs" onClick={onOpenGpa}>
              <LuChartLine className="size-3.5" aria-hidden />
              GPA
            </Button>
            <Button variant="ghost" size="sm" className="h-8 px-2.5 text-xs" onClick={onOpenRecord}>
              <LuNotebookPen className="size-3.5" aria-hidden />
              Record
            </Button>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button variant="ghost" size="icon" className="size-8" onClick={onOpenCommand} aria-label="Search">
                  <LuCommand className="size-4" aria-hidden />
                </Button>
              </TooltipTrigger>
              <TooltipContent>
                Search courses and actions <kbd className="mono ml-1 opacity-70">⌘K</kbd>
              </TooltipContent>
            </Tooltip>
          </>
        )}

        <Tooltip>
          <TooltipTrigger asChild>
            <span
              data-sync={sync}
              className={cn(
                'flex size-8 items-center justify-center',
                sync === 'error' ? 'text-destructive' : 'text-muted-foreground',
              )}
              aria-label={SYNC_LABEL[sync]}
              role="status"
            >
              {sync === 'fixture' ? (
                <LuFlaskConical className="size-4" aria-hidden />
              ) : sync === 'error' ? (
                <LuCloudOff className="size-4" aria-hidden />
              ) : (
                <LuCloud className={cn('size-4', (sync === 'saving' || sync === 'connecting') && 'animate-pulse')} aria-hidden />
              )}
            </span>
          </TooltipTrigger>
          <TooltipContent>{SYNC_LABEL[sync]}</TooltipContent>
        </Tooltip>

        {!isMobile && (
          <Tooltip>
            <TooltipTrigger asChild>
              <Button variant="ghost" size="icon" className="size-8" onClick={onOpenSettings} aria-label="Settings">
                <LuSettings className="size-4" aria-hidden />
              </Button>
            </TooltipTrigger>
            <TooltipContent>Settings</TooltipContent>
          </Tooltip>
        )}

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon" className="size-8" aria-label="More">
              <LuEllipsis className="size-4" aria-hidden />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-60">
            {isMobile && (
              <>
                <DropdownMenuItem onClick={onOpenGpa}>
                  <LuChartLine className="size-4" aria-hidden />
                  GPA projection
                </DropdownMenuItem>
                <DropdownMenuItem onClick={onOpenRecord}>
                  <LuNotebookPen className="size-4" aria-hidden />
                  Academic record
                </DropdownMenuItem>
              </>
            )}
            <DropdownMenuItem onClick={onOpenExceptions}>
              <LuSquarePen className="size-4" aria-hidden />
              Advisor exceptions
            </DropdownMenuItem>
            {isMobile && (
              <DropdownMenuItem onClick={() => onView('summary')}>
                <LuFileText className="size-4" aria-hidden />
                Summary
              </DropdownMenuItem>
            )}
            <DropdownMenuItem onClick={onPrint}>
              <LuPrinter className="size-4" aria-hidden />
              Print summary
            </DropdownMenuItem>
            <DropdownMenuItem onClick={onDownloadRecord}>
              <LuDownload className="size-4" aria-hidden />
              Download record backup
            </DropdownMenuItem>
            {isMobile && (
              <DropdownMenuItem onClick={onOpenSettings}>
                <LuSettings className="size-4" aria-hidden />
                Settings
              </DropdownMenuItem>
            )}
            <DropdownMenuSeparator />
            <DropdownMenuItem variant="destructive" onClick={onResetPlan}>
              <LuRotateCcw className="size-4" aria-hidden />
              Clear planned terms…
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </header>
  )
}
