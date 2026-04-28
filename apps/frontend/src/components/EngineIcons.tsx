import type { SVGProps } from 'react'

type IconProps = SVGProps<SVGSVGElement>

/** Claude Code — starburst / sunburst logo */
export function ClaudeIcon(props: IconProps) {
  // 16 rays from center, alternating long/short, rounded caps
  const cx = 12
  const cy = 12
  const rInner = 2.5
  const rLong = 10.5
  const rShort = 7.5
  const rays = 16
  const paths: string[] = []
  for (let i = 0; i < rays; i++) {
    const angle = (Math.PI * 2 * i) / rays - Math.PI / 2
    const rOuter = i % 2 === 0 ? rLong : rShort
    const x1 = cx + rInner * Math.cos(angle)
    const y1 = cy + rInner * Math.sin(angle)
    const x2 = cx + rOuter * Math.cos(angle)
    const y2 = cy + rOuter * Math.sin(angle)
    paths.push(`M${x1.toFixed(2)},${y1.toFixed(2)}L${x2.toFixed(2)},${y2.toFixed(2)}`)
  }
  return (
    <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" {...props}>
      <path d={paths.join('')} stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  )
}

/** Claude Code SDK — sunburst with inner ring to mark the SDK variant */
export function ClaudeSdkIcon(props: IconProps) {
  const cx = 12
  const cy = 12
  const rInner = 4.6
  const rLong = 10.5
  const rShort = 8
  const rays = 16
  const paths: string[] = []
  for (let i = 0; i < rays; i++) {
    const angle = (Math.PI * 2 * i) / rays - Math.PI / 2
    const rOuter = i % 2 === 0 ? rLong : rShort
    const x1 = cx + rInner * Math.cos(angle)
    const y1 = cy + rInner * Math.sin(angle)
    const x2 = cx + rOuter * Math.cos(angle)
    const y2 = cy + rOuter * Math.sin(angle)
    paths.push(`M${x1.toFixed(2)},${y1.toFixed(2)}L${x2.toFixed(2)},${y2.toFixed(2)}`)
  }
  return (
    <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" {...props}>
      <path d={paths.join('')} stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
      <circle cx={cx} cy={cy} r={3.4} stroke="currentColor" strokeWidth="1.3" fill="none" />
    </svg>
  )
}

/** OpenAI / Codex */
export function CodexIcon(props: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" {...props}>
      <path
        d="M22.282 9.821a5.985 5.985 0 0 0-.516-4.91 6.046 6.046 0 0 0-6.51-2.9A6.065 6.065 0 0 0 4.981 4.18a5.998 5.998 0 0 0-3.998 2.9 6.05 6.05 0 0 0 .743 7.097 5.98 5.98 0 0 0 .51 4.911 6.051 6.051 0 0 0 6.515 2.9A5.985 5.985 0 0 0 13.26 24a6.056 6.056 0 0 0 5.772-4.206 5.99 5.99 0 0 0 3.997-2.9 6.057 6.057 0 0 0-.747-7.073zM13.26 22.43a4.476 4.476 0 0 1-2.876-1.04l.143-.08 4.779-2.758a.795.795 0 0 0 .392-.681v-6.737l2.02 1.168a.071.071 0 0 1 .038.052v5.583a4.504 4.504 0 0 1-4.496 4.494zM3.6 18.304a4.47 4.47 0 0 1-.535-3.014l.142.085 4.783 2.759a.773.773 0 0 0 .78 0l5.843-3.369v2.332a.08.08 0 0 1-.033.062L9.724 19.95a4.5 4.5 0 0 1-6.123-1.645zM2.34 7.896a4.485 4.485 0 0 1 2.34-1.971V11.6a.766.766 0 0 0 .388.676l5.815 3.355-2.02 1.168a.076.076 0 0 1-.071.005l-4.83-2.786A4.504 4.504 0 0 1 2.34 7.872zm16.597 3.855l-5.833-3.387L15.119 7.2a.076.076 0 0 1 .071-.006l4.83 2.791a4.494 4.494 0 0 1-.676 8.105v-5.678a.79.79 0 0 0-.407-.66zm2.01-3.023l-.141-.085-4.774-2.782a.776.776 0 0 0-.785 0L9.409 9.23V6.897a.066.066 0 0 1 .028-.061l4.83-2.787a4.5 4.5 0 0 1 6.68 4.66zm-12.64 4.135l-2.02-1.164a.08.08 0 0 1-.038-.057V6.075a4.5 4.5 0 0 1 7.375-3.453l-.142.08L8.704 5.46a.795.795 0 0 0-.393.681zm1.097-2.365l2.602-1.5 2.607 1.5v3.005l-2.602 1.5-2.607-1.5z"
        fill="currentColor"
      />
    </svg>
  )
}

const ENGINE_ICONS: Partial<Record<string, React.FC<IconProps>>> = {
  'claude-code': ClaudeIcon,
  'claude-code-sdk': ClaudeSdkIcon,
  'codex': CodexIcon,
}

export function EngineIcon({ engineType, ...props }: IconProps & { engineType: string }) {
  const Icon = ENGINE_ICONS[engineType]
  if (!Icon) {
    // Fallback: first letter
    return (
      <span
        className={props.className}
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontWeight: 700,
          fontSize: '0.65em',
        }}
      >
        {engineType.charAt(0).toUpperCase()}
      </span>
    )
  }
  return <Icon {...props} />
}
