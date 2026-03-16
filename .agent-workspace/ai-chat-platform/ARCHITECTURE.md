# AI Chat Collaboration Platform Architecture

## System Overview

```
�---+-------------------+-------------------+-------------------+
    |                   |                   |                   |
    V                   V                   V                   |
+-----------+   +-------------------+   +-------------------+
|  Frontend |   |      Backend      |   |   Celery Workers  |
|   (React) |   |    (FastAPI)     |   |   (Redis Broker)  |
+-----------+   +-------------------+   +-------------------+
    |                   |                   |
    |                   |                   |
    |                   V                   V
    |           +----+-----------+   +------+-----------+
    |           |   |  PostgreSQL |   |      |   Redis    |
    |           |   |  (Messages) |   |      | (Cache)    |
    |           |   +-------------+   |      +------------+
    |           |                  |   |
    |           |                  |   |
    |           |                  V   V
    |           |           +------+------+
    |           |           |   AI Service  |
    |           |           +---------------+
    |
    +-------------------+-------------------+
    |      WebSockets   |      REST API     |
    +-------------------+-------------------+
```

## Component Details

### Frontend (React + TypeScript)
- **UI Framework**: React 18 with TypeScript
- **State Management**: React Context + TanStack Query
- **Real-time**: WebSocket client (Socket.IO)
- **Styling**: Tailwind CSS
- **Routing**: React Router 6

### Backend (FastAPI + Python)
- **Web Framework**: FastAPI (async, high performance)
- **ORM**: SQLAlchemy 2.0 (async)
- **Authentication**: JWT tokens with OAuth2 password flow
- **Real-time**: WebSocket support via WebSocketEndpoint
- **Validation**: Pydantic models

### Database (PostgreSQL 15+)
- **Tables**: users, rooms, messages, room_members, notifications
- **Features**: JSONB for metadata, UUID primary keys, indexes for performance

### Cache & Tasks (Redis)
- **Caching**: Session data, rate limiting
- **Message Broker**: Celery with Redis backend
- **Task Queue**: AI inference, email notifications, analytics

### Background Workers (Celery)
- **AI Tasks**: Response generation, sentiment analysis
- **Notification Tasks**: Email digests, push notifications
- **Maintenance**: Database cleanup, analytics aggregation

## Data Flow

```
User Action                    Flow                              Storage
-------                       ----                              -------
1. User connects    -> WebSocket -> Redis (session) -> DB (auth)
2. Send message      -> WebSocket -> DB (persist) -> Celery (AI)
3. AI response       -> Celery -> WebSocket -> User (push)
4. Join room          -> DB (room_members) -> WebSocket (group)
5. Private chat       -> DB (check auth) -> WebSocket (direct)
```

## Security Layer

```
Layer 1: TLS/HTTPS (termination at nginx)
Layer 2: JWT Authentication (access tokens)
Layer 3: WebSocket Authentication (protocol upgrade)
Layer 4: Room Authorization (membership check)
Layer 5: Input Validation (Pydantic models)
```

## Scalability Targets

- **Horizontal**: Stateless backend, read-replica DB, sharded cache
- **Real-time**: WebSocket per instance, Redis pub/sub for broadcast
- **Workers**: Auto-scaling based on Redis queue length
- **Database**: Connection pooling (pgpool), read replicas