#!/usr/bin/env bash
# ── Thirdwave Deploy Script ─────────────────────────────────────────────
# Sets up nginx reverse proxy + systemd service for small testing.
#
# Usage:
#   sudo bash platform/deploy/deploy.sh          # full setup
#   sudo bash platform/deploy/deploy.sh --nginx   # nginx only
#   sudo bash platform/deploy/deploy.sh --systemd # systemd only
#   sudo bash platform/deploy/deploy.sh --status  # check status
#   sudo bash platform/deploy/deploy.sh --stop    # stop everything
#   sudo bash platform/deploy/deploy.sh --uninstall # remove everything
# ────────────────────────────────────────────────────────────────────────
set -euo pipefail

# ── Resolve paths ─────────────────────────────────────────────────────
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PLATFORM_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
PROJECT_DIR="$(cd "$PLATFORM_DIR/.." && pwd)"

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

info()  { echo -e "${BLUE}[thirdwave]${NC} $1"; }
ok()    { echo -e "${GREEN}[thirdwave]${NC} $1"; }
warn()  { echo -e "${YELLOW}[thirdwave]${NC} $1"; }
fail()  { echo -e "${RED}[thirdwave]${NC} $1"; exit 1; }

# ── Pre-flight ────────────────────────────────────────────────────────
check_prerequisites() {
  info "Checking prerequisites..."

  # Must be root or sudo
  if [[ $EUID -ne 0 ]]; then
    fail "This script must be run as root (use sudo)"
  fi

  # Check nginx
  if ! command -v nginx &>/dev/null; then
    warn "nginx not found. Installing..."
    apt-get update -qq && apt-get install -y nginx
  fi
  ok "nginx $(nginx -v 2>&1 | cut -d/ -f2)"

  # Check bun
  local BUN_PATH="/home/nvidia/.bun/bin/bun"
  if [[ ! -x "$BUN_PATH" ]]; then
    # Try system bun
    BUN_PATH="$(which bun 2>/dev/null || true)"
    if [[ -z "$BUN_PATH" ]]; then
      fail "bun not found. Install: curl -fsSL https://bun.sh/install | bash"
    fi
  fi
  ok "bun found at $BUN_PATH"

  # Check platform directory
  if [[ ! -f "$PLATFORM_DIR/package.json" ]]; then
    fail "Platform not found at $PLATFORM_DIR"
  fi
  ok "Platform found at $PLATFORM_DIR"

  # Check .env
  if [[ ! -f "$PLATFORM_DIR/.env" ]]; then
    warn ".env not found — using defaults (may not reach vLLM)"
  else
    ok ".env loaded"
  fi
}

# ── Install nginx config ──────────────────────────────────────────────
setup_nginx() {
  info "Setting up nginx reverse proxy..."

  # Remove default site if it exists
  rm -f /etc/nginx/sites-enabled/default

  # Copy our config
  cp "$SCRIPT_DIR/nginx/thirdwave.conf" /etc/nginx/sites-available/thirdwave
  ln -sf /etc/nginx/sites-available/thirdwave /etc/nginx/sites-enabled/thirdwave

  # Test config
  if nginx -t 2>&1; then
    ok "nginx config valid"
  else
    fail "nginx config test failed"
  fi

  # Reload nginx
  systemctl enable nginx
  systemctl reload nginx || systemctl start nginx
  ok "nginx running and proxying to Thirdwave on :3100"
}

# ── Install systemd service ──────────────────────────────────────────
setup_systemd() {
  info "Setting up systemd service..."

  # Copy service file
  cp "$SCRIPT_DIR/systemd/thirdwave.service" /etc/systemd/system/thirdwave.service

  # Patch paths for this specific installation
  sed -i "s|WorkingDirectory=.*|WorkingDirectory=$PROJECT_DIR|" /etc/systemd/system/thirdwave.service
  sed -i "s|ExecStart=.*|ExecStart=/home/nvidia/.bun/bin/bun run $PLATFORM_DIR/scripts/start-all.ts|" /etc/systemd/system/thirdwave.service
  sed -i "s|EnvironmentFile=.*|EnvironmentFile=-$PLATFORM_DIR/.env|" /etc/systemd/system/thirdwave.service
  sed -i "s|ReadWritePaths=.*/.platform|ReadWritePaths=$PROJECT_DIR/.platform|" /etc/systemd/system/thirdwave.service
  sed -i "s|Environment=OPENCODE_DIR=.*|Environment=OPENCODE_DIR=$PROJECT_DIR|" /etc/systemd/system/thirdwave.service

  # Ensure data directory exists (SQLite DBs live at project root .platform/)
  mkdir -p "$PROJECT_DIR/.platform"
  chown -R nvidia:nvidia "$PROJECT_DIR/.platform"

  # Reload and enable
  systemctl daemon-reload
  systemctl enable thirdwave.service
  ok "systemd service installed and enabled"
}

