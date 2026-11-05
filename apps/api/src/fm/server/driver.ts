import type { FmCaps, FmEntryKind, FmSearchMode } from "../core/schema";

/** An entry as seen by a driver: mount-relative path, no caller caps. */
export interface FmDriverEntry {
  path: string;
  name: string;
  kind: FmEntryKind;
  size: number;
  /** Epoch milliseconds. */
  mtime: number;
  etag: string;
  mime?: string;
  /** Matched by an ignore rule such as .gitignore; set only by drivers that know. */
  ignored?: boolean;
}

export interface FmByteRange {
  start: number;
  /** Inclusive. */
  end: number;
}

export interface FmReadResult {
  body: ReadableStream<Uint8Array>;
  /** Full object size. */
  size: number;
  range?: FmByteRange;
}

/** Context of a change requested by a user; drivers that keep history (commits, versions) may record it. */
export interface FmChangeContext {
  /** The note the user gave with the change (`X-Fm-Message`). */
  message?: string;
}

export interface FmWriteOptions extends FmChangeContext {
  /** Fail with ETAG_MISMATCH unless the current etag matches. */
  ifMatch?: string;
  /** Fail with EXISTS when the target exists. */
  exclusive?: boolean;
  /** Body length in bytes when known; lets streaming backends avoid buffering. */
  size?: number;
}

export interface FmSearchOptions {
  /** Max entries to return. */
  limit: number;
  /**
   * `substring` (default): name contains `q`. `fuzzy`: the path below `dir`
   * fuzzy-matches `q` (`fuzzyScore` not null), best first.
   */
  mode?: FmSearchMode;
  signal?: AbortSignal;
}

/** A file that differs from the driver's baseline (a git commit, a previous version …). */
export interface FmChange {
  path: string;
  status: "added" | "modified" | "deleted" | "renamed" | "untracked";
  /** Path in the baseline, for renames. */
  previousPath?: string;
  additions?: number;
  deletions?: number;
}

/** Optional review capability: what changed against a baseline, and the baseline's bytes. */
export interface FmChanges {
  list: () => Promise<FmChange[]>;
  /**
   * The baseline version of `path` (its previous path for renames), or null when it
   * has none. `from` names the baseline path when it differs from `path`, so the
   * router can authorize it too.
   */
  readBase: (path: string) => Promise<(FmReadResult & { from?: string }) | null>;
}

/** One stored part of a multipart upload. */
export interface FmUploadPart {
  /** Part number, starting at 1. */
  n: number;
  size: number;
  etag: string;
}

/**
 * Optional multipart upload capability. Every part except the last has the
 * same size, at least `minPartSize`. Implement `uploadPart` (bytes pass
 * through the server), `presignPart` (the client PUTs straight to storage),
 * or both. `uploadId` is opaque and must survive a server restart for
 * persistent backends.
 */
export interface FmMultipart {
  /** Smallest allowed non-final part in bytes (default 1). */
  readonly minPartSize?: number;
  /** Max parts per upload (default 10000). */
  readonly maxParts?: number;
  /** Starts an upload of `path`; returns the upload id. */
  begin: (path: string) => Promise<string>;
  /** Stores part `n`, replacing an earlier upload of the same part. INVALID when the body length differs from `size`. */
  uploadPart?: (path: string, uploadId: string, n: number, body: ReadableStream<Uint8Array> | Uint8Array, size: number) => Promise<FmUploadPart>;
  /** URL the client may `PUT` part `n` to for `expiresIn` seconds. */
  presignPart?: (path: string, uploadId: string, n: number, expiresIn: number) => Promise<string>;
  /** Stored parts sorted by `n`; NOT_FOUND for an unknown, aborted or completed upload. */
  listParts: (path: string, uploadId: string) => Promise<FmUploadPart[]>;
  /**
   * Assembles `parts` (from `listParts`, numbered 1..N without gaps) into
   * `path` (the same path given to `begin`), creating parents; INVALID for gaps or unknown parts. Honours
   * `exclusive` / `ifMatch` like `write`. The upload is gone afterwards.
   */
  complete: (path: string, uploadId: string, parts: FmUploadPart[], opts?: FmWriteOptions) => Promise<FmDriverEntry>;
  /** Discards the upload and its parts. Idempotent. */
  abort: (path: string, uploadId: string) => Promise<void>;
}

/**
 * A storage backend. Paths are normalized (`/a/b`) and mount-relative; the
 * router validates them before calling in. Errors are `FmError`s.
 *
 * Contract (checked by `runDriverContract`):
 * - `write` creates missing parent directories.
 * - `move` / `copy` fail with EXISTS when `to` exists and NOT_FOUND when `from` does not.
 * - `remove` deletes directories recursively.
 * - `list` returns direct children in any order.
 * - `search` is optional; without it the router walks the tree with `list`.
 * - `multipart` is optional; see `FmMultipart`.
 */
export interface FmDriver {
  readonly name: string;
  /** Actions this backend supports at all. */
  readonly caps: FmCaps;
  stat: (path: string) => Promise<FmDriverEntry>;
  list: (path: string) => Promise<FmDriverEntry[]>;
  read: (path: string, range?: FmByteRange) => Promise<FmReadResult>;
  write: (path: string, body: ReadableStream<Uint8Array> | Uint8Array, opts?: FmWriteOptions) => Promise<FmDriverEntry>;
  mkdir: (path: string, ctx?: FmChangeContext) => Promise<FmDriverEntry>;
  move: (from: string, to: string, ctx?: FmChangeContext) => Promise<FmDriverEntry>;
  copy: (from: string, to: string, ctx?: FmChangeContext) => Promise<FmDriverEntry>;
  remove: (path: string, ctx?: FmChangeContext) => Promise<void>;
  /**
   * Entries below `dir` (any depth, `dir` itself excluded) matching `q` per
   * `opts.mode`, at most `limit`. `null` means the driver cannot
   * search here and the router should walk instead.
   */
  search?: (dir: string, q: string, opts: FmSearchOptions) => Promise<FmDriverEntry[] | null>;
  /** Optional; without it the router stores parts as hidden files and assembles them itself. */
  multipart?: FmMultipart;
  /** Changes against a baseline (review / diff), e.g. git status of a work tree. */
  changes?: FmChanges;
}

export async function readAll(body: ReadableStream<Uint8Array> | Uint8Array): Promise<Uint8Array<ArrayBuffer>> {
  if (body instanceof Uint8Array) {
    return body.buffer instanceof ArrayBuffer
      ? body as Uint8Array<ArrayBuffer>
      : new Uint8Array(body);
  }
  return new Uint8Array(await new Response(body).arrayBuffer());
}

export function bytesStream(bytes: Uint8Array): ReadableStream<Uint8Array> {
  return new ReadableStream({
    start(controller) {
      controller.enqueue(bytes);
      controller.close();
    },
  });
}
