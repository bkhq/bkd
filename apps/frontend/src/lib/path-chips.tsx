import type { ReactElement, ReactNode } from 'react'
import { cloneElement, Fragment, isValidElement } from 'react'

/**
 * Utilities + component for rendering inline file path chips inside chat
 * messages. The matcher works against a whitelist of "known paths" (paths
 * the AI has already touched in the current issue), so we never accidentally
 * promote a plain noun to a clickable chip.
 *
 * Matching rules:
 *  - Exact substring match against an entry from the known-paths set.
 *  - Optional `:LINE` or `:LINE-LINE` suffix is captured but does not have
 *    to be in the known-paths set.
 *  - Longest paths win — `src/foo.ts` beats `foo.ts` when both are present.
 *  - Match boundaries: each match must be flanked by non-path characters
 *    (or string ends) so `apps/api/foo.ts` is not matched twice when
 *    `foo.ts` is also in the set.
 */

export interface PathChipSegment {
  type: 'path'
  path: string
  /** Original matched substring (may include `:LINE` suffix). */
  matched: string
  line?: number
}

export interface TextSegment {
  type: 'text'
  text: string
}

export type Segment = TextSegment | PathChipSegment

/**
 * Characters that we consider valid path boundaries (anything not in this set
 * counts as "end of path token").
 */
const PATH_BOUNDARY_CHAR = /[\w/.\-:@]/

