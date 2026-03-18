# Rollback Runbook

## Purpose

Step-by-step procedure for rolling back a failed production deployment. Follow this runbook whenever a deployment causes service degradation, error rate spikes, or health check failures.

## Prerequisites

Before starting a rollback:
- Identify the **previous stable version** (git SHA or tag)
- Confirm you have access to the deployment tooling
- Notify the on-call engineer and incident commander

## Rollback Decision Criteria

| Signal | Threshold | Action |
|--------|-----------|--------|
| Error rate | > 5% of requests | Immediate rollback |
| p99 latency | > 2x baseline | Immediate rollback |
| Health check failures | 2+ consecutive | Immediate rollback |
| Memory usage | > 90% | Immediate rollback |
| User-reported issues | 3+ unique reports | Evaluate, likely rollback |

## Step-by-Step Rollback Procedure

### Step 1: Confirm the Issue (2 minutes max)

```bash
# Check current health status
python skills/deployment-pipeline/scripts/health-check.py \
  --url https://api.example.com \
  --output-dir ./rollback-investigation/

# Check error rate in logs
curl -s https://api.example.com/health/ready | jq .

# Verify which version is currently deployed
docker ps --format "table {{.Image}}\t{{.Status}}\t{{.Names}}"
```

### Step 2: Announce Rollback (1 minute)

Post in the incident channel:

```
@channel ROLLBACK IN PROGRESS
Environment: production
Current version: <failing-sha>
Rolling back to: <previous-stable-sha>
Reason: <brief description>
ETA: 5-10 minutes
```

### Step 3: Execute Rollback (5 minutes)

**Option A: Automated rollback (preferred)**

```bash
./skills/deployment-pipeline/scripts/deploy.sh \
  --rollback \
  --env production \
  --version <PREVIOUS_STABLE_SHA> \
  --output-dir ./rollback-results/
```

**Option B: Manual rollback via Docker**

```bash
# Pull previous images
docker pull registry.example.com/app-backend:<PREVIOUS_SHA>
docker pull registry.example.com/app-frontend:<PREVIOUS_SHA>

# Update backend service
docker service update \
  --image registry.example.com/app-backend:<PREVIOUS_SHA> \
  app-backend

# Update frontend service
docker service update \
  --image registry.example.com/app-frontend:<PREVIOUS_SHA> \
  app-frontend
```

**Option C: Rollback via GitHub Actions**

1. Go to Actions tab in GitHub
2. Select "CI/CD Pipeline" workflow
3. Click "Run workflow"
4. Select environment: `production`
5. Enter the previous stable version SHA

### Step 4: Verify Rollback (3 minutes)

```bash
# Run health checks
python skills/deployment-pipeline/scripts/health-check.py \
  --url https://api.example.com \
  --retries 5 \
  --output-dir ./rollback-results/

# Run smoke tests
./skills/deployment-pipeline/scripts/smoke-test.sh \
  --url https://api.example.com \
  --output-dir ./rollback-results/

# Verify correct version is running
curl -s https://api.example.com/health | jq .version
```

### Step 5: Announce Resolution

```
@channel ROLLBACK COMPLETE
Environment: production
Rolled back to: <previous-stable-sha>
Status: All health checks passing
Next steps: RCA will be conducted within 24 hours
```

## Database Rollback Considerations

**Important:** Database migrations are forward-only by default.

### If the failed deployment included migrations:

1. **Do NOT run `alembic downgrade` in production** unless the migration was specifically designed to be reversible
2. Instead, create a new forward migration that undoes the changes
3. If data was corrupted, restore from the most recent backup

### Safe migration rollback pattern:

```bash
# Step 1: Identify the migration that needs reversal
alembic history --verbose

# Step 2: Create a reversal migration
alembic revision --autogenerate -m "Revert: <original migration description>"

# Step 3: Test the reversal migration
./skills/deployment-pipeline/scripts/migration-dry-run.sh \
  --db-url "$STAGING_DB_URL" \
  --output-dir ./migration-rollback-test/

# Step 4: Apply the reversal migration
alembic upgrade head
```

## Post-Rollback Actions

1. **Create incident ticket** with timeline, impact, and root cause hypothesis
2. **Schedule post-mortem** within 24-48 hours
3. **Document the rollback** in the deployment log
4. **Investigate root cause** before re-attempting deployment
5. **Add regression tests** for the failure scenario

## Emergency Contacts

| Role | Contact | When to Escalate |
|------|---------|-----------------|
| On-call engineer | PagerDuty rotation | First responder |
| Incident commander | Engineering manager | SEV1/SEV2 incidents |
| Database admin | DBA on-call | Data corruption or migration issues |
| Platform team | #platform-team Slack | Infrastructure issues |

## Rollback Checklist

- [ ] Issue confirmed (health checks, error rates, user reports)
- [ ] Previous stable version identified
- [ ] Team notified in incident channel
- [ ] Rollback executed
- [ ] Health checks passing after rollback
- [ ] Smoke tests passing after rollback
- [ ] Resolution announced
- [ ] Incident ticket created
- [ ] Post-mortem scheduled
