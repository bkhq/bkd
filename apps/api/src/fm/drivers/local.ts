import type { Stats } from "node:fs";
import type { FmChange, FmChanges, FmDriver, FmDriverEntry, FmMultipart, FmSearchOptions, FmUploadPart, FmWriteOptions } from "../server/driver";
import { cp, link, lstat, mkdir, open, readdir, realpath, rename, rm, stat, unlink } from "node:fs/promises";
import { join, resolve, sep } from "node:path";
import process from "node:process";
import { FmError } from "../core/errors";
import { fuzzyRank } from "../core/fuzzy";
import { basename, dirname, isWithin } from "../core/path";
import { ALL_CAPS, READ_ONLY_CAPS } from "../core/schema";

export interface FmLocalDriverOptions {
  /** Absolute directory served as the mount root. */
  root: string;
  readOnly?: boolean;
  /** List dotfiles (default true). */
  showHidden?: boolean;
  /**
   * When true and the root is inside a git work tree, `search` lists candidates
   * with `git ls-files`, honouring .gitignore. Only files are found (git does not
   * list directories). Otherwise the router walks. `list` marks entries git
   * ignores with `ignored: true` via `git check-ignore`. git runs with fsmonitor
   * and the untracked cache disabled, literal pathspecs and a minimal environment.
   * `.git` paths become read-only through this driver: write / mkdir / move /
   * copy / remove on any path with a `.git` segment throw FORBIDDEN.
   */
  gitIgnore?: boolean;
  /**
   * Review support (`changes`): files that differ from a git commit (default
   * `HEAD`; `base` may name another commit, e.g. where a task started) plus
   * untracked files, scoped to the root; empty when the root is not in a work tree.
   * Like `gitIgnore`, it makes `.git` paths read-only through this driver, and git
   * runs with external diff, textconv and hooks disabled.
   */
  gitChanges?: boolean | { base?: string | (() => string | Promise<string>) };
  /** Directory for in-progress multipart parts (default `<root>/.fm-uploads/parts`; the router hides `/.fm-uploads`). */
  uploadDir?: string;
}

const UPLOAD_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const PART_FILE = /^([1-9]\d*)\.part$/;

const ERRNO: Record<string, ConstructorParameters<typeof FmError>[0]> = {
  ENOENT: "NOT_FOUND",
  EEXIST: "EXISTS",
  ENOTDIR: "NOT_A_DIR",
  EISDIR: "IS_A_DIR",
  ENOTEMPTY: "NOT_EMPTY",
  ERR_FS_CP_EEXIST: "EXISTS",
};

function mapError(err: unknown, path: string): never {
  const code = (err as { code?: string }).code;
  const mapped = code ? ERRNO[code] : undefined;
  if (mapped)
    throw new FmError(mapped, `${mapped}: ${path}`);
  throw err;
}

async function exists(abs: string): Promise<boolean> {
  try {
    await lstat(abs);
    return true;
  }
  catch {
    return false;
  }
}

