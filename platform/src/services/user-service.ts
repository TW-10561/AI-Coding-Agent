// ---------------------------------------------------------------------------
// User Service — registration, authentication, approval workflow
// ---------------------------------------------------------------------------

import { sql, pgEnabled } from "../config/db"
import { env } from "../config/env"

// Use Bun's built-in password hashing (bcrypt under the hood)
const hashPassword = (pwd: string) => Bun.password.hash(pwd, { algorithm: "bcrypt", cost: 12 })
const verifyPassword = (pwd: string, hash: string) => Bun.password.verify(pwd, hash)

// Minimal JWT implementation using Web Crypto (no external deps)
const JWT_SECRET = env.PLATFORM_JWT_SECRET || "thirdwave-dev-secret-change-me"
const JWT_EXPIRY_SECONDS = 7 * 24 * 60 * 60 // 7 days

const encoder = new TextEncoder()
const decoder = new TextDecoder()

function base64url(buf: ArrayBuffer): string {
  return btoa(String.fromCharCode(...new Uint8Array(buf)))
    .replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "")
}

function base64urlDecode(s: string): Uint8Array {
  const padded = s.replace(/-/g, "+").replace(/_/g, "/") + "==".slice(0, (4 - s.length % 4) % 4)
  const binary = atob(padded)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  return bytes
}

async function getSigningKey() {
  return crypto.subtle.importKey(
    "raw", encoder.encode(JWT_SECRET),
    { name: "HMAC", hash: "SHA-256" }, false, ["sign", "verify"],
  )
}

export interface JWTPayload {
  sub: string      // user id
  email: string
  role: string     // role name
  roleId: string   // role UUID
  iat: number
  exp: number
}

export async function signJWT(payload: Omit<JWTPayload, "iat" | "exp">): Promise<string> {
  const now = Math.floor(Date.now() / 1000)
  const header = base64url(encoder.encode(JSON.stringify({ alg: "HS256", typ: "JWT" })).buffer as ArrayBuffer)
  const body = base64url(encoder.encode(JSON.stringify({ ...payload, iat: now, exp: now + JWT_EXPIRY_SECONDS })).buffer as ArrayBuffer)
  const key = await getSigningKey()
  const sig = await crypto.subtle.sign("HMAC", key, encoder.encode(`${header}.${body}`))
  return `${header}.${body}.${base64url(sig)}`
}

export async function verifyJWT(token: string): Promise<JWTPayload | null> {
  try {
    const [header, body, sig] = token.split(".")
    if (!header || !body || !sig) return null
    const key = await getSigningKey()
    const valid = await crypto.subtle.verify("HMAC", key, base64urlDecode(sig), encoder.encode(`${header}.${body}`))
    if (!valid) return null
    const payload = JSON.parse(decoder.decode(base64urlDecode(body))) as JWTPayload
    if (payload.exp < Math.floor(Date.now() / 1000)) return null
    return payload
  } catch { return null }
}

// ── User CRUD ──────────────────────────────────────────────────────

export interface RegisterInput {
  email: string
  password: string
  fullName?: string
  requestedRole?: string  // role name, defaults to "developer"
  company?: string
}

export interface LoginInput {
  email: string
  password: string
}

export interface UserRecord {
  id: string
  email: string
  fullName: string
  roleId: string
  roleName: string
  company: string | null
  status: string
  createdAt: string
  lastLoginAt: string | null
}

