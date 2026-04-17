#!/usr/bin/env bash
# ────────────────────────────────────────────────────────────────────────
# Thirdwave AI Platform — Environment Bootstrap Script
# ────────────────────────────────────────────────────────────────────────
# Run this ONCE after copying the project to a new server/GPU.
# It installs dependencies, configures paths, patches hardcoded values,
# and prepares the .env file for the new environment.
#
# Usage:
#   1. Copy the project folder to the new machine
#   2. Edit env.template with your new network/path values
#   3. Run: bash setup-environment.sh
#
# Prerequisites: bash, curl, git (should be available on any dev server)
# ────────────────────────────────────────────────────────────────────────
set -euo pipefail

# ── Colors ────────────────────────────────────────────────────────────
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
BOLD='\033[1m'
DIM='\033[2m'
NC='\033[0m'

log()   { echo -e "${GREEN}[✓]${NC} $*"; }
warn()  { echo -e "${YELLOW}[!]${NC} $*"; }
err()   { echo -e "${RED}[✗]${NC} $*"; }
info()  { echo -e "${CYAN}[i]${NC} $*"; }
header(){ echo -e "\n${BOLD}═══ $* ═══${NC}\n"; }

# ── Resolve project root ─────────────────────────────────────────────
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# The script lives inside platform/, so project root is one level up
if [[ -d "$SCRIPT_DIR/src" && -f "$SCRIPT_DIR/package.json" ]]; then
  # Script is inside the platform directory
  PLATFORM_DIR="$SCRIPT_DIR"
  PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
else
  # Script is at the project root (legacy layout)
  PROJECT_ROOT="$SCRIPT_DIR"
  PLATFORM_DIR="$PROJECT_ROOT/platform"
fi

if [[ ! -d "$PLATFORM_DIR" ]]; then
  err "Cannot find platform/ directory at $PLATFORM_DIR"
  err "Run this script from the AI-Coding-Agent project root."
  exit 1
fi

header "Thirdwave AI — Environment Bootstrap"
info "Project root:  $PROJECT_ROOT"
info "Platform dir:  $PLATFORM_DIR"
info "User:          $(whoami)"
info "Home:          $HOME"

# ══════════════════════════════════════════════════════════════════════
# STEP 1: .env Configuration
# ══════════════════════════════════════════════════════════════════════
header "Step 1: Environment Configuration"

ENV_FILE="$PLATFORM_DIR/.env"
ENV_TEMPLATE="$PLATFORM_DIR/env.template"

if [[ -f "$ENV_FILE" ]]; then
  warn ".env already exists at $ENV_FILE"
  read -rp "  Overwrite with template? (y/N): " overwrite
  if [[ "$overwrite" =~ ^[Yy]$ ]]; then
    cp "$ENV_FILE" "${ENV_FILE}.backup.$(date +%s)"
    log "Backed up existing .env"
  else
    info "Keeping existing .env — will still patch paths below."
  fi
fi

if [[ -f "$ENV_TEMPLATE" ]] && { [[ ! -f "$ENV_FILE" ]] || [[ "$overwrite" =~ ^[Yy]$ ]]; }; then
  cp "$ENV_TEMPLATE" "$ENV_FILE"
  log "Copied env.template → platform/.env"
fi

# ── Auto-detect and patch paths in .env ──────────────────────────────
if [[ -f "$ENV_FILE" ]]; then
  info "Auto-patching paths in .env for this machine..."

  # Replace placeholder paths with actual detected paths
  sed -i "s|OPENCODE_DIR=.*|OPENCODE_DIR=$PROJECT_ROOT|" "$ENV_FILE"
  sed -i "s|AGENT_WORKSPACE_DIR=.*|AGENT_WORKSPACE_DIR=$PROJECT_ROOT/.agent-workspace|" "$ENV_FILE"

  # Detect opencode binary
  OPENCODE_BIN=""
  for candidate in "$HOME/.opencode/bin/opencode" "$HOME/.local/bin/opencode" "/usr/local/bin/opencode"; do
    if [[ -x "$candidate" ]]; then
      OPENCODE_BIN="$candidate"
      break
    fi
  done
  if [[ -n "$OPENCODE_BIN" ]]; then
    sed -i "s|OPENCODE_BIN=.*|OPENCODE_BIN=$OPENCODE_BIN|" "$ENV_FILE"
    log "OpenCode binary: $OPENCODE_BIN"
  else
    warn "OpenCode binary not found — will install in Step 3"
    sed -i "s|OPENCODE_BIN=.*|OPENCODE_BIN=$HOME/.opencode/bin/opencode|" "$ENV_FILE"
  fi

  log "Paths patched in .env"
  echo ""
  info "Current .env values (paths):"
  grep -E "^(OPENCODE_DIR|OPENCODE_BIN|AGENT_WORKSPACE_DIR|VLLM_GATEWAY)" "$ENV_FILE" | sed 's/^/    /'
  echo ""
  warn ">>> REVIEW: Edit platform/.env to set VLLM_GATEWAY_URL and VLLM_GATEWAY_KEY"
  warn ">>> for the twave network before starting the platform."
