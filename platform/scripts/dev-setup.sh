#!/usr/bin/env bash
# ---------------------------------------------------------------------------
# Thirdwave — Multi-Developer Setup
#
# Assigns each developer a unique port offset so multiple developers can
# run Thirdwave simultaneously on the same host without port conflicts.
#
# Usage:
#   ./platform/scripts/dev-setup.sh            # Auto-assign next free slot
#   ./platform/scripts/dev-setup.sh <name>     # Create .env for a specific dev
#   ./platform/scripts/dev-setup.sh --list     # Show assigned slots
#
# Each developer gets:
#   - Platform port: 3100 + (slot * 10)   e.g. dev1=3110, dev2=3120
#   - OpenCode port: 4096 + (slot * 10)   e.g. dev1=4106, dev2=4116
#
# Config is stored in .platform/devs/ and symlinked to .env.<name>
# ---------------------------------------------------------------------------

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)"
DEV_DIR="$PROJECT_DIR/.platform/devs"
PLATFORM_DIR="$PROJECT_DIR/platform"

mkdir -p "$DEV_DIR"

# Colors
GREEN='\033[0;32m'
CYAN='\033[0;36m'
YELLOW='\033[1;33m'
DIM='\033[0;90m'
BOLD='\033[1m'
NC='\033[0m'

# ── List existing slots ──────────────────────────────────────────────
list_slots() {
    echo -e "\n${BOLD}  Thirdwave Developer Slots${NC}\n"
    echo -e "  ${DIM}Slot  Name            Platform    OpenCode${NC}"
    echo -e "  ${DIM}────  ──────────────  ──────────  ────────${NC}"

    local count=0
    for f in "$DEV_DIR"/*.env 2>/dev/null; do
        [ -f "$f" ] || continue
        local name=$(basename "$f" .env)
        local offset=$(grep "^THIRDWAVE_PORT_OFFSET=" "$f" | cut -d= -f2)
        local slot=$((offset / 10))
        local pport=$((3100 + offset))
        local oport=$((4096 + offset))
        printf "  %-4s  %-14s  :%-9s  :%s\n" "$slot" "$name" "$pport" "$oport"
        count=$((count + 1))
    done

    if [ "$count" -eq 0 ]; then
        echo -e "  ${DIM}(no developers assigned yet)${NC}"
    fi
    echo ""
}

# ── Find next free slot ──────────────────────────────────────────────
next_free_slot() {
    local slot=1
    while true; do
        local offset=$((slot * 10))
        local taken=0
        for f in "$DEV_DIR"/*.env 2>/dev/null; do
            [ -f "$f" ] || continue
            if grep -q "^THIRDWAVE_PORT_OFFSET=$offset$" "$f"; then
                taken=1
                break
            fi
        done
        [ "$taken" -eq 0 ] && echo "$slot" && return
        slot=$((slot + 1))
        [ "$slot" -gt 50 ] && echo "ERROR: No free slots" >&2 && exit 1
    done
}

# ── Create a developer slot ──────────────────────────────────────────
create_slot() {
    local name="$1"
    local slot="$2"
    local offset=$((slot * 10))
    local pport=$((3100 + offset))
    local oport=$((4096 + offset))

    # Check for duplicate name
    if [ -f "$DEV_DIR/$name.env" ]; then
        echo -e "${YELLOW}Developer '$name' already has a slot assigned.${NC}"
        cat "$DEV_DIR/$name.env"
        return 0
    fi

    cat > "$DEV_DIR/$name.env" <<EOF
# Thirdwave config for developer: $name (slot $slot)
# Generated: $(date -Iseconds)
THIRDWAVE_PORT_OFFSET=$offset
AUTO_PORT=true
# Platform: http://localhost:$pport
# OpenCode: http://localhost:$oport
EOF

    echo -e "\n${GREEN}✓ Created slot for ${BOLD}$name${NC}"
    echo -e "  ${CYAN}Slot:${NC}      $slot"
    echo -e "  ${CYAN}Platform:${NC}  http://localhost:$pport"
    echo -e "  ${CYAN}OpenCode:${NC}  http://localhost:$oport"
    echo -e "  ${CYAN}Config:${NC}    $DEV_DIR/$name.env"
    echo ""
    echo -e "  ${BOLD}To start:${NC}"
    echo -e "  ${DIM}cd $PLATFORM_DIR${NC}"
    echo -e "  ${DIM}env \$(cat $DEV_DIR/$name.env | grep -v '^#' | xargs) bun run scripts/launch.ts${NC}"
    echo ""
    echo -e "  Or add an alias to your shell:"
    echo -e "  ${DIM}alias thirdwave='env \$(cat $DEV_DIR/$name.env | grep -v \"^#\" | xargs) bun run $PLATFORM_DIR/scripts/launch.ts'${NC}"
    echo ""
}

# ── Main ─────────────────────────────────────────────────────────────
case "${1:-}" in
    --list|-l)
        list_slots
        ;;
    --help|-h)
        echo "Usage: $0 [--list | --help | <dev-name>]"
        echo ""
        echo "  (no args)     Auto-assign next free slot, prompt for name"
        echo "  <dev-name>    Create slot for the specified developer"
        echo "  --list        Show existing developer assignments"
        exit 0
        ;;
    "")
        echo -e "\n${BOLD}  Thirdwave — Developer Setup${NC}\n"
        read -rp "  Developer name (e.g. john): " devname
        devname="${devname// /-}"
        devname="${devname,,}"  # lowercase
        if [ -z "$devname" ]; then
            echo "Name required." && exit 1
        fi
        slot=$(next_free_slot)
        create_slot "$devname" "$slot"
        ;;
    *)
        devname="${1// /-}"
        devname="${devname,,}"
        slot=$(next_free_slot)
        create_slot "$devname" "$slot"
        ;;
esac