# ── Start the service ─────────────────────────────────────────────────
start_service() {
  info "Starting Thirdwave service..."
  systemctl start thirdwave.service

  # Wait for health
  info "Waiting for platform to become healthy..."
  local attempts=0
  while [[ $attempts -lt 30 ]]; do
    if curl -sf http://127.0.0.1:3100/health >/dev/null 2>&1; then
      ok "Platform is healthy!"
      return 0
    fi
    sleep 1
    attempts=$((attempts + 1))
  done

  warn "Platform not responding after 30s — check: journalctl -u thirdwave -f"
}

# ── Status check ──────────────────────────────────────────────────────
show_status() {
  echo ""
  info "═══ Thirdwave Deployment Status ═══"
  echo ""

  # systemd
  if systemctl is-active --quiet thirdwave 2>/dev/null; then
    ok "Service:  RUNNING"
  else
    warn "Service:  STOPPED"
  fi

  # nginx
  if systemctl is-active --quiet nginx 2>/dev/null; then
    ok "Nginx:    RUNNING"
  else
    warn "Nginx:    STOPPED"
  fi

  # Health check
  if curl -sf http://127.0.0.1:3100/health >/dev/null 2>&1; then
    local health=$(curl -sf http://127.0.0.1:3100/health)
    ok "Health:   OK — $health"
  else
    warn "Health:   UNREACHABLE (platform may be starting)"
  fi

  # Get IPs
  echo ""
  info "Access URLs:"
  for ip in $(ip -4 addr show | grep -oP '(?<=inet\s)\d+\.\d+\.\d+\.\d+' | grep -v '^127\.'); do
    echo -e "  ${GREEN}→${NC} http://$ip/"
  done
  echo -e "  ${GREEN}→${NC} http://localhost/"
  echo ""

  # Recent logs
  info "Recent logs (last 5 lines):"
  journalctl -u thirdwave --no-pager -n 5 2>/dev/null || echo "  (no logs yet)"
  echo ""
}

# ── Stop ──────────────────────────────────────────────────────────────
stop_all() {
  info "Stopping Thirdwave service..."
  systemctl stop thirdwave.service 2>/dev/null || true
  ok "Thirdwave service stopped"

  # Verify ports are released (belt-and-suspenders)
  sleep 1
  for PORT in 3100 4096; do
    PIDS=$(lsof -t -i :"$PORT" 2>/dev/null || true)
    if [ -n "$PIDS" ]; then
      warn "Port $PORT still held by PID(s) $PIDS — force-releasing"
      kill -9 $PIDS 2>/dev/null || true
    fi
  done
  ok "Ports 3100 and 4096 released"
}

# ── Stop including nginx ───────────────────────────────────────────────
stop_all_services() {
  stop_all
  info "Stopping nginx..."
  systemctl stop nginx 2>/dev/null || true
  ok "nginx stopped"
}

# ── Restart ────────────────────────────────────────────────────────────
restart_service() {
  info "Restarting Thirdwave..."
  systemctl restart thirdwave.service 2>/dev/null || true
  info "Waiting for platform to become healthy..."
  local attempts=0
  while [[ $attempts -lt 20 ]]; do
    if curl -sf http://127.0.0.1:3100/health >/dev/null 2>&1; then
      ok "Thirdwave restarted and healthy!"
      return 0
    fi
    sleep 1
    attempts=$((attempts + 1))
  done
  warn "Platform not responding after 20s — check: journalctl -u thirdwave -f"
}

# ── Uninstall ─────────────────────────────────────────────────────────
uninstall() {
  warn "Removing Thirdwave deployment..."
  systemctl stop thirdwave.service 2>/dev/null || true
  systemctl disable thirdwave.service 2>/dev/null || true
  rm -f /etc/systemd/system/thirdwave.service
  rm -f /etc/nginx/sites-enabled/thirdwave
  rm -f /etc/nginx/sites-available/thirdwave
  systemctl daemon-reload
  systemctl reload nginx 2>/dev/null || true
  ok "Thirdwave deployment removed (source code untouched)"
}

# ── Main ──────────────────────────────────────────────────────────────
case "${1:-full}" in
  --nginx)
    check_prerequisites
    setup_nginx
    ;;
  --systemd)
    check_prerequisites
    setup_systemd
    start_service
    ;;
  --status)
    show_status
    ;;
  --stop)
    stop_all
    ;;
  --stop-all)
    stop_all_services
    ;;
  --restart)
    restart_service
    ;;
  --uninstall)
    uninstall
    ;;
  full|--full)
    check_prerequisites
    setup_nginx
    setup_systemd
    start_service
    echo ""
    show_status
    ;;
  *)
    echo "Usage: sudo bash deploy.sh [--full|--nginx|--systemd|--status|--stop|--stop-all|--restart|--uninstall]"
    exit 1
    ;;
esac