fi

# ══════════════════════════════════════════════════════════════════════
# STEP 2: Install Bun Runtime
# ══════════════════════════════════════════════════════════════════════
header "Step 2: Bun Runtime"

export PATH="$HOME/.bun/bin:$HOME/.local/bin:/usr/local/bin:$PATH"

if command -v bun &>/dev/null; then
  BUN_VER="$(bun --version 2>/dev/null || echo 'unknown')"
  log "Bun already installed: v$BUN_VER"
else
  info "Installing Bun..."
  curl -fsSL https://bun.sh/install | bash
  export PATH="$HOME/.bun/bin:$PATH"
  if command -v bun &>/dev/null; then
    log "Bun installed: v$(bun --version)"
  else
    err "Bun installation failed. Install manually: curl -fsSL https://bun.sh/install | bash"
    exit 1
  fi
fi

# ══════════════════════════════════════════════════════════════════════
# STEP 3: Install OpenCode Engine
# ══════════════════════════════════════════════════════════════════════
header "Step 3: OpenCode Engine"

if command -v opencode &>/dev/null || [[ -x "$HOME/.opencode/bin/opencode" ]]; then
  OC_PATH="$(command -v opencode 2>/dev/null || echo "$HOME/.opencode/bin/opencode")"
  log "OpenCode already installed: $OC_PATH"
else
  info "Installing OpenCode..."
  if curl -fsSL https://opencode.ai/install 2>/dev/null | bash; then
    log "OpenCode installed"
  else
    warn "OpenCode auto-install failed."
    warn "Install manually: curl -fsSL https://opencode.ai/install | bash"
    warn "Or place the binary at $HOME/.opencode/bin/opencode"
  fi
fi

# ══════════════════════════════════════════════════════════════════════
# STEP 4: Install System Dependencies
# ══════════════════════════════════════════════════════════════════════
header "Step 4: System Dependencies"

MISSING_DEPS=()
for dep in git ripgrep curl python3; do
  if ! command -v "$dep" &>/dev/null; then
    # ripgrep binary is 'rg'
    if [[ "$dep" == "ripgrep" ]] && command -v rg &>/dev/null; then
      continue
    fi
    MISSING_DEPS+=("$dep")
  fi
done

