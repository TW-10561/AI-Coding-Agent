#!/bin/bash
set -e

PROJECT_ROOT="/home/nvidia/AI_Coding_Agent/AGENT/AI-Coding-Agent"
LOCAL_SKILLS_DIR="$HOME/.skills"
AGENT_SKILLS_DIR="$PROJECT_ROOT/skills/installed"
MANIFESTS_DIR="$PROJECT_ROOT/skills/manifests"
REGISTRY="$PROJECT_ROOT/skills/registry.json"
LOG_FILE="$PROJECT_ROOT/skills/logs/install.log"

echo "🔄 Syncing skills into agent registry..."

mkdir -p "$AGENT_SKILLS_DIR"
mkdir -p "$MANIFESTS_DIR"
mkdir -p "$(dirname "$LOG_FILE")"

NOW=$(date -u +"%Y-%m-%dT%H:%M:%SZ")

for skill_path in "$LOCAL_SKILLS_DIR"/*; do
  skill_name=$(basename "$skill_path")
  [ -d "$skill_path" ] || continue

  echo "📦 Processing $skill_name"

  rsync -a --delete "$skill_path/" "$AGENT_SKILLS_DIR/$skill_name/"

  if [ -f "$skill_path/manifest.json" ]; then
    cp "$skill_path/manifest.json" "$MANIFESTS_DIR/$skill_name.json"
  fi

  if command -v jq >/dev/null 2>&1; then
    tmp=$(mktemp)

    jq --arg name "$skill_name" --arg updated "$NOW" '
      .last_updated = $updated |
      if (.skills[]?.name == $name)
      then .
      else .skills += [{"name": $name, "enabled": true}]
      end
    ' "$REGISTRY" > "$tmp"

    mv "$tmp" "$REGISTRY"
  fi

  echo "$NOW Installed $skill_name" >> "$LOG_FILE"
done

echo "✅ Skill sync complete."
