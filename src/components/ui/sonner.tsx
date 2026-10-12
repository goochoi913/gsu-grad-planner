import {
  LuCircleCheck as CircleCheckIcon,
  LuInfo as InfoIcon,
  LuLoaderCircle as Loader2Icon,
  LuOctagonX as OctagonXIcon,
  LuTriangleAlert as TriangleAlertIcon,
} from "react-icons/lu"
import { Toaster as Sonner, type ToasterProps } from "sonner"

// The theme comes from the app's own preference (see use-prefs), not next-themes.
const Toaster = ({ theme = "system", ...props }: ToasterProps) => {
  return (
    <Sonner
      theme={theme}
      className="toaster group"
      icons={{
        success: <CircleCheckIcon className="size-4" />,
        info: <InfoIcon className="size-4" />,
        warning: <TriangleAlertIcon className="size-4" />,
        error: <OctagonXIcon className="size-4" />,
        loading: <Loader2Icon className="size-4 animate-spin" />,
      }}
      style={
        {
          "--normal-bg": "var(--popover)",
          "--normal-text": "var(--popover-foreground)",
          "--normal-border": "var(--border)",
          "--border-radius": "var(--radius)",
        } as React.CSSProperties
      }
      {...props}
    />
  )
}

export { Toaster }
