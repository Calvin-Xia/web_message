import { afterEach, describe, expect, it, vi } from 'vitest';
import { checkAdminRateLimit, checkRateLimit, getClientIP } from '../src/shared/rateLimit.js';
import { createD1Database, createRateLimitKv } from './helpers/fakeCloudflare.js';

afterEach(() => {
  vi.restoreAllMocks();
});

describe('checkRateLimit', () => {
  it('returns a 429 response once the threshold is exceeded', async () => {
    const db = createD1Database();
    const request = new Request('http://localhost/api/issues', {
      method: 'POST',
      headers: {
        'CF-Connecting-IP': '127.0.0.1',
      },
    });

    for (let attempt = 0; attempt < 10; attempt += 1) {
      await expect(checkRateLimit({ RATE_LIMIT_STORE: db }, request, 'postIssue', {})).resolves.toBeNull();
    }

    const response = await checkRateLimit({ RATE_LIMIT_STORE: db }, request, 'postIssue', {});
    const payload = await response.json();

    expect(response.status).toBe(429);
    expect(payload.error).toBe('请求过于频繁，请稍后再试');
    expect(payload.retryAfter).toBeGreaterThan(0);
  });

  it('increments the current window counter when under the threshold', async () => {
    const db = createD1Database();
    const request = new Request('http://localhost/api/issues', {
      method: 'GET',
      headers: {
        'CF-Connecting-IP': '127.0.0.1',
      },
    });

    const response = await checkRateLimit({ RATE_LIMIT_STORE: db }, request, 'getIssues', {});

    expect(response).toBeNull();
    expect(db.rateLimitState[0].request_count).toBe(1);
    expect(db.rateLimitState[0].endpoint).toBe('getIssues');
  });

  it('falls back to KV when D1 rate limit storage throws', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const kv = createRateLimitKv({
      'ratelimit:getIssues:127.0.0.1:block': JSON.stringify({ blockedUntil: Date.now() + 60_000 }),
    });
    const request = new Request('http://localhost/api/issues', {
      method: 'GET',
      headers: {
        'CF-Connecting-IP': '127.0.0.1',
      },
    });

    const response = await checkRateLimit({
      RATE_LIMIT_STORE: {
        prepare() {
          throw new Error('d1 unavailable');
        },
      },
      RATE_LIMIT_KV: kv,
    }, request, 'getIssues', {
      'X-Test': '1',
    });
    const payload = await response.json();

    expect(response.status).toBe(429);
    expect(response.headers.get('X-Test')).toBe('1');
    expect(payload.retryAfter).toBeGreaterThan(0);
    expect(errorSpy).toHaveBeenCalledWith('D1 rate limit check failed:', expect.any(Error));
  });

  it('cleans up expired KV blocks and creates a fresh block when the threshold is already met', async () => {
    const kv = createRateLimitKv({
      'ratelimit:postIssue:127.0.0.1:block': String(Date.now() - 1_000),
      'ratelimit:postIssue:127.0.0.1:count': '10',
    });
    const request = new Request('http://localhost/api/issues', {
      method: 'POST',
      headers: {
        'CF-Connecting-IP': '127.0.0.1',
      },
    });

    const response = await checkRateLimit({
      RATE_LIMIT_KV: kv,
    }, request, 'postIssue', {});
    const payload = await response.json();
    const blockValue = await kv.get('ratelimit:postIssue:127.0.0.1:block');
    const countValue = await kv.get('ratelimit:postIssue:127.0.0.1:count');

    expect(response.status).toBe(429);
    expect(payload.retryAfter).toBeGreaterThan(0);
    expect(blockValue).not.toBeNull();
    expect(countValue).toBeNull();
  });

  it('warns and skips when the endpoint is unknown or no store is configured', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const request = new Request('http://localhost/api/issues', {
      method: 'GET',
    });

    await expect(checkRateLimit({}, request, 'unknownEndpoint', {})).resolves.toBeNull();
    await expect(checkRateLimit({}, request, 'getIssues', {})).resolves.toBeNull();

    expect(warnSpy).toHaveBeenCalledWith('Unknown endpoint: unknownEndpoint, skipping rate limit');
    expect(warnSpy).toHaveBeenCalledWith('No rate limit store configured, skipping rate limit');
  });
});

describe('admin rate limit helpers', () => {
  it('routes admin GET requests through the adminRead bucket', async () => {
    const db = createD1Database();
    const request = new Request('http://localhost/api/admin/issues', {
      method: 'GET',
      headers: {
        'X-Forwarded-For': '203.0.113.10, 203.0.113.11',
      },
    });

    const response = await checkAdminRateLimit({ RATE_LIMIT_STORE: db }, request, {});

    expect(response).toBeNull();
    expect(db.rateLimitState[0].endpoint).toBe('adminRead');
    expect(db.rateLimitState[0].client_ip).toBe('203.0.113.10');
  });

  it('extracts client IPs from Cloudflare, X-Forwarded-For, or falls back to unknown', () => {
    const cfRequest = new Request('http://localhost/api/issues', {
      headers: {
        'CF-Connecting-IP': '198.51.100.5',
      },
    });
    const forwardedRequest = new Request('http://localhost/api/issues', {
      headers: {
        'X-Forwarded-For': '203.0.113.10, 203.0.113.11',
      },
    });
    const unknownRequest = new Request('http://localhost/api/issues');

    expect(getClientIP(cfRequest)).toBe('198.51.100.5');
    expect(getClientIP(forwardedRequest)).toBe('203.0.113.10');
    expect(getClientIP(unknownRequest)).toBe('unknown');
  });
});
