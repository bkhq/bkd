import type { FmConflict, FmUploadSession } from "../core/schema";
import type { FmClient } from "./client";
import { createStore } from "zustand/vanilla";
import { FmApiError } from "./client";

export type FmUploadStatus = "queued" | "uploading" | "done" | "error" | "canceled";

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
  cancel: (id: string) => void;
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

export function createUploadQueue(opts: FmUploadQueueOptions) {
  const concurrency = opts.concurrency ?? 3;
  const threshold = opts.sessionThreshold ?? 16 * 1024 * 1024;
  const partTransport = opts.partTransport ?? xhrPartTransport;
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
  let seq = 0;

  const store = createStore<FmUploadState>()((set, get) => {
    const patch = (id: string, p: Partial<FmUploadTask>) =>
      set(s => ({
        tasks: s.tasks.map(t => (t.id === id
          ? {
              ...t,
              ...p,
            }
          : t)),
      }));

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
        const saved = remembered.get(key);
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
        id = session.id;
        signal.throwIfAborted();
        patch(task.id, { path: session.path });

        const { partSize, parts } = session;
        const range = (n: number) => [
          (n - 1) * partSize,
          Math.min(n * partSize, file.size),
        ] as const;
        const received = new Set(session.received);
        let done = 0;
        for (const n of received) {
          const [start, end] = range(n);
          done += end - start;
        }
        patch(task.id, { loaded: done });
        for (let n = 1; n <= parts; n++) {
          if (received.has(n))
            continue;
          const [start, end] = range(n);
          const body = file.slice(start, end);
          for (let attempt = 0; ; attempt++) {
            const chunked = session.mode === "chunked";
            const url = chunked
              ? client.uploadPartUrl(task.mount, id, n)
              : session.urls?.[n - 1] ?? "";
            try {
              await partTransport(url, body, chunked
                ? client.headers()
                : {}, loaded => patch(task.id, { loaded: done + loaded }), signal);
              break;
            }
            catch (err) {
              if (signal.aborted || attempt >= retries)
                throw err;
              // Presigned URLs may have expired; fetch fresh ones.
              if (!chunked && err instanceof FmApiError && err.status === 403)
                session = await client.getUpload(task.mount, id);
              await wait(retryDelayMs * 2 ** attempt, signal);
            }
          }
          done += end - start;
          patch(task.id, { loaded: done });
        }
        await client.completeUpload(task.mount, id, { message: task.message });
        remembered.remove(key);
      }
      catch (err) {
        if (signal.aborted) {
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
      patch(task.id, { status: "uploading" });
      try {
        const file = files.get(task.id)!;
        if (opts.client && file.size >= threshold && (opts.sessions?.(task.mount) ?? true))
          await runSession(opts.client, task, file, controller.signal);
        else
          await opts.transport(task, file, loaded => patch(task.id, { loaded }), controller.signal);
        patch(task.id, { status: "done", loaded: task.size });
        opts.onUploaded?.(get().tasks.find(t => t.id === task.id) ?? task);
      }
      catch (err) {
        if (controller.signal.aborted) {
          patch(task.id, { status: "canceled" });
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
        controllers.delete(task.id);
        files.delete(task.id);
        pump();
      }
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
        if (task?.status === "queued") {
          files.delete(id);
          patch(id, { status: "canceled" });
        }
        controllers.get(id)?.abort();
      },
      clearFinished: () => set(s => ({
        tasks: s.tasks.filter(t => t.status === "queued" || t.status === "uploading"),
      })),
    };
  });
  return store;
}

export type FmUploadQueue = ReturnType<typeof createUploadQueue>;
