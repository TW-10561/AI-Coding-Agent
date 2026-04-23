// ---------------------------------------------------------------------------
// API Key Service — per-user vLLM key management
// Keys are encrypted (AES-256-GCM) so they can be recovered for forwarding
// to the inference gateway, AND hashed (bcrypt) for validation lookups.
// ---------------------------------------------------------------------------

import { sql, pgEnabled } from "../config/db"
import { env } from "../config/env"

const hashKey = (key: string) => Bun.password.hash(key, { algorithm: "bcrypt", cost: 10 })
const verifyKey = (key: string, hash: string) => Bun.password.verify(key, hash)

// ── AES-256-GCM encryption for recoverable key storage ──────────────
const ENC_SECRET = env.PLATFORM_JWT_SECRET || "thirdwave-dev-secret-change-me"
const enc = new TextEncoder()
const dec = new TextDecoder()

async function deriveAesKey(): Promise<CryptoKey> {
  const raw = await crypto.subtle.digest("SHA-256", enc.encode(ENC_SECRET))
  return crypto.subtle.importKey("raw", raw, "AES-GCM", false, ["encrypt", "decrypt"])
}

async function encryptKey(plaintext: string): Promise<string> {
  const key = await deriveAesKey()
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const ct = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, enc.encode(plaintext))
  // Format: base64(iv + ciphertext)
  const buf = new Uint8Array(iv.length + ct.byteLength)
  buf.set(iv, 0)
  buf.set(new Uint8Array(ct), iv.length)
  return btoa(String.fromCharCode(...buf))
}

async function decryptKey(encoded: string): Promise<string> {
  const key = await deriveAesKey()
  const raw = Uint8Array.from(atob(encoded), c => c.charCodeAt(0))
  const iv = raw.slice(0, 12)
  const ct = raw.slice(12)
  const pt = await crypto.subtle.decrypt({ name: "AES-GCM", iv }, key, ct)
  return dec.decode(pt)
}

export interface ApiKeyRecord {
  id: string
  userId: string
  keyPreview: string
  displayName: string | null
  keyType: string
  inferenceGatewayUrl: string | null
  status: string
  adminVerified: boolean
  adminVerifiedAt: string | null
  adminVerifiedBy: string | null
  createdAt: string
  lastUsedAt: string | null
  expiresAt: string | null
}

export class ApiKeyService {
  private _columnsReady = false

  /** Ensure the key_encrypted and admin_verified columns exist (migration) */
  private async ensureColumns(): Promise<void> {
    if (this._columnsReady || !pgEnabled) return
    try {
      await sql`ALTER TABLE api_keys ADD COLUMN IF NOT EXISTS key_encrypted TEXT`
      await sql`ALTER TABLE api_keys ADD COLUMN IF NOT EXISTS admin_verified BOOLEAN DEFAULT FALSE`
      await sql`ALTER TABLE api_keys ADD COLUMN IF NOT EXISTS admin_verified_at TIMESTAMPTZ`
      await sql`ALTER TABLE api_keys ADD COLUMN IF NOT EXISTS admin_verified_by UUID REFERENCES users(id)`
    } catch {}
    // Migrate audit log action column to allow new values
    try {
      await sql`ALTER TABLE api_key_audit_log DROP CONSTRAINT IF EXISTS api_key_audit_log_action_check`
      await sql`ALTER TABLE api_key_audit_log ADD CONSTRAINT api_key_audit_log_action_check CHECK (action IN ('created', 'rotated', 'revoked', 'validated', 'expired', 'admin_verified', 'admin_rejected'))`
    } catch {}
    this._columnsReady = true
  }

