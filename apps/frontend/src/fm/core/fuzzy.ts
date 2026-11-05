const BOUNDARY = "/.-_ ";

function isSubsequence(query: string, text: string, from: number): boolean {
  let i = 0;
  for (let j = from; j < text.length && i < query.length; j++) {
    if (text[j] === query[i])
      i++;
  }
  return i === query.length;
}

function isBoundary(text: string, i: number, baseStart: number): boolean {
  return i === 0 || i === baseStart || BOUNDARY.includes(text[i - 1]!);
}

/** Best match in `text[from..]`: 0 none, 1 anywhere, 2 starting at a word boundary. */
function matchAt(query: string, text: string, from: number, baseStart: number, contiguous: boolean): number {
  let found = 0;
  for (let i = text.indexOf(query[0]!, from); i !== -1; i = text.indexOf(query[0]!, i + 1)) {
    const ok = contiguous
      ? text.startsWith(query, i)
      : isSubsequence(query, text, i);
    if (!ok)
      continue;
    if (isBoundary(text, i, baseStart))
      return 2;
    found = 1;
  }
  return found;
}

/**
 * Scores `path` against `query`; null when the query is not a subsequence of the path.
 * Encoding: tier * 1e6 - path.length * 10 + boundaryBonus, where tier is
 * 4 substring of basename, 3 substring of path, 2 subsequence of basename, 1 subsequence of path,
 * and boundaryBonus is 1 when the match starts at a word boundary.
 */
export function fuzzyScore(query: string, path: string): number | null {
  const q = query.replace(/\s+/g, "").toLocaleLowerCase();
  if (!q)
    return 0;
  const text = path.toLocaleLowerCase();
  const baseStart = text.lastIndexOf("/") + 1;
  const tiers: [number, number, boolean][] = [
    [4, baseStart, true],
    [3, 0, true],
    [2, baseStart, false],
    [1, 0, false],
  ];
  for (const [tier, from, contiguous] of tiers) {
    const match = matchAt(q, text, from, baseStart, contiguous);
    if (match)
      return tier * 1e6 - path.length * 10 + match - 1;
  }
  return null;
}

/** Items matching `query`, best first (ties keep input order), at most `limit`. */
export function fuzzyRank<T>(query: string, items: T[], pathOf: (item: T) => string, limit: number): T[] {
  const scored: { item: T; score: number }[] = [];
  for (const item of items) {
    const score = fuzzyScore(query, pathOf(item));
    if (score !== null)
      scored.push({ item, score });
  }
  return scored.sort((a, b) => b.score - a.score).slice(0, limit).map(s => s.item);
}