function defaultNameFromEmail(email: string): string {
  const local = (email.split("@")[0] || "").trim()
  if (!local) return "User"
  return local
    .replace(/[._-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/\b\w/g, (m) => m.toUpperCase())
}

function resolveDisplayName(fullName: string | undefined, email: string): string {
  const trimmed = (fullName || "").trim()
  return (trimmed || defaultNameFromEmail(email)).slice(0, 255)
}

export class UserService {
  private _profileColumnsReady = false

  private async ensureProfileColumns(): Promise<void> {
    if (this._profileColumnsReady || !pgEnabled) return
    try {
      await sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS full_name VARCHAR(255)`
      await sql`ALTER TABLE registration_requests ADD COLUMN IF NOT EXISTS full_name VARCHAR(255)`
      // Backfill full_name for existing users without one — derive from email prefix
      await sql`
        UPDATE users
        SET full_name = initcap(regexp_replace(split_part(email, '@', 1), '[._-]+', ' ', 'g'))
        WHERE full_name IS NULL OR full_name = ''
      `
    } catch {}
    // Migrate users.status CHECK constraint to include 'deactivated'
    try {
      await sql`ALTER TABLE users DROP CONSTRAINT IF EXISTS users_status_check`
      await sql`ALTER TABLE users ADD CONSTRAINT users_status_check CHECK (status IN ('active', 'suspended', 'deactivated'))`
    } catch {}
    this._profileColumnsReady = true
  }

  async register(input: RegisterInput): Promise<{ requestId: string; status: string }> {
    if (!pgEnabled) throw new Error("PostgreSQL required for user management")
    await this.ensureProfileColumns()

    // Validate email format
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(input.email)) {
      throw Object.assign(new Error("Invalid email format"), { status: 400 })
    }
    if (!input.password || input.password.length < 8) {
      throw Object.assign(new Error("Password must be at least 8 characters"), { status: 400 })
    }

    // Check if email already exists in users or pending requests
    const [existingUser] = await sql`SELECT id FROM users WHERE email = ${input.email}`
    if (existingUser) throw Object.assign(new Error("Email already registered"), { status: 409 })

    const [existingReq] = await sql`SELECT id, status FROM registration_requests WHERE email = ${input.email}`
    if (existingReq) {
      if (existingReq.status === "pending") {
        throw Object.assign(new Error("Registration already pending approval"), { status: 409 })
      }
      // If previously rejected, allow re-registration
      if (existingReq.status === "rejected") {
        await sql`DELETE FROM registration_requests WHERE id = ${existingReq.id}`
      }
    }

    // Resolve role
    const roleName = input.requestedRole || "developer"
    const [role] = await sql`SELECT id FROM roles WHERE name = ${roleName}`
    if (!role) throw Object.assign(new Error(`Role "${roleName}" not found`), { status: 400 })

    const passwordHash = await hashPassword(input.password)
    const fullName = resolveDisplayName(input.fullName, input.email)

    const [req] = await sql`
      INSERT INTO registration_requests (email, password_hash, requested_role, company, full_name, status)
      VALUES (${input.email}, ${passwordHash}, ${role.id}, ${input.company || null}, ${fullName}, 'pending')
      RETURNING id, status
    `
    return { requestId: req.id, status: req.status }
  }

  async login(input: LoginInput): Promise<{ token: string; user: UserRecord }> {
    if (!pgEnabled) throw new Error("PostgreSQL required for user management")
    await this.ensureProfileColumns()

    const [row] = await sql`
      SELECT u.id, u.email, u.full_name, u.password_hash, u.role_id, u.company, u.status,
             u.created_at, u.last_login_at, r.name AS role_name
      FROM users u
      JOIN roles r ON r.id = u.role_id
      WHERE u.email = ${input.email}
    `
    if (!row) throw Object.assign(new Error("Invalid email or password"), { status: 401 })
    if (row.status === "suspended") throw Object.assign(new Error("Account is suspended"), { status: 403 })
    if (row.status === "deactivated") throw Object.assign(new Error("Account has been deactivated. Contact your administrator."), { status: 403 })

    const valid = await verifyPassword(input.password, row.password_hash)
    if (!valid) throw Object.assign(new Error("Invalid email or password"), { status: 401 })

    // Update last login
    await sql`UPDATE users SET last_login_at = NOW() WHERE id = ${row.id}`

    const token = await signJWT({
      sub: row.id,
      email: row.email,
      role: row.role_name,
      roleId: row.role_id,
    })

    return {
      token,
      user: {
        id: row.id,
        email: row.email,
        fullName: row.full_name || defaultNameFromEmail(row.email),
        roleId: row.role_id,
        roleName: row.role_name,
        company: row.company,
        status: row.status,
        createdAt: row.created_at,
        lastLoginAt: new Date().toISOString(),
      },
    }
  }

  async approveRegistration(requestId: string, reviewerId: string, assignedRole?: string): Promise<UserRecord> {
    if (!pgEnabled) throw new Error("PostgreSQL required")
    await this.ensureProfileColumns()

    const [req] = await sql`
      SELECT id, email, password_hash, requested_role, company, full_name, status
      FROM registration_requests WHERE id = ${requestId}
    `
    if (!req) throw Object.assign(new Error("Registration request not found"), { status: 404 })
    if (req.status !== "pending") throw Object.assign(new Error(`Request already ${req.status}`), { status: 400 })

    // Resolve final role — admin can override the requested role
    let roleId = req.requested_role
    let roleName = "developer"
    if (assignedRole) {
      const [r] = await sql`SELECT id, name FROM roles WHERE name = ${assignedRole}`
      if (r) { roleId = r.id; roleName = r.name }
    } else if (roleId) {
      const [r] = await sql`SELECT name FROM roles WHERE id = ${roleId}`
      if (r) roleName = r.name
    }

    // Create user from registration request
    const [user] = await sql`
      INSERT INTO users (email, full_name, password_hash, role_id, company, status, verified_email)
      VALUES (${req.email}, ${req.full_name || defaultNameFromEmail(req.email)}, ${req.password_hash}, ${roleId}, ${req.company}, 'active', TRUE)
      RETURNING id, email, full_name, role_id, company, status, created_at, last_login_at
    `

    // Update registration request
    await sql`
      UPDATE registration_requests
      SET status = 'approved', reviewed_by = ${reviewerId}, reviewed_at = NOW()
      WHERE id = ${requestId}
    `

    return {
      id: user.id,
      email: user.email,
      fullName: user.full_name || defaultNameFromEmail(user.email),
      roleId: user.role_id,
      roleName,
      company: user.company,
      status: user.status,
      createdAt: user.created_at,
      lastLoginAt: user.last_login_at,
    }
  }

  async rejectRegistration(requestId: string, reviewerId: string, reason?: string): Promise<void> {
    if (!pgEnabled) throw new Error("PostgreSQL required")

    const [req] = await sql`SELECT status FROM registration_requests WHERE id = ${requestId}`
    if (!req) throw Object.assign(new Error("Registration request not found"), { status: 404 })
    if (req.status !== "pending") throw Object.assign(new Error(`Request already ${req.status}`), { status: 400 })

    await sql`
      UPDATE registration_requests
      SET status = 'rejected', reviewed_by = ${reviewerId}, review_reason = ${reason || null}, reviewed_at = NOW()
      WHERE id = ${requestId}
    `
  }

  async listPendingRegistrations(): Promise<any[]> {
    if (!pgEnabled) return []
    return sql`
      SELECT rr.id, rr.email, rr.company, rr.status, rr.created_at,
             r.name AS requested_role_name
      FROM registration_requests rr
      LEFT JOIN roles r ON r.id = rr.requested_role
      WHERE rr.status = 'pending'
      ORDER BY rr.created_at ASC
    `
  }

  async listAllRegistrations(): Promise<any[]> {
    if (!pgEnabled) return []
    return sql`
      SELECT rr.id, rr.email, rr.company, rr.status, rr.created_at, rr.reviewed_at,
             rr.review_reason, r.name AS requested_role_name,
             reviewer.email AS reviewed_by_email
      FROM registration_requests rr
      LEFT JOIN roles r ON r.id = rr.requested_role
      LEFT JOIN users reviewer ON reviewer.id = rr.reviewed_by
      ORDER BY rr.created_at DESC
      LIMIT 100
    `
  }

  async listUsers(): Promise<UserRecord[]> {
    if (!pgEnabled) return []
    await this.ensureProfileColumns()
    const rows = await sql`
      SELECT u.id, u.email, u.full_name, u.role_id, r.name AS role_name, u.company,
             u.status, u.created_at, u.last_login_at
      FROM users u
      JOIN roles r ON r.id = u.role_id
      ORDER BY u.created_at DESC
    `
    return rows.map((r: any) => ({
      id: r.id, email: r.email, fullName: r.full_name || defaultNameFromEmail(r.email), roleId: r.role_id, roleName: r.role_name,
      company: r.company, status: r.status, createdAt: r.created_at, lastLoginAt: r.last_login_at,
    }))
  }

  async getUser(userId: string): Promise<UserRecord | null> {
    if (!pgEnabled) return null
    await this.ensureProfileColumns()
    const [row] = await sql`
      SELECT u.id, u.email, u.full_name, u.role_id, r.name AS role_name, u.company,
             u.status, u.created_at, u.last_login_at
      FROM users u
      JOIN roles r ON r.id = u.role_id
      WHERE u.id = ${userId}
    `
    if (!row) return null
    return {
      id: row.id, email: row.email, fullName: row.full_name || defaultNameFromEmail(row.email), roleId: row.role_id, roleName: row.role_name,
      company: row.company, status: row.status, createdAt: row.created_at, lastLoginAt: row.last_login_at,
    }
  }

  async updateProfile(userId: string, patch: { fullName?: string }): Promise<UserRecord> {
    if (!pgEnabled) throw new Error("PostgreSQL required")
    await this.ensureProfileColumns()

    const fullName = (patch.fullName || "").trim()
    if (!fullName) {
      throw Object.assign(new Error("fullName is required"), { status: 400 })
    }
    await sql`UPDATE users SET full_name = ${fullName.slice(0, 255)} WHERE id = ${userId}`

    const user = await this.getUser(userId)
    if (!user) throw Object.assign(new Error("User not found"), { status: 404 })
    return user
  }

  async updateUserRole(userId: string, roleName: string): Promise<void> {
    if (!pgEnabled) throw new Error("PostgreSQL required")
    const [role] = await sql`SELECT id FROM roles WHERE name = ${roleName}`
    if (!role) throw Object.assign(new Error(`Role "${roleName}" not found`), { status: 400 })
    await sql`UPDATE users SET role_id = ${role.id} WHERE id = ${userId}`
  }

  async updateUserStatus(userId: string, status: "active" | "suspended" | "deactivated"): Promise<void> {
    if (!pgEnabled) throw new Error("PostgreSQL required")
    const validStatuses = ["active", "suspended", "deactivated"]
    if (!validStatuses.includes(status)) throw Object.assign(new Error("Invalid status"), { status: 400 })
    await sql`UPDATE users SET status = ${status} WHERE id = ${userId}`
  }

  async listRoles(): Promise<any[]> {
    if (!pgEnabled) return []
    return sql`SELECT id, name, description, is_built_in, created_at FROM roles ORDER BY name`
  }

  /** Bootstrap: create initial admin user if no users exist */
  async ensureAdminExists(): Promise<void> {
    if (!pgEnabled) return
    await this.ensureProfileColumns()
    const [adminRole] = await sql`SELECT id FROM roles WHERE name = 'admin'`
    if (!adminRole) return

    const adminEmail = "admin@thirdwave.local"
    const [adminCount] = await sql`
      SELECT COUNT(*)::int AS c
      FROM users u
      JOIN roles r ON r.id = u.role_id
      WHERE r.name = 'admin'
    `
    if (adminCount.c > 0) return

    const [existing] = await sql`SELECT id FROM users WHERE email = ${adminEmail}`
    if (existing) {
      await sql`
        UPDATE users
        SET role_id = ${adminRole.id},
            status = 'active',
            verified_email = TRUE,
            full_name = COALESCE(full_name, ${defaultNameFromEmail(adminEmail)})
        WHERE id = ${existing.id}
      `
      console.log(`[users] Promoted existing account to admin: ${adminEmail}`)
      return
    }

    const adminPwd = await hashPassword("admin123")  // default — change immediately

    await sql`
      INSERT INTO users (email, full_name, password_hash, role_id, company, status, verified_email)
      VALUES (${adminEmail}, ${defaultNameFromEmail(adminEmail)}, ${adminPwd}, ${adminRole.id}, 'Thirdwave', 'active', TRUE)
      ON CONFLICT (email) DO NOTHING
    `
    console.log(`[users] Default admin created: ${adminEmail} / admin123 — CHANGE PASSWORD IMMEDIATELY`)
  }

  /**
   * Hard-delete a user and all their associated data (API keys, sessions).
   * Admins cannot delete their own account.
   */
  async deleteUser(targetUserId: string, requestingAdminId: string): Promise<void> {
    if (!pgEnabled) throw new Error("PostgreSQL required")
    if (targetUserId === requestingAdminId) {
      throw Object.assign(new Error("You cannot delete your own account"), { status: 400 })
    }
    const [user] = await sql`SELECT id, email FROM users WHERE id = ${targetUserId}`
    if (!user) throw Object.assign(new Error("User not found"), { status: 404 })

    // Delete cascade: api_keys, registration_requests (by email), then user
    await sql`DELETE FROM api_keys WHERE user_id = ${targetUserId}`
    await sql`DELETE FROM registration_requests WHERE email = ${user.email}`
    await sql`DELETE FROM users WHERE id = ${targetUserId}`
    console.log(`[users] Admin ${requestingAdminId} deleted user ${user.email} (${targetUserId})`)
  }
}

export const userService = new UserService()
