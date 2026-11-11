import type { FmConflict, FmUploadSession } from "../core/schema";
import type { FmClient } from "./client";
import { createStore } from "zustand/vanilla";
import { FmApiError } from "./client";

export type FmUploadStatus = "queued" | "uploading" | "paused" | "done" | "error" | "canceled";

export interface FmUploadTask {
  id: string;
  mount: string;
  /** Requested target path; the server may pick a free name. */
  path: string;
  name: string;
  /** What the server does when `path` exists. */
  conflict: FmConflict;
  size: number;
  loaded: number;
  status: FmUploadStatus;
  error?: string;
  /** Change note sent with the upload (`X-Fm-Message`). */
  message?: string;
}

export interface FmUploadFile {
  file: Blob & { name: string };
  /** Path below the target directory, e.g. `photos/a.jpg` for folder uploads. */
  relativePath?: string;
  /** Defaults to `rename` (keep both). */
  conflict?: FmConflict;
  /** Change note for this file's upload. */
  message?: string;
}

export type FmTransport = (task: FmUploadTask, file: Blob, onProgress: (loaded: number) => void, signal: AbortSignal) => Promise<void>;

/** PUTs one part of an upload session. */
export type FmPartTransport = (url: string, body: Blob, headers: Record<string, string>, onProgress: (loaded: number) => void, signal: AbortSignal) => Promise<void>;

export interface FmUploadState {
  tasks: FmUploadTask[];
  enqueue: (mount: string, dir: string, files: FmUploadFile[]) => void;
  /** Stops the upload and aborts its server session. */
  cancel: (id: string) => void;
  /**
   * Holds a queued or running upload. A running session upload stops its part
   * requests but keeps the server session, so `resume` sends only the missing
   * parts; a single-PUT upload starts over on resume.
   */
  pause: (id: string) => void;
  /** Queues a paused upload again. */
  resume: (id: string) => void;
  pauseAll: () => void;
  resumeAll: () => void;
  clearFinished: () => void;
}

function xhrPut(url: string, body: Blob, headers: Record<string, string>, onProgress: (loaded: number) => void, signal: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("PUT", url);
    for (const [k, v] of Object.entries(headers))
      xhr.setRequestHeader(k, v);
    xhr.upload.onprogress = e => onProgress(e.loaded);
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300)
        return resolve();
      let res: { error?: { code?: string; message?: string } } | undefined;
      try {
        res = JSON.parse(xhr.responseText);
      }
      catch {}
      reject(new FmApiError(xhr.status, res?.error?.code ?? "HTTP_ERROR", res?.error?.message ?? xhr.statusText));
    };
    xhr.onerror = () => reject(new Error("Network error"));
    xhr.onabort = () => reject(new DOMException("Aborted", "AbortError"));
    signal.addEventListener("abort", () => xhr.abort());
    xhr.send(body);
  });
}

/** PUT via XHR so byte progress is observable (fetch cannot report upload progress). */
export function xhrTransport(client: FmClient): FmTransport {
  return (task, file, onProgress, signal) => xhrPut(client.writeUrl(task.mount, task.path, task.conflict), file, {
    ...client.headers(),
    ...client.changeHeaders({ message: task.message }),
  }, onProgress, signal);
}

export const xhrPartTransport: FmPartTransport = xhrPut;

export interface FmUploadQueueOptions {
  transport: FmTransport;
  concurrency?: number;
  /** Called after each successful upload (e.g. to refresh listings). */
  onUploaded?: (task: FmUploadTask) => void;
  /** Enables resumable upload sessions for large files. */
  client?: FmClient;
  /** Files of at least this size use a session when `client` is set. Default 16 MiB. */
  sessionThreshold?: number;
  /** Whether a mount accepts upload sessions (`FmMountInfo.uploadSessions`); default all. */
  sessions?: (mount: string) => boolean;
  partTransport?: FmPartTransport;
  /** Parts of one session upload sent at the same time. Default 3. */
  partConcurrency?: number;
  /** Retries per part. Default 3. */
  retries?: number;
  /** Base retry backoff, doubled per attempt. Default 500. */
  retryDelayMs?: number;
  /** Remembers session ids so re-adding a file resumes it. Defaults to `localStorage` when available. */
  storage?: Pick<Storage, "getItem" | "setItem" | "removeItem">;
}