  /** Store a new API key (encrypted + hashed, never plaintext after this) */
  async create(input: {
    userId: string
    apiKey: string
    displayName?: string
    keyType?: string
    inferenceGatewayUrl?: string
    skipGatewayVerification?: boolean
  }): Promise<ApiKeyRecord & { gatewayVerification?: { valid: boolean; models?: string[]; error?: string } }> {
    if (!pgEnabled) throw new Error("PostgreSQL required for API key management")
    await this.ensureColumns()

    // Revoke any existing active vLLM key for this user (one active key at a time)
    if (input.keyType !== "custom") {
      await sql`
        UPDATE api_keys SET status = 'revoked', revoked_at = NOW()
        WHERE user_id = ${input.userId} AND key_type = 'vllm' AND status = 'active'
      `
    }

    // Verify key against gateway before storing (unless explicitly skipped)
    let gatewayVerification: { valid: boolean; models?: string[]; error?: string } | undefined
    if (!input.skipGatewayVerification && input.keyType !== "platform") {
      gatewayVerification = await this.verifyGatewayKey(input.apiKey, input.inferenceGatewayUrl)
    }

    const keyHash = await hashKey(input.apiKey)
    const keyEncrypted = await encryptKey(input.apiKey)
    // Store a preview: first 8 + last 4 chars
    const preview = input.apiKey.length > 12
      ? `${input.apiKey.slice(0, 8)}...${input.apiKey.slice(-4)}`
      : input.apiKey.slice(0, 4) + "..."

    const [row] = await sql`
      INSERT INTO api_keys (user_id, key_hash, key_encrypted, key_preview, display_name, key_type, inference_gateway_url, status)
      VALUES (${input.userId}, ${keyHash}, ${keyEncrypted}, ${preview}, ${input.displayName || "vLLM Key"}, ${input.keyType || "vllm"}, ${input.inferenceGatewayUrl || null}, 'active')
      RETURNING id, user_id, key_preview, display_name, key_type, inference_gateway_url, status, created_at, last_used_at, expires_at
    `

    // Audit log
    await sql`
      INSERT INTO api_key_audit_log (user_id, api_key_id, action)
      VALUES (${input.userId}, ${row.id}, 'created')
    `

    // Auto-verify keys for admin users (they don't need separate approval)
    try {
      const [adminCheck] = await sql`
        SELECT 1 FROM users u JOIN roles r ON u.role_id = r.id
        WHERE u.id = ${input.userId} AND r.name = 'admin'
      `
      if (adminCheck) {
        await sql`
          UPDATE api_keys
          SET admin_verified = TRUE, admin_verified_at = NOW(), admin_verified_by = ${input.userId}
          WHERE id = ${row.id}
        `
        await sql`INSERT INTO api_key_audit_log (user_id, api_key_id, action) VALUES (${input.userId}, ${row.id}, 'admin_verified')`
      }
    } catch { /* non-fatal — admin can manually verify later */ }

    // Auto-verify keys for admin users (they don't need separate approval)
    try {
      const [adminCheck] = await sql`
        SELECT 1 FROM users u JOIN roles r ON u.role_id = r.id
        WHERE u.id = ${input.userId} AND r.name = 'admin'
      `
      if (adminCheck) {
        await sql`
          UPDATE api_keys
          SET admin_verified = TRUE, admin_verified_at = NOW(), admin_verified_by = ${input.userId}
          WHERE id = ${row.id}
        `
        await sql`INSERT INTO api_key_audit_log (user_id, api_key_id, action) VALUES (${input.userId}, ${row.id}, 'admin_verified')`
        row.admin_verified = true
      }
    } catch { /* non-fatal — admin can manually verify later */ }

    return { ...this._toRecord(row), gatewayVerification }
  }

  /** List user's API keys (active only by default) */
  async listByUser(userId: string, includeRevoked = false): Promise<ApiKeyRecord[]> {
    if (!pgEnabled) return []
    await this.ensureColumns()
    const rows = includeRevoked
      ? await sql`SELECT * FROM api_keys WHERE user_id = ${userId} ORDER BY created_at DESC`
      : await sql`SELECT * FROM api_keys WHERE user_id = ${userId} AND status = 'active' ORDER BY created_at DESC`
    return rows.map((r: any) => this._toRecord(r))
  }

