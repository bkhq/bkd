import type { Context, Env } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import type { FmAction, FmCaps, FmConflict, FmEntry, FmMountInfo, FmOpResult, FmTrashItem, FmUploadMode, FmUploadSession, FmUsage } from "../core/schema";
import type { FmChangeContext, FmDriver, FmDriverEntry, FmUploadPart, FmWriteOptions } from "./driver";
import { Hono } from "hono";
import { describeRoute, resolver, validator } from "hono-openapi";
import { z } from "zod";
import { FmError, isFmError } from "../core/errors";
import { fuzzyRank, fuzzyScore } from "../core/fuzzy";
import { assertName, basename, dirname, isWithin, joinPath, nextFreeName, normalizePath } from "../core/path";
import {
  ALL_CAPS,
  changeSchema,
  conflictSchema,
  entrySchema,
  errorBodySchema,
  intersectCaps,
  listResultSchema,
  mountInfoSchema,
  opsRequestSchema,
  opsResultSchema,
  READ_ONLY_CAPS,
  searchModeSchema,
  searchResultSchema,
  sortKeySchema,
  trashIdsSchema,
  trashItemSchema,
  uploadCreateSchema,
  uploadSessionSchema,
  usageSchema,
  zipEntrySchema,
} from "../core/schema";
import { collect, zipStream } from "./archive";
import { readAll } from "./driver";
import { inlineType, mimeOf } from "./mime";
import { dropTrashItem, expiresAt, getTrashItem, listTrash, moveToTrash, purgeExpiredItems, TRASH_DIR, trashedPath } from "./trash";
import { openZipEntry, readZipEntries } from "./zip";

export interface FmMount {
  id: string;
  label: string;
  driver: FmDriver;
  readOnly?: boolean;
  /**
   * Deletes move into a hidden `/.fm-trash` folder on the same driver. On a
   * read-only mount this only hides that folder. With `retentionDays`, older
   * items are deleted for good when the trash is listed or by `purgeExpired`.
   */
  trash?: boolean | { retentionDays: number };
  /**
   * Folders are implied by file paths (a flat file list): an empty folder cannot
   * be stored. The UI keeps folders created here until a file lands in them.
   */
  implicitFolders?: boolean;
  /**
   * Resumable upload sessions (default true). Without driver multipart their parts
   * are stored through the driver, so turn them off for storages where every write
   * counts (commits, remote workspaces): uploads then go in one request each.
   */
  uploads?: boolean;
}

/** Retention of a mount's trash in days, if any. */
function retentionOf(m: FmMount): number | undefined {
  return typeof m.trash === "object"
    ? m.trash.retentionDays
    : undefined;
}

/**
 * Deletes trash items past the mount's retention; returns how many. For hosts
 * that purge on a schedule (also done lazily when the trash is listed).
 */
export async function purgeExpired(mount: FmMount, now = Date.now()): Promise<number> {
  const days = retentionOf(mount);
  // Read-only views only hide the trash folder; they never delete from it.
  if (!days || mount.readOnly || !mount.driver.caps.delete)
    return 0;
  return (await purgeExpiredItems(mount.driver, days, now)).purged;
}

export interface FmLimits {
  /** Max bytes per write / upload. */
  maxUploadBytes: number;
  /** Max entries a directory listing may hold. */
  maxListEntries: number;
  archiveMaxEntries: number;
  archiveMaxBytes: number;
  /** Preferred part size for upload sessions; drivers may require larger parts. */
  uploadPartSize: number;
  /** Max total bytes of one upload session (`maxUploadBytes` limits a single write). */
  maxSessionUploadBytes: number;
  /** Lifetime of an upload session in milliseconds. */
  uploadSessionTtlMs: number;
  /** Largest source image the thumbnail hook is given. */
  thumbnailMaxBytes: number;
}

/** Widths `/thumb` serves. */
export const FM_THUMB_WIDTHS = [128, 256, 512] as const;
export type FmThumbWidth = typeof FM_THUMB_WIDTHS[number];

/** Input of the thumbnail hook: a raster image of the mount. */
export interface FmThumbnailInput {
  entry: FmDriverEntry;
  width: FmThumbWidth;
  /** The source bytes. */
  read: () => Promise<ReadableStream<Uint8Array>>;
}

/** A thumbnail, or undefined to decline (the UI then shows the full image). */
export type FmThumbnailHook<E extends Env = Env> = (c: Context<E>, input: FmThumbnailInput) => Promise<{ body: BodyInit; type: string } | undefined>;

export const DEFAULT_LIMITS: FmLimits = {
  maxUploadBytes: 100 * 1024 * 1024,
  maxListEntries: 10_000,
  archiveMaxEntries: 5000,
  archiveMaxBytes: 2 * 1024 * 1024 * 1024,
  uploadPartSize: 8 * 1024 * 1024,
  maxSessionUploadBytes: 10 * 1024 * 1024 * 1024,
  uploadSessionTtlMs: 24 * 60 * 60 * 1000,
  thumbnailMaxBytes: 32 * 1024 * 1024,
};

export interface FmRouterOptions<E extends Env> {
  /** Mounts visible to the current request (resolve per user / project here). */
  mounts: (c: Context<E>) => FmMount[] | Promise<FmMount[]>;
  /**
   * Allowed actions for `path` and everything below it. Listings apply a
   * directory's caps to its children. Missing `read` answers 404.
   */
  authorize?: (c: Context<E>, target: { mount: FmMount; path: string }) => FmCaps | Promise<FmCaps>;
  limits?: Partial<FmLimits>;
  /**
   * Called once per mutated item after the work, for successes and failures.
   * Awaited; a throwing hook is logged and never changes the response.
   */
  onEvent?: (c: Context<E>, event: FmChangeEvent) => void | Promise<void>;
  /**
   * Resizes images for `GET /m/:mount/thumb` (grid view). Web-API only here; see
   * `fm/thumbnails/bun` and `fm/thumbnails/cloudflare` for implementations.
   */
  thumbnail?: FmThumbnailHook<E>;
}

export interface FmChangeEvent {
  op: "write" | "mkdir" | "delete" | "move" | "copy" | "rename" | "restore" | "purge";
  /** The user's note for the change (`X-Fm-Message`), when given. */
  message?: string;
  /** Mount id. */
  mount: string;
  path: string;
  to?: string;
  /** Destination mount id when it differs from `mount`. */
  toMount?: string;
  trashId?: string;
  ok: boolean;
  error?: { code: string; message: string };
}

type EventDraft = Omit<FmChangeEvent, "ok" | "error">;

type ItemOutcome = Pick<FmOpResult, "entry" | "trashId">;

interface Target {
  mount: FmMount;
  path: string;
  caps: FmCaps;
}

/** Hidden per-mount folder: `<id>.json` holds an upload session, `<id>/<n>` its parts when the driver has no multipart. */
const UPLOADS_DIR = "/.fm-uploads";

