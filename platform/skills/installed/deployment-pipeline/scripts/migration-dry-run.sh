#!/usr/bin/env bash
#
# migration-dry-run.sh -- Test Alembic migrations against a staging database
#
# Creates a temporary database clone, runs pending migrations, validates
# the schema, and reports results without affecting the actual database.
#
# Usage:
#   ./migration-dry-run.sh --db-url postgresql://user:pass@host:5432/db --output-dir ./results/
#
set -euo pipefail

# ─── Defaults ────────────────────────────────────────────────────────────────
DB_URL=""
OUTPUT_DIR="./migration-dry-run-results"
ALEMBIC_CONFIG="alembic.ini"
CLONE_SUFFIX="_migration_test"
CLEANUP=true

# ─── Parse Arguments ─────────────────────────────────────────────────────────
while [[ $# -gt 0 ]]; do
  case "$1" in
    --db-url)         DB_URL="$2"; shift 2 ;;
    --output-dir)     OUTPUT_DIR="$2"; shift 2 ;;
    --alembic-config) ALEMBIC_CONFIG="$2"; shift 2 ;;
    --no-cleanup)     CLEANUP=false; shift ;;
    -h|--help)
      echo "Usage: $0 --db-url <database-url> --output-dir <dir>"
      echo ""
      echo "Options:"
      echo "  --db-url          PostgreSQL connection URL for staging database"
      echo "  --output-dir      Directory for migration test result files"
      echo "  --alembic-config  Path to alembic.ini (default: alembic.ini)"
      echo "  --no-cleanup      Do not drop the test database after migration"
      exit 0
      ;;
    *) echo "ERROR: Unknown argument: $1" >&2; exit 1 ;;
  esac
done

if [[ -z "$DB_URL" ]]; then
  echo "ERROR: --db-url is required" >&2
  exit 1
fi

# ─── Setup Output ────────────────────────────────────────────────────────────
mkdir -p "$OUTPUT_DIR"
TIMESTAMP=$(date -u +"%Y%m%dT%H%M%SZ")
LOG_FILE="${OUTPUT_DIR}/migration-dry-run-${TIMESTAMP}.log"
RESULT_FILE="${OUTPUT_DIR}/migration-dry-run-${TIMESTAMP}.json"

log() {
  local msg="[$(date -u +"%Y-%m-%dT%H:%M:%SZ")] $1"
  echo "$msg" | tee -a "$LOG_FILE"
}

# ─── Parse Database URL ─────────────────────────────────────────────────────
# Extract database name from URL: postgresql://user:pass@host:port/dbname
ORIGINAL_DB=$(echo "$DB_URL" | sed 's|.*/||')
TEST_DB="${ORIGINAL_DB}${CLONE_SUFFIX}"
TEST_DB_URL="${DB_URL%/*}/${TEST_DB}"

# Extract connection details for psql commands (without the database name)
CONN_URL="${DB_URL%/*}/postgres"

log "=== Migration Dry Run ==="
log "Original database: ${ORIGINAL_DB}"
log "Test database: ${TEST_DB}"
log "Alembic config: ${ALEMBIC_CONFIG}"

# ─── Cleanup Function ───────────────────────────────────────────────────────
cleanup() {
  if [[ "$CLEANUP" == true ]]; then
    log "Cleaning up test database ${TEST_DB}..."
    psql "$CONN_URL" -c "DROP DATABASE IF EXISTS \"${TEST_DB}\";" >>"$LOG_FILE" 2>&1 || {
      log "WARNING: Failed to drop test database ${TEST_DB}"
    }
  else
    log "Skipping cleanup (--no-cleanup specified). Test database: ${TEST_DB}"
  fi
}

trap cleanup EXIT

# ─── Step 1: Create Test Database ────────────────────────────────────────────
log ""
log "Step 1: Creating test database from template..."

# Drop if exists from a previous run
psql "$CONN_URL" -c "DROP DATABASE IF EXISTS \"${TEST_DB}\";" >>"$LOG_FILE" 2>&1

# Create database as a copy of the original
if psql "$CONN_URL" -c "CREATE DATABASE \"${TEST_DB}\" WITH TEMPLATE \"${ORIGINAL_DB}\";" >>"$LOG_FILE" 2>&1; then
  log "OK: Test database ${TEST_DB} created from ${ORIGINAL_DB}"
else
  log "ERROR: Failed to create test database"
  cat > "$RESULT_FILE" <<EOJSON
{
  "status": "error",
  "error": "Failed to create test database",
  "timestamp": "${TIMESTAMP}",
  "original_db": "${ORIGINAL_DB}",
  "test_db": "${TEST_DB}"
}
EOJSON
  exit 1
fi

# ─── Step 2: Check Current Migration State ───────────────────────────────────
log ""
log "Step 2: Checking current migration state..."

CURRENT_HEAD=$(DATABASE_URL="$TEST_DB_URL" alembic -c "$ALEMBIC_CONFIG" current 2>>"$LOG_FILE" || echo "unknown")
log "Current migration head: ${CURRENT_HEAD}"

PENDING_MIGRATIONS=$(DATABASE_URL="$TEST_DB_URL" alembic -c "$ALEMBIC_CONFIG" heads --verbose 2>>"$LOG_FILE" || echo "unknown")
log "Target heads: ${PENDING_MIGRATIONS}"

