#!/usr/bin/env bash
# ── Kadavuley Install Script ─────────────────────────────────────────
# One-line install:
#   curl -fsSL https://raw.githubusercontent.com/<org>/kadavuley/main/install.sh | bash
#
# Or clone and run:
#   git clone <repo> && cd kadavuley && bash install.sh
# ─────────────────────────────────────────────────────────────────────
set -euo pipefail

BLUE='\033[0;35m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
DIM='\033[0;90m'
NC='\033[0m'

log()  { echo -e "  ${BLUE}▶${NC} $*"; }
ok()   { echo -e "  ${GREEN}✓${NC} $*"; }
warn() { echo -e "  ${YELLOW}⚠${NC} $*"; }
err()  { echo -e "  ${RED}✗${NC} $*"; exit 1; }

echo ""
echo -e "  ${BLUE}╔══════════════════════════════════════════╗${NC}"
echo -e "  ${BLUE}║   ◆  K A D A V U L E Y   Installer      ║${NC}"
echo -e "  ${BLUE}║   AI Coding Platform — Local & Private   ║${NC}"
echo -e "  ${BLUE}╚══════════════════════════════════════════╝${NC}"
echo ""

# ── Detect platform ──────────────────────────────────────────────────
OS="$(uname -s | tr '[:upper:]' '[:lower:]')"
ARCH="$(uname -m)"
case "$ARCH" in
  x86_64)  ARCH="x64" ;;
  aarch64|arm64) ARCH="arm64" ;;
  *) err "Unsupported architecture: $ARCH" ;;
esac
log "Detected ${OS}-${ARCH}"

# ── Find or determine project directory ──────────────────────────────
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" 2>/dev/null && pwd || pwd)"

# If platform/ exists relative to script, we're in the repo
if [[ -d "$SCRIPT_DIR/platform" ]]; then
  ROOT_DIR="$SCRIPT_DIR"
elif [[ -d "$SCRIPT_DIR/../platform" ]]; then
  ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
else
  # Running from curl — clone the repo
  log "Will clone into ~/kadavuley ..."
  INSTALL_DIR="${KADAVULEY_DIR:-$HOME/kadavuley}"
  if [[ -d "$INSTALL_DIR" ]]; then
    warn "Directory $INSTALL_DIR already exists — pulling latest"
    cd "$INSTALL_DIR" && git pull --rebase 2>/dev/null || true
  else
    git clone https://github.com/sst/opencode.git "$INSTALL_DIR"
  fi
  ROOT_DIR="$INSTALL_DIR"
fi

PLATFORM_DIR="$ROOT_DIR/platform"
log "Platform dir: $PLATFORM_DIR"

# ── Step 1: Install Bun ─────────────────────────────────────────────
if command -v bun &>/dev/null; then
  ok "Bun already installed ($(bun --version))"
elif [[ -x "$HOME/.bun/bin/bun" ]]; then
  export PATH="$HOME/.bun/bin:$PATH"
  ok "Bun found at ~/.bun/bin ($(bun --version))"
else
  log "Installing Bun..."
  curl -fsSL https://bun.sh/install | bash
  export PATH="$HOME/.bun/bin:$PATH"
  ok "Bun installed ($(bun --version))"
fi

# ── Step 2: Install dependencies ─────────────────────────────────────
log "Installing platform dependencies..."
cd "$PLATFORM_DIR"
bun install 2>/dev/null || bun install --no-save
ok "Dependencies installed"

# ── Step 3: Build OpenCode binary ────────────────────────────────────
OPENCODE_BIN=""
# Check if already available
if command -v opencode &>/dev/null; then
  OPENCODE_BIN="$(command -v opencode)"
  ok "OpenCode binary found at $OPENCODE_BIN"
elif [[ -x "$HOME/.local/bin/opencode" ]]; then
  OPENCODE_BIN="$HOME/.local/bin/opencode"
  ok "OpenCode binary found at $OPENCODE_BIN"
else
  # Build from source
  log "Building OpenCode from source (this may take a minute)..."
  cd "$ROOT_DIR"
  bun install 2>/dev/null || bun install --no-save

  cd "$ROOT_DIR/packages/opencode"
  bun run build -- --single --skip-install 2>&1 | tail -5

  # Find the built binary
  DIST_BIN="$(find "$ROOT_DIR/packages/opencode/dist" -name "opencode" -type f 2>/dev/null | head -1)"
  if [[ -z "$DIST_BIN" ]]; then
    err "OpenCode build failed — binary not found in dist/"
  fi

  mkdir -p "$HOME/.local/bin"
  ln -sf "$DIST_BIN" "$HOME/.local/bin/opencode"
  OPENCODE_BIN="$HOME/.local/bin/opencode"
  ok "OpenCode built and linked to $OPENCODE_BIN"
fi

# Add to PATH permanently if needed
SHELL_RC=""
if [[ -f "$HOME/.bashrc" ]]; then SHELL_RC="$HOME/.bashrc"
elif [[ -f "$HOME/.zshrc" ]]; then SHELL_RC="$HOME/.zshrc"
fi

if [[ -n "$SHELL_RC" ]]; then
  NEED_PATH=false
  grep -q '\.bun/bin' "$SHELL_RC" 2>/dev/null || NEED_PATH=true
  grep -q '\.local/bin' "$SHELL_RC" 2>/dev/null || NEED_PATH=true

  if $NEED_PATH; then
    {
      echo ''
      echo '# ── Kadavuley ──'
      echo 'export PATH="$HOME/.local/bin:$HOME/.bun/bin:$PATH"'
    } >> "$SHELL_RC"
    ok "Updated $SHELL_RC with PATH entries"
  fi
fi

export PATH="$HOME/.local/bin:$HOME/.bun/bin:$PATH"

# ── Step 4: Create .env if missing ───────────────────────────────────
cd "$PLATFORM_DIR"
if [[ ! -f .env ]]; then
  cp .env.example .env
  ok "Created .env from template"
  warn "Edit platform/.env to set your vLLM server address"
else
  ok ".env already exists"
fi

# ── Step 5: Create global CLI symlink ────────────────────────────────
mkdir -p "$HOME/.local/bin"
ln -sf "$PLATFORM_DIR/bin/kadavuley" "$HOME/.local/bin/kadavuley"
ok "CLI linked: kadavuley → $PLATFORM_DIR/bin/kadavuley"

# ── Done ─────────────────────────────────────────────────────────────
echo ""
echo -e "  ${GREEN}╔══════════════════════════════════════════╗${NC}"
echo -e "  ${GREEN}║   ✓  Installation complete!              ║${NC}"
echo -e "  ${GREEN}╚══════════════════════════════════════════╝${NC}"
echo ""
echo -e "  ${DIM}Before first run, edit your config:${NC}"
echo -e "    ${BLUE}nano $PLATFORM_DIR/.env${NC}"
echo ""
echo -e "  ${DIM}Then launch with a single command:${NC}"
echo -e "    ${GREEN}kadavuley${NC}              ${DIM}# Full stack: OpenCode + Backend + TUI${NC}"
echo -e "    ${GREEN}kadavuley --headless${NC}   ${DIM}# Backend only (no TUI)${NC}"
echo -e "    ${GREEN}kadavuley --tui-only${NC}   ${DIM}# Connect TUI to running backend${NC}"
echo ""
echo -e "  ${DIM}If kadavuley is not found, run:${NC}"
echo -e "    ${BLUE}source $SHELL_RC${NC}"
echo ""
