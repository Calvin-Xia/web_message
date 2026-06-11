import { describe, expect, it } from 'vitest';
import { onRequest as usersRequest } from '../functions/api/admin/users.js';
import { onRequest as userDetailRequest } from '../functions/api/admin/users/[id].js';
import { generateToken } from '../src/shared/jwt.js';
import { hashPassword, verifyPassword } from '../src/shared/password.js';
import { createAppEnv } from './helpers/fakeCloudflare.js';

function createJsonRequest(url, method, body, token) {
  return new Request(url, {
    method,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: body == null ? undefined : JSON.stringify(body),
  });
}

async function seedAdminUsers(env) {
  env.DB.adminUsers.push(
    {
      id: 1,
      username: 'admin',
      password_hash: await hashPassword('Secure123!'),
      display_name: '管理员',
      role: 'admin',
      is_enabled: 1,
      last_login_at: '2026-06-09T00:00:00.000Z',
      created_at: '2026-06-01T00:00:00.000Z',
      updated_at: '2026-06-01T00:00:00.000Z',
    },
    {
      id: 2,
      username: 'handler1',
      password_hash: await hashPassword('Handler123!'),
      display_name: '处理员1',
      role: 'handler',
      is_enabled: 1,
      last_login_at: null,
      created_at: '2026-06-02T00:00:00.000Z',
      updated_at: '2026-06-02T00:00:00.000Z',
    },
  );
  env.DB.ids.adminUser = 3;
}

async function createUsersEnv() {
  const env = createAppEnv({
    ADMIN_JWT_SECRET: 'test-jwt-secret-32-characters-long',
  });
  await seedAdminUsers(env);
  const adminToken = (await generateToken(env, {
    id: 1,
    username: 'admin',
    role: 'admin',
  })).token;
  const handlerToken = (await generateToken(env, {
    id: 2,
    username: 'handler1',
    role: 'handler',
  })).token;

  return { env, adminToken, handlerToken };
}

describe('admin users routes', () => {
  it('lists users for admins without exposing password hashes', async () => {
    const { env, adminToken } = await createUsersEnv();

    const response = await usersRequest({
      request: new Request('http://localhost/api/admin/users', {
        headers: {
          Authorization: `Bearer ${adminToken}`,
        },
      }),
      env,
      params: {},
    });
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.data.items).toHaveLength(2);
    expect(payload.data.items[0]).not.toHaveProperty('passwordHash');
    expect(payload.data.items[0]).toMatchObject({
      id: 1,
      username: 'admin',
      displayName: '管理员',
      role: 'admin',
      isEnabled: true,
    });
  });

  it('forbids handlers from user management', async () => {
    const { env, handlerToken } = await createUsersEnv();

    const response = await usersRequest({
      request: new Request('http://localhost/api/admin/users', {
        headers: {
          Authorization: `Bearer ${handlerToken}`,
        },
      }),
      env,
      params: {},
    });

    expect(response.status).toBe(403);
    expect((await response.json()).error).toBe('权限不足');
  });

  it('creates users with hashed passwords and rejects duplicates', async () => {
    const { env, adminToken } = await createUsersEnv();

    const created = await usersRequest({
      request: createJsonRequest('http://localhost/api/admin/users', 'POST', {
        username: 'handler2',
        password: 'Handler234!',
        displayName: '处理员2',
        role: 'handler',
      }, adminToken),
      env,
      params: {},
    });
    const duplicate = await usersRequest({
      request: createJsonRequest('http://localhost/api/admin/users', 'POST', {
        username: 'handler2',
        password: 'Handler234!',
        displayName: '处理员2',
        role: 'handler',
      }, adminToken),
      env,
      params: {},
    });
    const payload = await created.json();
    const createdRow = env.DB.adminUsers.find((user) => user.username === 'handler2');

    expect(created.status).toBe(201);
    expect(payload.data.username).toBe('handler2');
    expect(createdRow.password_hash).not.toBe('Handler234!');
    expect(await verifyPassword('Handler234!', createdRow.password_hash)).toBe(true);
    expect(duplicate.status).toBe(409);
    expect(env.DB.adminActions.at(-1).action_type).toBe('user_created');
  });

  it('updates and soft-deletes users, but prevents deleting yourself', async () => {
    const { env, adminToken } = await createUsersEnv();

    const updated = await userDetailRequest({
      request: createJsonRequest('http://localhost/api/admin/users/2', 'PATCH', {
        displayName: '处理员一号',
        role: 'admin',
        isEnabled: false,
      }, adminToken),
      env,
      params: { id: '2' },
    });
    const deleted = await userDetailRequest({
      request: createJsonRequest('http://localhost/api/admin/users/2', 'DELETE', null, adminToken),
      env,
      params: { id: '2' },
    });
    const selfDelete = await userDetailRequest({
      request: createJsonRequest('http://localhost/api/admin/users/1', 'DELETE', null, adminToken),
      env,
      params: { id: '1' },
    });

    expect(updated.status).toBe(200);
    expect((await updated.json()).data).toMatchObject({
      id: 2,
      displayName: '处理员一号',
      role: 'admin',
      isEnabled: false,
    });
    expect(deleted.status).toBe(200);
    expect(env.DB.adminUsers.find((user) => user.id === 2).is_enabled).toBe(0);
    expect(selfDelete.status).toBe(400);
    expect((await selfDelete.json()).error).toBe('不能删除当前登录用户');
  });
});
