import { LuShare } from 'react-icons/lu'
import type { Prefs } from '@/hooks/use-prefs'
import { PROFESSORS, SCHEDULE_TERM_ID, scheduleFor } from '@/lib/schedule'
import { fmtDate } from '@/lib/format'
import { Label } from '@/components/ui/label'
import { Separator } from '@/components/ui/separator'
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { Switch } from '@/components/ui/switch'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'

export function SettingsSheet({
  open,
  onOpenChange,
  prefs,
  onPref,
}: {
  open: boolean
  onOpenChange: (o: boolean) => void
  prefs: Prefs
  onPref: <K extends keyof Prefs>(k: K, v: Prefs[K]) => void
}) {
  const sched = scheduleFor(SCHEDULE_TERM_ID)
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-full gap-0 overflow-y-auto sm:max-w-md">
        <SheetHeader>
          <SheetTitle>Settings</SheetTitle>
          <SheetDescription>These only change how the planner looks on this device. The plan and the record are shared through Firebase.</SheetDescription>
        </SheetHeader>
        <div className="space-y-5 px-4 pb-8">
          <div className="space-y-1.5">
            <Label className="text-sm">Theme</Label>
            <ToggleGroup type="single" variant="outline" size="sm" value={prefs.theme} onValueChange={(v) => v && onPref('theme', v as Prefs['theme'])} className="w-full">
              <ToggleGroupItem value="light" className="flex-1 text-xs">Light</ToggleGroupItem>
              <ToggleGroupItem value="dark" className="flex-1 text-xs">Dark</ToggleGroupItem>
              <ToggleGroupItem value="system" className="flex-1 text-xs">System</ToggleGroupItem>
            </ToggleGroup>
          </div>

          <div className="flex items-start justify-between gap-4">
            <div className="space-y-0.5">
              <Label htmlFor="show-past" className="text-sm">Show completed terms on the plan</Label>
              <p className="text-xs text-muted-foreground">Past terms and grades above the planned ones.</p>
            </div>
            <Switch id="show-past" checked={prefs.showPast} onCheckedChange={(v) => onPref('showPast', v)} />
          </div>

          <div className="space-y-1.5">
            <Label className="text-sm">Calendar opens on</Label>
            <ToggleGroup type="single" variant="outline" size="sm" value={prefs.calendarMode} onValueChange={(v) => v && onPref('calendarMode', v as Prefs['calendarMode'])} className="w-full">
              <ToggleGroupItem value="week" className="flex-1 text-xs">The whole week</ToggleGroupItem>
              <ToggleGroupItem value="day" className="flex-1 text-xs">One day</ToggleGroupItem>
            </ToggleGroup>
          </div>

          <Separator />

          <div className="space-y-2">
            <div className="text-sm font-medium">Put it on your phone’s home screen</div>
            <p className="text-xs leading-relaxed text-muted-foreground">
              iPhone: open this page in Safari, tap <LuShare className="inline size-3.5 align-text-bottom" aria-label="Share" /> Share, then “Add to Home Screen”. Android: in Chrome, open the ⋮ menu and tap “Add to Home screen” or “Install app”. It then opens like an app, full screen.
            </p>
          </div>

          <Separator />

          <div className="space-y-1 text-xs leading-relaxed text-muted-foreground">
            {sched && (
              <p>
                {sched.label} class schedule: your CSV copy, checked against GSU’s class search on {fmtDate(sched.sources.banner?.fetchedAt ?? sched.generatedAt)}.
              </p>
            )}
            <p>Professor ratings: RateMyProfessors (Georgia State), {fmtDate(PROFESSORS.fetchedAt)}.</p>
            <p>Degree rules: GSU 2024–2025 catalog and Degree Works. No sign-in — anyone with this link can see and edit the plan.</p>
          </div>
        </div>
      </SheetContent>
    </Sheet>
  )
}
