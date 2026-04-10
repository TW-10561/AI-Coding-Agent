# Thirdwave RBAC Migration Plan
**Current Date:** April 8, 2026  
**Target Completion:** May 20, 2026 (6 weeks)  
**Effort:** 155 hours total team effort

---

## Executive Summary

Thirdwave currently has **fragmented database architecture** with **no HITL approval workflow** and **hardcoded, inflexible RBAC**. This plan consolidates into **single PostgreSQL** with **dynamic role management**, **approval workflow**, and **audit compliance** for secure multi-user team deployment.

---

## PART 1: CURRENT STATE & PROBLEMS

### Current Architecture (Fragmented)

```
┌─────────────────────────────────────────────────┐
│         Thirdwave Platform (Port 3100)          │
├─────────────────────────────────────────────────┤
│                                                 │
│  OpenCode Client (Port 4096)                    │
│  + Tool Executor                                │
│  + Hardcoded RBAC (4 static roles)              │
│  + HITL Defense Layers (6 gates)                │
│                                                 │
└────────┬──────────────────────┬─────────────────┘
         │                      │
    ┌────▼────┐          ┌──────▼──────┐
    │ OpenCode │          │  Platform   │
    │ State DB │          │ Workspaces  │
    │ (SQLite) │          │ DB (SQLite) │
    └──────────┘          └─────────────┘
         │
    ┌────▼──────────┐
    │ Audit Log     │
    │ (JSONL files) │
    └───────────────┘
```

### Problems Identified

| # | Problem | Impact | Severity |
|---|---------|--------|----------|
| 1 | **No HITL Approval Workflow** | Risky tools execute without human review | 🔴 Critical |
| 2 | **Hardcoded RBAC (4 roles)** | Can't scale role definitions; no per-team customization | 🔴 Critical |
| 3 | **In-Memory RBAC** | Role changes require code redeploy; no runtime flexibility | 🔴 Critical |
| 4 | **No Path-Level Access** | Can't restrict file/directory access per role | 🟠 High |
| 5 | **No User Management** | No way to create/assign roles to team members | 🟠 High |
| 6 | **Fragmented Audit Trail** | Compliance gaps; hard to trace HITL decisions | 🟠 High |
| 7 | **SQLite at Scale** | Bottleneck at 20+ concurrent users | 🟡 Medium |
| 8 | **No Approval Workflow UI** | Approvers have no way to see/approve requests | 🟡 Medium |

---

## PART 2: VISION & GOALS

### What We're Building

✅ **Dynamic, database-backed RBAC system** — Create/edit roles without redeploying  
✅ **Human-In-The-Loop approval workflow** — Risky actions require human approval  
✅ **Path-level access control** — Restrict which directories each role can read/write  
✅ **Comprehensive audit trail** — Proof of who approved/denied what  
✅ **Multi-user team support** — 10–50 engineers with different roles  
✅ **Production-ready compliance** — SOC2/audit-ready logging  
✅ **Zero-downtime migration** — No service interruption to current workflows  

### Success Criteria

- ✅ All 11 PostgreSQL tables created and indexed
- ✅ 100% of existing workspaces, sessions, audit logs migrated (zero data loss)
- ✅ RBACEngineV2 passes unit tests (tool checks, path checks, approval flow)
- ✅ Tool executor integrated with new RBAC (all tools gated)
- ✅ Approval workflow functional: request → approve/deny → execute
- ✅ API endpoints working: list policies, create approvals, query audit log
- ✅ Approvers can see/act on pending requests (Slack notification + simple UI)
- ✅ Shadow mode validated: PostgreSQL runs in parallel with SQLite for 1 week
- ✅ Cutover complete: all traffic switched to PostgreSQL, SQLite archived

---

## PART 3: SOLUTION ARCHITECTURE

### New Stack (Single PostgreSQL)

