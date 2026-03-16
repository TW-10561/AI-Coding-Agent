// ============================================
// User Controller (POST-only API)
// ============================================

import { Request, Response } from 'express';
import {
  CreateUserRequest,
  GetUserRequest,
  ListUsersRequest,
  UpdateUserRequest,
  DeleteUserRequest,
} from './types';
import {
  createUser,
  getUser,
  listUsers,
  updateUser,
  deleteUser,
} from './service';

// Helper to send JSON response
function sendJson(res: Response, data: any, statusCode: number = 200): void {
  res.status(statusCode).json(data);
}

// ============================================
// Controller Methods
// ============================================

// Create User
// POST /api/v1/users
export const createUserController = (req: Request, res: Response): void => {
  const requestBody: CreateUserRequest = req.body;

  const result = createUser(requestBody);

  if (result.success) {
    sendJson(res, result, 201);
  } else {
    sendJson(res, result, result.statusCode);
  }
};

// Get User
// POST /api/v1/users/get
export const getUserController = (req: Request, res: Response): void => {
  const requestBody: GetUserRequest = req.body;

  const result = getUser(requestBody);

  if (result.success) {
    sendJson(res, result, 200);
  } else {
    sendJson(res, result, result.statusCode);
  }
};

// List Users
// POST /api/v1/users/list
export const listUsersController = (req: Request, res: Response): void => {
  const requestBody: ListUsersRequest = req.body;

  const result = listUsers(requestBody);

  if (result.success) {
    sendJson(res, result, 200);
  } else {
    sendJson(res, result, result.statusCode);
  }
};

// Update User
// POST /api/v1/users/update
export const updateUserController = (req: Request, res: Response): void => {
  const requestBody: UpdateUserRequest = req.body;

  const result = updateUser(requestBody);

  if (result.success) {
    sendJson(res, result, 200);
  } else {
    sendJson(res, result, result.statusCode);
  }
};

// Delete User
// POST /api/v1/users/delete
export const deleteUserController = (req: Request, res: Response): void => {
  const requestBody: DeleteUserRequest = req.body;

  const result = deleteUser(requestBody);

  if (result.success) {
    sendJson(res, result, 200);
  } else {
    sendJson(res, result, result.statusCode);
  }
};

// Health Check
// POST /api/v1/users/health (POST for consistency)
export const healthCheckController = (_req: Request, res: Response): void => {
  sendJson(res, { status: 'ok', timestamp: new Date().toISOString() }, 200);
};

// 404 Handler
export const notFoundController = (_req: Request, res: Response): void => {
  sendJson(
    res,
    {
      success: false,
      error: {
        code: 'NOT_FOUND',
        message: 'The requested resource was not found',
      },
    },
    404
  );
};