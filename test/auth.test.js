import { describe, expect, it, vi } from 'vitest';
import {
  authorizeAdminRequest,
  createForbiddenOriginResponse,
  createUnauthorizedResponse,
  verifyAdminKey,
} from '../src/shared/auth.js';

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
  it('rejects requests from untrusted origins before checking credentials', () => {
    const request = new Request('http://localhost/api/admin/issues', {
      headers: {
        Origin: 'https://evil.example.com',
        Authorization: 'Bearer secret-key',
      },
    });

    const result = authorizeAdminRequest(request, {
      ENVIRONMENT: 'production',
      ADMIN_SECRET_KEY: 'secret-key',
    });

    expect(result.ok).toBe(false);
    expect(result.response.status).toBe(403);
  });

  it('returns unauthorized for bad credentials and success for valid requests', () => {
    const unauthorizedRequest = new Request('http://localhost/api/admin/issues', {
      headers: {
        Origin: 'http://localhost:8788',
      },
    });
    const unauthorizedResult = authorizeAdminRequest(unauthorizedRequest, {
      ENVIRONMENT: 'development',
      ADMIN_SECRET_KEY: 'secret-key',
    });

    const authorizedRequest = new Request('http://localhost/api/admin/issues', {
      headers: {
        Origin: 'http://localhost:8788',
        Authorization: 'Bearer secret-key',
      },
    });
    const authorizedResult = authorizeAdminRequest(authorizedRequest, {
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
    });
  });
});
