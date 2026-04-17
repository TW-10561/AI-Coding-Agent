# User Management, API Key Architecture & Inline Completion
**Date**: April 8, 2026 | **Status**: Design Phase

---

## 🔑 CRITICAL: Email-Based User Linking with Infra Team

**Important**: This system is designed for ALL future users (developers, analysts, managers, etc.), not just current developers.

### Email is the Primary Linking Mechanism

|  | Infra Team System | Thirdwave Agent | Result |
|--------|--------|--------|--------|
| **User Email** | alice@company.com | alice@company.com | ✅ SAME (must match) |
| **vLLM API Key** | vllm_key_alice_xyz | Stored in api_keys table | ✅ Linked to same email |
| **Usage Tracking** | Infra dashboard | vLLM gateway logs | ✅ Single source of truth per email |

**User Journey:**
1. Infra team issues vLLM API key to: alice@company.com
2. User registers in Thirdwave agent with email: alice@company.com ← MUST be same
3. User pastes vLLM key during onboarding
4. User runs agent → all requests use alice's vLLM key
5. Infra team dashboard shows: alice@company.com used X tokens

**Key Rule**: Users MUST register with the SAME email address they have in the infra team system, otherwise usage tracking won't link correctly.

---

## 1. USER REGISTRATION & ADMIN APPROVAL WORKFLOW

### 1.1 Registration Flow (Non-Blocking)

```
User Registers                  Admin Reviews & Approves           User Onboards
+-----+                         +-------+                          +-------+
| Web | Registration Form       | Admin | Approval Dashboard       | VS    |
| App | (email, pwd, role)      | Port  | (pending list)           | Code  |
+-----+                         +-------+                          | Ext   |
  |                               |                                  +-------+
  | POST /auth/register          |                                    |
  v                               |                                    |
+----------------------------------+  <-- [NEW TABLE: registration_requests]
| registration_requests            |
| ├─ id (UUID)                    |
| ├─ email (string, unique)       |
| ├─ password_hash (bcrypt)       |
| ├─ requested_role (enum: admin/dev/readonly/team_leader)
| ├─ company (string)             |
| ├─ status (pending/approved/rejected)
| ├─ token (email verification)   |
| ├─ reviewed_by (admin user_id)  |
| ├─ review_reason (text)         |
| ├─ created_at                   |
| └─ reviewed_at                  |
+----------------------------------+
  |
  | Admin Approves
  v
+----------------------------------+
| users (moved from pending)       |
| ├─ id (UUID, PK)                |
| ├─ email (string, unique)       |
| ├─ password_hash (bcrypt)       |
| ├─ role_id (FK → roles)         |
| ├─ company (string)             |
| ├─ status (active/suspended)    |
| ├─ created_at                   |
| ├─ verified_at                  |
| └─ last_login_at                |
+----------------------------------+
  |
  | User Sets Up API Key
  v
+----------------------------------+  <-- [NEW TABLE: api_keys]
| api_keys                        |
| ├─ id (UUID, PK)                |
| ├─ user_id (FK → users)         |
| ├─ key_hash (hashed)            |
| ├─ display_name (user input)    |
| ├─ status (active/revoked)      |
| ├─ created_at                   |
| ├─ last_used_at                 |
| ├─ expires_at (optional)        |
| └─ revoked_at (nullable)        |
+----------------------------------+
```

### 1.2 Registration Endpoint (Backend, Port 3100)

**POST /auth/register**
```typescript
Request:
{
  email: "alice@company.com",
  password: "securepassword123",
  requestedRole: "developer",              // Not auto-applied
  company: "Acme Corp"
}

Response (201 Created):
{
  requestId: "req_abc123",
  status: "pending",
  message: "Registration request submitted. Admin will review within 24 hours.",
  checkStatusUrl: "/auth/registration-status/req_abc123"
}
```

### 1.3 Admin Approval Endpoint (Port 3100)

**GET /admin/registrations** (admin only)
```typescript
Response:
{
  pending: [
    {
      requestId: "req_abc123",
      email: "alice@company.com",
      requestedRole: "developer",
      company: "Acme Corp",
      createdAt: "2026-04-08T10:20:00Z",
      submittedFrom: "VS Code Extension v1.2.3"
    }
  ],
  approved: [...],
  rejected: [...]
}
```

