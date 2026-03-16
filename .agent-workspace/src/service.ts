// ============================================
// User Service Layer
// ============================================

import {
  User,
  UserRole,
  CreateUserRequest,
  CreateUserResponse,
  GetUserRequest,
  GetUserResponse,
  ListUsersRequest,
  ListUsersResponse,
  UpdateUserRequest,
  UpdateUserResponse,
  DeleteUserRequest,
  DeleteUserResponse,
  ErrorResponse,
} from './types';
import { userRepository } from './repository';

type ServiceResponse<T> = T | ErrorResponse;

// Helper to create error response
function errorResponse(
  code: string,
  message: string,
  details?: Record<string, unknown>,
  statusCode: number = 400
): ErrorResponse {
  return {
    success: false,
    error: { code, message, details },
    statusCode,
  };
}

// ============================================
// Service Methods
// ============================================

export class UserService {
  // Create a new user
  static create(req: CreateUserRequest): ServiceResponse<CreateUserResponse> {
    // Validate required fields
    if (!req.username || typeof req.username !== 'string') {
      return {
        ...errorResponse('VALIDATION_FAILED', 'Username is required', {
          username: 'Expected a non-empty string',
        }),
        statusCode: 400,
      };
    }

    if (!req.email || typeof req.email !== 'string' || !req.email.includes('@')) {
      return {
        ...errorResponse('VALIDATION_FAILED', 'Invalid email format', {
          email: 'Expected a valid email address',
        }),
        statusCode: 400,
      };
    }

    if (!req.password || typeof req.password !== 'string' || req.password.length < 8) {
      return {
        ...errorResponse(
          'VALIDATION_FAILED',
          'Password must be at least 8 characters',
          { password: 'Expected a string with minimum 8 characters' }
        ),
        statusCode: 400,
      };
    }

    // Validate role if provided
    const validRoles: UserRole[] = ['admin', 'moderator', 'user'];
    const role: UserRole = validRoles.includes(req.role as UserRole)
      ? (req.role as UserRole)
      : 'user';

    try {
      const user = userRepository.create({
        username: req.username,
        email: req.email,
        passwordHash: req.password,  // Will be hashed in repository
        role,
        isActive: true,
      });

      return { success: true, data: user };
    } catch (error: any) {
      if (error.code === 'USER_ALREADY_EXISTS') {
        return { ...errorResponse(error.code, error.message, error.details), statusCode: 409 };
      }
      return { ...errorResponse('INTERNAL_ERROR', 'Failed to create user'), statusCode: 500 };
    }
  }

  // Get a user by ID or email
  static get(req: GetUserRequest): ServiceResponse<GetUserResponse> {
    if (!req.id && !req.email) {
      return {
        ...errorResponse(
          'VALIDATION_FAILED',
          'Either id or email is required',
          { field: 'Expected "id" or "email" to be present' }
        ),
        statusCode: 400,
      };
    }

    let user: User | null = null;

    if (req.id) {
      user = userRepository.findById(req.id);
    } else if (req.email) {
      user = userRepository.findByEmail(req.email);
    }

    if (!user) {
      return {
        ...errorResponse('USER_NOT_FOUND', 'User not found'),
        statusCode: 404,
      };
    }

    return { success: true, data: user };
  }

  // List users with filtering and pagination
  static list(req: ListUsersRequest = {}): ServiceResponse<ListUsersResponse> {
    const page = Math.max(1, req.page || 1);
    const limit = Math.min(100, Math.max(1, req.limit || 20));

    const { data, total } = userRepository.list({
      page,
      limit,
      sortBy: req.sortBy,
      order: req.order,
      filter: req.filter,
    });

    // Paginate results
    const startIndex = (page - 1) * limit;
    const paginatedData = data.slice(startIndex, startIndex + limit);
    const totalPages = Math.ceil(total / limit);

    return {
      success: true,
      data: paginatedData,
      pagination: {
        page,
        limit,
        total,
        totalPages,
      },
    };
  }

  // Update a user
  static update(req: UpdateUserRequest): ServiceResponse<UpdateUserResponse> {
    if (!req.id) {
      return {
        ...errorResponse('VALIDATION_FAILED', 'User ID is required', {
          id: 'Expected a non-empty string',
        }),
        statusCode: 400,
      };
    }

    // Validate email if provided
    if (req.email && (typeof req.email !== 'string' || !req.email.includes('@'))) {
      return {
        ...errorResponse('VALIDATION_FAILED', 'Invalid email format', {
          email: 'Expected a valid email address',
        }),
        statusCode: 400,
      };
    }

    // Validate role if provided
    if (req.role) {
      const validRoles: UserRole[] = ['admin', 'moderator', 'user'];
      if (!validRoles.includes(req.role)) {
        return {
          ...errorResponse('VALIDATION_FAILED', 'Invalid role', {
            role: `Expected one of: ${validRoles.join(', ')}`,
          }),
          statusCode: 400,
        };
      }
    }

    // Validate password if provided
    if (req.password && (typeof req.password !== 'string' || req.password.length < 8)) {
      return {
        ...errorResponse(
          'VALIDATION_FAILED',
          'Password must be at least 8 characters',
          { password: 'Expected a string with minimum 8 characters' }
        ),
        statusCode: 400,
      };
    }

    const updatedUser = userRepository.update(req.id, {
      username: req.username,
      email: req.email,
      password: req.password,
      role: req.role,
      isActive: req.isActive,
    });

    if (!updatedUser) {
      return {
        ...errorResponse('USER_NOT_FOUND', 'User not found'),
        statusCode: 404,
      };
    }

    // Get list of updated fields
    const updatedFields = Object.keys(req).filter(
      (k) => k !== 'id' && req[k as keyof UpdateUserRequest] !== undefined
    );

    return {
      success: true,
      data: updatedUser,
      updatedFields,
      timestamp: updatedUser.updatedAt,
    };
  }

  // Delete a user
  static delete(req: DeleteUserRequest): ServiceResponse<DeleteUserResponse> {
    if (!req.id) {
      return {
        ...errorResponse('VALIDATION_FAILED', 'User ID(s) is required', {
          id: 'Expected a non-empty string or array of strings',
        }),
        statusCode: 400,
      };
    }

    const hardDelete = req.hardDelete || false;
    const ids = Array.isArray(req.id) ? req.id : [req.id];

    // Validate all IDs exist
    const existingIds = ids.filter((id) => userRepository.findById(id));
    if (existingIds.length === 0) {
      return {
        ...errorResponse('USER_NOT_FOUND', 'No users found with the given ID(s)'),
        statusCode: 404,
      };
    }

    const result = userRepository.delete(ids, hardDelete);

    return {
      success: true,
      deletedCount: result.deletedIds.length,
      deletedIds: result.deletedIds,
      softDeleted: result.softDeleted,
    };
  }
}

// Export individual methods for convenience
export const createUser = UserService.create;
export const getUser = UserService.get;
export const listUsers = UserService.list;
export const updateUser = UserService.update;
export const deleteUser = UserService.delete;