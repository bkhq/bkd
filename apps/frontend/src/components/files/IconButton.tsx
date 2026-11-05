import type { LucideIcon } from 'lucide-react'
import { cn } from 'cn'

/** Small square icon button used in the headers. */
export function IconButton({
  icon: Icon,
  label,
  onClick,
  active,
}: {
  icon: LucideIcon
  label: string
  onClick: () => void
  active?: boolean
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      aria-pressed={active}
      title={label}
      className={cn(
        'flex h-6 w-6 items-center justify-center rounded-md transition-colors',
        active ? 'bg-accent text-foreground' : 'text-muted-foreground hover:bg-accent hover:text-foreground',
      )}
    >
      <Icon className="h-3.5 w-3.5" />
    </button>
  )
}
