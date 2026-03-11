import { Log } from "../../util/log"
import path from "path"

const log = Log.create({ service: "sensitive-files" })

/**
 * Patterns for identifying sensitive files
 */
export const SENSITIVE_PATTERNS = [
  // Environment files
  /\.env/i,
  /\.env\..*/i,

  // SSH/GPG keys
  /\.pem$/i,
  /\.key$/i,
  /id_rsa/i,
  /id_dsa/i,
  /id_ecdsa/i,
  /id_ed25519/i,
  /\.ssh\//i,

  // AWS credentials
  /\.aws\//i,
  /aws_access_key/i,

  // Azure
  /\.azure\//i,

  // GCP
  /\.config\/gcloud/i,
  /service-account/i,

  // Private keys and certificates
  /\.crt$/i,
  /\.cert$/i,
  /\.pfx$/i,
  /\.p12$/i,

  // Database credentials
  /database\.yml/i,
  /database\.yaml/i,

  // OAuth tokens
  /\.oauth/i,
  /refresh_token/i,
  /access_token/i,

  // API keys (common patterns)
  /api[_-]?key/i,
  /secret[_-]?key/i,
  /private[_-]?key/i,
  /auth[_-]?token/i,

  // Git config
  /\.git\/config/i,

  // Terraform/Helm secrets
  /\.tfvars/i,
  /\.secrets/i,
  /secrets\.yaml/i,

  // Docker compose
  /docker-compose\.override/i,

  // Kubernetes
  /kube\/config/i,

  // History files that might contain secrets
  /\.bash_history/i,
  /\.zsh_history/i,
  /\.psql_history/i,
]

/**
 * Check if a file path is potentially sensitive
 */
export function isSensitive(filePath: string): boolean {
  const normalized = path.normalize(filePath).toLowerCase()

  for (const pattern of SENSITIVE_PATTERNS) {
    if (pattern.test(normalized)) {
      log.debug("Detected sensitive file", { filePath, pattern: pattern.source })
      return true
    }
  }

  return false
}

/**
 * Get a list of all sensitive patterns for documentation/debugging
 */
export function getSensitivePatterns(): string[] {
  return SENSITIVE_PATTERNS.map((p) => p.source)
}

/**
 * Extract sensitive files from a list of paths
 */
export function filterSensitive(paths: string[]): { sensitive: string[]; safe: string[] } {
  const sensitive: string[] = []
  const safe: string[] = []

  for (const filePath of paths) {
    if (isSensitive(filePath)) {
      sensitive.push(filePath)
    } else {
      safe.push(filePath)
    }
  }

  return { sensitive, safe }
}