  /** Rotate a key: revoke old, create new */
  async rotate(input: {
    userId: string
    oldKeyId: string
    newApiKey: string
  }): Promise<{ old: ApiKeyRecord; new: ApiKeyRecord }> {
    if (!pgEnabled) throw new Error("PostgreSQL required")

    // Revoke old key
    const [oldRow] = await sql`
      UPDATE api_keys SET status = 'revoked', revoked_at = NOW(), revoked_by = ${input.userId}
      WHERE id = ${input.oldKeyId} AND user_id = ${input.userId} AND status = 'active'
      RETURNING *
    `
    if (!oldRow) throw Object.assign(new Error("Key not found or already revoked"), { status: 404 })

    await sql`INSERT INTO api_key_audit_log (user_id, api_key_id, action) VALUES (${input.userId}, ${input.oldKeyId}, 'rotated')`

    // Create new key with same display name
    const newKey = await this.create({
      userId: input.userId,
      apiKey: input.newApiKey,
      displayName: oldRow.display_name || "vLLM Key (rotated)",
      keyType: oldRow.key_type,
      inferenceGatewayUrl: oldRow.inference_gateway_url,
    })

    return { old: this._toRecord(oldRow), new: newKey }
  }

  /** Revoke a key */
  async revoke(userId: string, keyId: string): Promise<void> {
    if (!pgEnabled) throw new Error("PostgreSQL required")
    const [row] = await sql`
      UPDATE api_keys SET status = 'revoked', revoked_at = NOW(), revoked_by = ${userId}
      WHERE id = ${keyId} AND (user_id = ${userId} OR EXISTS (SELECT 1 FROM users u JOIN roles r ON r.id = u.role_id WHERE u.id = ${userId} AND r.name = 'admin'))
      AND status = 'active'
      RETURNING id
    `
    if (!row) throw Object.assign(new Error("Key not found or already revoked"), { status: 404 })
    await sql`INSERT INTO api_key_audit_log (user_id, api_key_id, action) VALUES (${userId}, ${keyId}, 'revoked')`
  }

  /** Validate a raw API key against stored hashes — returns the user_id if valid */
  async validateKey(rawKey: string): Promise<{ userId: string; keyId: string } | null> {
    if (!pgEnabled) return null
    // Get all active keys (typically few per user, and few users initially)
    const keys = await sql`
      SELECT id, user_id, key_hash FROM api_keys
      WHERE status = 'active' AND (expires_at IS NULL OR expires_at > NOW())
    `
    for (const k of keys) {
      if (await verifyKey(rawKey, k.key_hash)) {
        // Update last_used_at
        await sql`UPDATE api_keys SET last_used_at = NOW() WHERE id = ${k.id}`
        await sql`INSERT INTO api_key_audit_log (user_id, api_key_id, action) VALUES (${k.user_id}, ${k.id}, 'validated')`
        return { userId: k.user_id, keyId: k.id }
      }
    }
    return null
  }

  /** Get a user's active vLLM key (decrypted, for forwarding to gateway).
   *  Returns null if the key is not admin-verified. */
  async getActiveVllmKey(userId: string): Promise<string | null> {
    if (!pgEnabled) return null
    await this.ensureColumns()
    const [row] = await sql`
      SELECT key_encrypted, key_preview, admin_verified FROM api_keys
      WHERE user_id = ${userId} AND status = 'active' AND key_type = 'vllm'
      ORDER BY created_at DESC LIMIT 1
    `
    if (!row) return null
    // Key must be admin-verified before it can be used for inference
    if (!row.admin_verified) return null
    // If we have an encrypted copy, decrypt it
    if (row.key_encrypted) {
      try { return await decryptKey(row.key_encrypted) } catch { /* fall through */ }
    }
    return null  // Can't recover from hash-only storage
  }

  /** Get a user's active vLLM key preview (for display only) */
  async getActiveVllmKeyPreview(userId: string): Promise<string | null> {
    if (!pgEnabled) return null
    const [row] = await sql`
      SELECT key_preview FROM api_keys
      WHERE user_id = ${userId} AND status = 'active' AND key_type = 'vllm'
      ORDER BY created_at DESC LIMIT 1
    `
    return row?.key_preview || null
  }

