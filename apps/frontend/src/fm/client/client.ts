import type { FmChangeEntry, FmConflict, FmEntry, FmListResult, FmMountInfo, FmOpsRequest, FmOpsResult, FmSearchMode, FmSearchResult, FmSortKey, FmTrashItem, FmUploadCreate, FmUploadSession, FmUsage, FmZipEntry } from "../core/schema";

export class FmApiError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.name = "FmApiError";
    this.status = status;
    this.code = code;
  }
}

export interface FmClientOptions {
  /** Where the router is mounted, e.g. `/api/fm`. */
  baseUrl: string;
  fetch?: (input: string, init?: RequestInit) => Promise<Response>;
  /** Extra headers for every request (auth tokens …). */
  headers?: () => Record<string, string>;
  /** Note sent with every changing request (`X-Fm-Message`), e.g. a commit message field of the host. */
  message?: () => string | undefined;
}

/** Per-call change note; overrides `FmClientOptions.message`. */
export interface FmChangeOptions {
  message?: string | undefined;
}

export interface FmListParams {
  cursor?: string | undefined;
  limit?: number;
  sort?: FmSortKey;
  order?: "asc" | "desc";
  /** Case-insensitive name filter. */
  q?: string | undefined;
  /** `false` drops dot entries. */
  hidden?: boolean | undefined;
  /** `false` drops entries the driver marks ignored. */
  ignored?: boolean | undefined;
}

export interface FmSearchParams {
  limit?: number;
  mode?: FmSearchMode;
  /** `false` drops results below a dot segment. */
  hidden?: boolean | undefined;
  /** `false` drops entries the driver marks ignored. */
  ignored?: boolean | undefined;
}

/** Listing / search visibility filter; omitted fields keep the server default. */
export interface FmListFilter {
  hidden?: boolean | undefined;
  ignored?: boolean | undefined;
}

/** Only `false` is sent; the server defaults both flags to on. */
function off(v: boolean | undefined) {
  return v === false
    ? "0"
    : undefined;
}

export interface FmWriteParams extends FmChangeOptions {
  conflict?: FmConflict;
  ifMatch?: string;
}

export type FmClient = ReturnType<typeof createFmClient>;

