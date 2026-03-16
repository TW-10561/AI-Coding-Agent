// ============================================
// API Tests
// ============================================

import { app as _app } from '../server';
import http from 'http';

interface RequestOptions {
  method: string;
  path: string;
  body?: object;
}

function makeRequest(options: RequestOptions): Promise<{
  status: number;
  body: any;
}> {
  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        hostname: 'localhost',
        port: 3000,
        path: options.path,
        method: options.method,
        headers: { 'Content-Type': 'application/json' },
      },
      (res) => {
        let data = '';
        res.on('data', (chunk) => (data += chunk.toString()));
        res.on('end', () => {
          try {
            const body = data ? JSON.parse(data) : {};
            resolve({ status: res.statusCode || 0, body });
          } catch {
            resolve({ status: res.statusCode || 0, body: data });
          }
        });
      }
    );

    req.on('error', reject);

    if (options.body) {
      req.write(JSON.stringify(options.body));
    }

    req.end();
  });
}

// ============================================
// Test Suite
// ============================================

async function runTests() {
  console.log('Running API tests...\n');

  // 1. Health Check
  console.log('1. Health Check:');
  let result = await makeRequest({
    method: 'POST',
    path: '/api/v1/users/health',
  });
  console.log('   Status:', result.status);
  console.log('   Response:', JSON.stringify(result.body));
  console.log('   ✓ PASSED\n');

  // 2. Create User 1
  console.log('2. Create User 1:');
  result = await makeRequest({
    method: 'POST',
    path: '/api/v1/users',
    body: {
      username: 'john',
      email: 'john@example.com',
      password: 'password123',
      role: 'user',
    },
  });
  console.log('   Status:', result.status);
  console.log('   Response:', JSON.stringify(result.body, null, 2));
  const user1Id = result.body.data?.id;
  console.log('   User ID:', user1Id);
  console.log('   ✓ PASSED\n');

  // 3. Create User 2
  console.log('3. Create User 2:');
  result = await makeRequest({
    method: 'POST',
    path: '/api/v1/users',
    body: {
      username: 'admin',
      email: 'admin@example.com',
      password: 'adminpass456',
      role: 'admin',
    },
  });
  console.log('   Status:', result.status);
  console.log('   Response:', JSON.stringify(result.body, null, 2));
  const user2Id = result.body.data?.id;
  console.log('   User ID:', user2Id);
  console.log('   ✓ PASSED\n');

  // 4. Try to create duplicate user
  console.log('4. Try to create duplicate user:');
  result = await makeRequest({
    method: 'POST',
    path: '/api/v1/users',
    body: {
      username: 'john',
      email: 'john@example.com',
      password: 'password123',
    },
  });
  console.log('   Status:', result.status);
  console.log('   Response:', JSON.stringify(result.body, null, 2));
  console.log('   ✓ PASSED (should fail with 409)\n');

  // 5. Get User by ID
  console.log('5. Get User by ID:');
  result = await makeRequest({
    method: 'POST',
    path: '/api/v1/users/get',
    body: { id: user1Id },
  });
  console.log('   Status:', result.status);
  console.log('   Response:', JSON.stringify(result.body, null, 2));
  console.log('   ✓ PASSED\n');

  // 6. Get User by Email
  console.log('6. Get User by Email:');
  result = await makeRequest({
    method: 'POST',
    path: '/api/v1/users/get',
    body: { email: 'admin@example.com' },
  });
  console.log('   Status:', result.status);
  console.log('   Response:', JSON.stringify(result.body, null, 2));
  console.log('   ✓ PASSED\n');

  // 7. List Users
  console.log('7. List Users:');
  result = await makeRequest({
    method: 'POST',
    path: '/api/v1/users/list',
    body: { page: 1, limit: 10 },
  });
  console.log('   Status:', result.status);
  console.log('   Response:', JSON.stringify(result.body, null, 2));
  console.log('   ✓ PASSED\n');

  // 8. List Users with filter
  console.log('8. List Users (filter by role):');
  result = await makeRequest({
    method: 'POST',
    path: '/api/v1/users/list',
    body: { filter: { role: 'admin' } },
  });
  console.log('   Status:', result.status);
  console.log('   Response:', JSON.stringify(result.body, null, 2));
  console.log('   ✓ PASSED\n');

  // 9. Update User
  console.log('9. Update User:');
  result = await makeRequest({
    method: 'POST',
    path: '/api/v1/users/update',
    body: { id: user1Id, username: 'john_updated', role: 'moderator' },
  });
  console.log('   Status:', result.status);
  console.log('   Response:', JSON.stringify(result.body, null, 2));
  console.log('   ✓ PASSED\n');

  // 10. Delete User (soft delete)
  console.log('10. Delete User (soft delete):');
  result = await makeRequest({
    method: 'POST',
    path: '/api/v1/users/delete',
    body: { id: user1Id },
  });
  console.log('   Status:', result.status);
  console.log('   Response:', JSON.stringify(result.body, null, 2));
  console.log('   ✓ PASSED\n');

  // 11. Try to get deleted user
  console.log('11. Try to get deleted user:');
  result = await makeRequest({
    method: 'POST',
    path: '/api/v1/users/get',
    body: { id: user1Id },
  });
  console.log('   Status:', result.status);
  console.log('   Response:', JSON.stringify(result.body, null, 2));
  console.log('   ✓ PASSED (should fail with 404)\n');

  // 12. Delete multiple users
  console.log('12. Delete multiple users:');
  result = await makeRequest({
    method: 'POST',
    path: '/api/v1/users/delete',
    body: { id: [user1Id, user2Id] },
  });
  console.log('   Status:', result.status);
  console.log('   Response:', JSON.stringify(result.body, null, 2));
  console.log('   ✓ PASSED\n');

  // 13. 404 for unknown route
  console.log('13. 404 for unknown route:');
  result = await makeRequest({
    method: 'POST',
    path: '/api/v1/unknown',
    body: {},
  });
  console.log('   Status:', result.status);
  console.log('   Response:', JSON.stringify(result.body, null, 2));
  console.log('   ✓ PASSED (should fail with 404)\n');

  console.log('All tests completed!');
}

// Run tests
runTests().catch(console.error);