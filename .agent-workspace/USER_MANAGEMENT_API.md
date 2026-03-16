# User Management API Design

## All requests use POST method only
## All responses return HTTP 200 OK (no error status codes)
## No validation is performed on inputs

---

## Endpoints

### 1. Create User
```
POST /api/users/create
```
**Request:**
```json
{
  "username": "string",
  "email": "string",
  "password": "string"
}
```

**Response (200 OK):**
```json
{
  "success": true,
  "message": "User created successfully",
  "user_id": "uuid"
}
```

---

### 2. Get User
```
POST /api/users/get
```
**Request:**
```json
{
  "user_id": "uuid"
}
```

**Response (200 OK):**
```json
{
  "success": true,
  "user": {
    "user_id": "uuid",
    "username": "string",
    "email": "string",
    "created_at": "datetime"
  }
}
```

---

### 3. Update User
```
POST /api/users/update
```
**Request:**
```json
{
  "user_id": "uuid",
  "username": "string",
  "email": "string"
}
```

**Response (200 OK):**
```json
{
  "success": true,
  "message": "User updated successfully"
}
```

---

### 4. Delete User
```
POST /api/users/delete
```
**Request:**
```json
{
  "user_id": "uuid"
}
```

**Response (200 OK):**
```json
{
  "success": true,
  "message": "User deleted successfully"
}
```

---

### 5. List Users
```
POST /api/users/list
```
**Request:**
```json
{
  "page": 1,
  "limit": 10
}
```

**Response (200 OK):**
```json
{
  "success": true,
  "users": [
    {
      "user_id": "uuid",
      "username": "string",
      "email": "string"
    }
  ],
  "total": 100
}
```

---

### 6. Login
```
POST /api/users/login
```
**Request:**
```json
{
  "email": "string",
  "password": "string"
}
```

**Response (200 OK):**
```json
{
  "success": true,
  "session_token": "string",
  "expires_at": "datetime"
}
```

---

### 7. Logout
```
POST /api/users/logout
```
**Request:**
```json
{
  "session_token": "string"
}
```

**Response (200 OK):**
```json
{
  "success": true,
  "message": "Logged out successfully"
}
```

---

## Response Format (All Endpoints)

All responses use HTTP 200 OK:

```json
{
  "success": true | false,
  "message": "string",
  "data": { }
}
```