export function createFmClient(opts: FmClientOptions) {
  const base = opts.baseUrl.replace(/\/$/, "");
  const doFetch = opts.fetch ?? ((input: string, init?: RequestInit) => fetch(input, init));

  const url = (path: string, query: Record<string, string | string[] | undefined> = {}) => {
    const q = new URLSearchParams();
    for (const [k, v] of Object.entries(query)) {
      for (const item of Array.isArray(v)
        ? v
        : (v === undefined
            ? []
            : [v]))
        q.append(k, item);
    }
    const s = q.toString();
    return `${base}${path}${s
      ? `?${s}`
      : ""}`;
  };

  const m = (mount: string) => `/m/${encodeURIComponent(mount)}`;

  const request = async (input: string, init: RequestInit = {}): Promise<Response> => {
    const headers = new Headers(init.headers);
    for (const [k, v] of Object.entries(opts.headers?.() ?? {}))
      headers.set(k, v);
    const res = await doFetch(input, { ...init, headers });
    if (!res.ok) {
      const body = await res.json().catch(() => undefined) as { error?: { code?: string; message?: string } } | undefined;
      throw new FmApiError(res.status, body?.error?.code ?? "HTTP_ERROR", body?.error?.message ?? res.statusText);
    }
    return res;
  };

  const json = async <T>(input: string, init?: RequestInit): Promise<T> => (await request(input, init)).json() as Promise<T>;
  /** `X-Fm-Message` for a changing request: the call's own note, else the host's. */
  const changeHeaders = (o: FmChangeOptions = {}): Record<string, string> => {
    const message = o.message ?? opts.message?.();
    return message?.trim()
      ? {
          "x-fm-message": encodeURIComponent(message),
        }
      : {};
  };
  const post = <T>(input: string, body: unknown, o?: FmChangeOptions) =>
    json<T>(input, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...changeHeaders(o),
      },
      body: JSON.stringify(body),
    });

  /** Raw bytes of a file; `range` holds inclusive byte offsets. */
  const read = (mount: string, path: string, o: { range?: { start: number; end: number }; version?: string } = {}) =>
    request(url(`${m(mount)}/read`, { path, v: o.version }), o.range
      ? {
          headers: { range: `bytes=${o.range.start}-${o.range.end}` },
        }
      : {});

  return {
    baseUrl: base,
    headers: () => opts.headers?.() ?? {},
    /** Headers carrying the change note, for uploads sent outside `fetch` (XHR). */
    changeHeaders,
    mounts: () => json<{ mounts: FmMountInfo[] }>(url("/mounts")).then(r => r.mounts),
    stat: (mount: string, path: string) => json<FmEntry>(url(`${m(mount)}/stat`, { path })),
    list: (mount: string, path: string, p: FmListParams = {}) => json<FmListResult>(url(`${m(mount)}/list`, {
      path,
      cursor: p.cursor,
      limit: p.limit?.toString(),
      sort: p.sort,
      order: p.order,
      q: p.q || undefined,
      hidden: off(p.hidden),
      ignored: off(p.ignored),
    })),
    /** Name matches at any depth below `path`. */
    search: (mount: string, path: string, q: string, p: FmSearchParams = {}) => json<FmSearchResult>(url(`${m(mount)}/search`, {
      path,
      q,
      limit: p.limit?.toString(),
      mode: p.mode,
      hidden: off(p.hidden),
      ignored: off(p.ignored),
    })),
    /** URL for `<img src>` / `<a href>`; `download` forces an attachment. */
    readUrl: (mount: string, path: string, o: { download?: boolean; version?: string } = {}) =>
      url(`${m(mount)}/read`, {
        path,
        download: o.download ? "1" : undefined,
        v: o.version,
      }),
    read,
    /** Resized image for mounts with `thumbnails`; 404 when none can be made. */
    thumbUrl: (mount: string, path: string, width: 128 | 256 | 512, version?: string) => url(`${m(mount)}/thumb`, {
      path,
      w: String(width),
      v: version,
    }),
    archiveUrl: (mount: string, paths: string[]) => url(`${m(mount)}/archive`, { path: paths }),
    writeUrl: (mount: string, path: string, conflict: FmConflict = "overwrite") => url(`${m(mount)}/write`, { path, conflict }),
    /** `range` holds inclusive byte offsets; the text is decoded from at most that many bytes. */
    readText: async (mount: string, path: string, o: { range?: { start: number; end: number } } = {}) => {
      const r = o.range;
      const res = await read(mount, path, r
        ? { range: r }
        : {});
      const etag = (res.headers.get("etag") ?? "").replace(/"/g, "");
      if (!r)
        return { text: await res.text(), etag };
      const bytes = new Uint8Array(await res.arrayBuffer());
      // A server ignoring Range answers 200 with the whole file.
      const from = res.status === 206
        ? 0
        : r.start;
      return {
        text: new TextDecoder().decode(bytes.slice(from, from + r.end - r.start + 1)),
        etag,
      };
    },
    write: (mount: string, path: string, body: BodyInit, p: FmWriteParams = {}) => json<FmEntry>(url(`${m(mount)}/write`, { path, conflict: p.conflict }), {
      method: "PUT",
      body,
      headers: {
        ...changeHeaders(p),
        ...(p.ifMatch
          ? { "if-match": `"${p.ifMatch}"` }
          : {}),
      },
    }),
    mkdir: (mount: string, path: string, o?: FmChangeOptions) => post<FmEntry>(url(`${m(mount)}/mkdir`), { path }, o),
    ops: (mount: string, req: FmOpsRequest, o?: FmChangeOptions) => post<FmOpsResult>(url(`${m(mount)}/ops`), req, o),
    usage: (mount: string, path: string) => json<FmUsage>(url(`${m(mount)}/usage`, { path })),
    /** Entries of a zip archive (central directory only). */
    zipEntries: (mount: string, path: string) => json<{ entries: FmZipEntry[]; truncated: boolean }>(url(`${m(mount)}/zip/entries`, { path })),
    /** URL of one zip entry for `<img src>` / `<a href>` / fetch. */
    zipEntryUrl: (mount: string, path: string, entry: string, o: { download?: boolean } = {}) => url(`${m(mount)}/zip/read`, {
      path,
      entry,
      download: o.download ? "1" : undefined,
    }),
    /** Files that differ from the mount's baseline (mounts with `changes`). */
    changes: (mount: string) => json<{ changes: FmChangeEntry[] }>(url(`${m(mount)}/changes`)).then(r => r.changes),
    /** Baseline text of `path`, or undefined when the baseline lacks it (added / untracked). */
    baseText: async (mount: string, path: string): Promise<string | undefined> => {
      try {
        return await (await request(url(`${m(mount)}/changes/base`, { path }))).text();
      }
      catch (e) {
        if (e instanceof FmApiError && e.status === 404)
          return undefined;
        throw e;
      }
    },
    trash: (mount: string) => json<{ items: FmTrashItem[] }>(url(`${m(mount)}/trash`)).then(r => r.items),
    restore: (mount: string, ids: string[], o?: FmChangeOptions) => post<FmOpsResult>(url(`${m(mount)}/trash/restore`), { ids }, o),
    /** Without `ids`, empties the trash. */
    purge: (mount: string, ids?: string[], o?: FmChangeOptions) => post<FmOpsResult>(url(`${m(mount)}/trash/purge`), ids
      ? { ids }
      : {}, o),
    /** Starts a resumable upload session. */
    createUpload: (mount: string, body: FmUploadCreate) => post<FmUploadSession>(url(`${m(mount)}/uploads`), body),
    getUpload: (mount: string, id: string) => json<FmUploadSession>(url(`${m(mount)}/uploads/${encodeURIComponent(id)}`)),
    /** URL for PUTting part `n` (from 1) of a `chunked` session. */
    uploadPartUrl: (mount: string, id: string, n: number) => url(`${m(mount)}/uploads/${encodeURIComponent(id)}/parts/${n}`),
    completeUpload: (mount: string, id: string, o?: FmChangeOptions) => json<FmEntry>(url(`${m(mount)}/uploads/${encodeURIComponent(id)}/complete`), {
      method: "POST",
      headers: changeHeaders(o),
    }),
    abortUpload: async (mount: string, id: string) => {
      await request(url(`${m(mount)}/uploads/${encodeURIComponent(id)}`), { method: "DELETE" });
    },
  };
}
