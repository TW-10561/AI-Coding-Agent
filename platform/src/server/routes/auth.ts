// ---------------------------------------------------------------------------
// Auth routes — /auth (no auth middleware required)
// ---------------------------------------------------------------------------

import { Hono } from "hono"
import { userService, verifyJWT } from "../../services/user-service"
import { apiKeyService } from "../../services/api-key-service"

export function authRoutes() {
  return new Hono()

    // POST /auth/register — create a pending registration request
    .post("/register", async (c) => {
      const body = await c.req.json()
      const { email, password, fullName } = body
      if (!email || !password) {
        return c.json({ error: "email and password are required" }, 400)
      }
      try {
        const result = await userService.register({ email, password, fullName })
        return c.json(result, 201)
      } catch (err: any) {
        const status = err.status || 400
        return c.json({ error: err.message }, status)
      }
    })

    // POST /auth/login — authenticate and return JWT
    .post("/login", async (c) => {
      const body = await c.req.json()
      const { email, password } = body
      if (!email || !password) {
        return c.json({ error: "email and password are required" }, 400)
      }
      try {
        const result = await userService.login({ email, password })
        // Include API key status and admin verification so the extension knows if onboarding is needed
        const keys = await apiKeyService.listByUser(result.user.id)
        const hasApiKey = keys.length > 0
        const keyVerification = await apiKeyService.getKeyVerificationStatus(result.user.id)
        return c.json({ ...result, hasApiKey, adminVerified: keyVerification.adminVerified })
      } catch (err: any) {
        const status = err.status || 401
        return c.json({ error: err.message }, status)
      }
    })

    // GET /auth/me — return current user from JWT
    .get("/me", async (c) => {
      const bearer = c.req.header("authorization")?.replace(/^Bearer\s+/i, "")
      if (!bearer) {
        return c.json({ error: "No token provided" }, 401)
      }
      try {
        const payload = await verifyJWT(bearer)
        if (!payload) return c.json({ error: "Invalid or expired token" }, 401)
        const user = await userService.getUser(payload.sub)
        if (!user) return c.json({ error: "User not found" }, 404)
        // Include API key status and admin verification
        const keys = await apiKeyService.listByUser(payload.sub)
        const hasApiKey = keys.length > 0
        const apiKeyPreview = keys.length > 0 ? keys[0].keyPreview : null
        const keyVerification = await apiKeyService.getKeyVerificationStatus(payload.sub)
        return c.json({ user, token: payload, hasApiKey, apiKeyPreview, adminVerified: keyVerification.adminVerified })
      } catch (err: any) {
        return c.json({ error: "Invalid or expired token" }, 401)
      }
    })

    // PATCH /auth/profile — update current user's profile
    .patch("/profile", async (c) => {
      const bearer = c.req.header("authorization")?.replace(/^Bearer\s+/i, "")
      if (!bearer) return c.json({ error: "No token provided" }, 401)

      const payload = await verifyJWT(bearer)
      if (!payload) return c.json({ error: "Invalid or expired token" }, 401)

      const body = await c.req.json().catch(() => ({})) as { fullName?: string }
      try {
        const user = await userService.updateProfile(payload.sub, { fullName: body.fullName })
        return c.json({ user })
      } catch (err: any) {
        const status = err.status || 400
        return c.json({ error: err.message }, status)
      }
    })

    // ── User API Key Management ────────────────────────────────────

    // POST /auth/api-keys — save a vLLM API key
    .post("/api-keys", async (c) => {
      const bearer = c.req.header("authorization")?.replace(/^Bearer\s+/i, "")
      if (!bearer) return c.json({ error: "No token provided" }, 401)
      const payload = await verifyJWT(bearer)
      if (!payload) return c.json({ error: "Invalid or expired token" }, 401)

      const body = await c.req.json().catch(() => ({})) as {
        apiKey?: string
        displayName?: string
        gatewayUrl?: string
        skipVerification?: boolean
      }
      if (!body.apiKey || body.apiKey.length < 10) {
        return c.json({ error: "A valid API key is required" }, 400)
      }
      try {
        const result = await apiKeyService.create({
          userId: payload.sub,
          apiKey: body.apiKey,
          displayName: body.displayName,
          inferenceGatewayUrl: body.gatewayUrl,
          skipGatewayVerification: body.skipVerification,
        })
        return c.json({
          key: {
            id: result.id,
            keyPreview: result.keyPreview,
            displayName: result.displayName,
            status: result.status,
            adminVerified: result.adminVerified,
            createdAt: result.createdAt,
          },
          gatewayVerification: result.gatewayVerification,
        }, 201)
      } catch (err: any) {
        return c.json({ error: err.message }, err.status || 400)
      }
    })

    // GET /auth/api-keys — list current user's API keys
    .get("/api-keys", async (c) => {
      const bearer = c.req.header("authorization")?.replace(/^Bearer\s+/i, "")
      if (!bearer) return c.json({ error: "No token provided" }, 401)
      const payload = await verifyJWT(bearer)
      if (!payload) return c.json({ error: "Invalid or expired token" }, 401)

      const keys = await apiKeyService.listByUser(payload.sub, true)
      return c.json({ keys })
    })

    // GET /auth/api-keys/active — get the full decrypted active key (owner only)
    .get("/api-keys/active", async (c) => {
      const bearer = c.req.header("authorization")?.replace(/^Bearer\s+/i, "")
      if (!bearer) return c.json({ error: "No token provided" }, 401)
      const payload = await verifyJWT(bearer)
      if (!payload) return c.json({ error: "Invalid or expired token" }, 401)

      const fullKey = await apiKeyService.getActiveVllmKey(payload.sub)
      if (!fullKey) return c.json({ error: "No active API key" }, 404)
      return c.json({ key: fullKey })
    })

    // POST /auth/api-keys/verify — verify a key against the gateway without saving
    .post("/api-keys/verify", async (c) => {
      const bearer = c.req.header("authorization")?.replace(/^Bearer\s+/i, "")
      if (!bearer) return c.json({ error: "No token provided" }, 401)
      const payload = await verifyJWT(bearer)
      if (!payload) return c.json({ error: "Invalid or expired token" }, 401)

      const body = await c.req.json().catch(() => ({})) as { apiKey?: string; gatewayUrl?: string }
      if (!body.apiKey) return c.json({ error: "apiKey is required" }, 400)

      const result = await apiKeyService.verifyGatewayKey(body.apiKey, body.gatewayUrl)
      return c.json(result)
    })

    // DELETE /auth/api-keys/:id — revoke one of user's own keys
    .delete("/api-keys/:id", async (c) => {
      const bearer = c.req.header("authorization")?.replace(/^Bearer\s+/i, "")
      if (!bearer) return c.json({ error: "No token provided" }, 401)
      const payload = await verifyJWT(bearer)
      if (!payload) return c.json({ error: "Invalid or expired token" }, 401)

      try {
        await apiKeyService.revoke(payload.sub, c.req.param("id"))
        return c.json({ ok: true })
      } catch (err: any) {
        return c.json({ error: err.message }, err.status || 400)
      }
    })
}
