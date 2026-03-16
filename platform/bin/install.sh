#!/usr/bin/env bash
# ── Thirdwave CLI Installer ─────────────────────────────────────────────
# Run:  curl -fsSL http://172.30.140.142/api/install | bash
# ─────────────────────────────────────────────────────────────────────
set -euo pipefail

SERVER="${THIRDWAVE_SERVER:-http://172.30.140.142}"
INSTALL_DIR="${HOME}/.local/bin"

GREEN='\033[0;32m'
CYAN='\033[0;36m'
BOLD='\033[1m'
DIM='\033[2m'
NC='\033[0m'

echo -e "${BOLD}Installing Thirdwave CLI (art)...${NC}"
echo ""

# Check deps
command -v curl >/dev/null 2>&1  || { echo "Error: curl required"; exit 1; }
command -v python3 >/dev/null 2>&1 || { echo "Error: python3 required"; exit 1; }

# Create install dir
mkdir -p "$INSTALL_DIR"

# Download the client as 'art'
echo -e "  Downloading from ${DIM}${SERVER}${NC}..."
curl -fsSL "${SERVER}/api/client" -o "${INSTALL_DIR}/art"
chmod +x "${INSTALL_DIR}/art"

echo -e "  ${GREEN}✓${NC} Installed to ${BOLD}${INSTALL_DIR}/art${NC}"

# Update shell profile: add PATH + THIRDWAVE_SERVER
SHELL_RC=""
if [[ -f "$HOME/.bashrc" ]]; then
  SHELL_RC="$HOME/.bashrc"
elif [[ -f "$HOME/.zshrc" ]]; then
  SHELL_RC="$HOME/.zshrc"
elif [[ -f "$HOME/.profile" ]]; then
  SHELL_RC="$HOME/.profile"
fi

if [[ -n "$SHELL_RC" ]]; then
  if ! grep -q "# Thirdwave AI" "$SHELL_RC" 2>/dev/null; then
    {
      echo ""
      echo "# Thirdwave AI Coding Assistant"
      echo "export THIRDWAVE_SERVER=\"${SERVER}\""
      echo 'export PATH="$HOME/.local/bin:$PATH"'
    } >> "$SHELL_RC"
    echo -e "  ${GREEN}✓${NC} Updated ${DIM}${SHELL_RC}${NC}"
  fi
fi

# Test connection
echo ""
echo -e "  Testing connection to ${DIM}${SERVER}${NC}..."
if curl -sf "${SERVER}/health" >/dev/null 2>&1; then
  echo -e "  ${GREEN}✓${NC} Server is reachable"
else
  echo -e "  Warning: Cannot reach ${SERVER} — check your network"
fi

echo ""
echo -e "${BOLD}Done!${NC} Run these now:"
echo ""
echo -e "  ${CYAN}export PATH=\"\$HOME/.local/bin:\$PATH\"${NC}"
echo -e "  ${CYAN}art \"Write a Python hello world\"${NC}"
echo ""
echo -e "${DIM}(New terminals will have 'art' automatically.)${NC}"
echo ""
