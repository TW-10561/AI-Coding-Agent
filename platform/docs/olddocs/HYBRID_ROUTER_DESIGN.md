# Hybrid Router Design — Thirdwave AI Coding Platform

## Concept

A Hybrid Router intelligently distributes AI inference requests across **local vLLM instances**, an **APISIX gateway**, and **cloud providers** — selecting the optimal backend per-request based on cost, latency, model capability, and availability.

```
                         ┌──────────────────┐
                         │   Hybrid Router   │
                         │  (request-level)  │
                         └────┬───┬───┬──────┘
                              │   │   │
              ┌───────────────┘   │   └───────────────┐
              ▼                   ▼                    ▼
     ┌─────────────┐    ┌──────────────┐     ┌──────────────┐
     │ APISIX GW   │    │ Direct vLLM  │     │ Cloud APIs   │
     │ (LB across  │    │ (single GPU  │     │ (OpenAI,     │
     │  all local)  │    │  endpoint)   │     │  Anthropic,  │
     │              │    │              │     │  Google...)  │
     └──────┬───────┘    └──────┬───────┘     └──────┬───────┘
            │                   │                     │
     ┌──────┴───────┐   ┌──────┴──────┐              │
     │ vLLM Node A  │   │ vLLM Node B │              │
     │ MiniMax M2.1 │   │ gpt-oss-120b│              │
     └──────────────┘   └─────────────┘              │
                                                     │
                                               Cloud endpoints
```

---

## Routing Strategy

### Tier 1: Local-First (Always Preferred)

| Priority | Backend | When |
|----------|---------|------|
| 1 | APISIX Gateway | Gateway is online + model available behind it |
| 2 | Direct vLLM | Specific endpoint requested or gateway down |
| 3 | Cloud fallback | Local unavailable OR user explicitly selects cloud model |

### Tier 2: Capability-Based Selection

Different tasks need different models:

| Task Type | Preferred Model | Reasoning |
|-----------|----------------|-----------|
| Code generation | Large context model (MiniMax M2.1) | 30K+ context, strong at code |
| Quick Q&A | Fastest available model | Low latency matters |
| Complex reasoning | Reasoning model (gpt-oss-120b, o3) | Chain-of-thought needed |
| Code review | Cloud model with large context | Full-file analysis |
| Test generation | Any capable model | Template-driven, less model-sensitive |

### Tier 3: Cost-Aware Routing

```
Cost calculation per request:
  local_cost  = 0  (self-hosted, only electricity)
  cloud_cost  = (input_tokens × costIn + output_tokens × costOut) / 1M
  
Route to local if: local is online AND latency < 2× cloud_latency
Route to cloud if: local is offline OR task requires unavailable capability
```

---

## Architecture

### Router Module: `platform/src/services/hybrid-router.ts`

```typescript
interface RouteDecision {
  provider: "gateway" | "direct-vllm" | "cloud"
  endpoint: string
  modelId: string
  apiKey: string
  reason: string           // Why this route was chosen
  estimatedLatencyMs: number
  estimatedCostUsd: number // 0 for local
}

interface RouteRequest {
  message: string
  preferredModel?: string
  taskType?: "code" | "chat" | "reasoning" | "review" | "test"
  maxLatencyMs?: number    // User's latency budget
  maxCostUsd?: number      // User's cost budget per request
  requiresTools?: boolean  // Tool-calling capability needed
  contextTokens?: number   // Estimated input size
}
```

### Decision Algorithm

```
1. Build candidate list from registry:
   - Gateway models (online)
   - Direct vLLM models (online)
   - Cloud models (configured + matching capability)

2. If preferredModel specified:
   - Find it in candidates → route there
   - Not found → error

3. Score each candidate:
   score = w_cost × cost_score
         + w_latency × latency_score
         + w_capability × capability_score
         + w_availability × availability_score

4. Apply constraints:
   - Remove candidates exceeding maxLatencyMs
   - Remove candidates exceeding maxCostUsd
   - Remove candidates without tool support (if required)

5. Select highest-scoring candidate
```

### Scoring Weights

