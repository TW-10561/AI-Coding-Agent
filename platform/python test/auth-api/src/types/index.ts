// User model
export interface User {
  id: string;
  email: string;
  passwordHash: string;
  firstName: string;
  lastName: string;
  role: "admin" | "moderator" | "user";
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

// DTO for creating a user (input)
export interface CreateUserDTO {
  email: string;
  password: string;
  firstName: string;
  lastName: string;
  role?: "admin" | "moderator" | "user";
}

// DTO for updating a user (input)
export interface UpdateUserDTO {
  email?: string;
  password?: string;
  firstName?: string;
  lastName?: string;
  role?: "admin" | "moderator" | "user";
  isActive?: boolean;
}

// DTO for user response (output - no password hash)
export interface UserResponseDTO {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  fullName: string;
  role: "admin" | "moderator" | "user";
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

// Authentication DTOs
export interface LoginDTO {
  email: string;
  password: string;
}

export interface RegisterDTO extends CreateUserDTO {}

export interface AuthResponseDTO {
  user: UserResponseDTO;
  token: string;
  expiresIn: string;
}

// JWT payload
export interface JWTPayload {
  sub: string; // user id
  email: string;
  role: string;
  iat: number;
  exp: number;
}

// API Response wrapper
export interface ApiResponse<T> {
  success: boolean;
  data?: T;
  message?: string;
  errors?: string[];
}

// Pagination
export interface PaginatedResponse<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}
