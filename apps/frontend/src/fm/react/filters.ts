/** Type groups offered by the list filter. */
export const FILTER_KINDS = [
  "folder",
  "image",
  "video",
  "audio",
  "document",
  "sheet",
  "code",
  "archive",
  "other",
] as const;
export type FmFilterKind = typeof FILTER_KINDS[number];

/** Ranges offered by the "Modified" filter. */
export const MODIFIED_RANGES = ["any", "today", "7d", "30d", "year"] as const;
export type FmModifiedRange = typeof MODIFIED_RANGES[number];

export interface FmListFilters {
  /** Empty: every type. */
  types: readonly FmFilterKind[];
  modified: FmModifiedRange;
  /** Host column values to keep, by column id (`entry.extra` key); an empty list keeps all. */
  extra?: Readonly<Record<string, readonly string[]>>;
}

export const NO_FILTERS: FmListFilters = { types: [], modified: "any" };

const hasExtra = (f: FmListFilters) => Object.values(f.extra ?? {}).some(v => v.length > 0);

export const hasFilters = (f: FmListFilters) => f.types.length > 0 || f.modified !== "any" || hasExtra(f);

type FmExtraValue = string | number | boolean | null;

/** A column value as text; missing and null read as empty. */
function columnText(e: { extra?: Readonly<Record<string, FmExtraValue>> | undefined }, id: string) {
  const v = e.extra?.[id];
  return v === undefined || v === null
    ? ""
    : String(v);
}

/** Distinct non-empty values of a host column, sorted, for its filter menu. */
export function columnValues(entries: readonly { extra?: Readonly<Record<string, FmExtraValue>> | undefined }[], id: string): string[] {
  return [
    ...new Set(entries.map(e => columnText(e, id)).filter(Boolean)),
  ].sort((a, b) => a.localeCompare(b));
}

const DOCUMENT = /\.(?:pdf|docx?|odt|rtf|pptx?|odp|pages|key)$/i;
const SHEET = /\.(?:csv|tsv|xlsx?|ods|numbers)$/i;
const ARCHIVE = /\.(?:zip|tar|t?gz|tbz2?|bz2|xz|7z|rar)$/i;
const CODE = /\.(?:txt|md|markdown|json|jsonc|ya?ml|toml|ini|env|log|xml|html?|css|scss|less|[cm]?[jt]sx?|vue|svelte|py|rb|go|rs|java|kt|swift|c|h|cc|cpp|hpp|cs|php|sh|bash|zsh|fish|sql|graphql|proto|conf|lock)$/i;

export function filterKindOf(entry: { kind: "file" | "dir"; name: string; mime?: string | undefined }): FmFilterKind {
  if (entry.kind === "dir")
    return "folder";
  const mime = entry.mime ?? "";
  const name = entry.name;
  if (mime.startsWith("image/"))
    return "image";
  if (mime.startsWith("video/"))
    return "video";
  if (mime.startsWith("audio/"))
    return "audio";
  if (SHEET.test(name) || /spreadsheet|ms-excel|text\/(?:csv|tab-separated)/.test(mime))
    return "sheet";
  if (DOCUMENT.test(name) || mime === "application/pdf" || /wordprocessing|presentation|msword|ms-powerpoint/.test(mime))
    return "document";
  if (ARCHIVE.test(name) || /zip|gzip|x-tar|x-7z|x-rar/.test(mime))
    return "archive";
  if (CODE.test(name) || mime.startsWith("text/") || /^(?:Dockerfile|Makefile|LICENSE|README)$/i.test(name))
    return "code";
  return "other";
}

/** Earliest modification time a range accepts (local time), or undefined for "any". */
export function modifiedSince(range: FmModifiedRange, now = new Date()): Date | undefined {
  switch (range) {
    case "today": return new Date(now.getFullYear(), now.getMonth(), now.getDate());
    case "7d": return new Date(now.getTime() - 7 * 86_400_000);
    case "30d": return new Date(now.getTime() - 30 * 86_400_000);
    case "year": return new Date(now.getFullYear(), 0, 1);
    default: return undefined;
  }
}

/** Entries matching `f`; the same array when nothing is filtered. `keepFolders` lets folders through (tree). */
export function applyFilters<T extends { kind: "file" | "dir"; name: string; mime?: string | undefined; mtime: string; extra?: Readonly<Record<string, FmExtraValue>> | undefined }>(
  entries: readonly T[],
  f: FmListFilters,
  o: { now?: Date; keepFolders?: boolean } = {},
): readonly T[] {
  if (!hasFilters(f))
    return entries;
  const since = modifiedSince(f.modified, o.now)?.getTime();
  return entries.filter((e) => {
    if (o.keepFolders && e.kind === "dir")
      return true;
    if (f.types.length && !f.types.includes(filterKindOf(e)))
      return false;
    for (const [id, values] of Object.entries(f.extra ?? {})) {
      if (values.length && !values.includes(columnText(e, id)))
        return false;
    }
    return since === undefined || Date.parse(e.mtime) >= since;
  });
}

function parseExtra(raw: unknown): Pick<FmListFilters, "extra"> {
  if (!raw || typeof raw !== "object")
    return {};
  const extra = Object.fromEntries(Object.entries(raw)
    .filter((kv): kv is [string, unknown[]] => Array.isArray(kv[1]))
    .map(([id, values]) => [
      id,
      values.filter((x): x is string => typeof x === "string"),
    ]));
  return Object.keys(extra).length
    ? { extra }
    : {};
}

/** Stored filters (JSON), dropping unknown values; anything unreadable is no filter. */
export function parseFilters(raw: string | null): FmListFilters {
  try {
    const v = JSON.parse(raw ?? "null") as Partial<FmListFilters> | null;
    return {
      types: Array.isArray(v?.types)
        ? FILTER_KINDS.filter(k => v.types!.includes(k))
        : [],
      modified: MODIFIED_RANGES.find(r => r === v?.modified) ?? "any",
      ...parseExtra(v?.extra),
    };
  }
  catch {
    return NO_FILTERS;
  }
}