**POST /admin/registrations/approve** (admin only)
```typescript
Request:
{
  requestId: "req_abc123",
  approvedRole: "developer",    // Admin can promote/downgrade
  reason: "Approved - trusted developer" 
}

Response:
{
  userId: "user_xyz789",
  email: "alice@company.com",
  role: "developer",
  status: "active",
  onboardingLink: "/setup/user_xyz789/onboard",
  apiKeySetupRequired: true
}

// Backend then:
// 1. Move from registration_requests → users
// 2. Create initial role assignment in tool_access_policies
// 3. Send email: "Account approved! Set up your API key: [link]"
```

**POST /admin/registrations/reject** (admin only)
```typescript
Request:
{
  requestId: "req_abc123",
  reason: "Not authorized for this project"
}

// Deletes registration_requests row
// Sends rejection email to user
```

---

## 2. API KEY MANAGEMENT STRATEGY

### 2.1 Why Per-User API Keys?

**Current Problem** (Single API Key Issue):
```
Multiple Developers
├─ Alice: Uses same vLLM key → Local model routing unclear
├─ Bob:   Uses same vLLM key → Agent model selection ambiguous
└─ Carol: Uses same vLLM key → No per-user segregation

Result: Unclear which local model each developer is using, complex policy management
```

**Proposed Solution** (Per-User vLLM API Keys):
```
Multiple Developers
├─ Alice: vllm_key_alice_12345 → Local inference routed under alice@company.com
├─ Bob:   vllm_key_bob_67890   → Local inference routed under bob@company.com
└─ Carol: vllm_key_carol_13579 → Local inference routed under carol@company.com

Benefits (Managed by Inference Team):
✓ Per-developer local model routing
✓ Usage tracking by developer (already done by inference gateway)
✓ Revoke access without affecting others
✓ Cost attribution by person (already tracked by inference team)
✓ Audit trail (already maintained by local inference gateway)
```

### 2.2 API Key Input Strategy: "Registration + Account Page"

#### **When to Ask for API Key?**

| Timing | Location | Purpose | Example |
|--------|----------|---------|---------|
| **Registration** ❌ | Registration form | Too early; users don't have key yet |  Would delay onboarding |
| **After Approval** ✅ | Onboarding page | First API key setup | User lands on `/setup/onboard`, prompted to paste vLLM API key from local gateway |
| **Account Settings** ✅ | Plugin account page | View/rotate/revoke keys | User goes to "Settings > API Keys" to manage |
| **On First Use** ⚠️ | Agent startup | Fallback; not ideal | If no key found, prompt inline |

**RECOMMENDATION**: **Approval → Onboarding (Initial) + Account Settings (Ongoing)**

```
Registration Flow:
User fills out form
    ↓
Admin approves
    ↓
GET /setup/onboard?token=xyz
    ↓
[Onboarding Page]
"Paste your vLLM API key from local inference gateway"
[Input field] [Save & Continue]
    ↓
POST /auth/api-keys/initialize
    ↓
api_keys table: INSERT user's first key
    ↓
"Key saved! Your local inference is now configured."
    ↓
[Account Page in VS Code Extension / Web Plugin]
"Manage API Keys"
├─ Active Keys
│  └─ vLLM Local Gateway Key (created Apr 8, last used Apr 8)
│     [Rotate Key] [Revoke Key]
├─ Add New Key
└─ Key Rotation History (audit trail)
```

### 2.3 API Key Lifecycle Management

#### **Table: api_keys**
```sql
CREATE TABLE api_keys (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  key_hash VARCHAR(255) NOT NULL,  -- Never store plaintext
  key_preview VARCHAR(20),         -- Last 20 chars visible: "vllm_token_abc1234"
  display_name VARCHAR(100),       -- e.g., "My Local Inference Gateway Key"
  key_type ENUM('vllm', 'custom'),  -- vLLM for local inference gateway
  inference_gateway_url VARCHAR(255),  -- e.g., "http://localhost:8000"
  status ENUM('active', 'revoked', 'expired'),
  created_at TIMESTAMP DEFAULT NOW(),
  last_used_at TIMESTAMP,
  expires_at TIMESTAMP,           -- Optional: auto-expire in 90 days
  revoked_at TIMESTAMP,
  revoked_by UUID REFERENCES users(id),  -- Which admin/user revoked it
  rotation_salt VARCHAR(32)        -- For secure rotation without re-entry
);

CREATE INDEX idx_api_keys_user_id ON api_keys(user_id);
CREATE INDEX idx_api_keys_status ON api_keys(status);
```

