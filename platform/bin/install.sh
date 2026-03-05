#!/usr/bin/env bash
# ── Artemis CLI Installer ─────────────────────────────────────────────
# Run:  curl -fsSL http://172.30.140.142/api/install | bash
# ─────────────────────────────────────────────────────────────────────
set -euo pipefail

SERVER="${ARTEMIS_SERVER:-http://172.30.140.142}"
INSTALL_DIR="${HOME}/.local/bin"

GREEN='\033[0;32m'
CYAN='\033[0;36m'
BOLD='\033[1m'
DIM='\033[2m'
NC='\033[0m'

echo -e "${BOLD}Installing Artemis CLI...${NC}"
echo ""

# Check deps
command -v curl >/dev/null 2>&1  || { echo "Error: curl required"; exit 1; }
command -v python3 >/dev/null 2>&1 || { echo "Error: python3 required"; exit 1; }

# Create install dir
mkdir -p "$INSTALL_DIR"

# Download the client
echo -e "  Downloading from ${DIM}${SERVER}${NC}..."
curl -fsSL "${SERVER}/api/client" -o "${INSTALL_DIR}/artemis"
chmod +x "${INSTALL_DIR}/artemis"

# Check PATH
if [[ ":$PATH:" != *":${INSTALL_DIR}:"* ]]; then
  echo ""
  echo -e "  ${CYAN}Note:${NC} Add this to your ~/.bashrc (or ~/.zshrc):"
  echo ""
  echo "    export PATH=\"\$HOME/.local/bin:\$PATH\""
  echo ""
  echo "  Then restart your terminal, or run:"
  echo "    source ~/.bashrc"
  echo ""
fi

# Set server URL in profile if not default
SHELL_RC=""
if [[ -f "$HOME/.bashrc" ]]; then
  SHELL_RC="$HOME/.bashrc"
elif [[ -f "$HOME/.zshrc" ]]; then
  SHELL_RC="$HOME/.zshrc"
fi

if [[ -n "$SHELL_RC" ]]; then
  if ! grep -q "ARTEMIS_SERVER" "$SHELL_RC" 2>/dev/null; then
    echo "" >> "$SHELL_RC"
    echo "# Artemis AI Coding Assistant" >> "$SHELL_RC"
    echo "export ARTEMIS_SERVER=\"${SERVER}\"" >> "$SHELL_RC"
    echo "export PATH=\"\$HOME/.local/bin:\$PATH\"" >> "$SHELL_RC"
    echo -e "  ${GREEN}✓${NC} Added ARTEMIS_SERVER and PATH to ${SHELL_RC}"
  fi
fi

# Verify
echo ""
echo -e "  ${GREEN}✓${NC} Installed to ${BOLD}${INSTALL_DIR}/artemis${NC}"
echo ""

# Test connection
echo -e "  Testing connection to ${SERVER}..."
if curl -sf "${SERVER}/health" >/dev/null 2>&1; then
  echo -e "  ${GREEN}✓${NC} Server is reachable"
else
  echo -e "  Warning: Cannot reach ${SERVER} — check your network"
fi

echo ""
echo -e "${BOLD}Done!${NC} Try it now:"
echo ""
echo -e "  ${CYAN}artemis \"Write a Python hello world\"${NC}"
echo -e "  ${CYAN}artemis chat${NC}"
echo -e "  ${CYAN}artemis health${NC}"
echo ""
