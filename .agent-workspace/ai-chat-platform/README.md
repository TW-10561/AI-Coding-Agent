# Real-Time AI Chat Collaboration Platform

## System Architecture Overview

The platform consists of:

1. **FastAPI Backend** - Handles REST APIs, WebSocket connections, and authentication
2. **PostgreSQL Database** - Stores users, messages, and chat rooms
3. **Redis** - Message queue for Celery workers
4. **Celery Workers** - Background task processing for AI responses and notifications
5. **React Frontend** - Real-time chat interface

## Installation

```bash
# Clone the repository
git clone <repo-url>
cd ai-chat-platform

# Copy environment file
cp .env.example .env

# Start with Docker
docker-compose up -d

# Or run individually
# Terminal 1: Start PostgreSQL and Redis
docker-compose up db redis -d

# Terminal 2: Start backend
cd backend
pip install -r requirements.txt
uvicorn app.main:app --reload

# Terminal 3: Start Celery worker
cd backend
celery -A app.tasks.celery_worker worker --loglevel=info

# Terminal 4: Start frontend
cd frontend
npm install
npm run dev
```