#### **Table: api_key_audit_log**
```sql
CREATE TABLE api_key_audit_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id),
  api_key_id UUID REFERENCES api_keys(id),
  action ENUM('created', 'rotated', 'revoked', 'validated', 'expired'),
  ip_address INET,
  user_agent TEXT,
  gateway_response_status INT,     -- e.g., 200 (key valid), 401 (key invalid)
  timestamp TIMESTAMP DEFAULT NOW()
  -- Note: Model usage tracking handled by local inference gateway
);

CREATE INDEX idx_audit_user_id ON api_key_audit_log(user_id);
CREATE INDEX idx_audit_timestamp ON api_key_audit_log(timestamp);
```

### 2.4 API Key Endpoints

#### **Create Initial API Key (During Onboarding)**
```typescript
POST /auth/api-keys/initialize
Headers: { "Authorization": "Bearer onboarding_token_xyz" }
Body:
{
  apiKey: "vllm_token_xxxxxxxxxxxx",  // vLLM API key from local inference gateway
  displayName: "My Local Inference Gateway",
  gatewayUrl: "http://localhost:8000"  // Optional: override default
}

Response (201):
{
  keyId: "key_abc123",
  preview: "vllm_token_...xxxx",
  createdAt: "2026-04-08T10:35:00Z",
  status: "active",
  message: "vLLM API key configured. Your local inference is ready."
}

// Backend:
// 1. Hash the API key (bcrypt with salt from api_keys.rotation_salt)
// 2. Store hash in api_keys table
// 3. Log in api_key_audit_log: action='created'
// 4. Return preview only (never return plaintext again)
```

#### **List User's API Keys**
```typescript
GET /auth/api-keys
Headers: { "Authorization": "Bearer user_token" }

Response (200):
{
  keys: [
    {
      id: "key_abc123",
      preview: "vllm_token_...xyz789",
      displayName: "My Local Inference Gateway",
      status: "active",
      createdAt: "2026-04-08T10:35:00Z",
      lastUsedAt: "2026-04-08T14:20:00Z"
    },
    {
      id: "key_def456",
      preview: "vllm_token_...cccccc",
      displayName: "Old Gateway Key",
      status: "revoked",
      revokedAt: "2026-04-08T13:00:00Z"
    }
  ]
}
```

#### **Rotate API Key (New Key Without Re-entry)**
```typescript
POST /auth/api-keys/rotate
Headers: { "Authorization": "Bearer user_token" }
Body:
{
  keyId: "key_abc123",
  newApiKey: "vllm_token_..."  // User pastes new key from vLLM gateway console
}

Response (200):
{
  oldKeyId: "key_abc123",
  newKeyId: "key_ghi789",
  oldKeyRevoked: true,
  newKeyPreview: "vllm_token_...new",
  revokedAt: "2026-04-08T14:30:00Z"
}

// Backend:
// 1. Mark old key as revoked (don't delete: audit trail)
// 2. Create new key entry
// 3. Log: action='rotated' in api_key_audit_log
```

#### **Revoke API Key**
```typescript
DELETE /auth/api-keys/{keyId}
Headers: { "Authorization": "Bearer user_token" }

Response (204 No Content)

// Backend:
// 1. Set status='revoked', revoked_at=NOW()
// 2. Log in api_key_audit_log: action='revoked'
// 3. Any requests with this key immediately fail with 401 Unauthorized
```

#### **Track API Key Usage**
```typescript
GET /auth/api-keys/{keyId}/usage
Headers: { "Authorization": "Bearer user_token" }

Response (200):
{
  keyId: "key_abc123",
  period: "last_7_days",
  totalValidations: 347,
  lastUsedAt: "2026-04-08T14:32:00Z",
  inferenceGateway: "http://localhost:8000",
  note: "Detailed usage analytics (tokens, models) are tracked by the local inference gateway"
}

// Usage Tracking:
// Model usage, token counts, and detailed analytics are maintained by the
// local vLLM inference gateway. This endpoint validates the key is still active.
```

### 2.5 Integration: Agent Starts → Checks for API Key

**VS Code Extension Agent Startup:**
```typescript
// platform/vscode-extension/src/agent.ts

async function initializeAgent() {
  // 1. Check if user is authenticated (Bearer token in session storage)
  const userToken = await vscode.SecureStorage.get('auth_token');
  if (!userToken) {
    // Redirect to login page
    vscode.commands.executeCommand('copilot.openSettings');
    return;
  }

  // 2. Check for valid API key
  const apiKey = await vscode.SecureStorage.get('api_key_hash');
  if (!apiKey) {
    vscode.window.showInformationMessage(
      'API key not configured. Open Account Settings to set it up.',
      'Go to Settings'
    ).then(choice => {
      if (choice === 'Go to Settings') {
        openAccountSettingsPage('/api-keys');
      }
    });
    return;
  }

  // 3. Validate key is still active (call GET /auth/api-keys/{keyId})
  const keyStatus = await fetch('/auth/api-keys/validate', {
    headers: { 'Authorization': `Bearer ${userToken}` }
  });

  if (keyStatus.status === 401) {
    vscode.window.showErrorMessage(
      'Your API key has been revoked or expired. Please set a new key.'
    );
    openAccountSettingsPage('/api-keys');
    return;
  }

  // 4. Initialize agent with valid session
  agentReady = true;
}
```