```
┌──────────────────────────────────────────────────────┐
│       Thirdwave Platform (Port 3100 - Bun)           │
│                                                      │
│  ┌────────────────────────────────────────────────┐  │
│  │  Tool Executor                                 │  │
│  │  • RBAC checks (via RBACEngineV2)              │  │
│  │  • Path access validation                      │  │
│  │  • Approval request creation                   │  │
│  │  • Audit logging                               │  │
│  └────────────────────────────────────────────────┘  │
│                                                      │
│  ┌────────────────────────────────────────────────┐  │
│  │  REST API                                      │  │
│  │  /rbac/tool-policies                           │  │
│  │  /rbac/path-rules                              │  │
│  │  /approvals/pending                            │  │
│  │  /approvals/:id/approve                        │  │
│  │  /audit                                        │  │
│  └────────────────────────────────────────────────┘  │
│                                                      │
└──────────────────┬───────────────────────────────────┘
                   │
        ┌──────────▼──────────┐
        │   PgBouncer         │
        │   (Port 6432)       │
        │   Connection Pool   │
        └──────────┬──────────┘
                   │
        ┌──────────▼──────────────────────────┐
        │                                     │
        │  PostgreSQL 14+ (Single Instance)   │
        │  ├─ users (Alice, Bob, etc.)        │
        │  ├─ roles (admin, dev, readonly)    │
        │  ├─ tool_access_policies            │
        │  ├─ path_access_rules               │
        │  ├─ approval_requests (HITL)        │
        │  ├─ audit_log (compliance)          │
        │  ├─ workspaces                      │
        │  ├─ sessions                        │
        │  ├─ messages                        │
        │  ├─ tool_metadata                   │
        │  └─ risk_scores                     │
        │                                     │
        │  Backups: WAL archiving to S3       │
        │  Replication: Hot standby ready     │
        │                                     │
        └─────────────────────────────────────┘
```

### Database Schema (11 Tables, Single Org)

| Table | Purpose | Rows (Estimate) |
|-------|---------|-----------------|
| users | Team members | ~15 |
| roles | Job roles | ~5–10 |
| tool_access_policies | Tool → Role → Decision | ~40 |
| path_access_rules | Path → Role → R/W/X | ~50 |
| workspaces | Project workspaces | ~5–10 |
| sessions | AI agent sessions | ~50–100 |
| messages | Session messages | ~10K |
| approval_requests | **HITL workflow** | ~100/month |
| audit_log | **Compliance trail** | ~50K/month |
| tool_metadata | Tool descriptions | ~10 |
| risk_scores | Risk baselines | ~50 |

---

## PART 4: 6-PHASE IMPLEMENTATION PLAN

### Phase 1: PostgreSQL Setup & Schema (Week 1 — 25h)

**Goal:** Provisioned PostgreSQL with all tables ready to receive data

**Detailed Tasks:**

| Task | Owner | Effort | Details |
|------|-------|--------|---------|
| Provision PostgreSQL instance | DevOps | 4h | AWS RDS / Azure Database / self-hosted; 20GB storage, HA options enabled |
| Configure PgBouncer connection pooling | DevOps | 3h | Install/configure on port 6432; min_pool=10, max_pool=50 |
| Create base schema (11 tables) | DBA | 8h | Run migration script; create indexes (12 indexes) |
| Create default roles (admin, dev, readonly) | Backend | 4h | Seed 3 built-in roles with policies |
| Configure backups (WAL archiving) | DevOps | 3h | S3 bucket, daily snapshots, PITR enabled |
| Documentation & README | Backend | 3h | Schema diagram, connection string doc, runbook |

**Deliverables:**
- ✅ PostgreSQL running at `postgres-primary:5432/thirdwave_prod`
- ✅ PgBouncer accessible at `pgbouncer:6432`
- ✅ All 11 tables created with indexes
- ✅ Default roles seeded (admin, developer, readonly)
- ✅ Backups configured and tested
- ✅ Migration guide documentation

**Success Criteria:**
- `psql -h localhost -U postgres -d thirdwave_prod` connects successfully
- All 11 tables exist and have indexes
- Sample queries run sub-100ms (cold cache)

**Risks:**
- Network latency to PostgreSQL (mitigated: use same VPC)
- PgBouncer misconfiguration (mitigated: test pooling with load)

---

### Phase 2: Data Migration (Week 2 — 30h)

**Goal:** All historical data synced from SQLite to PostgreSQL with zero data loss

**Detailed Tasks:**

