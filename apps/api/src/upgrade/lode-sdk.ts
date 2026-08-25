// lode.ts — single-file TS/JS SDK for the `lode` supervisor (github.com/dotns/lode).
// Wraps the state.json contract: read status, request upgrade/restart/rollback,
// report readiness, subscribe to lode's notifications. The SDK only *signals* lode
// (writes target/restart_nonce/ready under state.json.lock); lode does the heavy
// fetch→verify→install→observe. Bun or Node, zero deps. Contract: ../docs/integration.md §2.

import { closeSync, openSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const env = (typeof process !== "undefined" && process.env) || ({} as Record<string, string | undefined>);

/** Lifecycle status lode reports (kebab-case on the wire). */
export type Status = "starting" | "running" | "held" | "updating" | "rolling-back" | "stopping" | "stopped" | "error";

/** One entry in lode's rollout history. */
export interface HistoryEntry {
  version: string;
  at: string;
  result: "good" | "bad";
}

/** Parsed state.json. lode writes the top group; the app writes target/restartNonce/ready. */
export interface State {
  current?: string;
  lastGood?: string;
  available?: string;
  channel?: string;
  status?: Status;
  pid?: number;
  lastCheck?: string;
  lastError?: string;
  history: HistoryEntry[];
  configGeneration: number;
  target?: string;
  restartNonce: number;
  hold: boolean;
  ready?: string;
}

function toState(raw: Record<string, unknown>): State {
  const num = (v: unknown): number | undefined => (typeof v === "number" ? v : undefined);
  const str = (v: unknown): string | undefined => (typeof v === "string" ? v : undefined);
  return {
    current: str(raw.current),
    lastGood: str(raw.last_good),
    available: str(raw.available),
    channel: str(raw.channel),
    status: str(raw.status) as Status | undefined,
    pid: num(raw.pid),
    lastCheck: str(raw.last_check),
    lastError: str(raw.last_error),
    history: Array.isArray(raw.history) ? (raw.history as HistoryEntry[]) : [],
    configGeneration: num(raw.config_generation) ?? 0,
    target: str(raw.target),
    restartNonce: num(raw.restart_nonce) ?? 0,
    hold: raw.hold === true,
    ready: str(raw.ready),
  };
}

// best-effort flock(2): a real lock under Bun (bun:ffi), lock-free atomic RMW elsewhere.
const LOCK_EX = 2;
const LOCK_UN = 8;
type FlockFn = (fd: number, op: number) => number;
let flockFn: FlockFn | null | undefined;

function getFlock(): FlockFn | null {
  if (flockFn !== undefined) return flockFn;
  flockFn = null;
  try {
    if (typeof (globalThis as { Bun?: unknown }).Bun === "undefined" || typeof require === "undefined") return flockFn;
    const ffi = require("bun:ffi") as {
      dlopen: (p: string, s: unknown) => { symbols: { flock: FlockFn } };
      FFIType: { i32: unknown };
    };
    const def = { flock: { args: [ffi.FFIType.i32, ffi.FFIType.i32], returns: ffi.FFIType.i32 } };
    for (const lib of ["libc.so.6", "libSystem.B.dylib", "libc.dylib"]) {
      try {
        flockFn = ffi.dlopen(lib, def).symbols.flock;
        break;
      } catch {
        /* try the next candidate */
      }
    }
  } catch {
    /* no ffi — stay lock-free */
  }
  return flockFn;
}

function withLock<T>(lockPath: string, fn: () => T): T {
  const flock = getFlock();
  let fd = -1;
  try {
    fd = openSync(lockPath, "a");
  } catch {
    fd = -1; // no lock file — proceed lock-free (atomic rename still protects readers)
  }
  try {
    if (fd >= 0 && flock) {
      try {
        flock(fd, LOCK_EX);
      } catch {
        /* degrade to lock-free */
      }
    }
    return fn();
  } finally {
    if (fd >= 0) {
      try {
        if (flock) flock(fd, LOCK_UN);
      } catch {
        /* closing the fd releases the lock anyway */
      }
      try {
        closeSync(fd);
      } catch {
        /* best-effort */
      }
    }
  }
}

export interface LodeOptions {
  /** lode's dir (where state.json lives). Defaults to $LODE_DIR. */
  lodeDir?: string;
  /** Defaults to $LODE_INSTANCE (needed for readiness). */
  instance?: string;
}

/** Callbacks for {@link Lode.watch} — lode's notifications. Each fires on *change* only; any may be omitted. */
export interface WatchOptions {
  intervalMs?: number;
  /** config_generation rose: operator edited lode.toml. Apply via {@link Lode.reloadConfig}. */
  onConfigChange?: (generation: number, state: State) => void;
  /** A newer version is advertised (`available`, under policy = check). */
  onAvailable?: (version: string, state: State) => void;
  /** Lifecycle status changed. */
  onStatus?: (status: Status, state: State) => void;
  /** `current`/`last_good` changed — an update committed or a rollback landed. */
  onVersionChange?: (current: string | undefined, lastGood: string | undefined, state: State) => void;
  /** The `hold` flag changed (someone set/cleared a maintenance hold). */
  onHold?: (held: boolean, state: State) => void;
  /** lode recorded a (non-fatal) error. */
  onError?: (message: string, state: State) => void;
  /** Staged-update prepare prompt (`ready` == "{instance}-1"): drain, then {@link Lode.ackPrepared}. */
  onPrepare?: (state: State) => void;
  /** Every tick, the full snapshot. */
  onState?: (state: State) => void;
}

/** A handle on lode's dir (where state.json lives). {@link Lode.fromEnv} for the supervised app; `new Lode({ lodeDir })` for an external tool. */
export class Lode {
  readonly lodeDir: string;
  readonly instance: string;
  readonly statePath: string;
  readonly lockPath: string;

  constructor(opts: LodeOptions = {}) {
    const dir = opts.lodeDir ?? env.LODE_DIR;
    if (!dir) throw new Error("lode: no lode dir — set LODE_DIR (run under lode) or pass { lodeDir }");
    this.lodeDir = dir;
    this.instance = opts.instance ?? env.LODE_INSTANCE ?? "";
    this.statePath = join(dir, "state.json");
    this.lockPath = join(dir, "state.json.lock");
  }

  /** From the injected env (LODE_DIR / LODE_INSTANCE). */
  static fromEnv(): Lode {
    return new Lode();
  }

  /** Parse state.json (null when absent). Lock-free — atomic rename guarantees a whole snapshot. */
  read(): State | null {
    let text: string;
    try {
      text = readFileSync(this.statePath, "utf8");
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw e;
    }
    return toState(JSON.parse(text) as Record<string, unknown>);
  }

  /** Locked RMW primitive: `patch` mutates the raw object (snake_case keys); unknown keys are preserved. */
  update(patch: (raw: Record<string, unknown>) => void): State {
    return withLock(this.lockPath, () => {
      let raw: Record<string, unknown> = {};
      try {
        const parsed = JSON.parse(readFileSync(this.statePath, "utf8")) as unknown;
        if (parsed && typeof parsed === "object") raw = parsed as Record<string, unknown>;
      } catch {
        raw = {}; // absent or corrupt — start clean
      }
      patch(raw);
      const tmp = `${this.statePath}.${typeof process !== "undefined" ? process.pid : 0}.tmp`;
      writeFileSync(tmp, `${JSON.stringify(raw, null, 2)}\n`);
      renameSync(tmp, this.statePath);
      return toState(raw);
    });
  }

  /** Ask lode to restart your own process — a clean graceful stop (SIGTERM) +
   *  respawn of the current version. Use to self-recycle (you detected a resource/
   *  memory leak, or on a periodic schedule), or to apply a lode.toml/[env] edit
   *  (the Run-phase restart re-reads lode.toml). Bumps restart_nonce; lode acts
   *  ~1s later, once per bump. Returns the new nonce. */
  reboot(): number {
    let next = 0;
    this.update((raw) => {
      next = (typeof raw.restart_nonce === "number" ? raw.restart_nonce : 0) + 1;
      raw.restart_nonce = next;
    });
    return next;
  }

  /** Apply a pending lode.toml edit — alias of {@link reboot} (the restart re-reads lode.toml). */
  reloadConfig(): number {
    return this.reboot();
  }

  /** Set target (a version or "latest") to request an up/down-grade. */
  requestUpdate(version: string): void {
    if (!version) throw new Error("lode.requestUpdate: empty version");
    this.update((raw) => {
      raw.target = version;
    });
  }

  /** Ask lode NOT to (re)start your process (maintenance) → status "held"; a
   *  running child is left alone. Clear with {@link release}. */
  hold(): void {
    this.update((raw) => {
      raw.hold = true;
    });
  }

  /** Clear a hold (see {@link hold}) → lode resumes (re)starting your process. */
  release(): void {
    this.update((raw) => {
      raw.hold = false;
    });
  }

  /** Roll back to `version`, else to the recorded last_good. Returns the chosen version. */
  rollback(version?: string): string {
    let chosen: string | undefined;
    this.update((raw) => {
      chosen = version ?? (typeof raw.last_good === "string" ? raw.last_good : undefined);
      if (chosen) raw.target = chosen;
    });
    if (!chosen) throw new Error("lode.rollback: no version and no last_good in state.json");
    return chosen;
  }

  /** Report "I can serve" (bare token). Use unless you opt into the phased handshake. */
  markReady(): void {
    const i = this.requireInstance();
    this.update((raw) => {
      raw.ready = i;
    });
  }

  /** Phased handshake: report serving as "{instance}-0". */
  markServing(): void {
    const i = this.requireInstance();
    this.update((raw) => {
      raw.ready = `${i}-0`;
    });
  }

  /** Phased handshake: ack "prepared, cut over" as "{instance}-2". */
  ackPrepared(): void {
    const i = this.requireInstance();
    this.update((raw) => {
      raw.ready = `${i}-2`;
    });
  }

  /** Is lode prompting THIS instance to prepare (`ready` == "{instance}-1")? */
  prepareRequested(state?: State): boolean {
    if (!this.instance) return false;
    return (state ?? this.read() ?? undefined)?.ready === `${this.instance}-1`;
  }

  /** Poll state.json, firing {@link WatchOptions} callbacks on change. Returns a stop function. */
  watch(opts: WatchOptions = {}): () => void {
    const seed = this.read();
    let gen = seed?.configGeneration ?? 0;
    let status = seed?.status;
    let available = seed?.available;
    let lastError = seed?.lastError;
    let current = seed?.current;
    let lastGood = seed?.lastGood;
    let hold = seed?.hold ?? false;
    let prompted = false; // a prompt already active at start should still fire
    const tick = (): void => {
      const s = this.read();
      if (!s) return;
      opts.onState?.(s);
      if (s.configGeneration > gen) {
        gen = s.configGeneration;
        opts.onConfigChange?.(gen, s);
      }
      if (s.available !== available) {
        available = s.available;
        if (s.available) opts.onAvailable?.(s.available, s);
      }
      if (s.status !== status) {
        status = s.status;
        if (s.status) opts.onStatus?.(s.status, s);
      }
      if (s.current !== current || s.lastGood !== lastGood) {
        current = s.current;
        lastGood = s.lastGood;
        opts.onVersionChange?.(s.current, s.lastGood, s);
      }
      if (s.hold !== hold) {
        hold = s.hold;
        opts.onHold?.(s.hold, s);
      }
      if (s.lastError !== lastError) {
        lastError = s.lastError;
        if (s.lastError) opts.onError?.(s.lastError, s);
      }
      if (this.prepareRequested(s)) {
        if (!prompted) {
          prompted = true;
          opts.onPrepare?.(s);
        }
      } else {
        prompted = false;
      }
    };
    const id = setInterval(tick, opts.intervalMs ?? 1000);
    (id as { unref?: () => void }).unref?.();
    return () => clearInterval(id);
  }

  private requireInstance(): string {
    if (!this.instance) throw new Error("lode: no LODE_INSTANCE — readiness needs a supervised launch");
    return this.instance;
  }
}

/** Your app's persistent data dir, resolved `DATA_DIR` > `LODE_DIR` > `ROOT_DIR`
 *  (works with or without lode: set `ROOT_DIR` standalone, lode provides `LODE_DIR`,
 *  or set `DATA_DIR` to override). Undefined if none are set. */
export function dataDir(): string | undefined {
  return env.DATA_DIR || env.LODE_DIR || env.ROOT_DIR || undefined;
}

/** Your app's root/run dir convention (`ROOT_DIR`), or undefined. */
export function rootDir(): string | undefined {
  return env.ROOT_DIR || undefined;
}

/** lode's own dir, where state.json lives (`LODE_DIR`), or undefined when not under lode. */
export function lodeDir(): string | undefined {
  return env.LODE_DIR || undefined;
}

/** lode's runtime dir for this app — its cwd (`LODE_WORKDIR`), or undefined. */
export function workdir(): string | undefined {
  return env.LODE_WORKDIR || undefined;
}

/** Path to lode's config file (`LODE_CONFIG`), or undefined when not under lode / file-less. */
export function configPath(): string | undefined {
  return env.LODE_CONFIG || undefined;
}

/** Read lode's config file (`lode.toml`) as raw text — READ-ONLY (never write it; it's the
 *  operator's file). Undefined when there's no config path or it can't be read. Parse with
 *  your own TOML library if you need individual fields. */
export function readConfig(): string | undefined {
  const p = configPath();
  if (!p) return undefined;
  try {
    return readFileSync(p, "utf8");
  } catch {
    return undefined;
  }
}

/** This launch's instance id ({pid}-{nanoid}), or "". */
export function instanceId(): string {
  return env.LODE_INSTANCE ?? "";
}

/** The version lode launched, or undefined. */
export function activeVersion(): string | undefined {
  return env.LODE_ACTIVE_VERSION || undefined;
}

/** Readiness mode in force ("none" | "state"), or undefined. */
export function readiness(): "none" | "state" | undefined {
  const v = env.LODE_READINESS;
  return v === "none" || v === "state" ? v : undefined;
}

/** True when supervised by lode (LODE_DIR set). */
export function isSupervised(): boolean {
  return !!env.LODE_DIR;
}

/** Required graceful-stop handler: on SIGTERM/SIGINT run handler, then exit(0). */
export function onTerminate(handler: () => void | Promise<void>): void {
  if (typeof process === "undefined") return;
  let stopping = false;
  const stop = (): void => {
    if (stopping) return;
    stopping = true;
    Promise.resolve(handler()).finally(() => process.exit(0));
  };
  process.on("SIGTERM", stop);
  process.on("SIGINT", stop);
}
