import { describe, expect, it } from 'vitest';
import { onRequest } from '../functions/api/_middleware.js';
import { loadObservabilitySnapshot } from '../src/shared/observability.js';
import { createD1Database, createRateLimitKv } from './helpers/fakeCloudflare.js';

describe('api middleware', () => {
  it('adds security headers and records a 429 as a rate limit hit', async () => {
    const kv = createRateLimitKv();
    const observationStore = createD1Database();
    const backgroundTasks = [];

    const response = await onRequest({
      request: new Request('http://localhost/api/issues', { method: 'GET' }),
      env: {
        ENVIRONMENT: 'development',
        RATE_LIMIT_KV: kv,
        OBSERVABILITY_STORE: observationStore,
      },
      waitUntil: (promise) => backgroundTasks.push(promise),
      next: async () => new Response(JSON.stringify({ success: false, error: '请求过于频繁，请稍后再试' }), {
        status: 429,
        headers: {
          'Content-Type': 'application/json; charset=UTF-8',
        },
      }),
    });

    await Promise.all(backgroundTasks);
    const snapshot = await loadObservabilitySnapshot({ OBSERVABILITY_STORE: observationStore });

    expect(response.headers.get('X-Content-Type-Options')).toBe('nosniff');
    expect(response.headers.get('Content-Security-Policy')).toContain("default-src 'none'");
    expect(snapshot.buckets[0].rateLimitHits).toBe(1);
    expect(snapshot.recentErrors[0].status).toBe(429);
  });

  it('redirects insecure production requests to https', async () => {
    const response = await onRequest({
      request: new Request('http://issue.calvin-xia.cn/api/issues', { method: 'GET' }),
      env: {
        ENVIRONMENT: 'production',
        RATE_LIMIT_KV: createRateLimitKv(),
        OBSERVABILITY_STORE: createD1Database(),
      },
      next: async () => new Response('unexpected', { status: 200 }),
    });

    expect(response.status).toBe(308);
    expect(response.headers.get('Location')).toBe('https://issue.calvin-xia.cn/api/issues');
    expect(response.headers.get('Strict-Transport-Security')).toContain('max-age=31536000');
  });

  it('skips request observation for health checks and still appends security headers', async () => {
    const observationStore = createD1Database();

    const response = await onRequest({
      request: new Request('http://localhost/api/health', { method: 'GET' }),
      env: {
        ENVIRONMENT: 'development',
        RATE_LIMIT_KV: createRateLimitKv(),
        OBSERVABILITY_STORE: observationStore,
      },
      next: async () => new Response('ok', { status: 200 }),
    });

    expect(response.headers.get('X-Frame-Options')).toBe('DENY');
    expect(observationStore.requestObservations).toHaveLength(0);
  });

  it('skips request observation for preflight requests', async () => {
    const observationStore = createD1Database();

    const response = await onRequest({
      request: new Request('http://localhost/api/issues', { method: 'OPTIONS' }),
      env: {
        ENVIRONMENT: 'development',
        RATE_LIMIT_KV: createRateLimitKv(),
        OBSERVABILITY_STORE: observationStore,
      },
      next: async () => new Response(null, { status: 204 }),
    });

    expect(response.status).toBe(204);
    expect(observationStore.requestObservations).toHaveLength(0);
  });

  it('records unexpected downstream failures without waitUntil', async () => {
    const observationStore = createD1Database();

    await expect(onRequest({
      request: new Request('http://localhost/api/issues', { method: 'POST' }),
      env: {
        ENVIRONMENT: 'development',
        RATE_LIMIT_KV: createRateLimitKv(),
        OBSERVABILITY_STORE: observationStore,
      },
      next: async () => {
        throw new Error('boom');
      },
    })).rejects.toThrow('boom');

    const snapshot = await loadObservabilitySnapshot({ OBSERVABILITY_STORE: observationStore });
    expect(snapshot.recentErrors[0].status).toBe(500);
    expect(snapshot.recentErrors[0].message).toBe('服务器内部错误');
  });
});
