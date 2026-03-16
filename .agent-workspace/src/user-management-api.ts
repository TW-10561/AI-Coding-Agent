/**
 * User Management API
 * 
 * Endpoints (POST only):
 * - POST /api/v1/users          → Create user
 * - POST /api/v1/users/get      → Get user by ID
 * - POST /api/v1/users/list     → List/filter users
 * - POST /api/v1/users/update   → Update user
 * - POST /api/v1/users/delete  → Delete user(s)
 */

import express, { Request, Response, Router } from 'express';
import { v4 as uuidv4 } from 'uuid';

// ───────────────────────────────────────────────
// Types
// ───────────────────────────────────────────────

export type UserRole = 'admin' | 'moderator' | 'user';

export interface User {
  id: string;
  username: string;
  email: string;
  password: string;  // In production, this should be hashed!
  role: UserRole;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface UserResponse {
  id: string;
  username: string;
  email: string;
  role: UserRole;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface PaginatedResponse<T> {
  data: T[];
  pagination: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
}

export interface ErrorResponse {
  success: false;
  error: {
    code: string;
    message: string;
    details?: Record<string, unknown>;
  };
}

// Request types
export interface CreateUserRequest {
  username: string;
  email: string;
  password: string;
  role?: UserRole;
}

export interface GetUserRequest {
  id?: string;
  email?: string;
}

export interface ListUsersRequest {
  page?: number;
  limit?: number;
  sortBy?: 'createdAt' | 'username' | 'email';
  order?: 'asc' | 'desc';
  filter?: {
    role?: UserRole;
    isActive?: boolean;
    search?: string;
  };
}

export interface UpdateUserRequest {
  id: string;
  username?: string;
  email?: string;
  password?: string;
  role?: UserRole;
  isActive?: boolean;
}

export interface DeleteUserRequest {
  id: string | string[];
  hardDelete?: boolean;
}

// ───────────────────────────────────────────────
// In-Memory Storage (Replace with DB in production)
// ───────────────────────────────────────────────

const users: Map<string, User> = new Map();
const emailIndex: Map<string, string> = new Map(); // email → userId

// ───────────────────────────────────────────────
// Helper Functions
// ───────────────────────────────────────────────

function generateErrorResponse(
  code: string,
  message: string,
  details?: Record<string, unknown>
): ErrorResponse {
  return {
    success: false,
    error: { code, message, details }
  };
}

function sanitizeUser(user: User): UserResponse {
  const { password, ...sanitized } = user;
  return sanitized as UserResponse;
}

function isValidEmail(email: string): boolean {
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return emailRegex.test(email);
}

function isStrongPassword(password: string): boolean {
  return password.length >= 8;
}

// ───────────────────────────────────────────────
// Request Validators
// ───────────────────────────────────────────────

export function validateCreateUser(req: CreateUserRequest): string | null {
  if (!req.username || req.username.length < 3) {
    return 'Username must be at least 3 characters';
  }
  if (!req.email || !isValidEmail(req.email)) {
    return 'Invalid email format';
  }
  if (!req.password || !isStrongPassword(req.password)) {
    return 'Password must be at least 8 characters';
  }
  if (req.role && !['admin', 'moderator', 'user'].includes(req.role)) {
    return 'Invalid role';
  }
  return null;
}

export function validateUpdateUser(req: UpdateUserRequest): string | null {
  if (!req.id) return 'User ID is required';
  if (req.username !== undefined && req.username.length < 3) {
    return 'Username must be at least 3 characters';
  }
  if (req.email !== undefined && !isValidEmail(req.email)) {
    return 'Invalid email format';
  }
  if (req.password !== undefined && !isStrongPassword(req.password)) {
    return 'Password must be at least 8 characters';
  }
  return null;
}

// ───────────────────────────────────────────────
// API Endpoints
// ───────────────────────────────────────────────

// POST /api/v1/users
export function createUser(req: Request, res: Response): void {
  const body = req.body as CreateUserRequest;
  
  // Validate
  const validationError = validateCreateUser(body);
  if (validationError) {
    res.status(400).json(generateErrorResponse('VALIDATION_FAILED', validationError));
    return;
  }
  
  // Check duplicates
  if (emailIndex.has(body.email)) {
    res.status(409).json(generateErrorResponse('EMAIL_EXISTS', 'Email already registered'));
    return;
  }
  
  // Create user
  const now = new Date().toISOString();
  const user: User = {
    id: uuidv4(),
    username: body.username,
    email: body.email,
    password: body.password, // In production: hash this!
    role: body.role || 'user',
    isActive: true,
    createdAt: now,
    updatedAt: now,
  };
  
  users.set(user.id, user);
  emailIndex.set(user.email, user.id);
  
  res.status(201).json({
    success: true,
    data: sanitizeUser(user)
  });
}

// POST /api/v1/users/get
export function getUser(req: Request, res: Response): void {
  const body = req.body as GetUserRequest;
  
  if (!body.id && !body.email) {
    res.status(400).json(generateErrorResponse(
      'MISSING_PARAMS',
      'Either "id" or "email" is required'
    ));
    return;
  }
  
  let userId = body.id;
  if (!userId && body.email) {
    userId = emailIndex.get(body.email);
  }
  
  if (!userId) {
    res.status(404).json(generateErrorResponse('NOT_FOUND', 'User not found'));
    return;
  }
  
  const user = users.get(userId);
  if (!user) {
    res.status(404).json(generateErrorResponse('NOT_FOUND', 'User not found'));
    return;
  }
  
  res.json({
    success: true,
    data: sanitizeUser(user)
  });
}

// POST /api/v1/users/list
export function listUsers(req: Request, res: Response): void {
  const body = req.body as ListUsersRequest;
  
  const page = Math.max(1, body.page || 1);
  const limit = Math.min(100, Math.max(1, body.limit || 20));
  const sortBy = body.sortBy || 'createdAt';
  const order = body.order || 'desc';
  const filter = body.filter || {};
  
  // Filter users
  let filtered = Array.from(users.values());
  
  if (filter.role) {
    filtered = filtered.filter(u => u.role === filter.role);
  }
  if (filter.isActive !== undefined) {
    filtered = filtered.filter(u => u.isActive === filter.isActive);
  }
  if (filter.search) {
    const search = filter.search.toLowerCase();
    filtered = filtered.filter(u => 
      u.username.toLowerCase().includes(search) ||
      u.email.toLowerCase().includes(search)
    );
  }
  
  // Sort
  filtered.sort((a, b) => {
    const aVal = a[sortBy];
    const bVal = b[sortBy];
    if (aVal < bVal) return order === 'asc' ? -1 : 1;
    if (aVal > bVal) return order === 'asc' ? 1 : -1;
    return 0;
  });
  
  // Paginate
  const total = filtered.length;
  const totalPages = Math.ceil(total / limit);
  const start = (page - 1) * limit;
  const end = start + limit;
  const data = filtered.slice(start, end).map(sanitizeUser);
  
  res.json({
    success: true,
    data,
    pagination: { page, limit, total, totalPages }
  });
}

// POST /api/v1/users/update
export function updateUser(req: Request, res: Response): void {
  const body = req.body as UpdateUserRequest;
  
  // Validate
  const validationError = validateUpdateUser(body);
  if (validationError) {
    res.status(400).json(generateErrorResponse('VALIDATION_FAILED', validationError));
    return;
  }
  
  const user = users.get(body.id);
  if (!user) {
    res.status(404).json(generateErrorResponse('NOT_FOUND', 'User not found'));
    return;
  }
  
  // Check email uniqueness if changing
  if (body.email && body.email !== user.email) {
    if (emailIndex.has(body.email)) {
      res.status(409).json(generateErrorResponse('EMAIL_EXISTS', 'Email already registered'));
      return;
    }
    emailIndex.delete(user.email);
    emailIndex.set(body.email, user.id);
  }
  
  // Update fields
  const updatedFields: string[] = [];
  const now = new Date().toISOString();
  
  if (body.username && body.username !== user.username) {
    user.username = body.username;
    updatedFields.push('username');
  }
  if (body.email && body.email !== user.email) {
    user.email = body.email;
    updatedFields.push('email');
  }
  if (body.password && body.password !== user.password) {
    user.password = body.password; // In production: hash this!
    updatedFields.push('password');
  }
  if (body.role && body.role !== user.role) {
    user.role = body.role;
    updatedFields.push('role');
  }
  if (body.isActive !== undefined && body.isActive !== user.isActive) {
    user.isActive = body.isActive;
    updatedFields.push('isActive');
  }
  
  if (updatedFields.length > 0) {
    user.updatedAt = now;
  }
  
  res.json({
    success: true,
    data: {
      id: user.id,
      updatedFields,
      timestamp: now
    }
  });
}

// POST /api/v1/users/delete
export function deleteUser(req: Request, res: Response): void {
  const body = req.body as DeleteUserRequest;
  
  if (!body.id) {
    res.status(400).json(generateErrorResponse('MISSING_ID', 'User ID(s) required'));
    return;
  }
  
  const ids = Array.isArray(body.id) ? body.id : [body.id];
  const deletedIds: string[] = [];
  
  for (const id of ids) {
    const user = users.get(id);
    if (!user) continue;
    
    if (body.hardDelete) {
      users.delete(id);
      emailIndex.delete(user.email);
      deletedIds.push(id);
    } else {
      // Soft delete
      user.isActive = false;
      user.updatedAt = new Date().toISOString();
      deletedIds.push(id);
    }
  }
  
  if (deletedIds.length === 0) {
    res.status(404).json(generateErrorResponse('NOT_FOUND', 'No users found'));
    return;
  }
  
  res.json({
    success: true,
    data: {
      deletedCount: deletedIds.length,
      deletedIds,
      softDeleted: !body.hardDelete
    }
  });
}

// ───────────────────────────────────────────────
// Express Router
// ───────────────────────────────────────────────

export function createUserRouter(): Router {
  const router = express.Router();
  
  router.post('/users', createUser);
  router.post('/users/get', getUser);
  router.post('/users/list', listUsers);
  router.post('/users/update', updateUser);
  router.post('/users/delete', deleteUser);
  
  return router;
}

// ───────────────────────────────────────────────
// App Entry Point
// ───────────────────────────────────────────────

const app = express();
app.use(express.json());

// Mount API v1
app.use('/api/v1', createUserRouter());

// Error handler
app.use((err: Error, _req: Request, res: Response) => {
  console.error(err);
  res.status(500).json(generateErrorResponse('INTERNAL_ERROR', 'An error occurred'));
});

// Start server (uncomment for standalone usage)
// app.listen(3000, () => console.log('Server running on port 3000'));

export default app;