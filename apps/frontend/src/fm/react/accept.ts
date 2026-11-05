import type { FmEntry } from "../core/schema";

/**
 * Whether an entry matches an `accept` list of extensions (`.png`) and MIME
 * types (`text/plain`, `image/*`). An empty or missing list accepts everything;
 * folders are always accepted so they stay navigable.
 */
export function acceptsEntry(entry: Pick<FmEntry, "kind" | "name" | "mime">, accept: readonly string[] | undefined): boolean {
  if (!accept?.length || entry.kind === "dir")
    return true;
  const name = entry.name.toLowerCase();
  const mime = entry.mime?.toLowerCase();
  return accept.some((raw) => {
    const pattern = raw.trim().toLowerCase();
    if (pattern.startsWith("."))
      return name.endsWith(pattern);
    if (!mime)
      return false;
    return pattern.endsWith("/*")
      ? mime.startsWith(pattern.slice(0, -1))
      : mime === pattern;
  });
}
