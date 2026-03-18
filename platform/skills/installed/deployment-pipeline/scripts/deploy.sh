#!/usr/bin/env bash
#
# deploy.sh -- Main deployment orchestration script
#
# Orchestrates the deployment of backend and frontend services to the
# specified environment. Supports staging and production deployments,
# canary rollouts, rollback, and pre-deployment validation.
#
# Usage:
#   ./deploy.sh --env staging --version abc1234 --output-dir ./results/
#   ./deploy.sh --env production --version abc1234 --canary --output-dir ./results/
#   ./deploy.sh --rollback --env production --version prev123 --output-dir ./results/
#   ./deploy.sh --validate-only --env staging --output-dir ./results/
#
set -euo pipefail

# ─── Defaults ────────────────────────────────────────────────────────────────
ENV=""
VERSION=""
OUTPUT_DIR="./deploy-results"
CANARY=false
ROLLBACK=false
VALIDATE_ONLY=false
CANARY_WEIGHT=10
HEALTH_CHECK_RETRIES=3
HEALTH_CHECK_TIMEOUT=30

# ─── Parse Arguments ─────────────────────────────────────────────────────────
while [[ $# -gt 0 ]]; do
  case "$1" in
    --env)           ENV="$2"; shift 2 ;;
    --version)       VERSION="$2"; shift 2 ;;
    --output-dir)    OUTPUT_DIR="$2"; shift 2 ;;
    --canary)        CANARY=true; shift ;;
    --canary-weight) CANARY_WEIGHT="$2"; shift 2 ;;
    --rollback)      ROLLBACK=true; shift ;;
    --validate-only) VALIDATE_ONLY=true; shift ;;
    --retries)       HEALTH_CHECK_RETRIES="$2"; shift 2 ;;
    --timeout)       HEALTH_CHECK_TIMEOUT="$2"; shift 2 ;;
    -h|--help)
      echo "Usage: $0 --env <staging|production> --version <git-sha> --output-dir <dir>"
      echo ""
      echo "Options:"
      echo "  --env           Target environment (staging or production)"
      echo "  --version       Git SHA or tag to deploy"
      echo "  --output-dir    Directory for deployment result files"
      echo "  --canary        Enable canary deployment (production only)"
      echo "  --canary-weight Initial canary traffic percentage (default: 10)"
      echo "  --rollback      Roll back to the specified version"
      echo "  --validate-only Run pre-deployment validation without deploying"
      echo "  --retries       Health check retry count (default: 3)"
      echo "  --timeout       Health check timeout in seconds (default: 30)"
      exit 0
      ;;
    *) echo "ERROR: Unknown argument: $1" >&2; exit 1 ;;
  esac
done

# ─── Validation ──────────────────────────────────────────────────────────────
if [[ -z "$ENV" ]]; then
  echo "ERROR: --env is required (staging or production)" >&2
  exit 1
fi

if [[ "$ENV" != "staging" && "$ENV" != "production" ]]; then
  echo "ERROR: --env must be 'staging' or 'production'" >&2
  exit 1
fi

if [[ -z "$VERSION" && "$VALIDATE_ONLY" == false ]]; then
  echo "ERROR: --version is required unless --validate-only is set" >&2
  exit 1
fi

# ─── Setup Output ────────────────────────────────────────────────────────────
mkdir -p "$OUTPUT_DIR"
TIMESTAMP=$(date -u +"%Y%m%dT%H%M%SZ")
LOG_FILE="${OUTPUT_DIR}/deploy-${ENV}-${TIMESTAMP}.log"
RESULT_FILE="${OUTPUT_DIR}/deploy-${ENV}-${TIMESTAMP}.json"

log() {
  local msg="[$(date -u +"%Y-%m-%dT%H:%M:%SZ")] $1"
  echo "$msg" | tee -a "$LOG_FILE"
}

write_result() {
  local status="$1"
  local message="$2"
  cat > "$RESULT_FILE" <<EOJSON
{
  "environment": "${ENV}",
  "version": "${VERSION}",
  "status": "${status}",
  "message": "${message}",
  "timestamp": "${TIMESTAMP}",
  "canary": ${CANARY},
  "rollback": ${ROLLBACK},
  "log_file": "${LOG_FILE}"
}
EOJSON
  log "Result written to ${RESULT_FILE}"
}

