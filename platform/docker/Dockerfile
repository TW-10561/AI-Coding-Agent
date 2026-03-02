# ── Stage 1: Build OpenCode ────────────────────────────────────────────
FROM oven/bun:1.3.10-alpine AS opencode-build

WORKDIR /build
COPY . .
RUN bun install --frozen-lockfile
RUN cd packages/opencode && bun run build

# ── Stage 2: Platform runtime ─────────────────────────────────────────
FROM oven/bun:1.3.10-alpine AS runtime

RUN apk add --no-cache git ripgrep

WORKDIR /app

# Copy built OpenCode binary
COPY --from=opencode-build /build/packages/opencode/dist/opencode /usr/local/bin/opencode
RUN chmod +x /usr/local/bin/opencode

# Copy platform source
COPY platform/package.json platform/bun.lock* ./
RUN bun install --frozen-lockfile --production 2>/dev/null || bun install --production

COPY platform/src ./src
COPY platform/scripts ./scripts
COPY platform/tsconfig.json ./

# Default env
ENV PORT=3100
ENV HOST=0.0.0.0
ENV OPENCODE_URL=http://127.0.0.1:4096
ENV OPENCODE_BIN=opencode
ENV NODE_ENV=production
ENV LOG_LEVEL=info

EXPOSE 3100 4096

# Health check
HEALTHCHECK --interval=15s --timeout=5s --start-period=30s \
  CMD wget -qO- http://localhost:3100/health/ready || exit 1

# Start both OpenCode + Platform
CMD ["bun", "run", "scripts/start-all.ts"]
