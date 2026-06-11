import { afterEach, describe, expect, it, vi } from 'vitest';
import { onRequest as loginRequest } from '../functions/api/admin/auth/login.js';
import { onRequest as logoutRequest } from '../functions/api/admin/auth/logout.js';
import { onRequest as forgotPasswordRequest } from '../functions/api/admin/auth/forgot-password.js';
import { onRequest as resetPasswordRequest } from '../functions/api/admin/auth/reset-password.js';
import { hashPassword, verifyPassword } from '../src/shared/password.js';
import { isTokenBlacklisted, verifyToken } from '../src/shared/jwt.js';
import { createAppEnv } from './helpers/fakeCloudflare.js';

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function createJsonRequest(url, body, headers = {}) {
  return new Request(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...headers,
    },
    body: JSON.stringify(body),
  });
}

async function createAuthEnv(overrides = {}) {
  const env = createAppEnv({
    ADMIN_JWT_SECRET: 'test-jwt-secret-32-characters-long',
    PUBLIC_BASE_URL: 'https://issue.example.edu',
    ...overrides,
  });
  env.DB.adminUsers.push({
    id: 1,
    username: 'admin',
    password_hash: await hashPassword('Secure123!'),
    display_name: '管理员',
    role: 'admin',
    is_enabled: 1,
    last_login_at: null,
    created_at: '2026-06-01T00:00:00.000Z',
    updated_at: '2026-06-01T00:00:00.000Z',
  });
  env.DB.ids.adminUser = 2;
  return env;
}

describe('admin auth routes', () => {
  it('logs in enabled users, returns a JWT and updates audit state', async () => {
    const env = await createAuthEnv();
    const response = await loginRequest({
      request: createJsonRequest('http://localhost/api/admin/auth/login', {
        username: 'admin',
        password: 'Secure123!',
      }),
      env,
      params: {},
    });
    const payload = await response.json();
    const verified = await verifyToken(payload.data.token, env);

    expect(response.status).toBe(200);
    expect(payload.data.user).toEqual({
      id: 1,
      username: 'admin',
      displayName: '管理员',
      role: 'admin',
    });
    expect(payload.data.expiresAt).toMatch(/T/);
    expect(verified.valid).toBe(true);
    expect(env.DB.adminUsers[0].last_login_at).toBeTruthy();
    expect(env.DB.adminActions.at(-1)).toMatchObject({
      action_type: 'login_success',
      target_type: 'admin_user',
      target_id: 1,
      performed_by: 'admin',
    });
  });

  it('rejects wrong passwords and disabled users', async () => {
    const wrongPasswordEnv = await createAuthEnv();
    const disabledEnv = await createAuthEnv();
    disabledEnv.DB.adminUsers[0].is_enabled = 0;

    const wrongPassword = await loginRequest({
      request: createJsonRequest('http://localhost/api/admin/auth/login', {
        username: 'admin',
        password: 'Wrong123!',
      }),
      env: wrongPasswordEnv,
      params: {},
    });
    const disabled = await loginRequest({
      request: createJsonRequest('http://localhost/api/admin/auth/login', {
        username: 'admin',
        password: 'Secure123!',
      }),
      env: disabledEnv,
      params: {},
    });

    expect(wrongPassword.status).toBe(401);
    expect((await wrongPassword.json()).error).toBe('用户名或密码错误');
    expect(disabled.status).toBe(403);
    expect((await disabled.json()).error).toBe('账号已禁用');
  });

  it('logs out by blacklisting the current JWT', async () => {
    const env = await createAuthEnv();
    const loginResponse = await loginRequest({
      request: createJsonRequest('http://localhost/api/admin/auth/login', {
        username: 'admin',
        password: 'Secure123!',
      }),
      env,
      params: {},
    });
    const { data } = await loginResponse.json();

    const response = await logoutRequest({
      request: new Request('http://localhost/api/admin/auth/logout', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${data.token}`,
        },
      }),
      env,
      params: {},
    });
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.data.message).toBe('已成功登出');
    expect(await isTokenBlacklisted(data.token, env)).toBe(true);
    expect(env.DB.adminActions.at(-1)).toMatchObject({
      action_type: 'logout',
      performed_by: 'admin',
    });
  });

  it('returns the same forgot-password response and sends reset mail only for existing users', async () => {
    const env = await createAuthEnv({
      RESEND_API_KEY: 're_test_key',
    });
    const fetchSpy = vi.fn(async () => new Response(JSON.stringify({ id: 'email_1' }), { status: 200 }));
    vi.stubGlobal('fetch', fetchSpy);

    const existing = await forgotPasswordRequest({
      request: createJsonRequest('http://localhost/api/admin/auth/forgot-password', { username: 'admin' }),
      env,
      params: {},
    });
    const missing = await forgotPasswordRequest({
      request: createJsonRequest('http://localhost/api/admin/auth/forgot-password', { username: 'missing' }),
      env,
      params: {},
    });

    expect(await existing.json()).toEqual(await missing.json());
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(env.DB.passwordResetTokens).toHaveLength(1);
  });

  it('resets passwords with a valid token and rejects reused tokens', async () => {
    const env = await createAuthEnv({
      RESEND_API_KEY: 're_test_key',
    });
    const fetchSpy = vi.fn(async () => new Response(JSON.stringify({ id: 'email_1' }), { status: 200 }));
    vi.stubGlobal('fetch', fetchSpy);

    await forgotPasswordRequest({
      request: createJsonRequest('http://localhost/api/admin/auth/forgot-password', { username: 'admin' }),
      env,
      params: {},
    });
    const emailBody = JSON.parse(fetchSpy.mock.calls[0][1].body);
    const token = new URL(emailBody.text.match(/https:\/\/\S+/)[0]).searchParams.get('token');

    const response = await resetPasswordRequest({
      request: createJsonRequest('http://localhost/api/admin/auth/reset-password', {
        token,
        newPassword: 'NewPass123!',
      }),
      env,
      params: {},
    });
    const reused = await resetPasswordRequest({
      request: createJsonRequest('http://localhost/api/admin/auth/reset-password', {
        token,
        newPassword: 'Another123!',
      }),
      env,
      params: {},
    });

    expect(response.status).toBe(200);
    expect(await verifyPassword('NewPass123!', env.DB.adminUsers[0].password_hash)).toBe(true);
    expect(reused.status).toBe(400);
  });
});
