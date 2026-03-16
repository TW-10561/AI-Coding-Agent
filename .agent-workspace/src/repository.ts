// ============================================
// In-Memory User Repository
// ============================================

import { User, UserRole } from './types';
import { v4 as uuidv4 } from 'uuid';

interface UserRecord extends Omit<User, 'id' | 'createdAt' | 'updatedAt'> {
  // Extends user fields without id and timestamps
}

class UserRepository {
  private users: Map<string, User> = new Map();
  private emailIndex: Map<string, string> = new Map();  // email -> id
  private deletedUsers: Map<string, User> = new Map();  // Soft-deleted users

  // Create a new user
  create(data: UserRecord): User {
    const id = `usr_${uuidv4().replace(/-/g, '').substring(0, 12)}`;
    const now = new Date().toISOString();

    const user: User = {
      id,
      ...data,
      passwordHash: this.hashPassword(data.passwordHash),
      createdAt: now,
      updatedAt: now,
    };

    // Check for duplicate email
    if (this.emailIndex.has(data.email)) {
      throw {
        code: 'USER_ALREADY_EXISTS',
        message: `User with email ${data.email} already exists`,
      details: { email: data.email },
      statusCode: 409,
    };
    }

    this.users.set(id, user);
    this.emailIndex.set(data.email, id);

    return user;
  }

  // Find user by ID
  findById(id: string): User | null {
    return this.users.get(id) || null;
  }

  // Find user by email
  findByEmail(email: string): User | null {
    const id = this.emailIndex.get(email);
    if (!id) return null;
    return this.users.get(id) || null;
  }

  // List users with filtering and pagination
  list(options: {
    page?: number;
    limit?: number;
    sortBy?: 'createdAt' | 'username' | 'email';
    order?: 'asc' | 'desc';
    filter?: {
      role?: UserRole;
      isActive?: boolean;
      search?: string;
    };
  } = {}): { data: User[]; total: number } {
    const {
      sortBy = 'createdAt',
      order = 'desc',
      filter = {},
    } = options;

    // Get all users
    let results = Array.from(this.users.values());

    // Apply filters
    if (filter.role) {
      results = results.filter((u) => u.role === filter.role);
    }
    if (typeof filter.isActive === 'boolean') {
      results = results.filter((u) => u.isActive === filter.isActive);
    }
    if (filter.search) {
      const searchLower = filter.search.toLowerCase();
      results = results.filter(
        (u) =>
          u.username.toLowerCase().includes(searchLower) ||
          u.email.toLowerCase().includes(searchLower)
      );
    }

    // Apply sorting
    results.sort((a, b) => {
      let aVal: string | number = a[sortBy];
      let bVal: string | number = b[sortBy];

      // Handle date sorting
      if (sortBy === 'createdAt') {
        aVal = new Date(aVal as string).getTime();
        bVal = new Date(bVal as string).getTime();
      }

      if (typeof aVal === 'string') {
        aVal = aVal.toLowerCase();
        bVal = (bVal as string).toLowerCase();
      }

      if (order === 'asc') {
        return aVal > bVal ? 1 : -1;
      }
      return aVal < bVal ? 1 : -1;
    });

    return { data: results, total: results.length };
  }

  // Update user
  update(id: string, data: Partial<Omit<UserRecord, 'passwordHash'>> & { password?: string }): User | null {
    const user = this.users.get(id);
    if (!user) return null;

    // Check for duplicate email if email is being changed
    if (data.email && data.email !== user.email) {
      if (this.emailIndex.has(data.email)) {
        throw {
          code: 'USER_ALREADY_EXISTS',
          message: `User with email ${data.email} already exists`,
          details: { email: data.email },
          statusCode: 409,
        };
      }
      this.emailIndex.delete(user.email);
      this.emailIndex.set(data.email, id);
    }

    // Update user
    const updatedUser: User = {
      ...user,
      ...data,
      passwordHash: data.password
        ? this.hashPassword(data.password)
        : user.passwordHash,
      updatedAt: new Date().toISOString(),
    };

    this.users.set(id, updatedUser);
    return updatedUser;
  }

  // Delete user (soft or hard)
  delete(id: string | string[], hardDelete: boolean = false): { deletedIds: string[]; softDeleted: boolean } {
    const ids = Array.isArray(id) ? id : [id];
    const deletedIds: string[] = [];

    for (const userId of ids) {
      const user = this.users.get(userId);
      if (!user) continue;

      if (hardDelete) {
        // Hard delete
        this.users.delete(userId);
        this.emailIndex.delete(user.email);
      } else {
        // Soft delete
        user.isActive = false;
        user.updatedAt = new Date().toISOString();
        this.deletedUsers.set(userId, { ...user });
        this.users.delete(userId);
        this.emailIndex.delete(user.email);
      }

      deletedIds.push(userId);
    }

    return { deletedIds, softDeleted: !hardDelete };
  }

  // Helper: Hash password (mock implementation)
  private hashPassword(password: string): string {
    // In production, use bcrypt or argon2
    return `hash_${Buffer.from(password).toString('base64')}`;
  }

  // Get count
  count(): number {
    return this.users.size;
  }
}

// Singleton instance
export const userRepository = new UserRepository();