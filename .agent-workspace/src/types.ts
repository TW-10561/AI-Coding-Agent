// ============================================
// User Management API Types
// ============================================

// User Model
export interface User {
  id: string;
  username: string;
  email: string;
  passwordHash: string;  // Never store plain text passwords
  role: UserRole;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export type UserRole = 'admin' | 'moderator' | 'user';

// ============================================
// Request/Response Types
// ============================================

// --- Create User ---

export interface CreateUserRequest {
  username: string;
  email: string;
  password: string;
  role?: UserRole;
}

export interface CreateUserResponse {
  success: true;
  data: User;
}

// --- Get User ---

export interface GetUserRequest {
  id: string;
  // OR
  email?: string;
}

export interface GetUserResponse {
  success: true;
  data: User | null;
}

// --- List Users ---

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

export interface PaginatedResponse<T> {
  data: T[];
  pagination: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
}

export type ListUsersResponse = PaginatedResponse<User> & { success: true };

// --- Update User ---

export interface UpdateUserRequest {
  id: string;
  username?: string;
  email?: string;
  password?: string;
  role?: UserRole;
  isActive?: boolean;
}

export interface UpdateUserResponse {
  success: true;
  data: User;
  updatedFields: string[];
  timestamp: string;
}

// --- Delete User ---

export interface DeleteUserRequest {
  id: string | string[];
  hardDelete?: boolean;
}

export interface DeleteUserResponse {
  success: true;
  deletedCount: number;
  deletedIds: string[];
  softDeleted: boolean;
}

// ============================================
// Error Response
// ============================================

export interface ErrorCode {
  code: string;
  message: string;
}

export const ERROR_CODES: Record<string, ErrorCode> = {
  VALIDATION_FAILED: {
    code: 'VALIDATION_FAILED',
    message: 'Request validation failed',
  },
  USER_NOT_FOUND: {
    code: 'USER_NOT_FOUND',
    message: 'User not found',
  },
  USER_ALREADY_EXISTS: {
    code: 'USER_ALREADY_EXISTS',
    message: 'User already exists',
  },
  INVALID_CREDENTIALS: {
    code: 'INVALID_CREDENTIALS',
    message: 'Invalid email or password',
  },
  INTERNAL_ERROR: {
    code: 'INTERNAL_ERROR',
    message: 'An internal error occurred',
  },
};

export interface ErrorResponse {
  success: false;
  statusCode: number;
  error: {
    code: string;
    message: string;
    details?: Record<string, unknown>;
  };
}