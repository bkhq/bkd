import type { FmUploadFile } from "../client/upload";
import type { FmEntry } from "../core/schema";
import type { FmListFilters } from "./filters";
import type { FmShortcutId } from "./shortcuts";
import type { FmController } from "./use-file-manager";

import { useCallback, useEffect, useState } from "react";

import { dirname } from "../core/path";
import { NO_FILTERS, parseFilters } from "./filters";
import { parseHidden } from "./mount-visibility";
import { shortcutText } from "./shortcuts";
/** A folder that an action targets instead of the current one. */
export interface FmFolderRef {
  mount: string;
  path: string;
}

export type FmDialogState
  = | { kind: "mkdir"; to?: FmFolderRef }
    | { kind: "rename"; entry: FmEntry }
    | { kind: "delete"; paths: string[]; mount: string; after?: () => void }
    | { kind: "newFile"; to?: FmFolderRef }
    | { kind: "emptyTrash" }
    | { kind: "manageDrives" }
    | { kind: "shortcuts" }
    | { kind: "uploadConflict"; files: FmUploadFile[]; clashes: Set<string>; to: FmFolderRef }
    | undefined;

/** First path segment of an upload below the target folder. */
export const topName = (f: FmUploadFile) => (f.relativePath || f.file.name).replace(/^\/+/, "").split("/")[0]!;

export function triggerDownload(url: string) {
  const a = document.createElement("a");
  a.href = url;
  a.download = "";
  a.rel = "noopener";
  document.body.append(a);
  a.click();
  a.remove();
}

/** A string choice persisted in localStorage. */
export function useStoredChoice<T extends string>(key: string, values: readonly T[], fallback: T) {
  const [value, setValue] = useState<T>(() => {
    const stored = typeof localStorage !== "undefined"
      ? localStorage.getItem(key)
      : null;
    return values.find(v => v === stored) ?? fallback;
  });
  const change = (v: T) => {
    setValue(v);
    localStorage.setItem(key, v);
  };
  return [value, change] as const;
}

/** A list of strings persisted in localStorage as JSON. */
export function useStoredList(key: string) {
  const [value, setValue] = useState(() => parseHidden(typeof localStorage !== "undefined"
    ? localStorage.getItem(key)
    : null));
  const change = (v: string[]) => {
    setValue(v);
    localStorage.setItem(key, JSON.stringify(v));
  };
  return [value, change] as const;
}

/** List filters per mount, persisted in localStorage under `prefix:mount`. */
export function useStoredFilters(prefix: string) {
  const [byMount, setByMount] = useState<Readonly<Record<string, FmListFilters>>>({});
  const get = useCallback((m: string | undefined) => {
    if (!m)
      return NO_FILTERS;
    return byMount[m] ?? (typeof localStorage !== "undefined"
      ? parseFilters(localStorage.getItem(`${prefix}:${m}`))
      : NO_FILTERS);
  }, [byMount, prefix]);
  const set = (m: string, f: FmListFilters) => {
    setByMount(all => ({ ...all, [m]: f }));
    localStorage.setItem(`${prefix}:${m}`, JSON.stringify(f));
  };
  return [get, set] as const;
}

/** Tree rows that the location opens: its mount and, outside the trash, every ancestor folder. */
export function onPathKeys(mount: string, path: string, trash: boolean) {
  const keys = [`${mount}:/`];
  if (!trash) {
    for (let p = dirname(path); p !== "/"; p = dirname(p))
      keys.push(`${mount}:${p}`);
  }
  return keys;
}

/** The remembered `{ mount, path, file? }`, if it parses. */
export function readLast(key: string) {
  try {
    const v: unknown = JSON.parse(localStorage.getItem(key) ?? "null");
    if (v && typeof v === "object" && "mount" in v && "path" in v && typeof v.mount === "string" && typeof v.path === "string") {
      return {
        mount: v.mount,
        path: v.path,
        file: "file" in v && typeof v.file === "string"
          ? v.file
          : undefined,
      };
    }
  }
  catch {}
  return undefined;
}

export const NARROW = 640;

export const MAC = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.userAgent);
const key = (id: FmShortcutId) => shortcutText(id, MAC);
/** Shortcut labels shown in context menus, from the shortcut catalog. */
export const KEYS = {
  open: key("open"),
  copy: key("copy"),
  cut: key("cut"),
  paste: key("paste"),
  copyPath: key("copyPath"),
  copyRelativePath: key("copyRelativePath"),
  rename: key("rename"),
  delete: key("delete"),
};

/** Width of an element, tracked with ResizeObserver (0 until measured). */
export function useWidth() {
  const [el, setEl] = useState<HTMLElement | null>(null);
  const [width, setWidth] = useState(0);
  useEffect(() => {
    if (!el)
      return;
    const ro = new ResizeObserver(([e]) => setWidth(e!.contentRect.width));
    ro.observe(el);
    return () => ro.disconnect();
  }, [el]);
  return [setEl, width] as const;
}

/** Entry shown in the details panel, if it is open. */
export function shellDetailsEntry({ detailsOpen, features, inTrash, selected, dir }: FmController): FmEntry | undefined {
  if (!detailsOpen || !features.details || inTrash)
    return undefined;
  return selected.length === 1
    ? selected[0]
    : dir;
}
