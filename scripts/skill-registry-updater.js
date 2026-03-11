#!/usr/bin/env node

import fs from "fs";
import path from "path";

const HOME = process.env.HOME;
const SKILLS_DIR = path.join(HOME, ".skills");
const MANIFESTS_DIR = path.join(SKILLS_DIR, "manifests");
const REGISTRY_PATH = path.join(SKILLS_DIR, "registry.json");

function loadRegistry() {
  if (!fs.existsSync(REGISTRY_PATH)) {
    return { skills: [] };
  }
  const content = fs.readFileSync(REGISTRY_PATH, "utf-8").trim();
  if (!content) {
    return { skills: [] };
  }
  return JSON.parse(content);
}

function saveRegistry(registry) {
  fs.writeFileSync(REGISTRY_PATH, JSON.stringify(registry, null, 2));
}

function scanManifests() {
  const files = fs.readdirSync(MANIFESTS_DIR);
  return files
    .filter(f => f.endsWith(".json"))
    .map(f => {
      const full = path.join(MANIFESTS_DIR, f);
      return JSON.parse(fs.readFileSync(full, "utf-8"));
    });
}

function updateRegistry() {
  console.log("🔍 Scanning manifests...");

  const registry = loadRegistry();
  const manifests = scanManifests();

  const existing = new Set(registry.skills.map(s => s.name));

  for (const m of manifests) {
    if (!existing.has(m.name)) {
      console.log(`✅ Registering skill: ${m.name}`);
      registry.skills.push({
        name: m.name,
        version: m.version || "1.0.0",
        description: m.description || "",
        entry: m.entry || ""
      });
    }
  }

  saveRegistry(registry);
  console.log("🎉 Registry updated");
}

updateRegistry();