---

## 3. INLINE CODE COMPLETION & DIFF FEATURE

### 3.1 Current Limitation

Current agent flow:
```
User Request "fix this bug"
    ↓
Agent Analyzes Code
    ↓
Agent Generates Solution
    ↓
[PAUSE] Agent Returns Full Code Block
    ↓
User Reviews (manual process)
    ↓
User Applies Code
```

**Problem**: No inline preview; user can't see changes before applying.

### 3.2 Proposed: Inline Completion with Diff

```
User Request "fix this bug" + cursor at line 42
    ↓
[Agent Analyzes Context (5 lines before + after)]
    ↓
Agent Generates Inline Suggestion
    ↓
[INLINE PREVIEW at cursor]
┌─────────────────────────────────────────┐
│ OLD CODE:                   NEW CODE:    │
│ 42 | function sum(arr) {     42 | function sum(arr) {
│ 43 |   let total = 0;       │ 43 |   let total = 0;
│ 44 |   for (i = 0; ...) {  │ 44 |   for (let i = 0; arr.length; i++) {
│    │                        │ 45 |     total += arr[i];
│ 45 |     total += arr[i];   │ 46 |   }
│ 46 |   }                    │ 47 |   return total;
│ 47 |   return total;        │ 48 | }
│ 48 | }                      │
└────────────────────────────────────────┘
[Accept]  [Reject]  [Edit]  [See Full Diff]
    ↓
User: [Accept]
    ↓
Lines 42-48 replaced in-place
```

### 3.3 Implementation Architecture

#### **Backend Changes (Port 3100)**

```typescript
// New endpoint for inline completions
POST /agent/complete-inline
Headers: { "Authorization": "Bearer user_token" }
Body:
{
  filePath: "/src/utils.ts",
  cursorLine: 42,
  cursorColumn: 5,
  contextBefore: 3,      // Lines before cursor
  contextAfter: 3,       // Lines after cursor
  selectedText: "function sum(arr) { ... }",  // Current function
  userRequest: "fix the missing let in for loop"
}

Response (200):
{
  suggestedCode: "function sum(arr) {\n  let total = 0;\n  for (let i = 0; i < arr.length; i++) { ...",
  lineStart: 42,          // Where the suggestion starts
  lineEnd: 48,            // Where it ends
  confidence: 0.92,       // How confident the agent is (0–1)
  replacementType: "function_body",  // Context type
  appliedChanges: [
    {
      type: "line_modification",
      oldLine: "  for (i = 0; ...) {",
      newLine: "  for (let i = 0; i < arr.length; i++) {",
      lineNumber: 44,
      severity: "fix"  // error/fix/style/suggestion
    }
  ]
}
```

#### **Frontend Changes (VS Code Extension)**

```typescript
// platform/vscode-extension/src/inlineCompletion.ts

export class InlineCompletionProvider implements vscode.InlineCompletionItemProvider {
  
  async provideInlineCompletionItems(
    document: vscode.TextDocument,
    position: vscode.Position,
    context: vscode.InlineCompletionContext,
    token: vscode.CancellationToken
  ): Promise<vscode.InlineCompletionItem[]> {
    
    // Call agent inline completion endpoint
    const response = await fetch('/agent/complete-inline', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${userToken}` },
      body: JSON.stringify({
        filePath: document.fileName,
        cursorLine: position.line,
        cursorColumn: position.character,
        contextBefore: 3,
        contextAfter: 3,
        selectedText: document.getText(selectionRange),
        userRequest: userInput
      })
    });

    const {suggestedCode, lineStart, lineEnd, appliedChanges} = await response.json();

    // Create inline completion item with diff visualization
    const completionItem = new vscode.InlineCompletionItem(suggestedCode);
    completionItem.range = new vscode.Range(
      new vscode.Position(lineStart, 0),
      new vscode.Position(lineEnd, 0)
    );

    // Show diff panel alongside
    showDiffPanel(
      before: original_code_lines[lineStart:lineEnd],
      after: suggestedCode,
      changes: appliedChanges
    );

    return [completionItem];
  }
}

