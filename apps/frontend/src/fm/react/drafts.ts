/** Unsaved editor text and the etag it was based on. */
export interface FmDraft { text: string; etag: string; savedAt: number }

/** Most drafts kept at once. */
export const FM_DRAFT_MAX_ENTRIES = 50;
/** Most characters of draft text kept in total (~5 MiB of UTF-16). */
export const FM_DRAFT_MAX_CHARS = 5 * 1024 * 1024 / 2;

const KEY = "fm:drafts";

interface Stored extends FmDraft { mount: string; path: string }

function defaultStorage(): Storage | undefined {
  try {
    return globalThis.localStorage;
  }
  catch {
    return undefined;
  }
}

function isStored(v: unknown): v is Stored {
  if (typeof v !== "object" || v === null)
    return false;
  const d = v as Record<string, unknown>;
  return typeof d.mount === "string" && typeof d.path === "string" && typeof d.text === "string"
    && typeof d.etag === "string" && typeof d.savedAt === "number";
}

/** Stored drafts, oldest first. */
function read(storage: Storage): Stored[] {
  let raw: unknown;
  try {
    raw = JSON.parse(storage.getItem(KEY) ?? "{}");
  }
  catch {
    return [];
  }
  if (typeof raw !== "object" || raw === null || Array.isArray(raw))
    return [];
  return Object.values(raw).filter(isStored).sort((a, b) => a.savedAt - b.savedAt);
}

function serialize(drafts: Stored[]): string {
  return JSON.stringify(Object.fromEntries(drafts.map(d => [`${d.mount}:${d.path}`, d])));
}

function write(storage: Storage, drafts: Stored[]): void {
  try {
    storage.setItem(KEY, serialize(drafts));
  }
  catch {
    try {
      storage.setItem(KEY, serialize(drafts.slice(Math.floor(drafts.length / 2))));
    }
    catch {}
  }
}

/** Draft of `mount` + `path`, if one is stored. */
export function loadDraft(mount: string, path: string, storage = defaultStorage()): FmDraft | undefined {
  if (!storage)
    return undefined;
  const d = read(storage).find(d => d.mount === mount && d.path === path);
  return d && { text: d.text, etag: d.etag, savedAt: d.savedAt };
}

/** Stores the draft (savedAt = Date.now()), then prunes: at most FM_DRAFT_MAX_ENTRIES drafts and FM_DRAFT_MAX_CHARS characters of text in total, oldest savedAt dropped first. A single draft over the char limit is not stored (and any older draft of that file is removed). */
export function saveDraft(mount: string, path: string, draft: { text: string; etag: string }, storage = defaultStorage()): void {
  if (!storage)
    return;
  const drafts = read(storage).filter(d => d.mount !== mount || d.path !== path);
  if (draft.text.length <= FM_DRAFT_MAX_CHARS) {
    drafts.push({
      mount,
      path,
      text: draft.text,
      etag: draft.etag,
      savedAt: Date.now(),
    });
    let chars = drafts.reduce((n, d) => n + d.text.length, 0);
    while (drafts.length > FM_DRAFT_MAX_ENTRIES || chars > FM_DRAFT_MAX_CHARS)
      chars -= drafts.shift()!.text.length;
  }
  write(storage, drafts);
}

/** Drops the draft of `mount` + `path`. */
export function clearDraft(mount: string, path: string, storage = defaultStorage()): void {
  if (storage)
    write(storage, read(storage).filter(d => d.mount !== mount || d.path !== path));
}

/** Drops the drafts of `pathPrefix` and everything below it in `mount` ("/" clears the whole mount); meant to be called by delete / rename flows so stale drafts do not come back. */
export function clearDrafts(mount: string, pathPrefix: string, storage = defaultStorage()): void {
  if (!storage)
    return;
  const below = pathPrefix.endsWith("/")
    ? pathPrefix
    : `${pathPrefix}/`;
  write(storage, read(storage).filter(d => d.mount !== mount || (d.path !== pathPrefix && !d.path.startsWith(below))));
}