  /** Verify raw API key against the inference gateway (APISIX) */
  async verifyGatewayKey(rawKey: string, gatewayUrl?: string): Promise<{
    valid: boolean
    models?: string[]
    latencyMs?: number
    error?: string
  }> {
    const gwUrl = gatewayUrl || env.VLLM_GATEWAY_URL
    if (!gwUrl) return { valid: false, error: "No gateway URL configured (VLLM_GATEWAY_URL)" }

    const base = gwUrl.replace(/\/?$/, "").replace(/\/v1$/, "") + "/v1"
    const start = Date.now()
    try {
      const res = await fetch(`${base}/models`, {
        signal: AbortSignal.timeout(8_000),
        headers: rawKey ? { Authorization: `Bearer ${rawKey}` } : {},
      })
      const latencyMs = Date.now() - start

      if (res.status === 401 || res.status === 403) {
        return { valid: false, latencyMs, error: `Gateway rejected key (HTTP ${res.status})` }
      }
      if (!res.ok) {
        return { valid: false, latencyMs, error: `Gateway error (HTTP ${res.status})` }
      }

      const json = await res.json() as { data?: Array<{ id: string }> }
      const models = json.data?.map(m => m.id) || []
      return { valid: true, models, latencyMs }
    } catch (e: any) {
      return { valid: false, error: e.message || "Gateway unreachable" }
    }
  }

  /** Admin: verify (approve) a user's API key */
  async adminVerifyKey(keyId: string, adminUserId: string): Promise<ApiKeyRecord> {
    if (!pgEnabled) throw new Error("PostgreSQL required")
    await this.ensureColumns()
    const [row] = await sql`
      UPDATE api_keys
      SET admin_verified = TRUE, admin_verified_at = NOW(), admin_verified_by = ${adminUserId}
      WHERE id = ${keyId} AND status = 'active'
      RETURNING *
    `
    if (!row) throw Object.assign(new Error("Key not found or not active"), { status: 404 })
    await sql`INSERT INTO api_key_audit_log (user_id, api_key_id, action) VALUES (${row.user_id}, ${keyId}, 'admin_verified')`
    return this._toRecord(row)
  }

  /** Admin: reject a user's API key (revokes it) */
  async adminRejectKey(keyId: string, adminUserId: string): Promise<void> {
    if (!pgEnabled) throw new Error("PostgreSQL required")
    await this.ensureColumns()
    const [row] = await sql`
      UPDATE api_keys
      SET status = 'revoked', revoked_at = NOW(), revoked_by = ${adminUserId}, admin_verified = FALSE
      WHERE id = ${keyId} AND status = 'active'
      RETURNING user_id
    `
    if (!row) throw Object.assign(new Error("Key not found or already revoked"), { status: 404 })
    await sql`INSERT INTO api_key_audit_log (user_id, api_key_id, action) VALUES (${row.user_id}, ${keyId}, 'admin_rejected')`
  }

  /** Check if a user has an admin-verified active key */
  async hasVerifiedKey(userId: string): Promise<boolean> {
    if (!pgEnabled) return false
    await this.ensureColumns()
    const [row] = await sql`
      SELECT 1 FROM api_keys
      WHERE user_id = ${userId} AND status = 'active' AND key_type = 'vllm' AND admin_verified = TRUE
      LIMIT 1
    `
    return !!row
  }

  /** Get verification status of a user's active key */
  async getKeyVerificationStatus(userId: string): Promise<{ hasKey: boolean; adminVerified: boolean; keyPreview?: string }> {
    if (!pgEnabled) return { hasKey: false, adminVerified: false }
    await this.ensureColumns()
    const [row] = await sql`
      SELECT key_preview, admin_verified FROM api_keys
      WHERE user_id = ${userId} AND status = 'active' AND key_type = 'vllm'
      ORDER BY created_at DESC LIMIT 1
    `
    if (!row) return { hasKey: false, adminVerified: false }
    return { hasKey: true, adminVerified: row.admin_verified ?? false, keyPreview: row.key_preview }
  }

  private _toRecord(row: any): ApiKeyRecord {
    return {
      id: row.id,
      userId: row.user_id,
      keyPreview: row.key_preview,
      displayName: row.display_name,
      keyType: row.key_type,
      inferenceGatewayUrl: row.inference_gateway_url,
      status: row.status,
      adminVerified: row.admin_verified ?? false,
      adminVerifiedAt: row.admin_verified_at ?? null,
      adminVerifiedBy: row.admin_verified_by ?? null,
      createdAt: row.created_at,
      lastUsedAt: row.last_used_at,
      expiresAt: row.expires_at,
    }
  }
}

export const apiKeyService = new ApiKeyService()
