/**
 * User Management API Tests
 */

import supertest from 'supertest';
import _app, { createUserRouter } from './user-management-api';
import express from 'express';

// Use separate app for testing
const testApp = express();
testApp.use(express.json());
testApp.use('/api/v1', createUserRouter());

const request = supertest(testApp);

describe('POST /api/v1/users (Create User)', () => {
  it('creates a user successfully', async () => {
    const res = await request
      .post('/api/v1/users')
      .send({
        username: 'john',
        email: 'john@example.com',
        password: 'secure123',
        role: 'user'
      });
    
    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);
    expect(res.body.data).toHaveProperty('id');
    expect(res.body.data.username).toBe('john');
    expect(res.body.data).not.toHaveProperty('password');
  });
  
  it('rejects invalid email', async () => {
    const res = await request
      .post('/api/v1/users')
      .send({
        username: 'john',
        email: 'invalid-email',
        password: 'secure123'
      });
    
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_FAILED');
  });
  
  it('rejects duplicate email', async () => {
    // Create first user
    await request.post('/api/v1/users').send({
      username: 'john',
      email: 'john@example.com',
      password: 'secure123'
    });
    
    // Try to create duplicate
    const res = await request.post('/api/v1/users').send({
      username: 'john2',
      email: 'john@example.com',
      password: 'secure123'
    });
    
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('EMAIL_EXISTS');
  });
});

describe('POST /api/v1/users/get', () => {
  let createdUserId: string;
  
  beforeAll(async () => {
    const res = await request.post('/api/v1/users').send({
      username: 'getuser',
      email: 'getuser@example.com',
      password: 'secure123'
    });
    createdUserId = res.body.data.id;
  });
  
  it('fetches user by ID', async () => {
    const res = await request
      .post('/api/v1/users/get')
      .send({ id: createdUserId });
    
    expect(res.status).toBe(200);
    expect(res.body.data.id).toBe(createdUserId);
    expect(res.body.data.username).toBe('getuser');
  });
  
  it('fetches user by email', async () => {
    const res = await request
      .post('/api/v1/users/get')
      .send({ email: 'getuser@example.com' });
    
    expect(res.status).toBe(200);
    expect(res.body.data.email).toBe('getuser@example.com');
  });
});

describe('POST /api/v1/users/list', () => {
  beforeAll(async () => {
    await request.post('/api/v1/users').send({ username: 'list1', email: 'list1@test.com', password: 'pass' });
    await request.post('/api/v1/users').send({ username: 'list2', email: 'list2@test.com', password: 'pass', role: 'admin' });
    await request.post('/api/v1/users').send({ username: 'list3', email: 'list3@test.com', password: 'pass' });
  });
  
  it('lists all users', async () => {
    const res = await request.post('/api/v1/users/list').send({});
    
    expect(res.status).toBe(200);
    expect(res.body.data.length).toBeGreaterThan(2);
    expect(res.body.pagination).toHaveProperty('total');
  });
  
  it('filters by role', async () => {
    const res = await request
      .post('/api/v1/users/list')
      .send({ filter: { role: 'admin' } });
    
    expect(res.body.data.every((u: any) => u.role === 'admin')).toBe(true);
  });
  
  it('paginates results', async () => {
    const res = await request
      .post('/api/v1/users/list')
      .send({ page: 1, limit: 2 });
    
    expect(res.body.data.length).toBeLessThanOrEqual(2);
    expect(res.body.pagination.page).toBe(1);
    expect(res.body.pagination.limit).toBe(2);
  });
});

describe('POST /api/v1/users/update', () => {
  let userId: string;
  
  beforeAll(async () => {
    const res = await request.post('/api/v1/users').send({
      username: 'updateuser',
      email: 'updateuser@example.com',
      password: 'oldpassword'
    });
    userId = res.body.data.id;
  });
  
  it('updates user fields', async () => {
    const res = await request
      .post('/api/v1/users/update')
      .send({
        id: userId,
        username: 'updatedname',
        role: 'moderator'
      });
    
    expect(res.status).toBe(200);
    expect(res.body.data.updatedFields).toContain('username');
    expect(res.body.data.updatedFields).toContain('role');
  });
  
  it('returns 404 for non-existent user', async () => {
    const res = await request
      .post('/api/v1/users/update')
      .send({ id: 'non-existent-id' });
    
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('NOT_FOUND');
  });
});

describe('POST /api/v1/users/delete', () => {
  let userId: string;
  
  beforeAll(async () => {
    const res = await request.post('/api/v1/users').send({
      username: 'deleteuser',
      email: 'deleteuser@example.com',
      password: 'pass'
    });
    userId = res.body.data.id;
  });
  
  it('soft deletes a user', async () => {
    const res = await request
      .post('/api/v1/users/delete')
      .send({ id: userId });
    
    expect(res.status).toBe(200);
    expect(res.body.data.softDeleted).toBe(true);
    
    // Verify user is inactive
    const getRes = await request.post('/api/v1/users/get').send({ id: userId });
    expect(getRes.body.data.isActive).toBe(false);
  });
  
  it('deletes multiple users', async () => {
    const res1 = await request.post('/api/v1/users').send({ username: 'm1', email: 'm1@test.com', password: 'p' });
    const res2 = await request.post('/api/v1/users').send({ username: 'm2', email: 'm2@test.com', password: 'p' });
    
    const delRes = await request
      .post('/api/v1/users/delete')
      .send({ id: [res1.body.data.id, res2.body.data.id] });
    
    expect(delRes.body.data.deletedCount).toBe(2);
  });
});

// ───────────────────────────────────────────────
// Usage Example (run with ts-node)
// ───────────────────────────────────────────────

/**

// Create a user
const create = await fetch('http://localhost:3000/api/v1/users', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    username: 'john',
    email: 'john@example.com',
    password: 'secure123',
    role: 'user'
  })
}).then(r => r.json());

// List users
const list = await fetch('http://localhost:3000/api/v1/users/list', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ page: 1, limit: 10 })
}).then(r => r.json());

// Update user
const update = await fetch('http://localhost:3000/api/v1/users/update', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ id: create.data.id, role: 'moderator' })
}).then(r => r.json());

// Delete user
const del = await fetch('http://localhost:3000/api/v1/users/delete', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ id: create.data.id })
}).then(r => r.json());

*/

console.log('Tests defined. Run with: npx jest user-management-api.test.ts');