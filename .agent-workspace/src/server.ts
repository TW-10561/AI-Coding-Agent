// ============================================
// User Management API Server
// ============================================

import express, { Request, Response, NextFunction } from 'express';
import {
  createUserController,
  getUserController,
  listUsersController,
  updateUserController,
  deleteUserController,
  healthCheckController,
  notFoundController,
} from './controller';

// Create Express app
const app = express();

// Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Request logging
app.use((req: Request, _res: Response, next: NextFunction) => {
  const timestamp = new Date().toISOString();
  console.log(`[${timestamp}] ${req.method} ${req.path}`);
  next();
});

// ============================================
// Routes (All POST)
// ============================================

// Health Check
app.post('/api/v1/users/health', healthCheckController);

// User Management
app.post('/api/v1/users', createUserController);
app.post('/api/v1/users/get', getUserController);
app.post('/api/v1/users/list', listUsersController);
app.post('/api/v1/users/update', updateUserController);
app.post('/api/v1/users/delete', deleteUserController);

// 404 Handler (must be last)
app.use(notFoundController);

// Error handler
app.use(
  (err: Error, _req: Request, res: Response, _next: NextFunction) => {
    console.error('Unhandled error:', err);
    res.status(500).json({
      success: false,
      error: {
        code: 'INTERNAL_ERROR',
        message: err.message || 'An internal error occurred',
      },
    });
  }
);

// ============================================
// Start Server
// ============================================

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log(`Server started on port ${PORT}`);
});

// Export for testing
export { app };