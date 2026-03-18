# Environment Configuration Guide

## Overview

This document defines the configuration differences between development, staging, and production environments. All environment-specific values are injected via environment variables -- never hardcoded in source.

## Environment Comparison Matrix

| Configuration | Development | Staging | Production |
|---------------|-------------|---------|------------|
| **Deploy trigger** | Local / push to branch | Push to `main` / manual | Manual approval required |
| **Base URL** | `http://localhost:8000` | `https://staging.example.com` | `https://api.example.com` |
| **Frontend URL** | `http://localhost:3000` | `https://staging-app.example.com` | `https://app.example.com` |
| **Database** | Local PostgreSQL 16 | Staging RDS PostgreSQL 16 | Production RDS PostgreSQL 16 |
| **Redis** | Local Redis 7 | ElastiCache (single node) | ElastiCache (cluster mode) |
| **Log level** | `DEBUG` | `INFO` | `WARNING` |
| **Debug mode** | `True` | `False` | `False` |
| **SSL/TLS** | Self-signed / none | ACM certificate | ACM certificate |
| **Replicas** | 1 | 2 | 3+ (auto-scaled) |
| **Secrets source** | `.env` file | GitHub Secrets | AWS Secrets Manager |
| **Feature flags** | All enabled | Per-feature | Gradual rollout |
| **CORS origins** | `*` | Staging domain only | Production domain only |
| **Rate limiting** | Disabled | Relaxed (100 req/min) | Strict (30 req/min) |
| **Error reporting** | Console only | Sentry (staging DSN) | Sentry (production DSN) |
| **Backups** | None | Daily | Hourly + continuous WAL |

## Required Environment Variables

### Backend (FastAPI)

```bash
# ─── Core ────────────────────────────────────────────────────────────────
APP_ENV=development|staging|production
DEBUG=true|false
SECRET_KEY=<random-64-char-string>
ALLOWED_HOSTS=localhost,staging.example.com,api.example.com

# ─── Database ────────────────────────────────────────────────────────────
DATABASE_URL=postgresql+asyncpg://user:password@host:5432/dbname
DATABASE_POOL_SIZE=5|10|20
DATABASE_MAX_OVERFLOW=10|20|40

# ─── Redis ───────────────────────────────────────────────────────────────
REDIS_URL=redis://localhost:6379/0
REDIS_MAX_CONNECTIONS=10|20|50

# ─── Authentication ──────────────────────────────────────────────────────
JWT_SECRET_KEY=<random-64-char-string>
JWT_ALGORITHM=HS256
JWT_ACCESS_TOKEN_EXPIRE_MINUTES=30|30|15

# ─── CORS ────────────────────────────────────────────────────────────────
CORS_ORIGINS=*|https://staging-app.example.com|https://app.example.com

# ─── Logging ─────────────────────────────────────────────────────────────
LOG_LEVEL=DEBUG|INFO|WARNING
LOG_FORMAT=console|json|json
SENTRY_DSN=<empty>|<staging-dsn>|<production-dsn>

# ─── External Services ──────────────────────────────────────────────────
SMTP_HOST=mailhog|ses-smtp.region.amazonaws.com|ses-smtp.region.amazonaws.com
S3_BUCKET=local-dev|staging-bucket|production-bucket
```

### Frontend (React)

```bash
# ─── API ─────────────────────────────────────────────────────────────────
REACT_APP_API_URL=http://localhost:8000|https://staging.example.com|https://api.example.com

# ─── Feature Flags ──────────────────────────────────────────────────────
REACT_APP_ENABLE_DEBUG_PANEL=true|false|false
REACT_APP_ENABLE_ANALYTICS=false|true|true

# ─── Error Tracking ─────────────────────────────────────────────────────
REACT_APP_SENTRY_DSN=<empty>|<staging-dsn>|<production-dsn>
REACT_APP_SENTRY_ENVIRONMENT=development|staging|production
```

## Secrets Management

### Development

Store secrets in a `.env` file (never committed to git):

```bash
# .env (gitignored)
SECRET_KEY=dev-secret-key-not-for-production
DATABASE_URL=postgresql+asyncpg://postgres:postgres@localhost:5432/app_dev
REDIS_URL=redis://localhost:6379/0
JWT_SECRET_KEY=dev-jwt-secret
```

### Staging

Secrets stored in GitHub Environment Secrets:

```
Repository Settings -> Environments -> staging -> Environment secrets
```

Required secrets:
- `DATABASE_URL`
- `REDIS_URL`
- `SECRET_KEY`
- `JWT_SECRET_KEY`
- `SENTRY_DSN`
- `DOCKER_PASSWORD`

### Production

Secrets stored in AWS Secrets Manager:

```bash
# Retrieve secrets at startup
aws secretsmanager get-secret-value \
  --secret-id prod/app/secrets \
  --query SecretString \
  --output text | jq -r 'to_entries[] | "\(.key)=\(.value)"' > /tmp/.env

# Or use ECS task definition with secrets references
```

## Database Configuration

### Connection Pool Settings

| Setting | Development | Staging | Production |
|---------|-------------|---------|------------|
| `pool_size` | 5 | 10 | 20 |
| `max_overflow` | 10 | 20 | 40 |
| `pool_timeout` | 30s | 30s | 10s |
| `pool_recycle` | 3600s | 1800s | 900s |
| `pool_pre_ping` | True | True | True |

### Migration Strategy Per Environment

| Environment | Migration Method | Approval |
|-------------|-----------------|----------|
| Development | `alembic upgrade head` (manual) | None |
| Staging | Automated in CI, dry-run first | Automated |
| Production | Automated in CI, dry-run + manual approval | Required |

## Health Check Configuration

All environments expose the same health check endpoints but with different thresholds:

```python
# config.py
HEALTH_CHECK_CONFIG = {
    "development": {
        "timeout_seconds": 10,
        "check_database": True,
        "check_redis": True,
        "check_external_services": False,
    },
    "staging": {
        "timeout_seconds": 5,
        "check_database": True,
        "check_redis": True,
        "check_external_services": True,
    },
    "production": {
        "timeout_seconds": 3,
        "check_database": True,
        "check_redis": True,
        "check_external_services": True,
    },
}
```

## Deployment Checklist by Environment

### Before Deploying to Staging
- [ ] All environment variables set in GitHub Secrets
- [ ] Database migrations tested locally
- [ ] Feature flags configured in staging config
- [ ] Dependent services available in staging

### Before Deploying to Production
- [ ] Staging deployment verified and smoke tests passing
- [ ] All production environment variables configured in AWS Secrets Manager
- [ ] Database migration dry-run completed against production clone
- [ ] Rollback plan documented
- [ ] On-call engineer notified
- [ ] Feature flags set for gradual rollout