```typescript
const WEIGHTS = {
  cost:         0.30,  // Prefer cheaper (local = free)
  latency:      0.25,  // Prefer faster
  capability:   0.30,  // Prefer better model for the task
  availability: 0.15,  // Prefer reliable (gateway > direct)
}
```

### Latency Tracking

The router maintains a rolling latency histogram per endpoint:

```typescript
interface EndpointStats {
  endpoint: string
  p50Ms: number      // Median latency
  p95Ms: number      // 95th percentile
  p99Ms: number      // 99th percentile
  errorRate: number   // Last 100 requests
  lastProbeMs: number // Last health check
}
```

Updated after every request. Stale stats (>60s) trigger a background probe.

---

## Failover Chain

```
Request arrives
     ↓
[1] Try Gateway
     ├── Success → return response
     └── Failure (timeout/502/503)
          ↓
[2] Try Direct vLLM (if endpoint known)
     ├── Success → return response
     └── Failure
          ↓
[3] Try Cloud (if API key configured)
     ├── Success → return response
     └── Failure → return error to user
```

Each failover adds ~100ms overhead (connection setup). The router retries transparently — the user sees a single response.

### Circuit Breaker

Per-endpoint circuit breaker prevents cascading failures:

```
States: CLOSED → OPEN → HALF_OPEN → CLOSED

CLOSED:  Normal operation. Track errors.
         If error_rate > 50% in last 10 requests → OPEN

OPEN:    No requests sent. Wait 30s.
         After 30s → HALF_OPEN

HALF_OPEN: Send 1 probe request.
           If success → CLOSED
           If failure → OPEN (reset timer)
```

---

## Implementation Plan

### Phase 1: Smart Fallback (Minimal)
- Add failover logic to `resolveModel()` in chat.ts
- Gateway → Direct → Cloud chain
- Track basic latency per endpoint

### Phase 2: Capability Routing
- Add `taskType` parameter to chat API
- Map task types to model capabilities
- Route reasoning tasks to larger models

### Phase 3: Cost-Aware + Latency SLA
- Track per-request token costs
- Add latency histogram per endpoint
- Score-based routing with configurable weights

### Phase 4: Adaptive Learning
- Log every routing decision + outcome
- Adjust weights based on success rate
- Auto-prefer endpoints with lower error rates

---

## Configuration

```typescript
// .env additions for hybrid router
ROUTER_MODE=hybrid                    // "local-only" | "cloud-only" | "hybrid"
ROUTER_MAX_FALLBACK_ATTEMPTS=3       // Max failover hops
ROUTER_LATENCY_BUDGET_MS=30000       // Default max wait time
ROUTER_COST_BUDGET_USD=0.10          // Default max cost per request
ROUTER_PREFER_LOCAL=true             // Always try local first
ROUTER_CIRCUIT_BREAKER_THRESHOLD=5   // Errors before circuit opens
```

---

## Dashboard Integration

The hybrid router exposes stats at `/api/router/stats`:

```json
{
  "totalRequests": 1247,
  "routeDistribution": {
    "gateway": 1150,
    "direct-vllm": 82,
    "cloud": 15
  },
  "avgLatencyMs": {
    "gateway": 2340,
    "direct-vllm": 1890,
    "cloud": 1200
  },
  "totalCostUsd": 0.42,
  "failovers": 97,
  "circuitBreakers": {
    "gateway": "CLOSED",
    "direct-vllm": "OPEN",
    "cloud-openai": "CLOSED"
  }
}
```

This data feeds into the VS Code extension's status bar and the web dashboard, giving real-time visibility into where requests are going and why.

---

## Summary

The Hybrid Router transforms Thirdwave from a single-endpoint platform into a resilient, cost-optimized inference fabric:

1. **Local-first**: Zero cost, full privacy, no external dependencies
2. **Smart fallback**: Automatic failover to cloud when local fails
3. **Cost-aware**: Routes to cheapest capable backend
4. **Latency-aware**: Tracks real performance, avoids slow endpoints
5. **Self-healing**: Circuit breakers prevent cascading failures
6. **Observable**: Full routing telemetry for debugging and optimization