function normalizePath(p: string): string {
  return p.replace(/^\.\//, '').replace(/\\/g, '/')
}

/**
 * Build a sorted list of known paths suitable for left-to-right scanning.
 * Longest first so multi-segment paths win over their leaf filenames.
 */
export function sortKnownPaths(paths: Iterable<string>): string[] {
  const set = new Set<string>()
  for (const p of paths) {
    const n = normalizePath(p)
    if (n) set.add(n)
  }
  return [...set].sort((a, b) => b.length - a.length)
}

/**
 * Split a text string into a sequence of text + path segments based on the
 * known-paths whitelist. `:LINE` and `:LINE-LINE` suffixes are absorbed into
 * the matched chip.
 *
 * Returns the input as a single text segment when nothing matches.
 */
export function splitByKnownPaths(text: string, sortedPaths: string[]): Segment[] {
  if (!text || sortedPaths.length === 0) return [{ type: 'text', text }]

  const segments: Segment[] = []
  let cursor = 0

  while (cursor < text.length) {
    let bestMatch: { start: number, end: number, path: string, matched: string, line?: number } | null = null

    for (const path of sortedPaths) {
      // A single path may appear multiple times in the text. The first
      // occurrence might fail the boundary check (e.g. `foo.ts` inside
      // `foo.tsx`); we keep scanning forward instead of giving up on this
      // path entirely.
      let searchFrom = cursor
      while (true) {
        const idx = text.indexOf(path, searchFrom)
        if (idx === -1) break

        // Boundary on the left: must be start of string or non-path char.
        if (idx > 0 && PATH_BOUNDARY_CHAR.test(text[idx - 1]!)) {
          searchFrom = idx + 1
          continue
        }

        const endOfPath = idx + path.length
        // Boundary on the right: either non-path char, end of string, or a
        // `:LINE`/`:LINE-LINE` suffix.
        let matchEnd = endOfPath
        let line: number | undefined
        const suffixMatch = text.slice(endOfPath).match(/^:(\d+)(?:-\d+)?/)
        if (suffixMatch) {
          matchEnd = endOfPath + suffixMatch[0].length
          line = Number.parseInt(suffixMatch[1]!, 10)
        } else if (matchEnd < text.length && PATH_BOUNDARY_CHAR.test(text[matchEnd]!)) {
          // Path continues with `_`, `.`, `-`, etc. — this isn't a clean match.
          searchFrom = idx + 1
          continue
        }

        if (bestMatch === null || idx < bestMatch.start
          || (idx === bestMatch.start && matchEnd > bestMatch.end)) {
          bestMatch = {
            start: idx,
            end: matchEnd,
            path,
            matched: text.slice(idx, matchEnd),
            line,
          }
        }
        // This path has been placed at its earliest valid occurrence; no
        // need to scan further — a later occurrence would only lose the
        // earliest-start tiebreak.
        break
      }
    }

    if (!bestMatch) {
      segments.push({ type: 'text', text: text.slice(cursor) })
      break
    }

    if (bestMatch.start > cursor) {
      segments.push({ type: 'text', text: text.slice(cursor, bestMatch.start) })
    }
    segments.push({
      type: 'path',
      path: bestMatch.path,
      matched: bestMatch.matched,
      line: bestMatch.line,
    })
    cursor = bestMatch.end
  }

  return segments
}

/**
 * Render a single inline path chip. Keeps the same visual language as the
 * static `PathBadge` used in tool-call summaries but is clickable.
 */
export function PathChip({
  path,
  line,
  matched,
  onClick,
  ariaLabel,
}: {
  path: string
  line?: number
  matched?: string
  onClick: (path: string, line?: number) => void
  ariaLabel?: string
}) {
  const label = matched ?? (line ? `${path}:${line}` : path)
  return (
    <button
      type="button"
      onClick={(e) => {
        // preventDefault for symmetry with the tool-call PathBadge — if a
        // chip ends up inside a <summary> or <a>, we don't want the
        // default action of the host element to fire alongside.
        e.preventDefault()
        e.stopPropagation()
        onClick(path, line)
      }}
      aria-label={ariaLabel ?? label}
      className="inline rounded bg-muted/50 px-1.5 py-0.5 text-[11px] font-mono whitespace-nowrap text-foreground/90 hover:bg-muted hover:ring-1 hover:ring-primary/40 transition-colors cursor-pointer align-baseline"
    >
      {label}
    </button>
  )
}

/**
 * Walk an arbitrary React children tree and replace string nodes with
 * `<PathChip>` for known-path matches. Recurses through nested React
 * elements (e.g. text inside `<em>` / `<strong>`) but skips children of
 * elements whose tag is in `skipTags` (e.g. inline code, code blocks).
 *
 * Returns a React node array suitable for spreading into a parent element.
 */
export function transformChildrenWithPathChips(
  children: ReactNode,
  sortedPaths: string[],
  onClick: (path: string, line?: number) => void,
  skipTags: ReadonlySet<string> = SKIP_TAGS,
): ReactNode {
  if (sortedPaths.length === 0) return children

  function walk(node: ReactNode, keyPrefix: string): ReactNode {
    if (typeof node === 'string') {
      const segments = splitByKnownPaths(node, sortedPaths)
      if (segments.length === 1 && segments[0]!.type === 'text') return node
      return segments.map((seg, idx) =>
        seg.type === 'path'
          ? (
              <PathChip
                key={`${keyPrefix}-p-${idx}`}
                path={seg.path}
                line={seg.line}
                matched={seg.matched}
                onClick={onClick}
              />
            )
          : <Fragment key={`${keyPrefix}-t-${idx}`}>{seg.text}</Fragment>,
      )
    }

    if (Array.isArray(node)) {
      return node.map((child, idx) => (
        <Fragment key={`${keyPrefix}-a-${idx}`}>{walk(child, `${keyPrefix}-${idx}`)}</Fragment>
      ))
    }

    if (isValidElement(node)) {
      const element = node as ReactElement<{ children?: ReactNode }>
      const elementType = element.type
      const tagName = typeof elementType === 'string' ? elementType : ''
      if (tagName && skipTags.has(tagName)) return node
      // Component (function) — opaque; do not recurse to avoid breaking
      // component children expectations.
      if (typeof elementType !== 'string') return node
      const childChildren = element.props?.children
      if (childChildren === undefined) return node
      // `cloneElement` is the canonical API for wrapping arbitrary react-
      // markdown output without losing element keys / refs. The lint rule
      // discourages it for state plumbing; here it is pure subtree rewrite.
      // eslint-disable-next-line react/no-clone-element
      return cloneElement(element, undefined, walk(childChildren, `${keyPrefix}-c`))
    }

    return node
  }

  return walk(children, 'k')
}

/** Tag names whose subtrees must not be transformed (already styled). */
export const SKIP_TAGS: ReadonlySet<string> = new Set([
  'code',
  'pre',
  'a', // already linkified by react-markdown
])
