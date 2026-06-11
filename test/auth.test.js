import { describe, expect, it, vi } from 'vitest';
import {
  authorizeAdminRequest,
  createForbiddenOriginResponse,
  createUnauthorizedResponse,
  requireAdminRole,
  verifyAdminKey,
} from '../src/shared/auth.js';
import { generateToken } from '../src/shared/jwt.js';

describe('verifyAdminKey', () => {
  it('accepts a valid bearer token', () => {
    expect(verifyAdminKey('Bearer secret-key', { ADMIN_SECRET_KEY: 'secret-key' })).toEqual({ valid: true });
  });

  it('rejects missing configuration, missing headers, and invalid tokens', () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    expect(verifyAdminKey(null, { ADMIN_SECRET_KEY: 'secret-key' })).toEqual({ valid: false, error: '缺少授权信息' });
    expect(verifyAdminKey('secret-key', { ADMIN_SECRET_KEY: 'secret-key' })).toEqual({ valid: false, error: '授权格式错误' });
    expect(verifyAdminKey('Bearer wrong', { ADMIN_SECRET_KEY: 'secret-key' })).toEqual({ valid: false, error: '密钥无效' });
    expect(verifyAdminKey('Bearer secret-key', {})).toEqual({ valid: false, error: '服务器配置错误' });
    expect(errorSpy).toHaveBeenCalled();

    errorSpy.mockRestore();
  });
});

describe('admin auth responses', () => {
  it('builds forbidden and unauthorized json payloads', async () => {
    const forbidden = createForbiddenOriginResponse({});
    const unauthorized = createUnauthorizedResponse('缺少授权信息', {});

    expect(forbidden.status).toBe(403);
    expect((await forbidden.json()).error).toBe('来源不受信任');
    expect(unauthorized.status).toBe(401);
    expect((await unauthorized.json()).error).toBe('缺少授权信息');
  });
});

describe('authorizeAdminRequest', () => {
  it('rejects requests from untrusted origins before checking credentials', async () => {
    const request = new Request('http://localhost/api/admin/issues', {
      headers: {
        Origin: 'https://evil.example.com',
        Authorization: 'Bearer secret-key',
      },
    });

    const result = await authorizeAdminRequest(request, {
      ENVIRONMENT: 'production',
      ADMIN_SECRET_KEY: 'secret-key',
    });

    expect(result.ok).toBe(false);
    expect(result.response.status).toBe(403);
  });

  it('returns unauthorized for bad credentials and success for valid shared-key requests', async () => {
    const unauthorizedRequest = new Request('http://localhost/api/admin/issues', {
      headers: {
        Origin: 'http://localhost:8788',
      },
    });
    const unauthorizedResult = await authorizeAdminRequest(unauthorizedRequest, {
      ENVIRONMENT: 'development',
      ADMIN_SECRET_KEY: 'secret-key',
    });

    const authorizedRequest = new Request('http://localhost/api/admin/issues', {
      headers: {
        Origin: 'http://localhost:8788',
        Authorization: 'Bearer secret-key',
      },
    });
    const authorizedResult = await authorizeAdminRequest(authorizedRequest, {
      ENVIRONMENT: 'development',
      ADMIN_SECRET_KEY: 'secret-key',
    });

    expect(unauthorizedResult.ok).toBe(false);
    expect(unauthorizedResult.response.status).toBe(401);
    expect(authorizedResult).toEqual({
      ok: true,
      corsHeaders: {
        'Access-Control-Allow-Methods': 'GET, POST, PATCH, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization',
        'Access-Control-Allow-Origin': 'http://localhost:8788',
        'Cache-Control': 'no-store',
        Vary: 'Origin',
      },
      actor: 'admin',
      authType: 'shared_key',
      user: {
        id: null,
        username: 'admin',
        role: 'admin',
      },
    });
  });

  it('accepts JWT bearer tokens and exposes the actor identity', async () => {
    const env = {
      ENVIRONMENT: 'development',
      ADMIN_SECRET_KEY: 'secret-key',
      ADMIN_JWT_SECRET: 'test-jwt-secret-32-characters-long',
    };
    const { token } = await generateToken(env, {
      id: 9,
      username: 'handler1',
      role: 'handler',
    });
    const request = new Request('http://localhost/api/admin/issues', {
      headers: {
        Origin: 'http://localhost:8788',
        Authorization: `Bearer ${token}`,
      },
    });

    const result = await authorizeAdminRequest(request, env);

    expect(result.ok).toBe(true);
    expect(result.actor).toBe('handler1');
    expect(result.authType).toBe('jwt');
    expect(result.user).toMatchObject({
      id: 9,
      username: 'handler1',
      role: 'handler',
    });
  });

  it('rejects non-admin users for admin-only routes', async () => {
    const result = requireAdminRole({
      ok: true,
      corsHeaders: {},
      user: {
        id: 2,
        username: 'handler1',
        role: 'handler',
      },
    });

    expect(result.ok).toBe(false);
    expect(result.response.status).toBe(403);
    expect((await result.response.json()).error).toBe('权限不足');
  });
});
