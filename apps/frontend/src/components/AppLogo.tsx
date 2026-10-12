import { useTheme } from '@/hooks/use-theme'
import { cn } from 'cn'

export function AppLogo({ className }: { className?: string }) {
  const { resolved } = useTheme()
  return (
    <img
      src={resolved === 'dark' ? '/favicon-dark.svg' : '/favicon.svg'}
      alt="BKD"
      className={cn('rounded-lg', className)}
    />
  )
}
