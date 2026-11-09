import { FmError } from "./errors";

/** Normalizes a mount-relative POSIX path to `/a/b`. Rejects `..`, NUL and backslashes. */
export function normalizePath(input: string): string {
  if (input.includes("\0") || input.includes("\\"))
    throw new FmError("INVALID", "Invalid path");
  const parts: string[] = [];
  for (const part of input.split("/")) {
    if (part === "" || part === ".")
      continue;
    if (part === "..")
      throw new FmError("INVALID", "Path must not contain '..'");
    parts.push(part);
  }
  return `/${parts.join("/")}`;
}

export function joinPath(dir: string, name: string): string {
  assertName(name);
  return dir === "/"
    ? `/${name}`
    : `${dir}/${name}`;
}

export function dirname(path: string): string {
  const i = path.lastIndexOf("/");
  return i <= 0
    ? "/"
    : path.slice(0, i);
}

export function basename(path: string): string {
  return path.slice(path.lastIndexOf("/") + 1);
}

/** True when `path` equals `parent` or lies below it. */
export function isWithin(path: string, parent: string): boolean {
  return parent === "/" || path === parent || path.startsWith(`${parent}/`);
}

export function assertName(name: string): void {
  if (!name || name === "." || name === ".." || name.includes("/") || name.includes("\\") || name.includes("\0") || name.length > 255)
    throw new FmError("INVALID", `Invalid name: ${name}`);
}

/** `a.txt` -> `a (1).txt`, `a (1).txt` -> `a (2).txt`, `dir` -> `dir (1)`. */
export function nextFreeName(name: string, n: number): string {
  const dot = name.lastIndexOf(".");
  const hasExt = dot > 0;
  const stem = hasExt
    ? name.slice(0, dot)
    : name;
  const ext = hasExt
    ? name.slice(dot)
    : "";
  return `${stem.replace(/ \(\d+\)$/, "")} (${n})${ext}`;
}

/** Real path of a mount path under the host's `absoluteRoot`. */
export function absolutePath(root: string, path: string): string {
  const base = root.replace(/\/+$/, "");
  return path === "/"
    ? base || "/"
    : `${base}${path}`;
}

/** A mount path as a relative one: no leading slash, `.` for the root. */
export function relativePath(path: string): string {
  return path.slice(1) || ".";
}