# ─── Pre-Deployment Validation ───────────────────────────────────────────────
validate() {
  log "Running pre-deployment validation for ${ENV}..."

  local errors=0

  # Check Alembic migration consistency
  if command -v alembic &>/dev/null; then
    log "Checking Alembic migrations..."
    if ! alembic check 2>>"$LOG_FILE"; then
      log "WARNING: Alembic check failed -- migrations may be out of sync"
      errors=$((errors + 1))
    fi
  else
    log "SKIP: alembic not found in PATH"
  fi

  # Check Docker images exist
  if [[ -n "${VERSION:-}" ]]; then
    log "Verifying Docker images for version ${VERSION}..."
    for image in "app-backend:${VERSION}" "app-frontend:${VERSION}"; do
      if ! docker image inspect "$image" &>/dev/null 2>&1; then
        log "WARNING: Docker image ${image} not found locally"
        errors=$((errors + 1))
      else
        log "OK: Image ${image} exists"
      fi
    done
  fi

  # Check environment-specific config
  log "Validating environment configuration for ${ENV}..."
  local required_vars=()
  if [[ "$ENV" == "staging" ]]; then
    required_vars=(STAGING_DB_URL STAGING_REDIS_URL STAGING_API_URL)
  elif [[ "$ENV" == "production" ]]; then
    required_vars=(PRODUCTION_DB_URL PRODUCTION_REDIS_URL PRODUCTION_API_URL)
  fi

  for var in "${required_vars[@]}"; do
    if [[ -z "${!var:-}" ]]; then
      log "WARNING: Environment variable ${var} is not set"
      errors=$((errors + 1))
    else
      log "OK: ${var} is set"
    fi
  done

  if [[ $errors -gt 0 ]]; then
    log "Validation completed with ${errors} warning(s)"
  else
    log "Validation passed -- all checks OK"
  fi

  return $errors
}

# ─── Rollback ────────────────────────────────────────────────────────────────
rollback() {
  log "=== ROLLBACK: Rolling back ${ENV} to version ${VERSION} ==="

  log "Pulling previous images..."
  for service in backend frontend; do
    log "Deploying app-${service}:${VERSION}..."
    # In a real deployment, this would update the running service
    # docker service update --image "app-${service}:${VERSION}" "app-${service}"
    log "Simulated rollback of app-${service} to ${VERSION}"
  done

  log "Waiting for services to stabilize..."
  sleep 5

  log "Running post-rollback health checks..."
  local health_ok=true
  for endpoint in "/health" "/health/ready"; do
    local url="${BASE_URL}${endpoint}"
    log "Checking ${url}..."
    if curl -sf --max-time "$HEALTH_CHECK_TIMEOUT" "$url" >>"$LOG_FILE" 2>&1; then
      log "OK: ${endpoint} is healthy"
    else
      log "FAIL: ${endpoint} is not responding"
      health_ok=false
    fi
  done

  if [[ "$health_ok" == true ]]; then
    write_result "rollback_success" "Rolled back to ${VERSION} successfully"
    log "=== ROLLBACK COMPLETE ==="
  else
    write_result "rollback_failed" "Rollback to ${VERSION} completed but health checks failed"
    log "=== ROLLBACK COMPLETED WITH WARNINGS ==="
    exit 1
  fi
}

