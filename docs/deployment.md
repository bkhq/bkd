# Deployment

BKD is distributed as a small app package (`bkd-server.tar.gz`, ~2 MB) that runs under
[lode](https://github.com/dotns/lode) — a static Rust supervisor that verifies, launches,
supervises and updates it. BKD no longer downloads or installs anything itself.

```
lode  ──reads──►  lode.toml            (operator config: where to fetch, how to run)
  │
  ├──fetch───►  GitHub Releases        bkhq/bkd → bkd-server.tar.gz
  ├──verify──►  sha256 (always) + ed25519 signature (opt-in, see §3)
  ├──install─►  <dir>/versions/<version>/
  ├──launch──►  bun run server.js      (cwd = the version dir)
  └──watch───►  <dir>/state.json       (status ↔ update / rollback / restart requests)
```

Supported platforms: **Linux and macOS** (x64 / arm64). lode is a Unix process supervisor;
there is no Windows build.

## Quick start

Every release ships the operator files, so no repo checkout is needed:

```bash
# 1. lode itself — on arm64 or macOS swap in the matching asset
#    (lode-linux-arm64 / lode-darwin-x64 / lode-darwin-arm64)
curl -fsSL https://github.com/dotns/lode/releases/download/v0.1.0/lode-linux-x64.tar.gz \
  | sudo tar -xz -C /usr/local/bin lode lode-cli

# 2. an install root you own — lode writes state.json, versions/, runtime/ and
#    BKD's data/ here, and BKD spawns coding agents, so it should not run as root
sudo mkdir -p /opt/bkd && sudo chown "$(id -un)" /opt/bkd

# 3. the ready-to-use config — edit the paths marked CHANGE ME (default /opt/bkd)
curl -fsSL https://github.com/bkhq/bkd/releases/latest/download/bkd.lode.toml \
  -o /opt/bkd/lode.toml

# 4. run — lode installs the current release and supervises it
lode --dir /opt/bkd
```

Already running a `bkd-launcher-*` install? Jump to
[Migrating an existing launcher install](#6-migrating-an-existing-launcher-install) — your
database, uploads and worktrees stay exactly where they are.

Release assets:

| Asset | What it is |
|---|---|
| `bkd-server.tar.gz` | the application — the value of `[update].asset` |
| `bkd.lode.toml` | ready-to-use lode config (the file this guide describes) |
| `DEPLOYMENT.md` | this guide |
| `migrate-to-lode.ts` | migration script for launcher installs |
| `checksums.txt` | sha256 of the package |

The sections below explain each part of that config.

## 1. Install lode

Grab the binary for your host from the [lode releases](https://github.com/dotns/lode/releases)
and put `lode` + the `lode-cli` symlink on `PATH`:

```bash
curl -fsSL https://github.com/dotns/lode/releases/download/v0.1.0/lode-linux-x64.tar.gz \
  | sudo tar -xz -C /usr/local/bin lode lode-cli
lode --version
```

Pin the version you install — lode is the trust root of the update path.

## 2. Write `lode.toml`

Create the install root (this is `[global].dir`; BKD's `data/` lives inside it) and drop a
config next to it — for example `/opt/bkd/lode.toml`:

```toml
[global]
app = "bkd"
dir = "/opt/bkd"          # holds lode.toml, state.json, versions/, runtime/ and BKD's data/

[update]
github  = "bkhq/bkd"
asset   = "bkd-server.tar.gz"   # exact filename — lode's selection key
channel = "stable"
policy  = "check"            # off | check | auto

[trust]
require_signature = "off"     # not signed yet — see §3
# trusted_keys = ["<key_id>:<base64-pubkey>"]

[command]
run  = "bun run server.js"   # bare `lode` → supervised server
exec = "bun"                 # `lode <args>` → passthrough, e.g. `lode run server.js fix-db`

# lode downloads bun once when it is not on PATH and caches it at <dir>/runtime/bun.
# Runtime downloads are TLS-protected but NOT hash- or signature-verified: pin the version,
# or install bun yourself and drop this block (a bun on PATH always wins over the cache).
[runtime]
runtime  = "bun"
download = "https://github.com/oven-sh/bun/releases/download/bun-v1.4.0/bun-linux-x64.zip"
version  = "1.4.0"

[env]
ROOT_DIR = "/opt/bkd"     # keeps data/ outside the per-version directory — required
NODE_ENV = "production"
PORT     = "3000"
HOST     = "0.0.0.0"
LOG_LEVEL = "info"

[supervise]
readiness     = "state"   # BKD reports ready once it can serve; lode commits only then
ready_timeout = 30
health_grace  = 10        # a version that dies inside this window is rolled back
stop_timeout  = 30        # BKD cancels running engine processes on SIGTERM — leave room
restart       = "on-failure"
```

**`ROOT_DIR` is not optional.** lode runs BKD with its cwd set to
`<dir>/versions/<version>/`, which changes on every upgrade. `ROOT_DIR` pins the
installation root so `data/db`, `data/uploads`, `data/logs` and worktrees survive updates.
If it is unset, BKD falls back to `LODE_DIR`, which resolves to the same place under a
default layout.

### Update policy

`[update].policy` is **operator-owned** — BKD cannot change it from the UI.

| Policy | Behaviour |
|---|---|
| `off` | No checks. Only explicit `lode-cli update` or a UI update request installs anything. |
| `check` | Checks periodically and advertises the new version (`available` in the UI). Nothing installs until someone asks. |
| `auto` | Checks and installs automatically, then restarts BKD. |

Start on `check`, move to `auto` once you trust the pipeline.

## 3. Trust the publisher

**Signature verification is off today.** Releases are not signed yet, so the shipped config
sets `require_signature = "off"`. Installs are still integrity-checked: lode compares the
sha256 of the downloaded bytes against the GitHub asset digest on every install, under
every policy. What is missing is *identity* — proof of who produced those bytes.

To turn it on once a publisher key exists:

```bash
lode-cli keygen        # the publisher runs this once
```

The publisher keeps `private` secret (in CI as the `LODE_SIGNING_KEY` secret; the release
workflow signs automatically when it is set) and hands operators the `trustedKeys` line.
Operators then set:

```toml
[trust]
require_signature = "enforce"
trusted_keys = ["<key_id>:<base64-pubkey>"]
```

`require_signature` values: `off` (integrity only), `auto` (fail-closed once any trusted key
is configured, unverified with a warning otherwise), `enforce` (every installed asset must
carry a valid signature).

## 4. First run

```bash
lode --dir /opt/bkd
```

lode resolves the channel, downloads `bkd-server.tar.gz`, verifies it, installs it under
`versions/<version>/`, launches BKD and waits for its readiness signal. BKD is then
reachable on `PORT`.

Run it under your init system by pointing the unit at `lode` — it is a proper supervisor
(PID-1 subreaper, signal forwarding), so nothing else is needed:

```ini
[Service]
ExecStart=/usr/local/bin/lode --dir /opt/bkd
Restart=always
```

## 5. Operating

| Task | CLI | UI (Settings → Upgrade) |
|---|---|---|
| Show status / versions | `lode-cli status --dir /opt/bkd` | supervisor status, current + available version |
| Install the latest release | `lode-cli update --dir /opt/bkd` | **Update to latest** |
| Install a specific version | `lode-cli update --version 0.0.9 --dir /opt/bkd` | — |
| Roll back | `lode-cli rollback --dir /opt/bkd` | **Roll back to v…** |
| Restart the current version | `lode-cli restart --dir /opt/bkd` | **Restart** |
| List installed versions | `lode-cli versions --dir /opt/bkd` | — |
| Pause (maintenance) | set `hold` in `state.json` | — |

An update or rollback stops BKD with `SIGTERM`; BKD cancels running engine processes,
releases its PID lock and exits, then lode launches the new version. A version that exits
within `health_grace`, or never reports ready within `ready_timeout`, is rolled back to the
last known-good version automatically.

lode reports lifecycle *status*, not download progress — the UI shows
`updating` / `rolling-back` / `running`, with no percentage.

### Command-line options

The old launcher's flags are gone. Configure BKD through the environment (in
`[env]`, or per-deploy env vars, which win over `[env]`):

| Old flag | Now |
|---|---|
| `--port` | `PORT` |
| `--host` | `HOST` |
| `--data-dir` | `BKD_DATA_DIR` |
| `--log-level` | `LOG_LEVEL` |
| `--fix-db` | `lode run server.js fix-db` (passthrough) |

`lode --version` and `lode --help` report lode's own version and usage; lode parses those
flags before forwarding. Use `lode -- <args…>` to pass flag-like arguments through verbatim.

## 6. Migrating an existing launcher install

Installs created by the old `bkd-launcher-*` binary keep everything under one root
(`data/app/`, `data/updates/`, `data/db/`, …). lode reuses that same root, so **user data
never moves**.

```bash
# The script ships as a release asset; from a repo checkout use scripts/migrate-to-lode.ts.
curl -fsSL https://github.com/bkhq/bkd/releases/latest/download/migrate-to-lode.ts \
  -o migrate-to-lode.ts

# 1. Preview (writes nothing)
bun migrate-to-lode.ts --root /opt/bkd

# 2. Write lode.toml and pack the running version for rollback
bun migrate-to-lode.ts --root /opt/bkd --apply

# 3. Optionally drop the launcher-owned directories (data/app, data/updates)
bun migrate-to-lode.ts --root /opt/bkd --apply --prune
```

The script needs `bun` on `PATH`. If the host has none (the old launcher embedded its
own), skip it: download `bkd.lode.toml` instead, set `[global].dir` and `[env].ROOT_DIR`
to your existing install root, and start lode — that is all the script does, minus packing
the old version for rollback.

The script never touches `data/db`, `data/uploads`, `data/logs` or `worktrees/`. It writes
`lode.toml` with `dir` and `ROOT_DIR` set to the existing root, and packs the currently
installed version into `<root>/migration/bkd-server.tar.gz`.

### What actually moves

Nothing. lode adopts the install root you already have:

```
/opt/bkd/                     before                after
├── bkd-launcher-linux-x64    the launcher          delete once lode serves
├── lode.toml                 —                     new (operator config)
├── state.json                —                     new (lode ↔ BKD channel)
├── versions/<version>/       —                     new (installed releases)
├── runtime/bun               —                     new (cached bun)
├── data/app/                 active app code       replaced by versions/ (--prune removes)
├── data/updates/             downloaded archives   obsolete (--prune removes)
├── data/db/bkd.db            SQLite database       UNCHANGED, same path
├── data/uploads/             attachments           UNCHANGED, same path
├── data/logs/                logs                  UNCHANGED, same path
└── worktrees/                issue worktrees       UNCHANGED, same path
```

Every one of those paths is derived from `ROOT_DIR`, which is why pinning it in `[env]` is
the whole migration. Schema changes need no action either: the new version applies pending
Drizzle migrations on startup, exactly as the launcher's did.

If the old launcher ran with `--data-dir`, `DB_PATH` or `WORKTREE_DIR` pointing somewhere
else, uncomment the matching line in the generated `[env]` block — the script prints a
warning when it detects this, but it cannot read the environment of a process it did not
start.

Then stop the old launcher process and:

```bash
# Keep the version you were running available for rollback (offline, no download)
lode-cli seed /opt/bkd/migration/bkd-server.tar.gz --version 0.0.6 --dir /opt/bkd

lode --dir /opt/bkd
```

Review the generated `lode.toml` before starting: it ships `policy = "check"` (advertise
updates, install only when asked) and `require_signature = "off"` (see §3).

Delete the old launcher binary once the new process serves traffic.

### Un-migrated installs stay put

Migration is deliberate, never automatic. The package is named `bkd-server.tar.gz`
precisely so that pre-lode BKD cannot mistake it for an update: those versions select an
asset with `name.startsWith('bkd-app') && name.endsWith('.tar.gz')` (the old launcher with
`/^bkd-app-v\d+\.\d+\.\d+\.tar\.gz$/`), and no release asset matches either pattern
any more. Binary-mode installs are excluded too — they skip `.tar.gz` assets entirely.

Consequence: an un-migrated install reports "up to date" even after a new release, because
it finds no asset it could apply. It keeps running safely, but it will not tell you a newer
version exists — watch the releases page, or migrate.

## 7. Troubleshooting

**BKD reports "Not running under a supervisor".** `LODE_DIR` is not set — the process was
started directly instead of through `lode`. Version display still works; update, rollback
and restart are unavailable.

**A new version rolled back immediately.** It exited inside `health_grace` or missed
`ready_timeout`. Check BKD's log and `last_error` in `state.json`; migrations running on a
large database can exceed a short `ready_timeout`.

**`no update source configured`.** `[update]` has neither `github` nor `manifest`. This is
expected for an offline, seed-only install.

**Assets install "UNVERIFIED".** Expected today: signing is not enabled yet (§3). The
sha256 check still ran. Under `require_signature = "enforce"` an unsigned asset fails the
install instead.

**Data ended up in the wrong place after an upgrade.** `ROOT_DIR` is unset and `LODE_DIR`
does not point where you expect. Set `ROOT_DIR` explicitly in `[env]`.