interface UploadRecord {
  id: string;
  mount: string;
  /** Final target, fixed at create time. */
  path: string;
  size: number;
  partSize: number;
  parts: number;
  conflict: FmConflict;
  mode: FmUploadMode;
  /** Driver multipart upload id. */
  uploadId?: string;
  expiresAt: number;
}

const recordPath = (id: string) => `${UPLOADS_DIR}/${id}.json`;
const partsDir = (id: string) => `${UPLOADS_DIR}/${id}`;

/** Byte length of part `n`; the last part holds the remainder. */
function partLength(rec: UploadRecord, n: number): number {
  return n < rec.parts
    ? rec.partSize
    : rec.size - rec.partSize * (rec.parts - 1);
}

async function readRecord(d: FmDriver, id: string): Promise<UploadRecord> {
  const res = await d.read(recordPath(id));
  return JSON.parse(new TextDecoder().decode(await readAll(res.body))) as UploadRecord;
}

/** Discards the stored parts and the record of a session. */
async function discardUpload(d: FmDriver, rec: UploadRecord): Promise<void> {
  if (rec.uploadId)
    await d.multipart?.abort(rec.path, rec.uploadId);
  else
    await d.remove(partsDir(rec.id)).catch(ignoreNotFound);
  await d.remove(recordPath(rec.id)).catch(ignoreNotFound);
}

function ignoreNotFound(e: unknown) {
  if (!isFmError(e, "NOT_FOUND"))
    throw e;
}

/** Stored parts with a valid number and the expected length, sorted by `n`. */
async function storedParts(d: FmDriver, rec: UploadRecord): Promise<FmUploadPart[]> {
  let parts: FmUploadPart[];
  if (rec.uploadId && d.multipart) {
    parts = await d.multipart.listParts(rec.path, rec.uploadId);
  }
  else {
    const entries = await d.list(partsDir(rec.id)).catch((e: unknown) => {
      ignoreNotFound(e);
      return [];
    });
    parts = entries
      .filter(e => e.kind === "file" && /^\d+$/.test(e.name))
      .map(e => ({
        n: Number(e.name),
        size: e.size,
        etag: e.etag,
      }));
  }
  return parts
    .filter(p => p.n >= 1 && p.n <= rec.parts && p.size === partLength(rec, p.n))
    .sort((a, b) => a.n - b.n);
}

/** Concatenates the fallback part files in order. */
function joinParts(d: FmDriver, rec: UploadRecord): ReadableStream<Uint8Array> {
  let n = 0;
  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      for (;;) {
        if (!reader) {
          if (n >= rec.parts) {
            controller.close();
            return;
          }
          reader = (await d.read(`${partsDir(rec.id)}/${++n}`)).body.getReader();
        }
        const { done, value } = await reader.read();
        if (!done) {
          controller.enqueue(value);
          return;
        }
        reader = undefined;
      }
    },
    cancel(reason) {
      return reader?.cancel(reason);
    },
  });
}

const TAG = "Files";
const pathQuery = z.object({
  path: z.string().default("/"),
});
function err(description: string) {
  return {
    description,
    content: {
      "application/json": {
        schema: resolver(errorBodySchema),
      },
    },
  };
}
function ok(schema: z.ZodType, description: string) {
  return {
    description,
    content: {
      "application/json": {
        schema: resolver(schema),
      },
    },
  };
}
const ERRORS = {
  403: err("Forbidden"),
  404: err("Not found"),
  409: err("Conflict"),
  422: err("Invalid input"),
};

function v<S extends z.ZodType, T extends "query" | "json" | "param">(target: T, schema: S) {
  return validator(target, schema, (result, c) => {
    if (!result.success) {
      return c.json({
        error: { code: "INVALID", message: "Invalid request" },
      }, 422);
    }
  });
}

function rangeOf(header: string | undefined, size: number): { start: number; end: number } | undefined {
  const m = header
    ? /^bytes=(\d*)-(\d*)$/.exec(header.trim())
    : null;
  if (!m || (m[1] === "" && m[2] === ""))
    return undefined;
  const start = m[1] === ""
    ? Math.max(0, size - Number(m[2]))
    : Number(m[1]);
  const end = m[1] === "" || m[2] === ""
    ? size - 1
    : Math.min(Number(m[2]), size - 1);
  if (start > end || start >= size)
    throw new FmError("RANGE", "Range not satisfiable");
  return { start, end };
}

function limitStream(body: ReadableStream<Uint8Array>, max: number): ReadableStream<Uint8Array> {
  let seen = 0;
  return body.pipeThrough(new TransformStream<Uint8Array, Uint8Array>({
    transform(chunk, controller) {
      seen += chunk.byteLength;
      if (seen > max)
        controller.error(new FmError("TOO_LARGE", `Upload exceeds ${max} bytes`));
      else
        controller.enqueue(chunk);
    },
  }));
}

function contentDisposition(type: "inline" | "attachment", name: string) {
  return `${type}; filename="${name.replace(/[^\x20-\x7E]|["\\]/g, "_")}"; filename*=UTF-8''${encodeURIComponent(name)}`;
}