/** Local filesystem driver (Bun only). Every access is jailed to `root`, symlinks included. */
export function localDriver(opts: FmLocalDriverOptions): FmDriver {
  const root = resolve(opts.root);
  let realRoot: Promise<string> | undefined;
  const getRealRoot = () => (realRoot ??= realpath(root));

  const inside = (real: string, rr: string) => real === rr || real.startsWith(rr + sep);

  /** Absolute path for `path`, after checking the nearest existing ancestor resolves inside root. */
  const abs = async (path: string): Promise<string> => {
    const target = path === "/"
      ? root
      : join(root, path.slice(1));
    const rr = await getRealRoot();
    let probe = target;
    for (;;) {
      try {
        if (!inside(await realpath(probe), rr))
          throw new FmError("NOT_FOUND", `Not found: ${path}`);
        return target;
      }
      catch (err) {
        if ((err as { code?: string }).code !== "ENOENT" || probe === root) {
          throw err instanceof FmError
            ? err
            : mapError(err, path);
        }
        probe = resolve(probe, "..");
      }
    }
  };

  const etagOf = (st: Stats & { mtimeNs?: bigint }) =>
    `${Number(st.size).toString(36)}-${(st.mtimeNs ?? BigInt(Math.trunc(Number(st.mtimeMs) * 1e6))).toString(36)}`;

  const toEntry = (path: string, st: Stats & { mtimeNs?: bigint }): FmDriverEntry => ({
    path,
    name: path === "/"
      ? ""
      : basename(path),
    kind: st.isDirectory()
      ? "dir"
      : "file",
    size: st.isDirectory()
      ? 0
      : Number(st.size),
    mtime: Number(st.mtimeMs),
    etag: etagOf(st),
  });

  const statAbs = async (path: string, a: string) => {
    try {
      return toEntry(path, await stat(a, { bigint: true }) as unknown as Stats & { mtimeNs: bigint });
    }
    catch (err) {
      return mapError(err, path);
    }
  };

  const assertTransfer = async (from: string, to: string) => {
    if (from === "/" || isWithin(to, from))
      throw new FmError("INVALID", "Cannot move or copy a directory into itself");
    const [a, b] = [await abs(from), await abs(to)];
    if (!await exists(a))
      throw new FmError("NOT_FOUND", `Not found: ${from}`);
    if (await exists(b))
      throw new FmError("EXISTS", `Already exists: ${to}`);
    await mkdir(await abs(dirname(to)), { recursive: true }).catch(e => mapError(e, to));
    return [a, b] as const;
  };

  /** Spawns git at the root with fsmonitor and the untracked cache disabled and a minimal env. */
  const spawnGit = async (args: string[], extra: { stdin?: Blob; signal?: AbortSignal | undefined } = {}) => Bun.spawn([
    "git",
    "-c",
    "core.fsmonitor=false",
    "-c",
    "core.untrackedCache=false",
    "-c",
    "core.hooksPath=/dev/null",
    "-c",
    "diff.external=",
    ...args,
  ], {
    cwd: await abs("/"),
    env: {
      PATH: process.env.PATH ?? "",
      ...(process.env.HOME !== undefined
        ? { HOME: process.env.HOME }
        : {}),
      GIT_CONFIG_NOSYSTEM: "1",
      GIT_TERMINAL_PROMPT: "0",
      GIT_OPTIONAL_LOCKS: "0",
    },
    stdin: extra.stdin ?? "ignore",
    stdout: "pipe",
    stderr: "ignore",
    ...(extra.signal
      ? { signal: extra.signal }
      : {}),
  });

  /** Root-relative paths from `git ls-files` below `dir`; null when git fails or the root is not a work tree. */
  const gitFiles = async (dir: string, signal?: AbortSignal): Promise<string[] | null> => {
    try {
      const proc = await spawnGit([
        "--literal-pathspecs",
        "ls-files",
        "-z",
        "--cached",
        "--others",
        "--exclude-standard",
        "--",
        dir === "/"
          ? "."
          : dir.slice(1),
      ], { signal });
      const [out, exitCode] = await Promise.all([
        new Response(proc.stdout).text(),
        proc.exited,
      ]);
      return exitCode === 0
        ? out.split("\0").filter(Boolean)
        : null;
    }
    catch {
      return null;
    }
  };

  /** Root-relative paths among `rels` that git ignores; empty when git fails or the root is not a work tree. */
  const gitIgnored = async (rels: string[]): Promise<Set<string>> => {
    try {
      // check-ignore rejects --literal-pathspecs; a "./" prefix keeps names like ":(top)x" literal.
      const proc = await spawnGit(["check-ignore", "-z", "--stdin"], {
        stdin: new Blob([
          rels.map(r => `./${r}\0`).join(""),
        ]),
      });
      const [out, exitCode] = await Promise.all([
        new Response(proc.stdout).text(),
        proc.exited,
      ]);
      return exitCode === 0
        ? new Set(out.split("\0").filter(Boolean).map(p => p.slice(2)))
        : new Set();
    }
    catch {
      return new Set();
    }
  };

  const search = async (dir: string, q: string, o: FmSearchOptions): Promise<FmDriverEntry[] | null> => {
    const files = await gitFiles(dir, o.signal);
    if (!files)
      return null;
    let paths = files
      .map(rel => `/${rel}`)
      .filter(p => opts.showHidden !== false || !p.split("/").some(s => s.startsWith(".")));
    const relative = (path: string) => (dir === "/"
      ? path
      : path.slice(dir.length));
    if (o.mode === "fuzzy") {
      paths = fuzzyRank(q, paths, relative, paths.length);
    }
    else {
      const needle = q.toLocaleLowerCase();
      paths = paths.filter(p => basename(p).toLocaleLowerCase().includes(needle));
    }
    const out: FmDriverEntry[] = [];
    for (const p of paths) {
      if (out.length >= o.limit)
        break;
      try {
        out.push(await statAbs(p, await abs(p)));
      }
      catch {
        // Deleted but still in the index, or outside the jail.
      }
    }
    return out;
  };

  /** stdout of a git command run in the root, or null when it fails. */
  const gitOut = async (args: string[]): Promise<Uint8Array | null> => {
    try {
      const proc = await spawnGit(args);
      const [out, exitCode] = await Promise.all([
        new Response(proc.stdout).bytes(),
        proc.exited,
      ]);
      return exitCode === 0
        ? out
        : null;
    }
    catch {
      return null;
    }
  };
  const gitBase = async () => {
    const o = typeof opts.gitChanges === "object"
      ? opts.gitChanges.base
      : undefined;
    return (typeof o === "function"
      ? await o()
      : o) ?? "HEAD";
  };
  /** Above this many changed files, line counts are skipped. */
  const NUMSTAT_MAX = 2000;
  const changes: FmChanges = {
    async list() {
      const base = await gitBase();
      const nul = (b: Uint8Array | null) => (b
        ? new TextDecoder().decode(b).split("\0")
        : null);
      const diff = nul(await gitOut([
        "diff",
        "--no-ext-diff",
        "--no-textconv",
        "--name-status",
        "-z",
        "-M",
        "--relative",
        base,
        "--",
      ]));
      if (!diff)
        return [];
      const out = new Map<string, FmChange>();
      for (let i = 0; i < diff.length - 1;) {
        const code = diff[i++]!;
        if (!code)
          continue;
        const kind = code[0];
        if (kind === "R" || kind === "C") {
          const from = diff[i++]!;
          const to = diff[i++]!;
          out.set(`/${to}`, kind === "R"
            ? { path: `/${to}`, status: "renamed", previousPath: `/${from}` }
            : { path: `/${to}`, status: "added" });
          continue;
        }
        const path = `/${diff[i++]!}`;
        out.set(path, {
          path,
          status: kind === "A"
            ? "added"
            : kind === "D"
              ? "deleted"
              : "modified",
        });
      }
      for (const rel of nul(await gitOut([
        "ls-files",
        "-z",
        "--others",
        "--exclude-standard",
        "--",
        ".",
      ])) ?? []) {
        if (rel)
          out.set(`/${rel}`, { path: `/${rel}`, status: "untracked" });
      }
      if (out.size <= NUMSTAT_MAX) {
        // "add\tdel\tpath\0", renames as "add\tdel\t\0from\0to\0"; binaries count "-".
        const stats = nul(await gitOut([
          "diff",
          "--no-ext-diff",
          "--no-textconv",
          "--numstat",
          "-z",
          "-M",
          "--relative",
          base,
          "--",
        ])) ?? [];
        for (let i = 0; i < stats.length - 1; i++) {
          const [add, del, path] = stats[i]!.split("\t");
          if (add === undefined || del === undefined)
            continue;
          const to = path || (i += 2, stats[i]!);
          const c = out.get(`/${to}`);
          if (c && add !== "-") {
            c.additions = Number(add);
            c.deletions = Number(del);
          }
        }
      }
      return [
        ...out.values(),
      ];
    },
    async readBase(path) {
      const base = await gitBase();
      const show = (rel: string) => gitOut(["show", "--no-textconv", `${base}:./${rel}`]);
      // Same path first; a renamed file's base lives under its previous name.
      let bytes = await show(path.replace(/^\/+/, ""));
      let from: string | undefined;
      if (!bytes) {
        from = (await changes.list()).find(c => c.path === path)?.previousPath;
        bytes = from
          ? await show(from.slice(1))
          : null;
      }
      if (!bytes)
        return null;
      return {
        body: new Blob([bytes as Uint8Array<ArrayBuffer>]).stream(),
        size: bytes.length,
        ...(from
          ? { from }
          : {}),
      };
    },
  };

  /**
   * Throws when the mount is read-only, or when git runs on the tree (gitIgnore /
   * gitChanges) and a path is inside `.git`: repository config can name programs
   * (external diff, textconv, filters) that git would run on the server.
   */
  const writable = (...paths: string[]) => {
    if (opts.readOnly)
      throw new FmError("UNSUPPORTED", "Mount is read-only");
    for (const path of paths) {
      if ((opts.gitIgnore || opts.gitChanges) && path.split("/").some(s => s.toLowerCase() === ".git"))
        throw new FmError("FORBIDDEN", `Forbidden: ${path}`);
    }
  };

  /** Applies the `write` target checks and creates parents; returns the absolute target. */
  const prepareWrite = async (path: string, o: FmWriteOptions) => {
    const a = await abs(path);
    const current = await stat(a, { bigint: true }).catch(() => undefined);
    if (current?.isDirectory())
      throw new FmError("IS_A_DIR", `Is a directory: ${path}`);
    if (current && o.exclusive)
      throw new FmError("EXISTS", `Already exists: ${path}`);
    if (o.ifMatch !== undefined && (!current || toEntry(path, current as unknown as Stats).etag !== o.ifMatch))
      throw new FmError("ETAG_MISMATCH", "File changed since it was read");
    await mkdir(resolve(a, ".."), { recursive: true }).catch(e => mapError(e, path));
    return a;
  };

  /** Fills a temp file next to `a`, then moves it into place (hard link when exclusive). */
  const commitWrite = async (path: string, a: string, o: FmWriteOptions, fill: (tmp: string) => Promise<unknown>) => {
    const tmp = join(resolve(a, ".."), `.${basename(path)}.fm-${crypto.randomUUID()}`);
    try {
      await fill(tmp);
      if (o.exclusive) {
        await link(tmp, a).catch(e => mapError(e, path));
        await unlink(tmp);
      }
      else {
        await rename(tmp, a);
      }
    }
    catch (err) {
      await rm(tmp, { force: true });
      throw err;
    }
    return statAbs(path, a);
  };

  const uploadDir = resolve(opts.uploadDir ?? join(root, ".fm-uploads", "parts"));

  /** Directory of upload `id` for `path`; NOT_FOUND for a malformed id, unknown upload or other path. */
  const uploadOf = async (path: string, id: string) => {
    if (!UPLOAD_ID.test(id))
      throw new FmError("NOT_FOUND", `Unknown upload: ${id}`);
    const dir = join(uploadDir, id);
    const meta = await Bun.file(join(dir, "meta.json")).json().catch(() => undefined) as { path?: unknown } | undefined;
    if (meta?.path !== path)
      throw new FmError("NOT_FOUND", `Unknown upload: ${id}`);
    return dir;
  };

  const partsOf = async (dir: string): Promise<FmUploadPart[]> => {
    const out: FmUploadPart[] = [];
    for (const name of await readdir(dir)) {
      const m = PART_FILE.exec(name);
      if (!m)
        continue;
      const st = await stat(join(dir, name), { bigint: true }) as unknown as Stats & { mtimeNs: bigint };
      out.push({
        n: Number(m[1]),
        size: Number(st.size),
        etag: etagOf(st),
      });
    }
    return out.sort((a, b) => a.n - b.n);
  };

  const multipart: FmMultipart = {
    async begin(path) {
      writable(path);
      const id = crypto.randomUUID();
      const dir = join(uploadDir, id);
      await mkdir(dir, { recursive: true });
      await Bun.write(join(dir, "meta.json"), JSON.stringify({ path }));
      return id;
    },
    async uploadPart(path, uploadId, n, body, size) {
      writable(path);
      const dir = await uploadOf(path, uploadId);
      if (!Number.isInteger(n) || n < 1)
        throw new FmError("INVALID", `Invalid part number: ${n}`);
      const tmp = join(dir, `${n}.part.tmp`);
      const file = join(dir, `${n}.part`);
      try {
        const written = body instanceof Uint8Array
          ? await Bun.write(tmp, body)
          : await Bun.write(tmp, new Response(body));
        if (written !== size)
          throw new FmError("INVALID", `Part ${n} is ${written} bytes, expected ${size}`);
        await rename(tmp, file);
      }
      catch (err) {
        await rm(tmp, { force: true });
        throw err;
      }
      const st = await stat(file, { bigint: true }) as unknown as Stats & { mtimeNs: bigint };
      return {
        n,
        size,
        etag: etagOf(st),
      };
    },
    async listParts(path, uploadId) {
      return partsOf(await uploadOf(path, uploadId));
    },
    async complete(path, uploadId, parts, o = {}) {
      writable(path);
      const dir = await uploadOf(path, uploadId);
      const stored = new Map((await partsOf(dir)).map(p => [p.n, p]));
      parts.forEach((p, i) => {
        if (p.n !== i + 1 || stored.get(p.n)?.size !== p.size)
          throw new FmError("INVALID", `Missing or unknown part ${i + 1}`);
      });
      const a = await prepareWrite(path, o);
      const entry = await commitWrite(path, a, o, async (tmp) => {
        const fh = await open(tmp, "w");
        try {
          for (const p of parts) {
            for await (const chunk of Bun.file(join(dir, `${p.n}.part`)).stream())
              await fh.write(chunk);
          }
        }
        finally {
          await fh.close();
        }
      });
      await rm(dir, { recursive: true, force: true });
      return entry;
    },
    async abort(_path, uploadId) {
      if (!UPLOAD_ID.test(uploadId))
        throw new FmError("NOT_FOUND", `Unknown upload: ${uploadId}`);
      await rm(join(uploadDir, uploadId), { recursive: true, force: true });
    },
  };

  return {
    name: "local",
    caps: opts.readOnly ? READ_ONLY_CAPS : ALL_CAPS,
    ...(opts.gitChanges
      ? { changes }
      : {}),
    async stat(path) {
      return statAbs(path, await abs(path));
    },
    async list(path) {
      const dir = await abs(path);
      const rr = await getRealRoot();
      let dirents;
      try {
        dirents = await readdir(dir, { withFileTypes: true });
      }
      catch (err) {
        return mapError(err, path);
      }
      const out: FmDriverEntry[] = [];
      for (const d of dirents) {
        if (opts.showHidden === false && d.name.startsWith("."))
          continue;
        const childPath = path === "/"
          ? `/${d.name}`
          : `${path}/${d.name}`;
        const a = join(dir, d.name);
        try {
          if (d.isSymbolicLink() && !inside(await realpath(a), rr))
            continue;
          out.push(await statAbs(childPath, a));
        }
        catch {
          // Dangling symlinks and entries removed mid-listing are skipped.
        }
      }
      if (opts.gitIgnore && out.length > 0) {
        const ignored = await gitIgnored(out.map(e => e.path.slice(1)));
        for (const e of out) {
          if (ignored.has(e.path.slice(1)))
            e.ignored = true;
        }
      }
      return out;
    },
    async read(path, range) {
      const a = await abs(path);
      const entry = await statAbs(path, a);
      if (entry.kind !== "file")
        throw new FmError("IS_A_DIR", `Is a directory: ${path}`);
      const file = Bun.file(a);
      const body = range
        ? file.slice(range.start, range.end + 1).stream()
        : file.stream();
      return {
        body,
        size: entry.size,
        ...(range
          ? { range }
          : {}),
      };
    },
    async write(path, body, o = {}) {
      writable(path);
      const a = await prepareWrite(path, o);
      return commitWrite(path, a, o, tmp => body instanceof Uint8Array
        ? Bun.write(tmp, body)
        : Bun.write(tmp, new Response(body)));
    },
    async mkdir(path) {
      writable(path);
      const a = await abs(path);
      if (await exists(a))
        throw new FmError("EXISTS", `Already exists: ${path}`);
      await mkdir(a, { recursive: true }).catch(e => mapError(e, path));
      return statAbs(path, a);
    },
    async move(from, to) {
      writable(from, to);
      const [a, b] = await assertTransfer(from, to);
      try {
        await rename(a, b);
      }
      catch (err) {
        if ((err as { code?: string }).code !== "EXDEV")
          return mapError(err, from);
        await cp(a, b, { recursive: true, errorOnExist: true, force: false });
        await rm(a, { recursive: true, force: true });
      }
      return statAbs(to, b);
    },
    async copy(from, to) {
      writable(from, to);
      const [a, b] = await assertTransfer(from, to);
      await cp(a, b, { recursive: true, errorOnExist: true, force: false }).catch(e => mapError(e, to));
      return statAbs(to, b);
    },
    async remove(path) {
      writable(path);
      if (path === "/")
        throw new FmError("INVALID", "Cannot remove the root");
      const a = await abs(path);
      if (!await exists(a))
        throw new FmError("NOT_FOUND", `Not found: ${path}`);
      await rm(a, { recursive: true, force: true });
    },
    ...(opts.gitIgnore
      ? { search }
      : {}),
    ...(opts.readOnly
      ? {}
      : { multipart }),
  };
}
