import { describe, expect, it } from 'vitest';
import { onRequest } from '../functions/api/health.js';
import { recordRequestObservation } from '../src/shared/observability.js';
import { createD1Database, createRateLimitKv } from './helpers/fakeCloudflare.js';

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
    const kv = createRateLimitKv();
    const observationStore = createD1Database();
    const observationEnv = { OBSERVABILITY_STORE: observationStore };

    await recordRequestObservation(observationEnv, {
      path: '/api/issues',
      method: 'POST',
      status: 500,
      durationMs: 80,
      timestamp: Date.now(),
      message: '数据库错误',
    });
    await recordRequestObservation(observationEnv, {
      path: '/api/issues',
      method: 'GET',
      status: 200,
      durationMs: 720,
      timestamp: Date.now(),
    });
    await recordRequestObservation(observationEnv, {
      path: '/api/issues',
      method: 'GET',
      status: 429,
      durationMs: 0,
      timestamp: Date.now(),
      message: '请求过于频繁，请稍后再试',
    });

    const response = await onRequest({
      request: new Request('http://localhost/api/health'),
      env: {
        ENVIRONMENT: 'development',
        DB: createDb(),
        RATE_LIMIT_KV: kv,
        OBSERVABILITY_STORE: observationStore,
      },
      params: {},
    });
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.success).toBe(true);
    expect(payload.data.status).toBe('healthy');
    expect(payload.data.services.d1.status).toBe('connected');
    expect(payload.data.services.kv.status).toBe('connected');
    expect(payload.data.metrics.requestCount).toBe(3);
    expect(payload.data.metrics.rateLimitHits).toBe(1);
    expect(payload.data.trends).toHaveLength(1);
    expect(payload.data.recentErrors).toHaveLength(2);
  });

  it('degrades when KV is unavailable and fails when D1 is unavailable', async () => {
    const degradedResponse = await onRequest({
      request: new Request('http://localhost/api/health'),
      env: {
        ENVIRONMENT: 'development',
        DB: createDb(),
        OBSERVABILITY_STORE: createD1Database(),
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
        OBSERVABILITY_STORE: createD1Database(),
      },
      params: {},
    });
    const unhealthyPayload = await unhealthyResponse.json();

    expect(unhealthyResponse.status).toBe(503);
    expect(unhealthyPayload.data.status).toBe('unhealthy');
    expect(unhealthyPayload.data.checks.database).toBe('fail');
  });
});
