// ---------------------------------------------------------------------------
// theme.ts — Visual theme for Kadavuley TUI
// Inspired by OpenCode's design language: clean lines, muted tones, accent pops
// ---------------------------------------------------------------------------

import chalk from "chalk"

// ── Color Palette ────────────────────────────────────────────────────
// Inspired by OpenCode's catppuccin/gruvbox aesthetic

export const C = {
  // Primary brand
  primary:    chalk.hex("#7c3aed"),       // vivid purple
  primaryBg:  chalk.bgHex("#7c3aed").hex("#ffffff"),
  primaryDim: chalk.hex("#a78bfa"),       // lighter purple

  // Accent
  accent:     chalk.hex("#06b6d4"),       // cyan
  accentBold: chalk.hex("#06b6d4").bold,

  // Semantic
  success:    chalk.hex("#22c55e"),       // green
  warning:    chalk.hex("#eab308"),       // yellow
  error:      chalk.hex("#ef4444"),       // red
  info:       chalk.hex("#3b82f6"),       // blue

  // Text hierarchy
  text:       chalk.hex("#e2e8f0"),       // main text (light gray)
  textBold:   chalk.hex("#f8fafc").bold,  // headings
  muted:      chalk.hex("#64748b"),       // secondary text
  dim:        chalk.hex("#475569"),       // tertiary / borders

  // Roles
  user:       chalk.hex("#60a5fa"),       // user = blue
  assistant:  chalk.hex("#a78bfa"),       // assistant = purple
  system:     chalk.hex("#94a3b8"),       // system = gray

  // Misc
  highlight:  chalk.hex("#fbbf24"),       // gold highlight
  link:       chalk.hex("#38bdf8").underline,
  code:       chalk.hex("#e2e8f0").bgHex("#1e293b"),
} as const

// ── Box Drawing Characters ───────────────────────────────────────────

export const Box = {
  // Rounded corners
  tl: "╭", tr: "╮", bl: "╰", br: "╯",
  h: "─", v: "│",
  // T-junctions
  teeRight: "├", teeLeft: "┤", teeDown: "┬", teeUp: "┴",
  cross: "┼",
  // Heavy
  hBold: "━", vBold: "┃",
  // Dots
  dot: "●", dotEmpty: "○", diamond: "◆", diamondEmpty: "◇",
  arrow: "→", arrowLeft: "←", arrowUp: "↑", arrowDown: "↓",
  check: "✓", cross_mark: "✗", warning_sign: "⚠",
  // Misc
  ellipsis: "…", bullet: "•", pipe: "│",
} as const

// ── Layout Constants ─────────────────────────────────────────────────

export const TERM_WIDTH = () => Math.min(process.stdout.columns || 80, 100)
export const INNER_WIDTH = () => TERM_WIDTH() - 4 // account for padding + border

// ── Spinner Frames ───────────────────────────────────────────────────

export const SPINNER_FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"]