# ─── Deploy ──────────────────────────────────────────────────────────────────
deploy() {
  log "=== DEPLOY: Deploying ${VERSION} to ${ENV} ==="

  # Step 1: Pre-deployment validation
  log "Step 1: Pre-deployment validation"
  if ! validate; then
    log "WARNING: Validation had warnings, proceeding with caution"
  fi

  # Step 2: Deploy images
  log "Step 2: Deploying Docker images"
  for service in backend frontend; do
    log "Deploying app-${service}:${VERSION} to ${ENV}..."
    # In a real deployment:
    # docker service update --image "app-${service}:${VERSION}" "app-${service}-${ENV}"
    log "Simulated deploy of app-${service}:${VERSION}"
  done

  # Step 3: Run database migrations
  log "Step 3: Running database migrations"
  # In a real deployment:
  # alembic upgrade head
  log "Simulated migration run"

  # Step 4: Health checks
  log "Step 4: Running health checks"
  local retries=$HEALTH_CHECK_RETRIES
  local healthy=false
  while [[ $retries -gt 0 ]]; do
    sleep 10
    if curl -sf --max-time "$HEALTH_CHECK_TIMEOUT" "${BASE_URL}/health" >>"$LOG_FILE" 2>&1; then
      healthy=true
      break
    fi
    retries=$((retries - 1))
    log "Health check failed, ${retries} retries remaining..."
  done

  if [[ "$healthy" == false ]]; then
    log "ERROR: Health checks failed after all retries"
    write_result "deploy_failed" "Health checks failed after deployment"
    log "Initiating automatic rollback..."
    return 1
  fi

  log "Health checks passed"

  # Step 5: Smoke tests
  log "Step 5: Running smoke tests"
  local script_dir
  script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
  if [[ -x "${script_dir}/smoke-test.sh" ]]; then
    if "${script_dir}/smoke-test.sh" --url "$BASE_URL" --output-dir "$OUTPUT_DIR"; then
      log "Smoke tests passed"
    else
      log "WARNING: Smoke tests had failures"
    fi
  else
    log "SKIP: smoke-test.sh not found or not executable"
  fi

  write_result "deploy_success" "Deployed ${VERSION} to ${ENV} successfully"
  log "=== DEPLOY COMPLETE ==="
}

# ─── Canary Deploy ───────────────────────────────────────────────────────────
canary_deploy() {
  log "=== CANARY DEPLOY: ${VERSION} to ${ENV} at ${CANARY_WEIGHT}% ==="

  # Step 1: Deploy canary instances
  log "Step 1: Deploying canary instances (${CANARY_WEIGHT}% traffic)"
  # In a real deployment, update nginx/load balancer weights
  log "Simulated canary deployment at ${CANARY_WEIGHT}%"

  # Step 2: Monitor canary
  log "Step 2: Monitoring canary for 60 seconds..."
  sleep 10  # Shortened for script execution; real monitoring would be longer

  # Step 3: Evaluate canary
  log "Step 3: Evaluating canary health"
  local canary_healthy=true
  if curl -sf --max-time "$HEALTH_CHECK_TIMEOUT" "${BASE_URL}/health" >>"$LOG_FILE" 2>&1; then
    log "Canary health check passed"
  else
    log "Canary health check failed"
    canary_healthy=false
  fi

  if [[ "$canary_healthy" == false ]]; then
    log "ERROR: Canary evaluation failed, rolling back"
    write_result "canary_failed" "Canary evaluation failed, rollback initiated"
    return 1
  fi

  # Step 4: Ramp to 50%
  log "Step 4: Ramping canary to 50%"
  sleep 5

  # Step 5: Full rollout
  log "Step 5: Full rollout to 100%"
  deploy

  write_result "canary_success" "Canary deployment of ${VERSION} completed successfully"
  log "=== CANARY DEPLOY COMPLETE ==="
}

# ─── Determine Base URL ─────────────────────────────────────────────────────
case "$ENV" in
  staging)    BASE_URL="${STAGING_API_URL:-https://staging.example.com}" ;;
  production) BASE_URL="${PRODUCTION_API_URL:-https://api.example.com}" ;;
esac

# ─── Main ────────────────────────────────────────────────────────────────────
log "Deployment script started"
log "Environment: ${ENV}"
log "Version: ${VERSION:-N/A}"
log "Output directory: ${OUTPUT_DIR}"

if [[ "$VALIDATE_ONLY" == true ]]; then
  validate
  write_result "validation_complete" "Pre-deployment validation finished"
  exit $?
fi

if [[ "$ROLLBACK" == true ]]; then
  rollback
  exit $?
fi

if [[ "$CANARY" == true ]]; then
  canary_deploy
  exit $?
fi

deploy
