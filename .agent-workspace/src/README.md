# User Management API

A RESTful API for user management using only POST requests.

## Base URL

```
POST /api/v1/users
```

## Endpoints

| Action | URL | Description |
|--------|-----|-------------|
| **Create** | `/api/v1/users` | Create new user |
| **Read One** | `/api/v1/users/get` | Get user by ID |
| **Read All** | `/api/v1/users/list` | List/filter users |
| **Update** | `/api/v1/users/update` | Update existing user |
| **Delete** | `/api/v1/users/delete` | Delete user(s) |

---

## Usage Examples

### Create User

```bash
curl -X POST http://localhost:3000/api/v1/users \
  -H "Content-Type: application/json" \
  -d '{
    "username": "john",
    "email": "john@example.com",
    "password": "secure123",
    "role": "user"
  }'
```

**Response (201 Created):**
```json
{
  "success": true,
  "data": {
    "id": "usr_12345",
    "username": "john",
    "email": "john@example.com",
    "role": "user",
    "isActive": true,
    "createdAt": "2025-01-01T00:00:00.000Z",
    "updatedAt": "2025-01-01T00:00:00.000Z"
  }
}
```

---

### Get User

```bash
curl -X POST http://localhost:3000/api/v1/users/get \
  -d '{ "id": "usr_12345" }'
```

**Response (200 OK):**
```json
{
  "success": true,
  "data": {
    "id": "usr_12345",
    "username": "john",
    "email": "john@example.com",
    "role": "user",
    "isActive": true,
    "createdAt": "2025-01-01T00:00:00.000Z",
    "updatedAt": "2025-01-01T00:00:00.000Z"
  }
}
```

---

### List Users

```bash
curl -X POST http://localhost:3000/api/v1/users/list \
  -d '{
    "page": 1,
    "limit": 10,
    "sortBy": "createdAt",
    "order": "desc",
    "filter": {
      "role": "user",
      "isActive": true
    }
  }'
```

**Response (200 OK):**
```json
{
  "success": true,
  "data": [
    { "id": "usr_12345", "username": "john", "email": "john@example.com", "role": "user" }
  ],
  "pagination": {
    "page": 1,
    "limit": 10,
    "total": 1,
    "totalPages": 1
  }
}
```

---

### Update User

```bash
curl -X POST http://localhost:3000/api/v1/users/update \
  -d '{
    "id": "usr_12345",
    "username": "john_updated",
    "role": "moderator"
  }'
```

**Response (200 OK):**
```json
{
  "success": true,
  "data": {
    "id": "usr_12345",
    "updatedFields": ["username", "role"],
    "timestamp": "2025-01-01T00:00:00.000Z"
  }
}
```

---

### Delete User

```bash
# Single user
curl -X POST http://localhost:3000/api/v1/users/delete \
  -d '{ "id": "usr_12345" }'

# Multiple users
curl -X POST http://localhost:3000/api/v1/users/delete \
  -d '{ "id": ["usr_1", "usr_2", "usr_3"] }'

# Hard delete (permanent)
curl -X POST http://localhost:3000/api/v1/users/delete \
  -d '{ "id": "usr_12345", "hardDelete": true }'
```

**Response (200 OK):**
```json
{
  "success": true,
  "data": {
    "deletedCount": 1,
    "deletedIds": ["usr_12345"],
    "softDeleted": true
  }
}
```

---

## Error Response (All Endpoints)

```json
{
  "success": false,
  "error": {
    "code": "VALIDATION_FAILED",
    "message": "Username must be at least 3 characters",
    "details": {}
  }
}
```

### Error Codes

| Code | Description |
|------|-------------|
| `VALIDATION_FAILED` | Request validation failed |
| `NOT_FOUND` | Resource not found |
| `EMAIL_EXISTS` | Email already registered |
| `MISSING_PARAMS` | Required parameters missing |
| `INTERNAL_ERROR` | Server error |

---

## Running the Server

```bash
# Install dependencies
npm install express uuid

# Run with ts-node
npx ts-node src/user-management-api.ts

# Or compile and run
npx tsc src/user-management-api.ts --outDir dist
node dist/user-management-api.js
```

---

## Running Tests

```bash
npm install --save-dev jest @types/jest supertest @types/supertest ts-node

npx jest src/user-management-api.test.ts
```

---

## Project Structure

```
src/
├── user-management-api.ts      # Main implementation
└── user-management-api.test.ts  # Tests
```

---

## Implementation Details

- **In-memory storage**: Replace with database (PostgreSQL, MongoDB, etc.) for production
- **Password hashing**: Currently stores plain text. Use `bcrypt` or `argon2` in production
- **Authentication**: Add JWT or session middleware for protected routes
- **Rate limiting**: Add `express-rate-limit` to prevent brute-force attacks
- **Input sanitization**: Use `express-validator` or `zoid` for robust validation