// Listen for user acceptance
completionItem.command = new vscode.Command('agent.acceptCompletion', 'agent.acceptCompletion', {
  document,
  suggestedCode,
  lineStart,
  lineEnd,
  changes: appliedChanges
});
```

### 3.4 Diff Visualization (Side-by-Side)

VS Code Diff Panel Integration:
```
[OLD] utils.ts                      [NEW] utils.ts (Inline Suggestion)
─────────────────────────────────────────────────────────────────
 40 │ const MAX_SIZE = 100;        │ 40 │ const MAX_SIZE = 100;
 41 │ export function sum(arr) {   │ 41 │ export function sum(arr) {
 42 │   let total = 0;             │ 42 │   let total = 0;
 43 │ - for (i = 0; i < arr.length)│ 43 │ + for (let i = 0; i < arr.length)
 44 │   - i++) {                   │ 44 │   + i++) {
 45 │   total += arr[i];           │ 45 │   total += arr[i];
 46 │ }                            │ 46 │ }
 47 │ return total;                │ 47 │ return total;
─────────────────────────────────────────────────────────────────

Legend:
[+] Added line
[-] Removed line
[~] Modified line
[=] Unchanged
```

### 3.5 Configuration in Extension Settings

```json
// .vscode/settings.json
{
  "thirdwave.agent": {
    "inlineCompletion": {
      "enabled": true,
      "autoTrigger": "onUserInput",      // or "onCommand", "onSelection"
      "contextLines": {
        "before": 3,
        "after": 3
      },
      "minConfidence": 0.80,            // Only show suggestions above 80%
      "showDiff": true,                 // Always show diff panel
      "diffLayout": "sideBySide",       // or "inline", "unified"
      "keyBindings": {
        "accept": "Tab",                // or "Enter"
        "reject": "Escape",
        "viewFullDiff": "Ctrl+Shift+D"
      }
    }
  }
}
```

---

## 4. UPDATED MIGRATION PLAN

### 4.1 New Timeline (8 Weeks Instead of 6)

| Phase | Week | Focus | Hours | Changes |
|-------|------|-------|-------|---------|
| Phase 1 | W1 (Apr 9–15) | PostgreSQL provisioning, schema v1 | **30h** | **+5h**: registration_requests + api_keys tables |
| Phase 2 | W2 (Apr 16–22) | Data migration, backup setup | 30h | (no change) |
| Phase 3 | W3 (Apr 23–29) | RBACEngineV2 + user management API | **35h** | **+5h**: Add user auth endpoints (/auth/register, /auth/login, /auth/validate) |
| Phase 4 | W4 (Apr 30–May 6) | REST API + API key management | **35h** | **+10h**: Full API key lifecycle (/api-keys endpoints, key rotation, audit logging) |
| Phase 5 | W5 (May 7–13) | Approval UI + notifications | 20h | (no change) |
| Phase 6 | W6 (May 14–20) | VS Code Extension: Auth UI + Account Settings | **40h** | **+15h**: Login/register UI, account page, API key management panel |
| **NEW** | **W7–8** | **Inline Completion + Diff Feature** | **30h** | **Entirely new**: Inline completion provider, diff visualization, VS Code inline API |
| | | | | |
| **TOTAL** | 8 weeks | Full system with user auth + API keys + inline completion | **220h** | **+35h** from original 185h plan |

### 4.2 Detailed New Phases

#### **Phase 1 (Week 1): PostgreSQL + User Management Schema**

**NEW Tables Added**:
```sql
-- Table 1: registration_requests (new dependency)
CREATE TABLE registration_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email VARCHAR(255) NOT NULL UNIQUE,
  password_hash VARCHAR(255) NOT NULL,
  requested_role UUID REFERENCES roles(id),
  company VARCHAR(255),
  status ENUM('pending', 'approved', 'rejected') DEFAULT 'pending',
  verification_token VARCHAR(255),
  reviewed_by UUID REFERENCES users(id),
  review_reason TEXT,
  created_at TIMESTAMP DEFAULT NOW(),
  reviewed_at TIMESTAMP
);

-- Table 2: api_keys (new)
CREATE TABLE api_keys (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  key_hash VARCHAR(255) NOT NULL,
  key_preview VARCHAR(20),
  display_name VARCHAR(100),
  key_type ENUM('claude', 'openai', 'custom') DEFAULT 'claude',
  status ENUM('active', 'revoked', 'expired') DEFAULT 'active',
  created_at TIMESTAMP DEFAULT NOW(),
  last_used_at TIMESTAMP,
  expires_at TIMESTAMP,
  revoked_at TIMESTAMP,
  revoked_by UUID REFERENCES users(id)
);