/** Builds the file manager API. Mount it with `app.route("/api/fm", createFmRouter(...))`. */
export function createFmRouter<E extends Env = Env>(options: FmRouterOptions<E>): Hono<E> {
  const limits: FmLimits = {
    ...DEFAULT_LIMITS,
    ...options.limits,
  };
  const app = new Hono<E>();

  const mountCaps = (m: FmMount) => intersectCaps(m.driver.caps, m.readOnly ? READ_ONLY_CAPS : ALL_CAPS);

  // Route handlers see a narrowed env type; the host hooks get the declared one.
  const host = (c: unknown) => c as Context<E>;

  const hasTrash = (m: FmMount) => !!m.trash && mountCaps(m).delete;
  /** Paths inside the trash or uploads folder are never exposed by regular routes (also on read-only views of the same storage). */
  const hidden = (m: FmMount, path: string) => isWithin(path, UPLOADS_DIR) || (!!m.trash && isWithin(path, TRASH_DIR));
  const assertVisible = (m: FmMount, path: string) => {
    if (hidden(m, path))
      throw new FmError("INVALID", `Reserved name: ${path}`);
  };

  const findMount = async (c: unknown, mountId: string): Promise<FmMount> => {
    const mount = (await options.mounts(host(c))).find(m => m.id === mountId);
    if (!mount)
      throw new FmError("NOT_FOUND", "Mount not found");
    return mount;
  };

  const resolve = async (c: unknown, mountId: string, rawPath: string, action?: FmAction): Promise<Target> => {
    const mount = await findMount(c, mountId);
    const path = normalizePath(rawPath);
    if (hidden(mount, path))
      throw new FmError("NOT_FOUND", "Not found");
    const granted = options.authorize
      ? await options.authorize(host(c), { mount, path })
      : ALL_CAPS;
    const caps = intersectCaps(mountCaps(mount), granted);
    if (!caps.read)
      throw new FmError("NOT_FOUND", "Not found");
    if (action && !caps[action])
      throw new FmError("FORBIDDEN", `Not allowed: ${action}`);
    return { mount, path, caps };
  };

  const toEntry = (t: Target, e: FmDriverEntry): FmEntry => {
    const mime = e.kind === "file"
      ? (e.mime ?? mimeOf(e.name))
      : undefined;
    return {
      mount: t.mount.id,
      path: e.path,
      name: e.name,
      kind: e.kind,
      size: e.size,
      mtime: new Date(e.mtime).toISOString(),
      ...(mime
        ? { mime }
        : {}),
      etag: e.etag,
      caps: t.caps,
      ...(e.ignored === true
        ? { ignored: true }
        : {}),
    };
  };

  /** The change note of a request: `X-Fm-Message`, percent-encoded UTF-8, at most 1 000 characters. */
  const changeCtx = (c: unknown): FmChangeContext => {
    const raw = host(c).req.header("x-fm-message");
    if (!raw)
      return {};
    let message: string;
    try {
      message = decodeURIComponent(raw);
    }
    catch {
      throw new FmError("INVALID", "Invalid X-Fm-Message");
    }
    if (message.length > 1000)
      throw new FmError("INVALID", "X-Fm-Message is longer than 1000 characters");
    return message.trim()
      ? { message }
      : {};
  };

  const emit = async (c: unknown, event: FmChangeEvent) => {
    if (!options.onEvent)
      return;
    try {
      const { message } = changeCtx(c);
      await options.onEvent(host(c), message === undefined
        ? event
        : { ...event, message });
    }
    catch (e) {
      console.error("onEvent hook failed", e);
    }
  };

  /** Runs one mutation and emits its event; `fn` may refine the draft. Errors are rethrown. */
  const track = async <T>(c: unknown, event: EventDraft, fn: () => Promise<T>): Promise<T> => {
    try {
      const out = await fn();
      await emit(c, { ...event, ok: true });
      return out;
    }
    catch (e) {
      if (e instanceof FmError) {
        await emit(c, {
          ...event,
          ok: false,
          error: { code: e.code, message: e.message },
        });
      }
      throw e;
    }
  };

  /** Runs one item of a batch; file-manager errors become a failed result, others reach the host. */
  const settle = async (c: unknown, results: FmOpResult[], path: string, event: EventDraft, fn: () => Promise<ItemOutcome>) => {
    try {
      results.push({
        path,
        ok: true,
        ...await track(c, event, fn),
      });
    }
    catch (e) {
      if (!(e instanceof FmError))
        throw e;
      results.push({
        path,
        ok: false,
        error: { code: e.code, message: e.message },
      });
    }
  };

  const exists = (d: FmDriver, path: string) => d.stat(path).then(() => true, () => false);

  /** Destination path for `name` in `dir` according to the conflict mode. */
  const destination = async (d: FmDriver, dir: string, name: string, conflict: FmConflict): Promise<string> => {
    const target = joinPath(dir, name);
    if (conflict !== "rename" || !await exists(d, target))
      return target;
    for (let n = 1; n < 1000; n++) {
      const candidate = joinPath(dir, nextFreeName(name, n));
      if (!await exists(d, candidate))
        return candidate;
    }
    throw new FmError("EXISTS", `No free name for ${name}`);
  };

  /** Copies or moves `path` into `dest` on another mount, streaming one file at a time. */
  const transfer = async (c: unknown, op: "move" | "copy", mountId: string, path: string, dest: Target, conflict: FmConflict, event: EventDraft): Promise<ItemOutcome> => {
    const src = await resolve(c, mountId, path, op);
    event.path = src.path;
    if (src.path === "/")
      throw new FmError("INVALID", "Cannot move or copy the root");
    const from = src.mount.driver;
    const into = dest.mount.driver;
    // Walk first so limits fail before anything is written.
    const items = await collect(from, [src.path], {
      maxEntries: limits.archiveMaxEntries,
      maxBytes: limits.archiveMaxBytes,
    }, p => hidden(src.mount, p));
    const to = await destination(into, dest.path, basename(src.path), conflict);
    assertVisible(dest.mount, to);
    if (conflict !== "rename" && await exists(into, to)) {
      if (conflict === "fail")
        throw new FmError("EXISTS", `Already exists: ${to}`);
      await resolve(c, dest.mount.id, to, "delete");
      await into.remove(to, changeCtx(c));
    }
    let created = false;
    try {
      for (const item of items) {
        const target = to + item.path.slice(src.path.length);
        if (item.dir) {
          await into.mkdir(target, changeCtx(c));
        }
        else {
          const { body } = await from.read(item.path);
          await into.write(target, body, {
            exclusive: true,
            ...changeCtx(c),
          }).catch(async (e) => {
            await body.cancel().catch(() => {});
            throw e;
          });
        }
        created = true;
      }
    }
    catch (e) {
      if (created)
        await into.remove(to).catch(() => {});
      throw e;
    }
    // The source goes only after the whole copy landed.
    if (op === "move") {
      if (hasTrash(src.mount))
        await moveToTrash(from, src.path, changeCtx(c));
      else
        await from.remove(src.path, changeCtx(c));
    }
    event.to = to;
    return {
      entry: toEntry(dest, await into.stat(to)),
    };
  };

  // Unknown errors go to the host's onError.
  app.onError((e, c) => {
    if (e instanceof FmError) {
      return c.json({
        error: { code: e.code, message: e.message },
      }, e.status as ContentfulStatusCode);
    }
    throw e;
  });

  app.get("/mounts", describeRoute({
    tags: [TAG],
    summary: "List mounts",
    responses: {
      200: ok(z.object({
        mounts: z.array(mountInfoSchema),
      }), "Mounts"),
    },
  }), async (c) => {
    const out: FmMountInfo[] = [];
    for (const mount of await options.mounts(host(c))) {
      const granted = options.authorize
        ? await options.authorize(host(c), { mount, path: "/" })
        : ALL_CAPS;
      const caps = intersectCaps(mountCaps(mount), granted);
      if (caps.read) {
        out.push({
          id: mount.id,
          label: mount.label,
          driver: mount.driver.name,
          caps,
          trash: hasTrash(mount),
          thumbnails: !!options.thumbnail,
          changes: !!mount.driver.changes,
          implicitFolders: !!mount.implicitFolders,
          uploadSessions: mount.uploads !== false,
          ...(hasTrash(mount) && retentionOf(mount)
            ? {
                trashRetentionDays: retentionOf(mount),
              }
            : {}),
        });
      }
    }
    return c.json({ mounts: out });
  });

  app.get("/m/:mount/stat", describeRoute({
    tags: [TAG],
    summary: "Stat an entry",
    responses: {
      200: ok(entrySchema, "Entry"),
      ...ERRORS,
    },
  }), v("query", pathQuery), async (c) => {
    const t = await resolve(c, c.req.param("mount"), c.req.valid("query").path);
    return c.json(toEntry(t, await t.mount.driver.stat(t.path)));
  });

  app.get("/m/:mount/list", describeRoute({
    tags: [TAG],
    summary: "List a directory",
    description: "Directories first, then sorted by `sort`. `cursor` is an opaque offset. `hidden=0` drops dot entries, `ignored=0` drops entries the driver marks ignored; `ignored` counts those before filtering.",
    responses: {
      200: ok(listResultSchema, "Listing"),
      ...ERRORS,
    },
  }), v("query", pathQuery.extend({
    cursor: z.string().regex(/^\d+$/).optional(),
    limit: z.coerce.number().int().min(1).max(1000).default(200),
    sort: sortKeySchema.default("name"),
    order: z.enum(["asc", "desc"]).default("asc"),
    q: z.string().max(255).optional(),
    hidden: z.enum(["0", "1"]).default("1"),
    ignored: z.enum(["0", "1"]).default("1"),
  })), async (c) => {
    const q = c.req.valid("query");
    const t = await resolve(c, c.req.param("mount"), q.path);
    const self = await t.mount.driver.stat(t.path);
    if (self.kind !== "dir")
      throw new FmError("NOT_A_DIR", "Not a directory");
    const needle = q.q?.trim().toLocaleLowerCase();
    const raw = (await t.mount.driver.list(t.path)).filter(e => !hidden(t.mount, e.path));
    const ignored = raw.filter(e => e.ignored === true).length;
    const all = raw.filter(e => (q.hidden === "1" || !e.name.startsWith("."))
      && (q.ignored === "1" || e.ignored !== true)
      && (!needle || e.name.toLocaleLowerCase().includes(needle)));
    if (all.length > limits.maxListEntries)
      throw new FmError("TOO_LARGE", `Directory has more than ${limits.maxListEntries} entries`);
    const dir = q.order === "asc"
      ? 1
      : -1;
    const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: "base" });
    all.sort((a, b) => {
      if (a.kind !== b.kind) {
        return a.kind === "dir"
          ? -1
          : 1;
      }
      const primary = q.sort === "name"
        ? collator.compare(a.name, b.name)
        : (q.sort === "size"
            ? a.size - b.size
            : a.mtime - b.mtime);
      return (primary || collator.compare(a.name, b.name)) * dir;
    });
    const offset = Number(q.cursor ?? 0);
    const items = all.slice(offset, offset + q.limit).map(e => toEntry(t, e));
    const next = offset + q.limit < all.length
      ? String(offset + q.limit)
      : undefined;
    return c.json({
      entry: toEntry(t, self),
      items,
      total: all.length,
      ...(next
        ? { cursor: next }
        : {}),
      ...(ignored > 0
        ? { ignored }
        : {}),
    });
  });

  app.get("/m/:mount/read", describeRoute({
    tags: [TAG],
    summary: "Read file content",
    description: "Supports `Range` and `If-None-Match`. Script-capable types are served as text/plain or attachment.",
    responses: {
      200: { description: "File bytes" },
      206: { description: "Partial content" },
      304: { description: "Not modified" },
      ...ERRORS,
    },
  }), v("query", pathQuery.extend({
    download: z.enum(["0", "1"]).optional(),
  })), async (c) => {
    const q = c.req.valid("query");
    const t = await resolve(c, c.req.param("mount"), q.path);
    const d = t.mount.driver;
    const e = await d.stat(t.path);
    if (e.kind !== "file")
      throw new FmError("IS_A_DIR", "Is a directory");
    const etag = `"${e.etag}"`;
    const headers = new Headers({
      "ETag": etag,
      "Last-Modified": new Date(e.mtime).toUTCString(),
      "Accept-Ranges": "bytes",
      "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'; sandbox",
      "Cache-Control": "private, no-cache",
    });
    if (c.req.header("if-none-match") === etag)
      return new Response(null, { status: 304, headers });
    const type = q.download === "1"
      ? undefined
      : inlineType(e.mime ?? mimeOf(e.name));
    headers.set("Content-Type", type ?? "application/octet-stream");
    headers.set("Content-Disposition", contentDisposition(type ? "inline" : "attachment", e.name));
    const range = rangeOf(c.req.header("range"), e.size);
    const res = await d.read(t.path, range);
    if (range) {
      headers.set("Content-Range", `bytes ${range.start}-${range.end}/${res.size}`);
      headers.set("Content-Length", String(range.end - range.start + 1));
      return new Response(res.body, { status: 206, headers });
    }
    headers.set("Content-Length", String(res.size));
    return new Response(res.body, { status: 200, headers });
  });

  /** The review capability of a mount, or 405. */
  const changesOf = async (c: unknown, mountId: string) => {
    const mount = await findMount(c, mountId);
    if (!mount.driver.changes)
      throw new FmError("UNSUPPORTED", "This mount has no changes");
    return { mount, changes: mount.driver.changes };
  };

  app.get("/m/:mount/changes", describeRoute({
    tags: [TAG],
    summary: "List changes",
    description: "Files that differ from the driver's baseline (e.g. git HEAD), limited to paths the caller may read.",
    responses: {
      200: ok(z.object({
        changes: z.array(changeSchema),
      }), "Changed files"),
      405: err("Mount has no changes"),
      ...ERRORS,
    },
  }), async (c) => {
    const { mount, changes } = await changesOf(c, c.req.param("mount"));
    const out = [];
    const readable = async (path: string) => !hidden(mount, path) && await resolve(c, mount.id, path).then(() => true, () => false);
    for (const change of await changes.list()) {
      if (!await readable(change.path))
        continue;
      // A rename out of a place the caller may not read shows as a new file.
      if (change.previousPath && !await readable(change.previousPath)) {
        const { previousPath: _hidden, ...rest } = change;
        out.push({ ...rest, status: "added" });
        continue;
      }
      out.push(change);
    }
    return c.json({ changes: out });
  });

  app.get("/m/:mount/changes/base", describeRoute({
    tags: [TAG],
    summary: "Read the baseline version",
    description: "Bytes of `path` in the baseline (its previous path for renames); 404 for files the baseline lacks. Served like `/read`.",
    responses: {
      200: { description: "Baseline bytes" },
      405: err("Mount has no changes"),
      ...ERRORS,
    },
  }), v("query", pathQuery), async (c) => {
    const { mount, changes } = await changesOf(c, c.req.param("mount"));
    const t = await resolve(c, mount.id, c.req.valid("query").path);
    const base = await changes.readBase(t.path);
    if (!base)
      throw new FmError("NOT_FOUND", "Not in the baseline");
    // The baseline of a rename lives at its previous path: authorize that too.
    if (base.from && base.from !== t.path
      && (hidden(mount, base.from) || !await resolve(c, mount.id, base.from).then(() => true, () => false))) {
      await base.body.cancel().catch(() => {});
      throw new FmError("NOT_FOUND", "Not in the baseline");
    }
    const type = inlineType(mimeOf(basename(t.path)));
    return new Response(base.body, {
      headers: {
        "Content-Type": type ?? "application/octet-stream",
        "Content-Length": String(base.size),
        "X-Content-Type-Options": "nosniff",
        "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'; sandbox",
        "Cache-Control": "private, no-cache",
      },
    });
  });

  /** A zip file of the mount within the archive size limit. */
  const zipFile = async (c: unknown, mountId: string, path: string) => {
    const t = await resolve(c, mountId, path);
    const e = await t.mount.driver.stat(t.path);
    if (e.kind !== "file")
      throw new FmError("IS_A_DIR", "Is a directory");
    if (e.size > limits.archiveMaxBytes)
      throw new FmError("TOO_LARGE", "Archive too large to browse");
    return t;
  };

  app.get("/m/:mount/zip/entries", describeRoute({
    tags: [TAG],
    summary: "List a zip archive",
    description: "Entries from the central directory (ranged reads, Zip64 aware), at most `archiveMaxEntries`.",
    responses: {
      200: ok(z.object({
        entries: z.array(zipEntrySchema),
        truncated: z.boolean(),
      }), "Archive entries"),
      ...ERRORS,
    },
  }), v("query", pathQuery), async (c) => {
    const t = await zipFile(c, c.req.param("mount"), c.req.valid("query").path);
    return c.json(await readZipEntries(t.mount.driver, t.path, limits.archiveMaxEntries));
  });

  app.get("/m/:mount/zip/read", describeRoute({
    tags: [TAG],
    summary: "Read a zip archive entry",
    description: "Streams one stored or deflated entry with the same content-type safety as `/read`; encrypted entries and other methods answer 405.",
    responses: {
      200: { description: "Entry bytes" },
      ...ERRORS,
    },
  }), v("query", pathQuery.extend({
    entry: z.string().min(1),
    download: z.enum(["0", "1"]).optional(),
  })), async (c) => {
    const q = c.req.valid("query");
    const t = await zipFile(c, c.req.param("mount"), q.path);
    const { size, body } = await openZipEntry(t.mount.driver, t.path, q.entry, limits.archiveMaxEntries);
    const name = q.entry.split("/").pop() || q.entry;
    const type = q.download === "1"
      ? undefined
      : inlineType(mimeOf(name));
    return new Response(body, {
      headers: {
        "Content-Type": type ?? "application/octet-stream",
        "Content-Disposition": contentDisposition(type ? "inline" : "attachment", name),
        "Content-Length": String(size),
        "X-Content-Type-Options": "nosniff",
        "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'; sandbox",
        "Cache-Control": "private, no-cache",
      },
    });
  });

  app.get("/m/:mount/thumb", describeRoute({
    tags: [TAG],
    summary: "Image thumbnail",
    description: "Resized raster image (not SVG) from the router's `thumbnail` hook; 404 when there is no hook, the file is not an image, too large or the hook declines.",
    responses: {
      200: { description: "Thumbnail bytes" },
      304: { description: "Not modified" },
      ...ERRORS,
    },
  }), v("query", pathQuery.extend({
    w: z.enum(FM_THUMB_WIDTHS.map(String) as [string, ...string[]]),
  })), async (c) => {
    const q = c.req.valid("query");
    const t = await resolve(c, c.req.param("mount"), q.path);
    const d = t.mount.driver;
    const e = await d.stat(t.path);
    const width = Number(q.w) as FmThumbWidth;
    const mime = e.mime ?? mimeOf(e.name) ?? "";
    const none = () => new FmError("NOT_FOUND", "No thumbnail");
    if (!options.thumbnail || e.kind !== "file" || !mime.startsWith("image/") || mime === "image/svg+xml" || e.size > limits.thumbnailMaxBytes)
      throw none();
    const etag = `"${e.etag}-w${width}"`;
    const headers = new Headers({
      "ETag": etag,
      "Cache-Control": "private, max-age=86400",
      "X-Content-Type-Options": "nosniff",
    });
    if (c.req.header("if-none-match") === etag)
      return new Response(null, { status: 304, headers });
    const thumb = await options.thumbnail(host(c), {
      entry: e,
      width,
      read: async () => (await d.read(t.path)).body,
    });
    if (!thumb)
      throw none();
    headers.set("Content-Type", thumb.type);
    return new Response(thumb.body, { status: 200, headers });
  });

  app.put("/m/:mount/write", describeRoute({
    tags: [TAG],
    summary: "Write a file",
    description: "Raw request body. `If-Match` guards overwrites; `conflict` decides what happens when the file exists.",
    responses: {
      200: ok(entrySchema, "Written entry"),
      412: err("ETag mismatch"),
      413: err("Too large"),
      ...ERRORS,
    },
  }), v("query", z.object({
    path: z.string().min(2),
    conflict: conflictSchema.default("overwrite"),
  })), async (c) => {
    const q = c.req.valid("query");
    const event: EventDraft = {
      op: "write",
      mount: c.req.param("mount"),
      path: q.path,
    };
    return track(c, event, async () => {
      const t = await resolve(c, event.mount, q.path, "write");
      event.path = t.path;
      if (t.path === "/")
        throw new FmError("INVALID", "Invalid path");
      const contentLength = c.req.header("content-length");
      const length = Number(contentLength ?? 0);
      if (length > limits.maxUploadBytes)
        throw new FmError("TOO_LARGE", `Upload exceeds ${limits.maxUploadBytes} bytes`);
      const ifMatch = c.req.header("if-match")?.replace(/^W\//, "").replace(/"/g, "");
      const d = t.mount.driver;
      const path = await destination(d, dirname(t.path), basename(t.path), q.conflict);
      const body = c.req.raw.body
        ? limitStream(c.req.raw.body, limits.maxUploadBytes)
        : new Uint8Array();
      const written = await d.write(path, body, {
        ...changeCtx(c),
        ...(ifMatch
          ? { ifMatch }
          : {}),
        ...(q.conflict === "fail"
          ? { exclusive: true }
          : {}),
        ...(contentLength === undefined
          ? {}
          : { size: length }),
      });
      event.path = path;
      return c.json(toEntry(t, written));
    });
  });

  app.post("/m/:mount/mkdir", describeRoute({
    tags: [TAG],
    summary: "Create a directory",
    responses: {
      201: ok(entrySchema, "Created directory"),
      ...ERRORS,
    },
  }), v("json", z.object({
    path: z.string().min(2),
  })), async (c) => {
    const event: EventDraft = {
      op: "mkdir",
      mount: c.req.param("mount"),
      path: c.req.valid("json").path,
    };
    return track(c, event, async () => {
      const t = await resolve(c, event.mount, event.path, "write");
      event.path = t.path;
      return c.json(toEntry(t, await t.mount.driver.mkdir(t.path, changeCtx(c))), 201);
    });
  });

  app.post("/m/:mount/ops", describeRoute({
    tags: [TAG],
    summary: "Batch move / copy / delete / rename",
    description: "Each item succeeds or fails on its own; the response lists per-item results.",
    responses: {
      200: ok(opsResultSchema, "Per-item results"),
      ...ERRORS,
    },
  }), v("json", opsRequestSchema), async (c) => {
    const req = c.req.valid("json");
    const mountId = c.req.param("mount");
    const results: FmOpResult[] = [];
    const run = (path: string, event: EventDraft, fn: () => Promise<ItemOutcome>) => settle(c, results, path, event, fn);

    if (req.op === "delete") {
      for (const p of req.paths) {
        const event: EventDraft = { op: "delete", mount: mountId, path: p };
        await run(p, event, async () => {
          const t = await resolve(c, mountId, p, "delete");
          event.path = t.path;
          if (t.path === "/")
            throw new FmError("INVALID", "Cannot delete the root");
          if (hasTrash(t.mount) && !req.permanent) {
            event.trashId = await moveToTrash(t.mount.driver, t.path, changeCtx(c));
            return { trashId: event.trashId };
          }
          await t.mount.driver.remove(t.path, changeCtx(c));
          return {};
        });
      }
    }
    else if (req.op === "rename") {
      const event: EventDraft = { op: "rename", mount: mountId, path: req.path };
      await run(req.path, event, async () => {
        const t = await resolve(c, mountId, req.path, "rename");
        event.path = t.path;
        if (t.path === "/")
          throw new FmError("INVALID", "Cannot rename the root");
        assertName(req.name);
        const target = joinPath(dirname(t.path), req.name);
        assertVisible(t.mount, target);
        const to = await resolve(c, mountId, target, "write");
        const entry = toEntry(t, await t.mount.driver.move(t.path, to.path, changeCtx(c)));
        event.to = to.path;
        return { entry };
      });
    }
    else {
      const destMount = req.destMount ?? mountId;
      const dest = await resolve(c, destMount, req.dest, "write");
      for (const p of req.paths) {
        if (destMount !== mountId) {
          const event: EventDraft = {
            op: req.op,
            mount: mountId,
            path: p,
            toMount: destMount,
          };
          await run(p, event, () => transfer(c, req.op, mountId, p, dest, req.conflict, event));
          continue;
        }
        const event: EventDraft = { op: req.op, mount: mountId, path: p };
        await run(p, event, async () => {
          const src = await resolve(c, mountId, p, req.op);
          event.path = src.path;
          const d = src.mount.driver;
          if (src.path === "/" || isWithin(dest.path, src.path))
            throw new FmError("INVALID", "Cannot move or copy a directory into itself");
          let to = await destination(d, dest.path, basename(src.path), req.conflict);
          if (to === src.path) {
            if (req.op === "move") {
              const entry = toEntry(dest, await d.stat(to));
              event.to = to;
              return { entry };
            }
            to = await destination(d, dest.path, basename(src.path), "rename");
          }
          assertVisible(dest.mount, to);
          if (req.conflict === "overwrite" && await exists(d, to)) {
            await resolve(c, mountId, to, "delete");
            await d.remove(to, changeCtx(c));
          }
          const moved = req.op === "move"
            ? await d.move(src.path, to, changeCtx(c))
            : await d.copy(src.path, to, changeCtx(c));
          event.to = to;
          return {
            entry: toEntry(dest, moved),
          };
        });
      }
    }
    return c.json({ results });
  });

  app.get("/m/:mount/archive", describeRoute({
    tags: [TAG],
    summary: "Download entries as a zip",
    description: "Repeat `path` for several entries. Streams an uncompressed zip.",
    responses: {
      200: { description: "Zip stream" },
      413: err("Archive too large"),
      ...ERRORS,
    },
  }), v("query", z.object({
    path: z.union([
      z.string(),
      z.array(z.string()),
    ]),
  })), async (c) => {
    const raw = c.req.valid("query").path;
    const paths = Array.isArray(raw)
      ? raw
      : [raw];
    if (paths.length === 0 || paths.length > 100)
      throw new FmError("INVALID", "Between 1 and 100 paths");
    const targets = await Promise.all(paths.map(p => resolve(c, c.req.param("mount"), p)));
    const first = targets[0]!;
    const body = await zipStream(first.mount.driver, targets.map(t => t.path), {
      maxEntries: limits.archiveMaxEntries,
      maxBytes: limits.archiveMaxBytes,
    }, p => hidden(first.mount, p));
    const name = `${targets.length === 1
      ? (basename(first.path) || first.mount.label)
      : first.mount.label}.zip`;
    return new Response(body, {
      headers: {
        "Content-Type": "application/zip",
        "Content-Disposition": contentDisposition("attachment", name),
      },
    });
  });

  app.get("/m/:mount/usage", describeRoute({
    tags: [TAG],
    summary: "Total size of a folder",
    description: "Walks at most `archiveMaxEntries` entries; `truncated` marks a partial result.",
    responses: {
      200: ok(usageSchema, "Usage"),
      ...ERRORS,
    },
  }), v("query", pathQuery), async (c) => {
    const t = await resolve(c, c.req.param("mount"), c.req.valid("query").path);
    const d = t.mount.driver;
    const usage: FmUsage = {
      bytes: 0,
      files: 0,
      dirs: 0,
      truncated: false,
    };
    const root = await d.stat(t.path);
    if (root.kind === "file")
      return c.json({ ...usage, bytes: root.size, files: 1 });
    const queue = [t.path];
    let seen = 0;
    while (queue.length > 0 && !usage.truncated) {
      for (const e of await d.list(queue.shift()!)) {
        if (hidden(t.mount, e.path))
          continue;
        if (++seen > limits.archiveMaxEntries) {
          usage.truncated = true;
          break;
        }
        if (e.kind === "dir") {
          usage.dirs++;
          queue.push(e.path);
        }
        else {
          usage.files++;
          usage.bytes += e.size;
        }
      }
    }
    return c.json(usage);
  });

  app.get("/m/:mount/search", describeRoute({
    tags: [TAG],
    summary: "Search below a folder",
    description: "Case-insensitive name match at any depth, or with `mode=fuzzy` a fuzzy match on the path below `path`, best first. Without a driver search, walks at most `archiveMaxEntries` entries; `truncated` marks a partial result (walk budget or `limit` reached). `hidden=0` drops results below a dot segment, `ignored=0` drops entries the driver marks ignored (the walk skips both subtrees).",
    responses: {
      200: ok(searchResultSchema, "Matches"),
      ...ERRORS,
    },
  }), v("query", pathQuery.extend({
    q: z.string().trim().min(1).max(255),
    limit: z.coerce.number().int().min(1).max(500).default(100),
    mode: searchModeSchema.default("substring"),
    hidden: z.enum(["0", "1"]).default("1"),
    ignored: z.enum(["0", "1"]).default("1"),
  })), async (c) => {
    const q = c.req.valid("query");
    const t = await resolve(c, c.req.param("mount"), q.path);
    const d = t.mount.driver;
    if ((await d.stat(t.path)).kind !== "dir")
      throw new FmError("NOT_A_DIR", "Not a directory");
    const granted = new Map<string, FmCaps>();
    const capsOf = async (path: string) => {
      let caps = granted.get(path);
      if (!caps) {
        caps = intersectCaps(mountCaps(t.mount), options.authorize
          ? await options.authorize(host(c), { mount: t.mount, path })
          : ALL_CAPS);
        granted.set(path, caps);
      }
      return caps;
    };
    const fuzzy = q.mode === "fuzzy";
    const relative = (path: string) => (t.path === "/"
      ? path
      : path.slice(t.path.length));
    const dropped = (e: FmDriverEntry) => (q.hidden === "0" && e.path.split("/").some(s => s.startsWith(".")))
      || (q.ignored === "0" && e.ignored === true);
    let truncated = false;
    let candidates = await d.search?.(t.path, q.q, {
      limit: q.limit,
      mode: q.mode,
      signal: c.req.raw.signal,
    }) ?? null;
    if (candidates) {
      truncated = candidates.length >= q.limit;
    }
    else {
      candidates = [];
      const needle = q.q.toLocaleLowerCase();
      const queue = [t.path];
      let seen = 0;
      while (queue.length > 0 && !truncated) {
        for (const e of await d.list(queue.shift()!)) {
          if (hidden(t.mount, e.path) || dropped(e))
            continue;
          // Fuzzy mode ranks afterwards, so it keeps every match within the budget.
          if ((!fuzzy && candidates.length >= q.limit) || ++seen > limits.archiveMaxEntries) {
            truncated = true;
            break;
          }
          if (fuzzy
            ? fuzzyScore(q.q, relative(e.path)) !== null
            : e.name.toLocaleLowerCase().includes(needle)) {
            candidates.push(e);
          }
          if (e.kind === "dir" && (await capsOf(e.path)).read)
            queue.push(e.path);
        }
      }
    }
    const items: FmEntry[] = [];
    for (const e of candidates) {
      if (hidden(t.mount, e.path) || dropped(e))
        continue;
      const caps = await capsOf(e.path);
      if (caps.read)
        items.push(toEntry({ ...t, caps }, e));
    }
    if (fuzzy) {
      truncated ||= items.length > q.limit;
      return c.json({
        items: fuzzyRank(q.q, items, e => relative(e.path), q.limit),
        truncated,
      });
    }
    return c.json({ items, truncated });
  });

  const trashMount = async (c: unknown, mountId: string) => {
    const mount = await findMount(c, mountId);
    if (!hasTrash(mount))
      throw new FmError("UNSUPPORTED", "This mount has no trash");
    return mount;
  };

  app.get("/m/:mount/trash", describeRoute({
    tags: [TAG],
    summary: "List the trash",
    description: "Newest first; only items whose original path the caller may read. Items past the mount's retention are deleted first.",
    responses: {
      200: ok(z.object({
        items: z.array(trashItemSchema),
      }), "Trash items"),
      405: err("Mount has no trash"),
      ...ERRORS,
    },
  }), async (c) => {
    const mount = await trashMount(c, c.req.param("mount"));
    const days = retentionOf(mount);
    const all = days
      ? (await purgeExpiredItems(mount.driver, days)).kept
      : await listTrash(mount.driver);
    const items: FmTrashItem[] = [];
    for (const item of all) {
      if (await resolve(c, mount.id, item.path).then(() => true, () => false)) {
        items.push(days
          ? {
              ...item,
              expiresAt: expiresAt(item, days),
            }
          : item);
      }
    }
    return c.json({ items });
  });

  app.post("/m/:mount/trash/restore", describeRoute({
    tags: [TAG],
    summary: "Restore trash items",
    description: "Moves items back to their original path; a name clash picks a free name.",
    responses: {
      200: ok(opsResultSchema, "Per-item results"),
      405: err("Mount has no trash"),
      ...ERRORS,
    },
  }), v("json", trashIdsSchema), async (c) => {
    const mount = await trashMount(c, c.req.param("mount"));
    const d = mount.driver;
    const results: FmOpResult[] = [];
    for (const id of c.req.valid("json").ids) {
      const event: EventDraft = {
        op: "restore",
        mount: mount.id,
        path: id,
        trashId: id,
      };
      await settle(c, results, id, event, async () => {
        const item = await getTrashItem(d, id);
        event.path = item.path;
        const t = await resolve(c, mount.id, item.path, "write");
        const to = await destination(d, dirname(t.path), item.name, "rename");
        const entry = toEntry(t, await d.move(trashedPath(item), to, changeCtx(c)));
        await dropTrashItem(d, id, changeCtx(c));
        event.to = to;
        return { entry };
      });
    }
    return c.json({ results });
  });

  app.post("/m/:mount/trash/purge", describeRoute({
    tags: [TAG],
    summary: "Delete trash items permanently",
    description: "Without `ids`, empties every item the caller may delete.",
    responses: {
      200: ok(opsResultSchema, "Per-item results"),
      405: err("Mount has no trash"),
      ...ERRORS,
    },
  }), v("json", trashIdsSchema.partial()), async (c) => {
    const mount = await trashMount(c, c.req.param("mount"));
    const d = mount.driver;
    const ids = c.req.valid("json").ids ?? (await listTrash(d)).map(i => i.id);
    const results: FmOpResult[] = [];
    for (const id of ids) {
      const event: EventDraft = {
        op: "purge",
        mount: mount.id,
        path: id,
        trashId: id,
      };
      await settle(c, results, id, event, async () => {
        const item = await getTrashItem(d, id);
        event.path = item.path;
        await resolve(c, mount.id, item.path, "delete");
        await dropTrashItem(d, id, changeCtx(c));
        return {};
      });
    }
    return c.json({ results });
  });

  /** Loads a live session of `mountId`; unknown, foreign and expired ids answer 404. */
  const loadUpload = async (c: unknown, mountId: string, id: string) => {
    const mount = await findMount(c, mountId);
    const rec = /^[\da-f-]{36}$/.test(id)
      ? await readRecord(mount.driver, id).catch((e: unknown) => {
          ignoreNotFound(e);
          return undefined;
        })
      : undefined;
    if (!rec || rec.mount !== mount.id || rec.expiresAt < Date.now())
      throw new FmError("NOT_FOUND", "Upload not found");
    return rec;
  };

  const toSession = async (d: FmDriver, rec: UploadRecord): Promise<FmUploadSession> => {
    const session: FmUploadSession = {
      id: rec.id,
      mode: rec.mode,
      path: rec.path,
      size: rec.size,
      partSize: rec.partSize,
      parts: rec.parts,
      received: (await storedParts(d, rec)).map(p => p.n),
      expiresAt: rec.expiresAt,
    };
    const presign = d.multipart?.presignPart;
    if (rec.mode === "s3-multipart" && rec.uploadId && presign) {
      const expiresIn = Math.min(Math.ceil((rec.expiresAt - Date.now()) / 1000), 7 * 24 * 60 * 60);
      session.urls = await Promise.all(Array.from({ length: rec.parts }, (_, i) => presign(rec.path, rec.uploadId!, i + 1, expiresIn)));
    }
    return session;
  };

  /** Drops up to 100 expired sessions; best effort. */
  const sweepUploads = async (d: FmDriver) => {
    const entries = await d.list(UPLOADS_DIR).catch(() => []);
    const now = Date.now();
    let dropped = 0;
    for (const e of entries) {
      if (dropped >= 100)
        break;
      if (e.kind !== "file" || !e.name.endsWith(".json"))
        continue;
      try {
        const rec = await readRecord(d, e.name.slice(0, -".json".length));
        if (rec.expiresAt < now) {
          dropped++;
          await discardUpload(d, rec);
        }
      }
      catch {}
    }
  };

  const uploadParam = z.object({
    mount: z.string(),
    id: z.string(),
  });

  app.post("/m/:mount/uploads", describeRoute({
    tags: [TAG],
    summary: "Start an upload session",
    description: "Resumable upload of `size` bytes in `parts` parts. The target path is fixed now; `rename` picks a free name.",
    responses: {
      201: ok(uploadSessionSchema, "Upload session"),
      413: err("Too large"),
      ...ERRORS,
    },
  }), v("json", uploadCreateSchema), async (c) => {
    const body = c.req.valid("json");
    const t = await resolve(c, c.req.param("mount"), body.path, "write");
    if (t.path === "/")
      throw new FmError("INVALID", "Invalid path");
    if (t.mount.uploads === false)
      throw new FmError("UNSUPPORTED", "Upload sessions are off for this mount");
    if (body.size > limits.maxSessionUploadBytes)
      throw new FmError("TOO_LARGE", `Upload exceeds ${limits.maxSessionUploadBytes} bytes`);
    const d = t.mount.driver;
    await sweepUploads(d);
    const target = await destination(d, dirname(t.path), basename(t.path), body.conflict);
    if (body.conflict === "fail" && await exists(d, target))
      throw new FmError("EXISTS", "Already exists");
    if (target !== t.path)
      await resolve(c, t.mount.id, target, "write");
    const mp = d.multipart;
    const partSize = Math.max(limits.uploadPartSize, mp?.minPartSize ?? 1, Math.ceil(body.size / (mp?.maxParts ?? 10000)));
    const rec: UploadRecord = {
      id: crypto.randomUUID(),
      mount: t.mount.id,
      path: target,
      size: body.size,
      partSize,
      parts: Math.max(1, Math.ceil(body.size / partSize)),
      conflict: body.conflict,
      mode: mp?.presignPart
        ? "s3-multipart"
        : "chunked",
      expiresAt: Date.now() + limits.uploadSessionTtlMs,
    };
    if (mp)
      rec.uploadId = await mp.begin(target);
    await d.write(recordPath(rec.id), new TextEncoder().encode(JSON.stringify(rec)));
    return c.json(await toSession(d, rec), 201);
  });

  app.get("/m/:mount/uploads/:id", describeRoute({
    tags: [TAG],
    summary: "Upload session status",
    description: "`received` lists the stored parts; `urls` are presigned again.",
    responses: {
      200: ok(uploadSessionSchema, "Upload session"),
      ...ERRORS,
    },
  }), v("param", uploadParam), async (c) => {
    const { mount, id } = c.req.valid("param");
    const rec = await loadUpload(c, mount, id);
    const t = await resolve(c, mount, rec.path, "write");
    return c.json(await toSession(t.mount.driver, rec));
  });

  app.put("/m/:mount/uploads/:id/parts/:n", describeRoute({
    tags: [TAG],
    summary: "Upload one part",
    description: "Raw request body of exactly the part length (`partSize`, the remainder for the last part). Replaces an earlier upload of the part. `chunked` sessions only.",
    responses: {
      200: ok(z.object({
        n: z.number(),
        size: z.number(),
      }), "Stored part"),
      413: err("Too large"),
      ...ERRORS,
    },
  }), v("param", uploadParam.extend({
    n: z.string(),
  })), async (c) => {
    const { mount, id } = c.req.valid("param");
    const rec = await loadUpload(c, mount, id);
    const t = await resolve(c, mount, rec.path, "write");
    if (rec.mode !== "chunked")
      throw new FmError("INVALID", "Parts go to the presigned URLs");
    const n = Number(c.req.valid("param").n);
    if (!Number.isInteger(n) || n < 1 || n > rec.parts)
      throw new FmError("INVALID", `Invalid part number: ${c.req.valid("param").n}`);
    const expected = partLength(rec, n);
    const contentLength = c.req.header("content-length");
    if (contentLength === undefined || Number(contentLength) !== expected)
      throw new FmError("INVALID", `Part ${n} must be ${expected} bytes`);
    const body = c.req.raw.body
      ? limitStream(c.req.raw.body, expected)
      : new Uint8Array();
    const d = t.mount.driver;
    if (rec.uploadId) {
      if (!d.multipart?.uploadPart)
        throw new FmError("UNSUPPORTED", "Driver cannot store parts");
      await d.multipart.uploadPart(rec.path, rec.uploadId, n, body, expected);
    }
    else {
      const path = `${partsDir(rec.id)}/${n}`;
      const written = await d.write(path, body, { size: expected });
      if (written.size !== expected) {
        await d.remove(path).catch(() => {});
        throw new FmError("INVALID", `Part ${n} must be ${expected} bytes`);
      }
    }
    return c.json({ n, size: expected });
  });

  app.post("/m/:mount/uploads/:id/complete", describeRoute({
    tags: [TAG],
    summary: "Complete an upload session",
    description: "Assembles all parts into the session path. On failure the session stays and `complete` may be retried.",
    responses: {
      200: ok(entrySchema, "Written entry"),
      ...ERRORS,
    },
  }), v("param", uploadParam), async (c) => {
    const { mount, id } = c.req.valid("param");
    const rec = await loadUpload(c, mount, id);
    const event: EventDraft = {
      op: "write",
      mount,
      path: rec.path,
    };
    return track(c, event, async () => {
      const t = await resolve(c, mount, rec.path, "write");
      const d = t.mount.driver;
      const opts: FmWriteOptions = {
        ...changeCtx(c),
        size: rec.size,
        ...(rec.conflict === "overwrite"
          ? {}
          : { exclusive: true }),
      };
      let written: FmDriverEntry;
      try {
        const parts = await storedParts(d, rec);
        for (let n = 1; n <= rec.parts; n++) {
          if (parts[n - 1]?.n !== n)
            throw new FmError("INVALID", `Missing part ${n}`);
        }
        if (rec.uploadId && d.multipart) {
          written = await d.multipart.complete(rec.path, rec.uploadId, parts, opts);
        }
        else {
          written = await d.write(rec.path, joinParts(d, rec), opts);
          await d.remove(partsDir(rec.id)).catch(() => {});
        }
      }
      catch (e) {
        if (isFmError(e, "NOT_FOUND"))
          await discardUpload(d, rec).catch(() => {});
        throw e;
      }
      await d.remove(recordPath(rec.id)).catch(() => {});
      return c.json(toEntry(t, written));
    });
  });

  app.delete("/m/:mount/uploads/:id", describeRoute({
    tags: [TAG],
    summary: "Abort an upload session",
    responses: {
      200: ok(z.object({
        ok: z.literal(true),
      }), "Aborted"),
      ...ERRORS,
    },
  }), v("param", uploadParam), async (c) => {
    const { mount, id } = c.req.valid("param");
    const rec = await loadUpload(c, mount, id);
    const t = await resolve(c, mount, rec.path, "write");
    await discardUpload(t.mount.driver, rec);
    return c.json({ ok: true });
  });

  return app;
}
