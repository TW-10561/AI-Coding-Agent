# ── Kadavuley Platform — Production Docker Image ──────────────────────
# Build:   docker build -t kadavuley -f platform/docker/Dockerfile .
# Run:     docker run -p 3100:3100 -p 4096:4096 -e VLLM_BASE_URL=... kadavuley
# Compose: cd platform/docker && docker compose up --build
# ───────────────────────────────────────────────────────────────────────

# ── Stage 1: Build OpenCode from source ────────────────────────────────
FROM oven/bun:1.3.10-alpine AS opencode-build

WORKDIR /build

# Copy only what's needed for opencode build
COPY package.json bun.lock* turbo.json ./
COPY packages/opencode/package.json packages/opencode/
COPY packages/script/ packages/script/

# Install root deps (monorepo)
RUN bun install --frozen-lockfile 2>/dev/null || bun install

# Copy opencode source and build single-arch binary
COPY packages/opencode/ packages/opencode/
RUN cd packages/opencode && bun run build -- --single --skip-install

# ── Stage 2: Platform runtime ─────────────────────────────────────────
FROM oven/bun:1.3.10-alpine AS runtime

RUN apk add --no-cache git ripgrep

WORKDIR /app

# Copy built OpenCode binary (find the single-arch output)
COPY --from=opencode-build /build/packages/opencode/dist/opencode-*/bin/opencode /usr/local/bin/opencode
RUN chmod +x /usr/local/bin/opencode && opencode --version

# Install platform dependencies
COPY platform/package.json ./
RUN bun install --production 2>/dev/null || bun install

# Copy platform source
COPY platform/src ./src
COPY platform/scripts ./scripts
COPY platform/bin ./bin
COPY platform/tui ./tui
COPY platform/tsconfig.json ./

# Install TUI dependencies
RUN cd tui && bun install --production 2>/dev/null || (cd tui && bun install)

# Default environment
ENV PORT=3100
ENV HOST=0.0.0.0
ENV OPENCODE_URL=http://127.0.0.1:4096
ENV OPENCODE_BIN=opencode
ENV OPENCODE_DIR=/workspace
ENV NODE_ENV=production
ENV LOG_LEVEL=info

EXPOSE 3100 4096

# Health check
HEALTHCHECK --interval=15s --timeout=5s --start-period=40s \
  CMD wget -qO- http://localhost:3100/health/ready || exit 1

# Start OpenCode + Platform backend (headless — no TUI in container)
CMD ["bun", "run", "scripts/start-all.ts"]