-- Table 3: api_key_audit_log (new)
CREATE TABLE api_key_audit_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id),
  api_key_id UUID REFERENCES api_keys(id),
  action ENUM('created', 'rotated', 'revoked', 'used', 'expired'),
  ip_address INET,
  user_agent TEXT,
  model_used VARCHAR(100),
  tokens_used INT,
  timestamp TIMESTAMP DEFAULT NOW()
);

-- Updated users table (add new columns)
ALTER TABLE users ADD COLUMN registration_status ENUM('active', 'suspended') DEFAULT 'active';
ALTER TABLE users ADD COLUMN verified_email BOOLEAN DEFAULT FALSE;

CREATE INDEX idx_registration_requests_status ON registration_requests(status);
CREATE INDEX idx_api_keys_user_id ON api_keys(user_id);
CREATE INDEX idx_api_key_audit_user_id ON api_key_audit_log(user_id);
```

**Effort**: 25h → **30h** (+5h for new user management schema)

#### **Phase 3 (Week 3): User Management APIs**

**NEW Endpoints**:
```
POST   /auth/register                          -- User registration
GET    /auth/registration-status/{requestId}  -- Check approval status
GET    /admin/registrations                    -- List pending (admin only)
POST   /admin/registrations/approve            -- Admin approval
POST   /admin/registrations/reject             -- Admin rejection
POST   /auth/login                             -- User login
GET    /auth/validate                          -- Token validation
```

**Effort**: 30h → **35h** (+5h for user auth endpoints)

#### **Phase 4 (Week 4): API Key Management APIs** (EXPANDED)

**NEW Endpoints**:
```
POST   /auth/api-keys/initialize               -- First key setup (onboarding)
GET    /auth/api-keys                          -- List user's keys
POST   /auth/api-keys/rotate                   -- Rotate key
DELETE /auth/api-keys/{keyId}                  -- Revoke key
GET    /auth/api-keys/{keyId}/usage            -- Usage analytics
POST   /agent/complete-inline                  -- Inline completion (new!)
```

**Effort**: 25h → **35h** (+10h for complete API key lifecycle + inline completion endpoint)

#### **Phase 6 (NEW): VS Code Extension UI** (EXPANDED)

**NEW Components**:
```
src/
├─ auth/
│  ├─ LoginView.tsx           -- Login form
│  ├─ RegisterView.tsx        -- Registration form
│  └─ EmailVerificationView.tsx -- Check approval status
├─ account/
│  ├─ AccountSettingsPage.tsx
│  ├─ ApiKeysPanel.tsx        -- List/rotate/revoke keys
│  └─ UsageVisualization.tsx  -- API key usage charts
├─ inlineCompletion/
│  ├─ InlineCompletionProvider.ts
│  ├─ DiffVisualization.tsx
│  └─ CompleteCommand.ts
└─ components/
   └─ AuthGuard.tsx           -- Require login before agent
```

**Effort**: 25h → **40h** (+15h for auth UI + account page + inline completion UI)

#### **PHASE 7–8 (NEW): Inline Completion Feature** (ENTIRELY NEW)

**Week 7–8 (30h)**:
- Backend completion engine (context understanding, model integration)
- VS Code inline API integration (vscode.InlineCompletionItemProvider)
- Diff visualization (side-by-side, unified, inline formats)
- Configuration UI (settings panel for completion behavior)
- Testing & refinement

---

## 5. SECURITY CONSIDERATIONS

### 5.1 Password Security
```typescript
// Phase 3: Use bcrypt with 12 rounds
import bcrypt from 'bcrypt';

async function hashPassword(plaintext: string): Promise<string> {
  return bcrypt.hash(plaintext, 12);  // 12 rounds = ~100ms per hash
}

async function verifyPassword(plaintext: string, hash: string): Promise<boolean> {
  return bcrypt.compare(plaintext, hash);  // Timing-safe
}
```

### 5.2 API Key Security

**NEVER Store Plaintext Keys**:
```typescript
// ❌ WRONG
const key = "sk-..."; // Stored in database
await db.query('INSERT INTO api_keys VALUES (?)', [key]);

