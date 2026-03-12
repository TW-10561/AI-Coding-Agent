#!/bin/bash

##############################################################################
#                                                                            #
#  🚀 START SELF-EVALUATING SUBAGENT BRIDGE SERVER                         #
#                                                                            #
#  Starts the TypeScript Express server that bridges the TUI to the        #
#  self-evaluating subagent system.                                        #
#                                                                            #
#  Usage: ./start_subagent_bridge.sh                                       #
#                                                                            #
##############################################################################

PLATFORM_DIR="/home/nvidia/AI_Coding_Agent/agent0.1/AI-Coding-Agent/platform"

echo "╔════════════════════════════════════════════════════════════════╗"
echo "║  🚀 Self-Evaluating Subagent Bridge Server                    ║"
echo "║                                                                ║"
echo "║  Server: http://localhost:3001                                ║"
echo "║  API: /api/subagent/*                                          ║"
echo "╚════════════════════════════════════════════════════════════════╝"
echo ""

cd "$PLATFORM_DIR"

echo "Checking dependencies..."
npm install --progress=false 2>/dev/null

echo ""
echo "Starting Subagent Bridge Server..."
echo ""

# Check if ts-node is available, otherwise use tsx or bun
if command -v ts-node &> /dev/null; then
    ts-node src/api/subagent-bridge-server.ts
elif command -v bun &> /dev/null; then
    bun run src/api/subagent-bridge-server.ts
elif command -v tsx &> /dev/null; then
    tsx src/api/subagent-bridge-server.ts
else
    # Compile and run with npx ts-node
    npx ts-node src/api/subagent-bridge-server.ts
fi