function defaultStorage(): FmUploadQueueOptions["storage"] {
  try {
    return globalThis.localStorage;
  }
  catch {
    return undefined;
  }
}

function wait(ms: number, signal: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    signal.throwIfAborted();
    const timer = setTimeout(resolve, ms);
    signal.addEventListener("abort", () => {
      clearTimeout(timer);
      reject(signal.reason);
    }, { once: true });
  });
}

/** Abort reason that marks a pause rather than a cancel. */
const PAUSED = new DOMException("Paused", "AbortError");

export function createUploadQueue(opts: FmUploadQueueOptions) {
  const concurrency = opts.concurrency ?? 3;
  const threshold = opts.sessionThreshold ?? 16 * 1024 * 1024;
  const partTransport = opts.partTransport ?? xhrPartTransport;
  const partConcurrency = opts.partConcurrency ?? 3;
  const retries = opts.retries ?? 3;
  const retryDelayMs = opts.retryDelayMs ?? 500;
  const storage = "storage" in opts
    ? opts.storage
    : defaultStorage();
  const remembered = {
    get: (key: string) => {
      try {
        return storage?.getItem(key) ?? null;
      }
      catch {
        return null;
      }
    },
    set: (key: string, id: string) => {
      try {
        storage?.setItem(key, id);
      }
      catch {}
    },
    remove: (key: string) => {
      try {
        storage?.removeItem(key);
      }
      catch {}
    },
  };
  const files = new Map<string, Blob>();
  const controllers = new Map<string, AbortController>();
  /** Server sessions of started tasks, so a resume works without `storage`. */
  const sessions = new Map<string, { id: string; key: string }>();
  /** Byte progress not yet written to the store, flushed once per frame. */
  const progressed = new Map<string, number>();
  let flushScheduled = false;
  let seq = 0;

  const store = createStore<FmUploadState>()((set, get) => {
    /** Writes a task now, folding in its pending progress so the last value is kept. */
    const patch = (id: string, p: Partial<FmUploadTask>) => {
      const loaded = progressed.get(id);
      progressed.delete(id);
      set(s => ({
        tasks: s.tasks.map(t => (t.id === id
          ? {
              ...t,
              ...(loaded === undefined
                ? {}
                : { loaded }),
              ...p,
            }
          : t)),
      }));
    };

    function flushProgress() {
      flushScheduled = false;
      if (progressed.size === 0)
        return;
      const due = new Map(progressed);
      progressed.clear();
      if (!get().tasks.some(t => t.status === "uploading" && due.has(t.id)))
        return;
      set(s => ({
        tasks: s.tasks.map(t => (t.status === "uploading" && due.has(t.id)
          ? {
              ...t,
              loaded: due.get(t.id)!,
            }
          : t)),
      }));
    }

    /** Records byte progress; all tasks share one store write per animation frame (or 100 ms). */
    function progress(id: string, loaded: number) {
      progressed.set(id, loaded);
      if (flushScheduled)
        return;
      flushScheduled = true;
      if (typeof globalThis.requestAnimationFrame === "function")
        globalThis.requestAnimationFrame(flushProgress);
      else
        setTimeout(flushProgress, 100);
    }

    function pump() {
      const { tasks } = get();
      let running = tasks.filter(t => t.status === "uploading").length;
      for (const task of tasks) {
        if (running >= concurrency)
          break;
        if (task.status === "queued") {
          running++;
          void run(task);
        }
      }
    }

    async function runSession(client: FmClient, task: FmUploadTask, file: Blob, signal: AbortSignal) {
      const lastModified = (file as Blob & { lastModified?: number }).lastModified ?? 0;
      const key = `fm-upload:${task.mount}:${task.path}:${file.size}:${lastModified}:${task.name}`;
      let id: string | undefined;
      try {
        let session: FmUploadSession | undefined;
        const saved = sessions.get(task.id)?.id ?? remembered.get(key);
        if (saved) {
          session = await client.getUpload(task.mount, saved).catch(() => undefined);
          if (!session)
            remembered.remove(key);
        }
        if (!session) {
          session = await client.createUpload(task.mount, {
            path: task.path,
            size: file.size,
            conflict: task.conflict,
          });
          remembered.set(key, session.id);
        }
        const sid = session.id;
        id = sid;
        sessions.set(task.id, { id: sid, key });
        let current = session;
        signal.throwIfAborted();
        patch(task.id, { path: session.path });

        const { partSize, parts } = session;
        const range = (n: number) => [
          (n - 1) * partSize,
          Math.min(n * partSize, file.size),
        ] as const;
        const received = new Set(session.received);
        const missing: number[] = [];
        let done = 0;
        for (let n = 1; n <= parts; n++) {
          const [start, end] = range(n);
          if (received.has(n))
            done += end - start;
          else
            missing.push(n);
        }
        patch(task.id, { loaded: done });

        // Bytes sent by the parts in flight; progress = finished parts + these.
        const inflight = new Map<number, number>();
        const report = () => {
          let loaded = done;
          for (const n of inflight.values())
            loaded += n;
          progress(task.id, loaded);
        };
        // A part that runs out of retries stops its siblings.
        const failed = new AbortController();
        const partSignal = AbortSignal.any([signal, failed.signal]);

        const sendPart = async (n: number) => {
          const [start, end] = range(n);
          const body = file.slice(start, end);
          for (let attempt = 0; ; attempt++) {
            const chunked = current.mode === "chunked";
            const url = chunked
              ? client.uploadPartUrl(task.mount, sid, n)
              : current.urls?.[n - 1] ?? "";
            try {
              await partTransport(url, body, chunked
                ? client.headers()
                : {}, (loaded) => {
                inflight.set(n, loaded);
                report();
              }, partSignal);
              break;
            }
            catch (err) {
              inflight.delete(n);
              if (partSignal.aborted || attempt >= retries)
                throw err;
              // Presigned URLs may have expired; fetch fresh ones.
              if (!chunked && err instanceof FmApiError && err.status === 403)
                current = await client.getUpload(task.mount, sid);
              await wait(retryDelayMs * 2 ** attempt, partSignal);
            }
          }
          inflight.delete(n);
          done += end - start;
          report();
        };

        let next = 0;
        let failure: { err: unknown } | undefined;
        const worker = async () => {
          while (next < missing.length && !partSignal.aborted)
            await sendPart(missing[next++]!);
        };
        await Promise.all(Array.from({
          length: Math.min(partConcurrency, missing.length),
        }, () => worker().catch((err) => {
          failure ??= { err };
          failed.abort(err);
        })));
        signal.throwIfAborted();
        if (failure)
          throw failure.err;
        await client.completeUpload(task.mount, sid, { message: task.message });
        remembered.remove(key);
      }
      catch (err) {
        // A pause keeps the server session for resume; a cancel drops it.
        if (signal.aborted && signal.reason !== PAUSED) {
          if (id)
            void client.abortUpload(task.mount, id).catch(() => {});
          remembered.remove(key);
        }
        throw err;
      }
    }

    async function run(task: FmUploadTask) {
      const controller = new AbortController();
      controllers.set(task.id, controller);
      const file = files.get(task.id)!;
      const session = !!opts.client && file.size >= threshold && (opts.sessions?.(task.mount) ?? true);
      // A single PUT cannot continue; a resumed one starts from zero.
      patch(task.id, session
        ? { status: "uploading" }
        : { status: "uploading", loaded: 0 });
      let paused = false;
      try {
        if (session)
          await runSession(opts.client!, task, file, controller.signal);
        else
          await opts.transport(task, file, loaded => progress(task.id, loaded), controller.signal);
        patch(task.id, { status: "done", loaded: task.size });
        opts.onUploaded?.(get().tasks.find(t => t.id === task.id) ?? task);
      }
      catch (err) {
        if (controller.signal.aborted) {
          paused = controller.signal.reason === PAUSED;
          patch(task.id, {
            status: paused
              ? "paused"
              : "canceled",
          });
        }
        else {
          patch(task.id, {
            status: "error",
            error: err instanceof Error
              ? err.message
              : String(err),
          });
        }
      }
      finally {
        if (controllers.get(task.id) === controller)
          controllers.delete(task.id);
        if (!paused) {
          files.delete(task.id);
          sessions.delete(task.id);
        }
        pump();
      }
    }

    function pause(id: string) {
      const task = get().tasks.find(t => t.id === id);
      if (task?.status === "queued")
        patch(id, { status: "paused" });
      else if (task?.status === "uploading")
        controllers.get(id)?.abort(PAUSED);
    }

    function resume(id: string) {
      if (get().tasks.find(t => t.id === id)?.status !== "paused")
        return;
      patch(id, { status: "queued" });
      pump();
    }

    return {
      tasks: [],
      enqueue: (mount, dir, list) => {
        const added = list.map(({ file, relativePath, conflict, message }): FmUploadTask => {
          const id = `u${++seq}`;
          files.set(id, file);
          const rel = (relativePath || file.name).replace(/^\/+/, "");
          return {
            id,
            mount,
            path: `${dir === "/"
              ? ""
              : dir}/${rel}`,
            name: file.name,
            conflict: conflict ?? "rename",
            size: file.size,
            loaded: 0,
            status: "queued",
            ...(message
              ? { message }
              : {}),
          };
        });
        set(s => ({
          tasks: [
            ...s.tasks,
            ...added,
          ],
        }));
        pump();
      },
      cancel: (id) => {
        const task = get().tasks.find(t => t.id === id);
        if (task?.status === "queued" || task?.status === "paused") {
          files.delete(id);
          const session = sessions.get(id);
          sessions.delete(id);
          if (session && opts.client) {
            void opts.client.abortUpload(task.mount, session.id).catch(() => {});
            remembered.remove(session.key);
          }
          patch(id, { status: "canceled" });
        }
        controllers.get(id)?.abort();
      },
      pause,
      resume,
      pauseAll: () => {
        for (const t of get().tasks)
          pause(t.id);
      },
      resumeAll: () => {
        set(s => ({
          tasks: s.tasks.map(t => (t.status === "paused"
            ? {
                ...t,
                status: "queued",
              }
            : t)),
        }));
        pump();
      },
      clearFinished: () => set(s => ({
        tasks: s.tasks.filter(t => t.status === "queued" || t.status === "uploading" || t.status === "paused"),
      })),
    };
  });
  return store;
}

export type FmUploadQueue = ReturnType<typeof createUploadQueue>;

/**
 * Asks before leaving the page while any upload is queued or running (paused
 * ones do not count). The `beforeunload` listener is only attached while needed.
 * Returns a function that detaches it.
 */
export function guardUploadsOnUnload(queue: FmUploadQueue, target: Pick<EventTarget, "addEventListener" | "removeEventListener"> = globalThis) {
  const onBeforeUnload = (e: Event) => e.preventDefault();
  let attached = false;
  const sync = (tasks: FmUploadTask[]) => {
    const busy = tasks.some(t => t.status === "queued" || t.status === "uploading");
    if (busy === attached)
      return;
    attached = busy;
    if (busy)
      target.addEventListener("beforeunload", onBeforeUnload);
    else
      target.removeEventListener("beforeunload", onBeforeUnload);
  };
  sync(queue.getState().tasks);
  const unsubscribe = queue.subscribe(s => sync(s.tasks));
  return () => {
    unsubscribe();
    if (attached)
      target.removeEventListener("beforeunload", onBeforeUnload);
    attached = false;
  };
}