| Task | Owner | Effort | Details |
|------|-------|--------|---------|
| Export SQLite workspaces → PostgreSQL | Backend | 5h | Query `platform-workspaces.db` workspaces table; INSERT into `workspaces` table; verify row count |
| Sync OpenCode sessions/messages | Backend | 10h | HTTP poll OpenCode (port 4096); fetch all sessions & messages; batch INSERT into PostgreSQL; handle duplicates |
| Migrate audit log entries | Backend | 8h | Read JSONL audit files; transform to PostgreSQL schema; INSERT with timestamps; validate |
| Data validation & reconciliation | QA | 5h | Row count checks, hash verification, spot checks on random records |
| Backup SQLite (archive) | DevOps | 2h | Compress and store SQLite DBs as backup (keep for 30 days) |

**Deliverables:**
- ✅ `workspaces` table populated (n rows, 100% match SQLite)
- ✅ `sessions` + `messages` tables synced from OpenCode
- ✅ `audit_log` table populated with historical events
- ✅ Validation report: row counts, row checksums
- ✅ SQLite backups archived to S3

**Success Criteria:**
- All workspaces present in PostgreSQL (row count match SQLite)
- All sessions/messages from OpenCode synced
- No audit log events lost
- Validation script passes 100%

**Risks:**
- OpenCode API timeouts during large fetch (mitigated: pagination + retry logic)
- Data integrity issues (mitigated: validation script before cutover)

---

### Phase 3: RBACEngineV2 Implementation (Week 3 — 30h)

**Goal:** Dynamic RBAC engine with tool/path checks and approval workflow

**Detailed Tasks:**

| Task | Owner | Effort | Details |
|------|-------|--------|---------|
| Write RBACEngineV2 class | Backend | 12h | ~350 lines TypeScript; methods: canExecuteTool(), canAccessPath(), createApprovalRequest(), respondToApprovalRequest(), auditLog() |
| Wire tool-executor to RBAC | Backend | 10h | Add RBAC gate before tool execution; check tool policies; check path access; handle "allow"/"ask"/"deny" |
| Implement approval request creation | Backend | 5h | On "ask" decision, create approval_requests row; capture risk_score, tool_args, requested_by |
| Unit tests (RBAC engine) | QA | 3h | Test canExecuteTool (allow/ask/deny), canAccessPath (patterns), audit logging |

**Deliverables:**
- ✅ `/platform/HITL/rbac-v2.ts` — RBACEngineV2 class (350+ lines)
- ✅ `/platform/src/services/tool-executor.ts` — Updated with RBAC gates
- ✅ Unit test suite (Jest) with >80% coverage
- ✅ Integration test: full tool execute flow (RBAC → approval → execute)

**Success Criteria:**
- `RBACEngineV2.canExecuteTool()` correctly returns "allow"/"ask"/"deny"
- `RBACEngineV2.canAccessPath()` respects path patterns and priorities
- All unit tests pass
- Integration test: tool execution blocked by RBAC → approval workflow

**Risks:**
- Performance regression in tool execution (mitigated: profile RBAC queries, add indexes)
- RBAC logic errors (mitigated: comprehensive unit tests)

---

### Phase 4: REST API Endpoints (Week 4 — 25h)

**Goal:** Operators can manage RBAC policies and approvals via REST API

**Detailed Tasks:**

| Task | Owner | Effort | Details |
|------|-------|--------|---------|
| Build `/rbac/*` endpoints | Backend | 8h | GET/POST /rbac/tool-policies, GET/POST /rbac/path-rules, GET /rbac/roles, POST /users/:id/role |
| Build `/approvals/*` endpoints | Backend | 8h | GET /approvals/pending, POST /approvals/:id/approve, POST /approvals/:id/deny |
| Build `/audit` endpoint | Backend | 4h | GET /audit (filter by user, action, date) + pagination |
| API documentation (OpenAPI/Swagger) | Backend | 3h | Document all endpoints, request/response schemas |
| E2E test: full API workflow | QA | 2h | Create policy → assign role → execute tool → see approval request → approve → verify audit log |

**Deliverables:**
- ✅ `/platform/src/server/routes/rbac.ts` — RBAC endpoints
- ✅ `/platform/src/server/routes/approvals.ts` — Approval endpoints
- ✅ `/platform/src/server/routes/audit.ts` — Audit log endpoint
- ✅ OpenAPI spec (for frontend/external tools)
- ✅ E2E test suite
- ✅ Postman/cURL examples

**Success Criteria:**
- All endpoints return correct HTTP status codes
- E2E test passes: policy creation → tool execution → approval request created
- API documentation complete and accurate
- Load test: 100 req/sec handled without errors

