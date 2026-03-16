#!/usr/bin/env bash
#
# smoke-test.sh -- Post-deployment smoke tests
#
# Runs a suite of smoke tests against a deployed environment to verify
# critical endpoints are responding correctly after deployment.
#
# Usage:
#   ./smoke-test.sh --url https://staging.example.com --output-dir ./results/
#
set -euo pipefail

# ─── Defaults ────────────────────────────────────────────────────────────────
BASE_URL=""
OUTPUT_DIR="./smoke-test-results"
TIMEOUT=10
VERBOSE=false

# ─── Parse Arguments ─────────────────────────────────────────────────────────
while [[ $# -gt 0 ]]; do
  case "$1" in
    --url)        BASE_URL="$2"; shift 2 ;;
    --output-dir) OUTPUT_DIR="$2"; shift 2 ;;
    --timeout)    TIMEOUT="$2"; shift 2 ;;
    --verbose)    VERBOSE=true; shift ;;
    -h|--help)
      echo "Usage: $0 --url <base-url> --output-dir <dir>"
      echo ""
      echo "Options:"
      echo "  --url         Base URL of the deployed service"
      echo "  --output-dir  Directory for smoke test result files"
      echo "  --timeout     HTTP request timeout in seconds (default: 10)"
      echo "  --verbose     Enable verbose output"
      exit 0
      ;;
    *) echo "ERROR: Unknown argument: $1" >&2; exit 1 ;;
  esac
done

if [[ -z "$BASE_URL" ]]; then
  echo "ERROR: --url is required" >&2
  exit 1
fi

# ─── Setup Output ────────────────────────────────────────────────────────────
mkdir -p "$OUTPUT_DIR"
TIMESTAMP=$(date -u +"%Y%m%dT%H%M%SZ")
RESULT_FILE="${OUTPUT_DIR}/smoke-test-${TIMESTAMP}.json"
LOG_FILE="${OUTPUT_DIR}/smoke-test-${TIMESTAMP}.log"

TOTAL=0
PASSED=0
FAILED=0
RESULTS="[]"

log() {
  local msg="[$(date -u +"%Y-%m-%dT%H:%M:%SZ")] $1"
  echo "$msg" | tee -a "$LOG_FILE"
}

# ─── Test Runner ─────────────────────────────────────────────────────────────
run_test() {
  local name="$1"
  local method="$2"
  local path="$3"
  local expected_status="$4"
  local expected_body="${5:-}"

  TOTAL=$((TOTAL + 1))
  local url="${BASE_URL}${path}"

  log "TEST: ${name}"
  log "  ${method} ${url} (expect ${expected_status})"

  local http_code
  local body
  local tmpfile
  tmpfile=$(mktemp)

  http_code=$(curl -s -o "$tmpfile" -w "%{http_code}" \
    -X "$method" \
    --max-time "$TIMEOUT" \
    "$url" 2>>"$LOG_FILE") || {
    log "  FAIL: Connection error"
    FAILED=$((FAILED + 1))
    RESULTS=$(echo "$RESULTS" | python3 -c "
import sys, json
r = json.loads(sys.stdin.read())
r.append({'name': '$name', 'status': 'FAIL', 'reason': 'connection_error'})
print(json.dumps(r))
" 2>/dev/null || echo "$RESULTS")
    rm -f "$tmpfile"
    return 1
  }

  body=$(cat "$tmpfile")
  rm -f "$tmpfile"

  # Check status code
  if [[ "$http_code" != "$expected_status" ]]; then
    log "  FAIL: Expected status ${expected_status}, got ${http_code}"
    FAILED=$((FAILED + 1))
    RESULTS=$(echo "$RESULTS" | python3 -c "
import sys, json
r = json.loads(sys.stdin.read())
r.append({'name': '$name', 'status': 'FAIL', 'expected': $expected_status, 'actual': $http_code})
print(json.dumps(r))
" 2>/dev/null || echo "$RESULTS")
    return 1
  fi

  # Check body content if specified
  if [[ -n "$expected_body" ]]; then
    if ! echo "$body" | grep -q "$expected_body"; then
      log "  FAIL: Response body does not contain '${expected_body}'"
      FAILED=$((FAILED + 1))
      return 1
    fi
  fi

  log "  PASS"
  PASSED=$((PASSED + 1))
  RESULTS=$(echo "$RESULTS" | python3 -c "
import sys, json
r = json.loads(sys.stdin.read())
r.append({'name': '$name', 'status': 'PASS', 'http_code': $http_code})
print(json.dumps(r))
" 2>/dev/null || echo "$RESULTS")
  return 0
}

# ─── Smoke Tests ─────────────────────────────────────────────────────────────
log "=== Smoke Test Suite ==="
log "Base URL: ${BASE_URL}"
log "Timeout: ${TIMEOUT}s"
log ""

# Health endpoints
run_test "Liveness check"      GET "/health"       200 "healthy" || true
run_test "Readiness check"     GET "/health/ready" 200 "ready"   || true

# API endpoints
run_test "API root"            GET "/api/v1/"      200           || true
run_test "OpenAPI docs"        GET "/docs"          200           || true
run_test "OpenAPI JSON"        GET "/openapi.json"  200           || true

# Auth endpoints (expect 401 without credentials)
run_test "Auth required"       GET "/api/v1/users/me" 401        || true

# Frontend (if served from same domain)
run_test "Frontend index"      GET "/"              200           || true

# Static assets
run_test "Static assets"       GET "/static/"       200           || true

# ─── Summary ─────────────────────────────────────────────────────────────────
log ""
log "=== Smoke Test Summary ==="
log "Total: ${TOTAL}  Passed: ${PASSED}  Failed: ${FAILED}"

# Write results to JSON file
cat > "$RESULT_FILE" <<EOJSON
{
  "base_url": "${BASE_URL}",
  "timestamp": "${TIMESTAMP}",
  "total": ${TOTAL},
  "passed": ${PASSED},
  "failed": ${FAILED},
  "success": $([ "$FAILED" -eq 0 ] && echo "true" || echo "false"),
  "results": ${RESULTS}
}
EOJSON

log "Results written to ${RESULT_FILE}"

if [[ $FAILED -gt 0 ]]; then
  log "SMOKE TESTS FAILED: ${FAILED} test(s) did not pass"
  exit 1
fi

log "ALL SMOKE TESTS PASSED"
exit 0
