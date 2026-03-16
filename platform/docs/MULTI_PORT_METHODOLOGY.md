# Multi-Port Methodology

## Problem

Multiple developers on the same shared machine need to run independent Thirdwave instances simultaneously. Each instance consists of two services:

- **Platform backend** (default port `3100`) — the Hono HTTP API
- **OpenCode engine** (default port `4096`) — the AI agent runtime

Without isolation, two developers starting Thirdwave would collide on ports `:3100` and `:4096`, causing "address in use" errors or accidentally connecting to each other's instance.

## Solution: Two-Layer Port Isolation

The implementation uses a two-layer strategy:

### Layer 1 — `THIRDWAVE_PORT_OFFSET` (deterministic)

Each developer sets a personal offset via the `THIRDWAVE_PORT_OFFSET` environment variable. This value is added to **both** the Platform and OpenCode base ports:

```
THIRDWAVE_PORT_OFFSET=0   →  Platform :3100, OpenCode :4096  (default)
THIRDWAVE_PORT_OFFSET=10  →  Platform :3110, OpenCode :4106
THIRDWAVE_PORT_OFFSET=20  →  Platform :3120, OpenCode :4116
```

**Implementation** (`platform/src/config/env.ts`):

1. Zod schema validates `THIRDWAVE_PORT_OFFSET` as a number (default `0`).
2. After parsing, if offset > 0:
   - `cfg.PORT += cfg.THIRDWAVE_PORT_OFFSET`
   - Parse `cfg.OPENCODE_URL` as a URL, add the offset to the port, write it back.
3. All downstream code reads `env.PORT` and `env.OPENCODE_URL` — they see the shifted values automatically. No other code needs to change.

The offset is set once per developer (e.g., in `~/.bashrc` or a `.env` override) and never changes. This gives deterministic, non-overlapping port ranges.

### Layer 2 — `AUTO_PORT` (adaptive fallback)

Even with offsets, a port might still be occupied (e.g., a zombie process from a crashed session). When `AUTO_PORT=true` (the default):

1. The server attempts to bind to `env.PORT`.
2. If it fails, `findFreePort(start, host, maxAttempts=20)` probes up to 20 consecutive ports starting from `env.PORT`.
3. The first available port is used. A warning is logged:
   ```
   Port 3100 busy — using 3101 for this session
   Tip: set THIRDWAVE_PORT_OFFSET=N to fix your personal port range
   ```

**Implementation** (`platform/src/config/env.ts` + `platform/src/server/index.ts`):

- `isPortFree(port, host)` — attempts to bind with `Bun.serve`, then immediately stops. Returns true if successful.
- `findFreePort(start, host, maxAttempts)` — iterates from `start` calling `isPortFree`. Throws if all 20 ports are occupied.
- At server startup, if `AUTO_PORT` is true and the configured port is busy, the actual port is updated and logged.

### Combined Flow

```
Developer starts Thirdwave
       │
       ▼
  Read THIRDWAVE_PORT_OFFSET from env
  Apply offset: PORT += offset, OPENCODE_PORT += offset
       │
       ▼
  AUTO_PORT enabled?
  ├── No  → Bind directly to PORT (fail if busy)
  └── Yes → Try PORT, PORT+1, ... PORT+19
             Use first available
       │
       ▼
  Log actual port, start TUI/extension
```

## Usage Examples

### Developer A (default)
```bash
# No offset needed — uses defaults
bun run platform/scripts/launch.ts
# → Platform :3100, OpenCode :4096
```

### Developer B
```bash
export THIRDWAVE_PORT_OFFSET=10
bun run platform/scripts/launch.ts
# → Platform :3110, OpenCode :4106
```

### Developer C
```bash
export THIRDWAVE_PORT_OFFSET=20
bun run platform/scripts/launch.ts
# → Platform :3120, OpenCode :4116
```

### CI/Testing (explicit ports)
```bash
PORT=9000 OPENCODE_URL=http://127.0.0.1:9096 AUTO_PORT=false bun run platform/scripts/launch.ts
```

## Design Decisions

1. **Offset over random ports** — Deterministic ports let developers bookmark URLs and configure VS Code extensions without discovering the port each time.

2. **AUTO_PORT as safety net** — Prevents hard failures when a zombie process holds the expected port. The fallback is transparent to downstream code because the actual port is propagated via `server.port` and `process.env.THIRDWAVE_URL`.

3. **Single env var** — One `THIRDWAVE_PORT_OFFSET` shifts both services. Developers don't need to remember separate port numbers for Platform and OpenCode.

4. **No global state** — Each instance reads its own environment. No shared lock files or port registries.
