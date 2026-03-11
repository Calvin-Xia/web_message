import { describe, expect, it } from 'vitest';
import { onRequest } from '../functions/api/health.js';
import { createRateLimitKv } from './helpers/fakeCloudflare.js';

function createDb({ shouldFail = false } = {}) {
  return {
    prepare() {
      return {
        async first() {
          if (shouldFail) {
            throw new Error('DB unavailable');
          }
          return { ok: 1 };
        },
      };
    },
  };
}

describe('health route', () => {
  it('returns structured health data with metrics and trend history', async () => {
    const kv = createRateLimitKv({
      'ops:health:summary': JSON.stringify({
        buckets: [
          {
            timestamp: Date.parse('2026-03-11T12:00:00.000Z'),
            requestCount: 10,
            errorCount: 1,
            rateLimitHits: 2,
            totalResponseTime: 800,
          },
        ],
        recentErrors: [
          {
            timestamp: '2026-03-11T12:01:00.000Z',
            path: '/api/issues',
            method: 'POST',
            status: 500,
            message: '服务器内部错误',
          },
        ],
      }),
    });

    const response = await onRequest({
      request: new Request('http://localhost/api/health'),
      env: {
        ENVIRONMENT: 'development',
        DB: createDb(),
        RATE_LIMIT_KV: kv,
      },
      params: {},
    });
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.success).toBe(true);
    expect(payload.data.status).toBe('healthy');
    expect(payload.data.services.d1.status).toBe('connected');
    expect(payload.data.services.kv.status).toBe('connected');
    expect(payload.data.metrics.requestCount).toBe(10);
    expect(payload.data.metrics.rateLimitHits).toBe(2);
    expect(payload.data.trends).toHaveLength(1);
    expect(payload.data.recentErrors).toHaveLength(1);
  });

  it('degrades when KV is unavailable and fails when D1 is unavailable', async () => {
    const degradedResponse = await onRequest({
      request: new Request('http://localhost/api/health'),
      env: {
        ENVIRONMENT: 'development',
        DB: createDb(),
      },
      params: {},
    });
    const degradedPayload = await degradedResponse.json();

    expect(degradedResponse.status).toBe(200);
    expect(degradedPayload.data.status).toBe('degraded');
    expect(degradedPayload.data.services.kv.status).toBe('not_configured');

    const unhealthyResponse = await onRequest({
      request: new Request('http://localhost/api/health'),
      env: {
        ENVIRONMENT: 'development',
        DB: createDb({ shouldFail: true }),
        RATE_LIMIT_KV: createRateLimitKv(),
      },
      params: {},
    });
    const unhealthyPayload = await unhealthyResponse.json();

    expect(unhealthyResponse.status).toBe(503);
    expect(unhealthyPayload.data.status).toBe('unhealthy');
    expect(unhealthyPayload.data.checks.database).toBe('fail');
  });
});