// ✅ CORRECT
const keyHash = await hash(key);  // Hash with rotating salt
const keyPreview = key.slice(-20); // Last 20 chars only for display
await db.query(
  'INSERT INTO api_keys (key_hash, key_preview) VALUES (?, ?)',
  [keyHash, keyPreview]
);
// User never sees plaintext again; only shown at creation time
```

**Key Rotation Without Re-entry**:
- Store rotation_salt in api_keys row
- User generates new key in Claude console
- Call POST /api-keys/rotate with new key
- Backend hashes with same salt, compares; if new key valid, marks old as revoked
- User doesn't need to re-enter old key

### 5.3 Registration Approval Flow

**Prevents Unauthorized Onboarding**:
- User submits registration → goes to pending state
- Admin manually approves in dashboard
- Only after approval → email sent with onboarding link
- Onboarding token expires in 24 hours
- User must set password + API key before full access

**Audit Trail**:
```sql
SELECT reviewed_by, status, reviewed_at, review_reason
FROM registration_requests
WHERE email = 'alice@company.com';
```

---

## 6. INTEGRATION WITH EXISTING RBAC

### 6.1 User-to-Role Mapping (Still Database-Backed)

```sql
-- Phase 1: users table gets role assignment
ALTER TABLE users ADD COLUMN role_id UUID REFERENCES roles(id) NOT NULL;

-- Phase 3: During admin approval, assign role from registration_requests.requested_role
INSERT INTO users (email, password_hash, role_id, company, status)
SELECT email, password_hash, requested_role, company, 'active'
FROM registration_requests
WHERE id = 'req_abc123' AND status = 'approved';

-- All existing RBAC logic still applies:
-- tool_access_policies: (tool_name, role_id) → decision
-- path_access_rules: (path_pattern, role_id) → permissions
```

### 6.2 HITL Approval Requests Still Use API Key User Context

```sql
-- When user submits a tool request with their API key:
INSERT INTO approval_requests (
  session_id,
  tool_name,
  requested_by,        -- ← Look up from api_key → user_id
  status,
  risk_score,
  timestamp
) VALUES (
  'sess_123',
  'bash',
  'user_alice_id',      -- ← Traced via api_key_id → user_id FK
  'pending',
  85,
  NOW()
);

-- Audit trail now includes WHO requested it (API key tied to user)
SELECT * FROM audit_log WHERE user_id = 'user_alice_id';
```

---

## 7. IMPLEMENTATION CHECKLIST

### Phase 1 (PostgreSQL + Schema)
- [ ] PostgreSQL instance provisioned (AWS RDS or Docker)
- [ ] 11 base tables created (from COMPLETE_RBAC_MATRIX.md)
- [ ] **3 NEW tables created**: registration_requests, api_keys, api_key_audit_log
- [ ] Indexes created (all tables)
- [ ] Default roles seeded (admin, developer, readonly, team_leader)
- [ ] Backup configured (daily snapshots, WAL archiving)
- [ ] PgBouncer connection pooling set up

### Phase 3 (User Management APIs)
- [ ] POST /auth/register endpoint implemented
- [ ] Admin approval workflow (GET /admin/registrations, POST /admin/registrations/approve)
- [ ] Email verification tokens (24h expiry)
- [ ] Password hashing (bcrypt 12 rounds)
- [ ] Token-based authentication (JWT or session cookies)
- [ ] Role assignment during approval

### Phase 4 (API Key Management)
- [ ] POST /auth/api-keys/initialize endpoint
- [ ] GET /auth/api-keys and DELETE endpoints
- [ ] POST /auth/api-keys/rotate (key rotation)
- [ ] API key validation middleware (every request checks key status)
- [ ] api_key_audit_log recording (action, timestamp, model used)
- [ ] **POST /agent/complete-inline endpoint** (inline completion backend)

### Phase 5 (Approval UI)
- [ ] Admin dashboard for pending registrations
- [ ] Slack notifications for approval requests
- [ ] Web UI for approving/denying

### Phase 6 (VS Code Extension UI)
- [ ] Login/register form
- [ ] Account settings page
- [ ] API keys management panel (list, rotate, revoke)
- [ ] Inline completion UI component
- [ ] Diff visualization (side-by-side panel)

### Phase 7–8 (Inline Completion)
- [ ] Inline completion provider (vscode.InlineCompletionItemProvider)
- [ ] Context extraction (file, cursor position, surrounding code)
- [ ] Model integration (call agent's /complete-inline endpoint)
- [ ] Diff rendering (highlight changes)
- [ ] Keyboard bindings (Tab=accept, Esc=reject)
- [ ] User testing & refinement

---

## 8. ANSWERS TO YOUR THREE QUESTIONS

### Q1: "Can we have user registration with email + password + role selection, verified by admin?"

**Answer**: ✅ **100% Possible**

- Registration form collects: email, password, role request, company
- Goes to `registration_requests` table with status='pending'
- Admin reviews in dashboard (port 3100)
- Admin can approve/reject and reassign role
- Upon approval: user moves to `users` table, gets activation email
- Changes: +3 tables, +5 API endpoints, +15h effort in phases 1, 3, 4

### Q2: "I want inline completion with diff between old and new code"

**Answer**: ✅ **Achievable, 2-Week Addition (Phases 7–8)**

- Backend: New `/agent/complete-inline` endpoint (Phase 4: 5h)
- Frontend: VS Code `InlineCompletionItemProvider` (Phase 6: +5h for skeleton)
- Inline Completion Feature: 30h dedicated phase (W7–8)
- Diff visualization: Side-by-side panel with inline highlights
- Configuration: Keyboard shortcuts, trigger behavior, confidence thresholds

### Q3: "Where should users input their API key? During registration or account page?"

**Answer**: ✅ **Both for Optimal UX** (Onboarding → Account Settings)

- **During Registration**: ❌ Too early; users don't have vLLM key yet
- **After Approval (Onboarding)**: ✅ First API key setup (3-minute flow)
  - User prompted: "Paste your vLLM API key (provided by infra team)"
  - Key linked to their email address (same as infra team account)
- **Account Settings**: ✅ View, rotate, revoke keys anytime
- **Key Benefit**: Each user has personal vLLM key
- **Email Linking**: User registers with alice@company.com → infra team alice@company.com → same usage tracking
- **Usage Tracking**: Managed by local inference team (cost attribution, audit trail, model tracking already done)
- **Rotation**: No need to re-enter old key; just paste new one, backend validates and switches

---

## 10. CLARIFICATION: Usage Tracking & Cost Attribution (Per-User by Email)

**Per-User vLLM Keys are Routed by Local Inference Gateway**

The infrastructure team's local inference gateway (e.g., vLLM server at `localhost:8000`) already handles:
- ✅ **Usage Tracking per User (by email)**: Each API key validates against local gateway, models used by person tracked
- ✅ **Cost Attribution (by email)**: Inference team dashboard shows tokens/requests per user email
- ✅ **Revoke Access**: Invalid key = gateway rejects immediately
- ✅ **Audit Trail**: Inference gateway logs all requests with user email + timestamp
- ✅ **Email Linking**: alice@company.com (infra) = alice@company.com (Thirdwave) = unified tracking

**Thirdwave's Role** (Backend Port 3100):
- Store vLLM API keys securely (hashed, never plaintext)
- Map users → keys (who is authorized to use which key)
- Validate key before passing to agent
- Log key lifecycle (created, rotated, revoked) in audit_log table
- Provide account settings UI for key management (rotate, revoke)

**Flow**:
```
Developer (VS Code Extension)
    ↓
