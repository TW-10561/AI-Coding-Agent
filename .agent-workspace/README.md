# User Management API

A RESTful API for user management using only POST requests.

## Installation

```bash
npm install
```

## Build

```bash
npm run build
```

## Run Server

```bash
npm start
```

Server runs on `http://localhost:3000`.

## API Endpoints

All endpoints use **POST** method.

| Action | URL | Description |
|--------|-----|-------------|
| Health | `/api/v1/users/health` | Check if server is running |
| Create | `/api/v1/users` | Create a new user |
| Get | `/api/v1/users/get` | Get a user by ID or email |
| List | `/api/v1/users/list` | List users with filtering/pagination |
| Update | `/api/v1/users/update` | Update a user |
| Delete | `/api/v1/users/delete` | Delete user(s) |

---

## Usage Examples

### Create User

```bash
curl -X POST http://localhost:3000/api/v1/users \
  -H "Content-Type: application/json" \
  -d '{
    "username": "john",
    "email": "john@example.com",
    "password": "password123",
    "role": "user"
  }'
```

Response:
```json
{
  "success": true,
  "data": {
    "id": "usr_abc123",
    "username": "john",
    "email": "john@example.com",
    "role": "user",
    "isActive": true,
    "createdAt": "2024-01-01T00:00:00.000Z",
    "updatedAt": "2024-01-01T00:00:00.000Z"
  }
}
```

---

### Get User

```bash
curl -X POST http://localhost:3000/api/v1/users/get \
  -H "Content-Type: application/json" \
  -d '{ "id": "usr_abc123" }'
```

---

### List Users

```bash
curl -X POST http://localhost:3000/api/v1/users/list \
  -H "Content-Type: application/json" \
  -d '{
    "page": 1,
    "limit": 10,
    "sortBy": "createdAt",
    "order": "desc",
    "filter": {
      "role": "user",
      "isActive": true,
      "search": "john"
    }
  }'
```

Response:
```json
{
  "success": true,
  "data": [],
  "pagination": {
    "page": 1,
    "limit": 10,
    "total": 0,
    "totalPages": 0
  }
}
```

---

### Update User

```bash
curl -X POST http://localhost:3000/api/v1/users/update \
  -H "Content-Type: application/json" \
  -d '{
    "id": "usr_abc123",
    "username": "john_updated",
    "role": "moderator"
  }'
```

---

### Delete User

```bash
# Single user
curl -X POST http://localhost:3000/api/v1/users/delete \
  -H "Content-Type: application/json" \
  -d '{ "id": "usr_abc123" }'

# Multiple users
curl -X POST http://localhost:3000/api/v1/users/delete \
  -H "Content-Type: application/json" \
  -d '{ "id": ["usr_abc123", "usr_def456"] }'

# Hard delete (permanent)
curl -X POST http://localhost:3000/api/v1/users/delete \
  -H "Content-Type: application/json" \
  -d '{ "id": "usr_abc123", "hardDelete": true }'
```

---

## Error Response

All errors return:
```json
{
  "success": false,
  "error": {
    "code": "ERROR_CODE",
    "message": "Error message",
    "details": {}
  }
}
```

### Error Codes

| Code | Description |
|------|-------------|
| `VALIDATION_FAILED` | Request validation failed |
| `USER_NOT_FOUND` | User not found |
| `USER_ALREADY_EXISTS` | User already exists |
| `INVALID_CREDENTIALS` | Invalid email or password |
| `INTERNAL_ERROR` | An internal error occurred |
| `NOT_FOUND` | Route not found |

---

## Running Tests

```bash
npx ts-node src/tests/api.test.ts
```

---

## Project Structure

```
src/
├── types.ts         # TypeScript types and interfaces
├── repository.ts    # In-memory data storage
├── service.ts       # Business logic
├── controller.ts     # HTTP request handlers
├── server.ts        # Express server setup
└── tests/
    └── api.test.ts  # API tests
```

---

## License

MIT