if [[ ${#MISSING_DEPS[@]} -eq 0 ]]; then
  log "All system dependencies present (git, ripgrep, curl, python3)"
else
  warn "Missing system packages: ${MISSING_DEPS[*]}"
  if command -v apt &>/dev/null; then
    info "Attempting: sudo apt install ${MISSING_DEPS[*]}"
    sudo apt update -qq && sudo apt install -y -qq "${MISSING_DEPS[@]}" && log "Installed missing packages" || warn "Could not auto-install. Run: sudo apt install ${MISSING_DEPS[*]}"
  elif command -v apk &>/dev/null; then
    sudo apk add --no-cache "${MISSING_DEPS[@]}" && log "Installed missing packages" || warn "Could not auto-install. Run: sudo apk add ${MISSING_DEPS[*]}"
  else
    warn "Install manually: ${MISSING_DEPS[*]}"
  fi
fi

# ══════════════════════════════════════════════════════════════════════
# STEP 5: Install Platform Dependencies (bun install)
# ══════════════════════════════════════════════════════════════════════
header "Step 5: Platform Dependencies"

info "Installing platform packages..."
cd "$PLATFORM_DIR"
bun install --frozen-lockfile 2>/dev/null || bun install
log "Platform dependencies installed"

# Install TUI dependencies if present
if [[ -f "$PLATFORM_DIR/tui/package.json" ]]; then
  info "Installing TUI packages..."
  cd "$PLATFORM_DIR/tui"
  bun install --frozen-lockfile 2>/dev/null || bun install
  log "TUI dependencies installed"
fi

cd "$PROJECT_ROOT"

# ══════════════════════════════════════════════════════════════════════
# STEP 6: Create Required Directories
# ══════════════════════════════════════════════════════════════════════
header "Step 6: Directory Structure"

mkdir -p "$PROJECT_ROOT/.agent-workspace"
mkdir -p "$PROJECT_ROOT/.platform"
log "Created .agent-workspace/"
log "Created .platform/ (SQLite database directory)"

# ══════════════════════════════════════════════════════════════════════
# STEP 7: Patch Hardcoded IPs in install.sh (for new network)
# ══════════════════════════════════════════════════════════════════════
header "Step 7: Patch Hardcoded Network References"

# Read the new server IP from .env if available, otherwise prompt
PLATFORM_IP=""
if [[ -f "$ENV_FILE" ]]; then
  PLATFORM_IP=$(grep -E "^HOST=" "$ENV_FILE" 2>/dev/null | head -1 | cut -d= -f2)
fi

INSTALL_SCRIPT="$PLATFORM_DIR/bin/install.sh"
if [[ -f "$INSTALL_SCRIPT" ]]; then
  # Replace old hardcoded IP in install script
  OLD_IP="172.30.140.142"
  if grep -q "$OLD_IP" "$INSTALL_SCRIPT"; then
    read -rp "  Enter this server's IP on the twave network (for client installer): " NEW_SERVER_IP
    if [[ -n "$NEW_SERVER_IP" ]]; then
      sed -i "s|$OLD_IP|$NEW_SERVER_IP|g" "$INSTALL_SCRIPT"
      log "Patched install.sh: $OLD_IP → $NEW_SERVER_IP"
    else
      warn "Skipped — install.sh still has old IP ($OLD_IP)"
    fi
  else
    log "install.sh already patched (no old IPs found)"
  fi
fi

# Patch docker-compose files
for compose_file in "$PROJECT_ROOT/docker-compose.dev.yml" "$PLATFORM_DIR/docker/docker-compose.yml"; do
  if [[ -f "$compose_file" ]]; then
    OLD_GATEWAY="172.30.140.63"
    if grep -q "$OLD_GATEWAY" "$compose_file"; then
      # Read gateway URL from .env
      NEW_GATEWAY=""
      if [[ -f "$ENV_FILE" ]]; then
        NEW_GATEWAY=$(grep -E "^VLLM_GATEWAY_URL=" "$ENV_FILE" 2>/dev/null | head -1 | sed 's|VLLM_GATEWAY_URL=||' | sed 's|/v1$||' | sed 's|http://||')
        # Extract just IP:port
        NEW_GATEWAY=$(echo "$NEW_GATEWAY" | cut -d/ -f1)
      fi
      if [[ -n "$NEW_GATEWAY" && "$NEW_GATEWAY" != "YOUR_GATEWAY_IP:9080" ]]; then
        sed -i "s|$OLD_GATEWAY:9080|$NEW_GATEWAY|g" "$compose_file"
        log "Patched $(basename "$compose_file"): gateway → $NEW_GATEWAY"
      else
        warn "$(basename "$compose_file") still has old gateway IP ($OLD_GATEWAY:9080)"
        warn "Update VLLM_GATEWAY_URL in .env then re-run, or edit manually."
      fi
    fi
  fi
done

# ══════════════════════════════════════════════════════════════════════
# STEP 8: Patch systemd Service File
# ══════════════════════════════════════════════════════════════════════
header "Step 8: Systemd Service (optional)"

SYSTEMD_FILE="$PLATFORM_DIR/deploy/systemd/thirdwave.service"
if [[ -f "$SYSTEMD_FILE" ]]; then
  OLD_HOME="/home/nvidia"
  OLD_PROJECT="/home/nvidia/AI_Coding_Agent/Kadavuley/AI-Coding-Agent"

  # Patch home directory references
  if grep -q "$OLD_HOME" "$SYSTEMD_FILE"; then
    sed -i "s|$OLD_PROJECT|$PROJECT_ROOT|g" "$SYSTEMD_FILE"
    sed -i "s|User=nvidia|User=$(whoami)|g" "$SYSTEMD_FILE"
    sed -i "s|Group=nvidia|Group=$(id -gn)|g" "$SYSTEMD_FILE"
    # Update bun path
    BUN_PATH="$(command -v bun 2>/dev/null || echo "$HOME/.bun/bin/bun")"
    sed -i "s|$OLD_HOME/.bun/bin/bun|$BUN_PATH|g" "$SYSTEMD_FILE"
    # Update opencode path
    OC_ACTUAL="$(command -v opencode 2>/dev/null || echo "$HOME/.opencode/bin/opencode")"
    sed -i "s|$OLD_HOME/.opencode/bin/opencode|$OC_ACTUAL|g" "$SYSTEMD_FILE"
    # Update remaining home dir references
    sed -i "s|$OLD_HOME|$HOME|g" "$SYSTEMD_FILE"
    log "Patched thirdwave.service for user=$(whoami), home=$HOME"
  else
    log "thirdwave.service already patched"
  fi
else
  info "No systemd service file found (OK for non-systemd setups)"
fi

# ══════════════════════════════════════════════════════════════════════
# STEP 9: Add bun/opencode to Shell Profile
# ══════════════════════════════════════════════════════════════════════
header "Step 9: Shell Profile"

SHELL_RC=""
for rc in "$HOME/.bashrc" "$HOME/.zshrc" "$HOME/.profile"; do
  [[ -f "$rc" ]] && SHELL_RC="$rc" && break
done

if [[ -n "$SHELL_RC" ]]; then
  MARKER="# Thirdwave AI Platform"
  if ! grep -q "$MARKER" "$SHELL_RC"; then
    cat >> "$SHELL_RC" << 'PROFILE'

# Thirdwave AI Platform
export PATH="$HOME/.bun/bin:$HOME/.opencode/bin:$HOME/.local/bin:$PATH"
PROFILE
    log "Added PATH entries to $SHELL_RC"
  else
    log "Shell profile already configured"
  fi
else
  warn "No shell profile found. Add to your profile manually:"
  echo '  export PATH="$HOME/.bun/bin:$HOME/.opencode/bin:$HOME/.local/bin:$PATH"'
fi

# ══════════════════════════════════════════════════════════════════════
# STEP 10: TypeCheck & Validation
# ══════════════════════════════════════════════════════════════════════
header "Step 10: Validation"

cd "$PLATFORM_DIR"

info "Running TypeScript typecheck..."
if bun run typecheck 2>/dev/null; then
  log "TypeScript typecheck passed"
else
  warn "TypeScript typecheck had issues (may be OK for dev)"
fi

# Quick sanity check on .env
if [[ -f "$ENV_FILE" ]]; then
  ISSUES=0
  if grep -q "YOUR_GATEWAY_IP" "$ENV_FILE" 2>/dev/null; then
    warn ".env still has placeholder VLLM_GATEWAY_URL — update before starting"
    ISSUES=1
  fi
  if grep -q "YOUR_GATEWAY_API_KEY" "$ENV_FILE" 2>/dev/null; then
    warn ".env still has placeholder VLLM_GATEWAY_KEY — update before starting"
    ISSUES=1
  fi
  if grep -q "/path/to/" "$ENV_FILE" 2>/dev/null; then
    warn ".env still has placeholder paths — these should have been auto-patched"
    ISSUES=1
  fi
  if [[ $ISSUES -eq 0 ]]; then
    log ".env values look good"
  fi
fi

# ══════════════════════════════════════════════════════════════════════
# DONE
# ══════════════════════════════════════════════════════════════════════
header "Setup Complete"

echo -e "${GREEN}${BOLD}Environment is ready!${NC}"
echo ""
echo -e "  ${BOLD}Before starting, review:${NC}"
echo -e "    ${CYAN}$ENV_FILE${NC}"
echo ""
echo -e "  ${BOLD}Key values to verify:${NC}"
echo -e "    VLLM_GATEWAY_URL  — inference gateway on twave network"
echo -e "    VLLM_GATEWAY_KEY  — gateway API key"
echo -e "    OPENCODE_DIR      — should be: $PROJECT_ROOT"
echo -e "    OPENCODE_BIN      — path to opencode binary"
echo ""
echo -e "  ${BOLD}Start the platform:${NC}"
echo -e "    cd $PLATFORM_DIR"
echo -e "    bun run dev           ${DIM}# dev server with watch mode${NC}"
echo -e "    bun run start:all     ${DIM}# OpenCode + Platform (headless)${NC}"
echo -e "    bun run launch        ${DIM}# OpenCode + Platform + TUI${NC}"
echo ""
echo -e "  ${BOLD}Or use Docker:${NC}"
echo -e "    cd $PROJECT_ROOT"
echo -e "    docker compose -f docker-compose.dev.yml up --build"
echo ""
echo -e "  ${BOLD}Health check:${NC}"
echo -e "    curl http://localhost:3100/health/ready"
echo ""
