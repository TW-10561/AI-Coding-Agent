// Type declarations for modules without built-in types
declare module "marked-terminal" {
  import { MarkedExtension } from "marked"
  // Default export is the raw Renderer constructor (not useful with new Marked API)
  export default function TerminalRenderer(options?: Record<string, unknown>): MarkedExtension
  // Named export is the proper extension factory for marked.use()
  export function markedTerminal(options?: Record<string, unknown>): MarkedExtension
}