**Risks:**
- API security gaps (mitigated: authentication middleware, rate limiting)
- Missing error handling (mitigated: comprehensive error responses)

---

### Phase 5: Approval Workflow & Notification (Week 5 — 20h)

**Goal:** Approvers can see and act on pending requests

**Detailed Tasks:**

| Task | Owner | Effort | Details |
|------|-------|--------|---------|
| Implement Slack/email webhooks | Backend | 8h | POST to Slack channel when approval_request created; include tool_name, risk_score, requester |
| Build simple approval UI (web) | Frontend | 8h | List pending requests, approve/deny buttons, show risk_score and tool_args |
| Webhook signature verification | Backend | 2h | Verify Slack/email webhook authenticity (HMAC) |
| Notification templates | Backend | 2h | Slack message templates, approval URL links |

**Deliverables:**
- ✅ Slack webhook integration (POST to #approvals channel)
- ✅ Simple web UI: `/approvals` page with pending list
- ✅ Approval notification templates
- ✅ Webhook signature verification
- ✅ E2E test: approval creation → Slack notification → UI shows request → approve action

**Success Criteria:**
- Slack notification sent <5 sec after approval_request created
- Approvers see pending requests in UI within 1 sec
- Approve button updates approval_requests table and audit_log
- No duplicate notifications

**Risks:**
- Slack API rate limits (mitigated: batch notifications, retry logic)
- UI latency (mitigated: caching, pagination)

---

### Phase 6: Testing & Zero-Downtime Rollout (Week 6 — 25h)

**Goal:** Validate PostgreSQL migration and switch all traffic with zero downtime

**Detailed Tasks:**

| Task | Owner | Effort | Details |
|------|-------|--------|---------|
| Shadow mode setup | Backend + DevOps | 5h | Platform writes to BOTH PostgreSQL + SQLite; reads PostgreSQL only; monitor data sync |
| Shadow mode validation (1 week) | QA | 8h | Run all agentic workflows; verify PostgreSQL results match SQLite; test approval flow |
| Load test (50 users, 5 concurrent sessions each) | QA | 5h | Simulate team load; measure latency, throughput; check PgBouncer pool |
| Cutover runbook & checklist | DevOps | 3h | Step-by-step migration procedure, rollback plan, communication |
| Cutover execution | DevOps + Backend | 3h | Stop dual-write, switch to PostgreSQL-only, verify metrics, monitor alerts |
| Post-cutover validation | QA | 1h | Smoke tests: create session, execute tool, request approval, approve/execute |

**Deliverables:**
- ✅ Shadow mode running (PostgreSQL + SQLite for 1 week)
- ✅ Validation report: data consistency 100%, latency <200ms
- ✅ Load test results: 50-user load handled without errors
- ✅ Cutover runbook (detailed step-by-step)
- ✅ Rollback plan documented
- ✅ Post-cutover monitoring dashboard (CPU, connections, query latency)

**Success Criteria:**
- Shadow mode validates data consistency
- Load test: <100ms p50 latency, no dropped connections
- Cutover executed with 0 downtime
- All monitoring alerts configured and tested
- SQLite archived; PostgreSQL is system of record

**Risks:**
- Cutover coordination errors (mitigated: runbook, dry-run beforehand)
- PostgreSQL performance issues under load (mitigated: load test validates)
- Rollback needed (mitigated: SQLite backups retained, quick rollback procedure)

---

## PART 5: PARALLEL WORK OPPORTUNITIES

If you have 3 engineers (recommended):

| Weeks | Engineer A (Backend) | Engineer B (Backend/DBA) | Engineer C (DevOps/QA) |
|-------|----------------------|--------------------------|------------------------|
| Week 1 | — | **Phase 1: PostgreSQL + schema** | **Phase 1: DevOps infra** |
| Week 2 | **Phase 3: RBACEngineV2** | **Phase 2: Data migration** | **Phase 2: Validation** |
| Week 3 | **Phase 3: Tool-executor integration** | Phase 3 (support) | **Phase 3: Unit tests** |
| Week 4 | **Phase 4: API endpoints** | Phase 4 (support) | **Phase 4: E2E tests** |
| Week 5 | **Phase 5: Approval UI + webhooks** | Phase 5 (support) | **Phase 5: Load test setup** |
| Week 6 | **Phase 6: Monitoring** | **Phase 6: Shadow mode** | **Phase 6: Cutover execution** |

**Coordination points:**
- End of Week 1: Schema review + approval before Phase 2 starts
- End of Week 2: Data validation sign-off before Phase 3 starts
- End of Week 3: RBAC engine code review before Phase 4 starts
- End of Week 5: Load test results before Phase 6 starts

---

## PART 6: ROLLOUT STRATEGY

### Shadow Mode (1 week, overlapping Phase 6)

```
Weeks 5–6: Parallel operation
┌──────────────────────────────────────────┐
│  Platform                                │
│                                          │
│  Tool Executor writes to:                │
│  ├─ PostgreSQL (primary)                 │
│  ├─ SQLite (legacy, for validation)      │
│                                          │
│  All reads from: PostgreSQL              │
│                                          │
│  ✅ Validation: compare results 1x/hour   │
│  ✅ If mismatch: investigate, fix, retry  │
└──────────────────────────────────────────┘
        │              │
    ┌───▼─────┐   ┌───▼────────┐
    │PostgreSQL   │SQLite
    │(Primary)    │(Backup)
    └───────────┘   └────────────┘
```

### Cutover (Day 1 of Week 6, ~2 hours)

```
Step 1: Stop dual-write (t = 0:00)
        Platform writes ONLY to PostgreSQL

Step 2: Verify sync (t = 0:10)
        Compare row counts: PostgreSQL == SQLite

Step 3: Switch reads (t = 0:20)
        All queries → PostgreSQL (already done in shadow mode)

Step 4: Monitor (t = 0:30 to t = 2:00)
        ✅ Agent latency <200ms
        ✅ No connection errors
        ✅ Audit logs recording correctly
        ✅ Approvals workflow working

Step 5: Archive SQLite (t = 2:00+)
        Compress to S3, keep local copy for 30 days

Result: Platform running 100% on PostgreSQL
```

### Rollback Plan (if issues arise)

```
If problems detected during/after cutover:

1. Stop Platform (graceful shutdown)
2. Switch reads back to SQLite (config change)
3. Run validation to identify issue
4. Fix in PostgreSQL, retry cutover
5. If unfixable: revert to SQLite, post-mortem

Expected SLA: <30 minutes to rollback
```

---

## PART 7: SUCCESS METRICS & VALIDATION

### Before → After Comparison

| Metric | Before | After | Target |
|--------|--------|-------|--------|
| **RBAC Flexibility** | 4 hardcoded roles | Unlimited dynamic roles | ✅ 10+ custom roles |
| **Tool Execution Latency** | 50–100ms | <100ms (optimized) | ✅ <150ms p95 |
| **Approval Requests** | ❌ 0 (no workflow) | ✅ Full workflow enabled | ✅ 100% tracked |
| **Audit Trail Completeness** | ~60% | ~99% | ✅ 100% |
| **User Management** | Manual only | Via API + UI | ✅ Self-service |
| **Path-Level Access** | ❌ Missing | ✅ Full support | ✅ 50+ path rules |
| **Concurrent Users** | 5–10 max | 50–100 no problem | ✅ 20+ comfortable |
| **Backup Strategy** | Manual | WAL archiving + snapshots | ✅ Automated daily |

### Testing Checklist

- ✅ Unit tests: RBAC engine >80% coverage
- ✅ Integration tests: Tool executor → RBAC → approval → execute
- ✅ E2E tests: Full user journeys (admin, developer, readonly roles)
- ✅ Load test: 50 concurrent users, 5 sessions each → <200ms latency
- ✅ Data migration: 100% row count match SQLite → PostgreSQL
- ✅ Shadow mode: 1-week parallel operation, 100% data consistency
- ✅ API contract tests: OpenAPI spec validated against implementation
- ✅ Security tests: RBAC denial checks, path boundary tests, SQL injection tests

---

## PART 8: RISKS & MITIGATION

| Risk | Probability | Impact | Mitigation |
|------|-------------|--------|-----------|
| **PostgreSQL performance degradation** | Medium | High | Load test (week 5), optimize slow queries, add indexes |
| **Data loss during migration** | Low | Critical | Backup SQLite, validation script, dry-run migration |
| **RBAC logic bugs** | Medium | High | Comprehensive unit tests, code review, staged rollout |
| **Approval workflow UX confusion** | Medium | Medium | Simple UI, Slack notifications, internal docs |
| **OpenCode sync timeouts** | Medium | Medium | Pagination, retry logic, incremental sync |
| **PgBouncer connection pool exhaustion** | Low | High | Load test validates pool sizing, monitoring alerts |
| **Cutover coordination failure** | Low | High | Dry-run cutover, detailed runbook, team rehearsal |
| **Rollback complexity** | Low | High | Automated rollback script, 30-day SQLite retention |

---

## PART 9: DEPENDENCIES & PREREQUISITES

### Before Starting Phase 1

- ✅ Team alignment on design (roadmap + this plan)
- ✅ Infrastructure available: PostgreSQL instance provisioning approved
- ✅ S3 bucket created (for backups + archive)
- ✅ 3 engineers assigned (Backend x2, DevOps/QA x1)
- ✅ Access to OpenCode HTTP API (port 4096)
- ✅ SQLite DB backups taken (pre-migration safety)

### Tools & Services

- **Database:** PostgreSQL 14+ (v15 recommended)
- **Connection Pool:** PgBouncer
- **Monitoring:** Prometheus + Grafana (optional but recommended)
- **Backups:** S3 (AWS) or equivalent cloud storage
- **Notifications:** Slack (for approval workflow)
- **Testing:** Jest (unit), Playwright (E2E), k6/LoadImpact (load testing)

---

## PART 10: COMMUNICATION & PHASES

### Week 1: Kickoff
- Announce plan to team
- Assign engineers
- Brief on RBAC/approval workflow concepts
- Review schema design

### Week 2–5: Execution
- Weekly syncs (Mon + Fri)
- Block blockers same-day
- Slack updates in #engineering-infra

### Week 6: Cutover & Validation
- Daily syncs during shadow mode
- Cutover day: real-time support
- Post-cutover celebration 🎉

### Post-Launch: Monitoring
- 1 week close monitoring (alerts enabled)
- Bi-weekly syncs for 1 month
- Document learnings, improvements

---

## PART 11: NEXT STEPS (Immediate Actions)

1. **Today (April 8):**
   - Review this plan with team
   - Discuss risks/concerns
   - Confirm 3 engineers available

2. **Tomorrow (April 9):**
   - Provision PostgreSQL instance (DevOps)
   - Begin Phase 1 setup
   - Create GitHub issues for each phase

3. **Week of April 9:**
   - Phase 1 in progress
   - Backend engineers start Phase 3 prep (RBACEngineV2 design)
   - QA starts Phase 2 prep (validation scripts)

---

## APPENDIX A: Database Schema DDL

See: `CURRENT_VS_PROPOSED_SCHEMA.md` (11 tables with full CREATE TABLE statements)

---

## APPENDIX B: RBACEngineV2 Code Skeleton

See: `ENHANCED_RBAC_STREAMLINED.md` (full RBACEngineV2 class + integration example)

---

## APPENDIX C: API Endpoint Specs

See: `ENHANCED_RBAC_STREAMLINED.md` (REST routes with request/response examples)

---

## APPENDIX D: Default Role Definitions

```yaml
roles:
  - name: admin
    description: "Full access, can create policies"
    tool_policies:
      "*": "allow"            # All tools allowed
    path_rules:
      - pattern: "*"
        readable: true
        writable: true
        executable: true
        priority: 100

  - name: developer
    description: "Can execute tools, risky ops require approval"
    tool_policies:
      bash: "ask"             # Bash requires approval
      read_file: "allow"
      write_file: "allow"
      list_dir: "allow"
      grep_search: "allow"
      web_fetch: "ask"        # Web requires approval
    path_rules:
      - pattern: "/workspace/*"
        readable: true
        writable: true
        priority: 10
      - pattern: "/root"
        readable: false
        writable: false
        priority: 20

  - name: readonly
    description: "Read-only access to workspace"
    tool_policies:
      bash: "deny"
      read_file: "allow"
      write_file: "deny"
      list_dir: "allow"
      grep_search: "allow"
      web_fetch: "deny"
    path_rules:
      - pattern: "/workspace/*"
        readable: true
        writable: false
        priority: 10
```

---

**Status:** Ready for approval ✅  
**Approval:** [Awaiting team sign-off]  
**Start Date:** April 9, 2026  
**Target Completion:** May 20, 2026