# ─── Step 3: Run Migrations ─────────────────────────────────────────────────
log ""
log "Step 3: Running pending migrations on test database..."

MIGRATION_OUTPUT=""
MIGRATION_STATUS="success"
MIGRATION_ERROR=""

if MIGRATION_OUTPUT=$(DATABASE_URL="$TEST_DB_URL" alembic -c "$ALEMBIC_CONFIG" upgrade head 2>&1); then
  log "OK: Migrations completed successfully"
  log "Migration output:"
  echo "$MIGRATION_OUTPUT" | tee -a "$LOG_FILE"
else
  MIGRATION_STATUS="failed"
  MIGRATION_ERROR="$MIGRATION_OUTPUT"
  log "ERROR: Migration failed"
  log "Error output:"
  echo "$MIGRATION_OUTPUT" | tee -a "$LOG_FILE"
fi

# ─── Step 4: Validate Schema ────────────────────────────────────────────────
log ""
log "Step 4: Validating post-migration schema..."

SCHEMA_VALIDATION="unknown"
if [[ "$MIGRATION_STATUS" == "success" ]]; then
  # Get list of tables
  TABLES=$(psql "$TEST_DB_URL" -t -c "
    SELECT table_name FROM information_schema.tables
    WHERE table_schema = 'public'
    ORDER BY table_name;
  " 2>>"$LOG_FILE" || echo "")

  if [[ -n "$TABLES" ]]; then
    log "Tables in migrated schema:"
    echo "$TABLES" | tee -a "$LOG_FILE"
    SCHEMA_VALIDATION="valid"
  else
    log "WARNING: No tables found after migration"
    SCHEMA_VALIDATION="empty"
  fi

  # Verify alembic version table
  ALEMBIC_VERSION=$(psql "$TEST_DB_URL" -t -c "
    SELECT version_num FROM alembic_version;
  " 2>>"$LOG_FILE" || echo "missing")
  log "Alembic version after migration: ${ALEMBIC_VERSION}"
fi

# ─── Step 5: Test Downgrade (Optional) ──────────────────────────────────────
log ""
log "Step 5: Testing migration reversibility..."

DOWNGRADE_STATUS="skipped"
if [[ "$MIGRATION_STATUS" == "success" ]]; then
  if DATABASE_URL="$TEST_DB_URL" alembic -c "$ALEMBIC_CONFIG" downgrade -1 >>"$LOG_FILE" 2>&1; then
    log "OK: Downgrade by one step succeeded"
    DOWNGRADE_STATUS="success"

    # Re-upgrade to verify idempotency
    if DATABASE_URL="$TEST_DB_URL" alembic -c "$ALEMBIC_CONFIG" upgrade head >>"$LOG_FILE" 2>&1; then
      log "OK: Re-upgrade after downgrade succeeded"
    else
      log "WARNING: Re-upgrade after downgrade failed"
      DOWNGRADE_STATUS="re-upgrade-failed"
    fi
  else
    log "WARNING: Downgrade failed (migration may be forward-only)"
    DOWNGRADE_STATUS="failed"
  fi
fi

# ─── Write Results ───────────────────────────────────────────────────────────
log ""
log "Writing results to ${RESULT_FILE}"

# Escape strings for JSON
MIGRATION_ERROR_ESCAPED=$(echo "$MIGRATION_ERROR" | python3 -c "import sys,json; print(json.dumps(sys.stdin.read()))" 2>/dev/null | sed 's/^"//;s/"$//' || echo "$MIGRATION_ERROR")
MIGRATION_OUTPUT_ESCAPED=$(echo "$MIGRATION_OUTPUT" | python3 -c "import sys,json; print(json.dumps(sys.stdin.read()))" 2>/dev/null | sed 's/^"//;s/"$//' || echo "$MIGRATION_OUTPUT")

cat > "$RESULT_FILE" <<EOJSON
{
  "timestamp": "${TIMESTAMP}",
  "original_db": "${ORIGINAL_DB}",
  "test_db": "${TEST_DB}",
  "migration_status": "${MIGRATION_STATUS}",
  "migration_output": "${MIGRATION_OUTPUT_ESCAPED}",
  "migration_error": "${MIGRATION_ERROR_ESCAPED}",
  "schema_validation": "${SCHEMA_VALIDATION}",
  "downgrade_test": "${DOWNGRADE_STATUS}",
  "alembic_version": "$(echo "$ALEMBIC_VERSION" | xargs)",
  "current_head_before": "${CURRENT_HEAD}",
  "log_file": "${LOG_FILE}"
}
EOJSON

# ─── Summary ─────────────────────────────────────────────────────────────────
log ""
log "=== Migration Dry Run Summary ==="
log "Migration:  ${MIGRATION_STATUS}"
log "Schema:     ${SCHEMA_VALIDATION}"
log "Downgrade:  ${DOWNGRADE_STATUS}"

if [[ "$MIGRATION_STATUS" != "success" ]]; then
  log "MIGRATION DRY RUN FAILED"
  exit 1
fi

log "MIGRATION DRY RUN PASSED"
exit 0
