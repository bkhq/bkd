---
name: bkd-local-update
description: Build, package, and deploy a new version of BKD to the local launcher environment. Use when upgrading BKD locally.
---

# BKD Local Update

Build, package, and deploy a new version of BKD to the local launcher environment.

## Version Format

Versions use the format `0.0.XX-lc` (e.g., `0.0.90-lc`). The `-lc` suffix distinguishes local builds from upstream releases.

## Upgrade Steps

### 1. Build & Package

```bash
cd /home/weifashi/hwt/bkd

# Pull latest code (if needed)
git pull

# Install dependencies (if lockfile changed)
bun install

# Build frontend
bun run build

# Package (skip frontend since already built)
bun scripts/package.ts --version 0.0.XX-lc --skip-frontend
```

### 2. Deploy

```bash
VERSION=0.0.XX-lc

# Extract to versioned directory (launcher expects v prefix)
mkdir -p /workspace/data/app/v${VERSION}
tar -xzf /home/weifashi/hwt/bkd/dist/bkd-app-${VERSION}.tar.gz \
  -C /workspace/data/app/v${VERSION}/

# Update version pointer
echo "{\"version\":\"${VERSION}\",\"updatedAt\":\"$(date -u +%Y-%m-%dT%H:%M:%SZ)\"}" \
  > /workspace/data/app/version.json
```

### 3. Restart Launcher

```bash
# Kill launcher binary ONLY (wrapper auto-restarts it in 5s)
kill $(pgrep -x bkd-launcher)
```

**Important**: Use `pgrep -x bkd-launcher` (exact match), NOT `pgrep -f bkd-launcher` (matches wrapper bash script too).

If the wrapper script is already dead (no auto-restart), start it manually:

```bash
cd /workspace && nohup bash -c '
  while true; do
    ./bkd-launcher-linux-x64 >>/tmp/bkd-launcher.log 2>&1
    echo "[$(date)] launcher exited, restarting in 5s..."
    sleep 5
  done
' &
```

### 4. Verify

```bash
curl -s http://localhost:3000/api/health | jq .data
# Expected: { "status": "ok", "version": "0.0.XX-lc", ... }
```

## Architecture

```
/workspace/
├── bkd-launcher-linux-x64          # Launcher binary (~90MB, compiled Bun)
└── data/app/
    ├── version.json                 # Active version pointer
    ├── v0.0.89-lc/                  # Previous version
    │   ├── server.js
    │   ├── public/
    │   └── migrations/
    └── v0.0.90-lc/                  # Current version
        ├── server.js                # Bundled API server
        ├── public/                  # Frontend static assets
        └── migrations/              # Drizzle SQL migrations
```

- **Launcher**: reads `version.json`, loads `data/app/v{version}/server.js`
- **server.js**: single-file bundled API server (bun build output)
- **public/**: Vite build output (frontend)
- **migrations/**: Drizzle migration SQL files

## Quick Reference

| Command | Description |
|---------|-------------|
| `curl -s localhost:3000/api/health` | Check running version |
| `cat /workspace/data/app/version.json` | Check deployed version |
| `tail -20 /tmp/bkd-launcher.log` | Check launcher logs |
| `pgrep -x bkd-launcher` | Get launcher PID |
| `ps aux \| grep bkd-launcher` | Check launcher + wrapper status |