Submits tool request + local vLLM key
    ↓
Thirdwave Backend validates key exists & is active
    ↓
Agent executes tool → calls local inference gateway
    ↓
vLLM Gateway (Inference Team)
├─ Authenticates key
├─ Routes to appropriate local model
├─ Tracks tokens/requests per key
├─ Returns result
└─ Logs to gateway's analytics dashboard
```

**No Double-Accounting**: Inference team tracks detailed usage; Thirdwave only tracks key lifecycle & validation.

---

## 9. SUMMARY: What Changes?

| Aspect | Current | Updated |
|--------|---------|---------|
| **Timeline** | 6 weeks | **8 weeks** (+2 weeks for inline completion) |
| **Total Effort** | 185h | **220h** (+35h) |
| **Tables** | 11 | **14** (+3: registration_requests, api_keys, api_key_audit_log) |
| **Auth** | None | ✅ Registration + admin approval workflow |
| **API Keys** | Shared (single key) | ✅ Per-user vLLM keys (inference team tracks usage) |
| **Usage Tracking** | Manual | ✅ Automatic (handled by local inference gateway) |
| **Inline Completion** | No | ✅ New (W7–8) |
| **User Management** | N/A | ✅ 5 new endpoints + UI |
| **Roles** | 4 (static) | 4 (dynamic in DB) + assignment in registration |

**Critical Path**: Phase 1 (PostgreSQL) → Phase 3 (User auth) → Phase 4 (API keys) → Phase 6 (Extension UI) → Phase 7–8 (Inline completion)

**No blockers** between phases; can run Phase 5 (Approval UI) in parallel with Phase 6.

---

**Next Steps**:
1. Confirm timeline (6→8 weeks acceptable?)
2. assign DevOps for Phase 1 (PostgreSQL provisioning)
3. Assign 2 backend engineers for Phases 3–4 (user auth + API key APIs)
4. Assign 1 frontend engineer for Phase 6 (VS Code Extension UI)
5. Begin Phase 1 planning (April 9, 2026)
