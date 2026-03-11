import { describe, expect, it } from 'vitest';
import { loadObservabilitySnapshot, readErrorMessageFromResponse, recordRequestObservation } from '../src/shared/observability.js';
import { createRateLimitKv } from './helpers/fakeCloudflare.js';

const BUCKET_MS = 5 * 60 * 1000;
const BASE_TIMESTAMP = Date.parse('2026-03-11T00:00:00.000Z');

function createBucket(offset, overrides = {}) {
  return {
    timestamp: BASE_TIMESTAMP + (offset * BUCKET_MS),
    requestCount: 1,
    errorCount: 0,
    rateLimitHits: 0,
    totalResponseTime: 10,
    ...overrides,
  };
}

describe('observability helpers', () => {
  it('returns null when the response body has already been consumed', async () => {
    const response = new Response(JSON.stringify({ error: '内部细节' }), {
      status: 400,
      headers: {
        'Content-Type': 'application/json; charset=UTF-8',
      },
    });

    await response.text();

    await expect(readErrorMessageFromResponse(response)).resolves.toBeNull();
  });

  it('keeps late-arriving buckets ordered when persisting observations', async () => {
    const env = {
      RATE_LIMIT_KV: createRateLimitKv({
        'ops:health:summary': JSON.stringify({
          buckets: [createBucket(2), createBucket(4)],
          recentErrors: [],
          updatedAt: new Date(BASE_TIMESTAMP).toISOString(),
        }),
      }),
    };

    await recordRequestObservation(env, {
      path: '/api/issues',
      method: 'GET',
      status: 200,
      durationMs: 25,
      timestamp: BASE_TIMESTAMP + (3 * BUCKET_MS),
    });

    const snapshot = await loadObservabilitySnapshot(env);
    expect(snapshot.buckets.map((bucket) => bucket.timestamp)).toEqual([
      createBucket(2).timestamp,
      createBucket(3).timestamp,
      createBucket(4).timestamp,
    ]);
  });

  it('prunes the oldest buckets when the retention window is exceeded', async () => {
    const buckets = Array.from({ length: 36 }, (_, index) => createBucket(index));
    const env = {
      RATE_LIMIT_KV: createRateLimitKv({
        'ops:health:summary': JSON.stringify({
          buckets,
          recentErrors: [],
          updatedAt: new Date(BASE_TIMESTAMP).toISOString(),
        }),
      }),
    };

    await recordRequestObservation(env, {
      path: '/api/issues',
      method: 'POST',
      status: 200,
      durationMs: 30,
      timestamp: BASE_TIMESTAMP + (36 * BUCKET_MS),
    });

    const snapshot = await loadObservabilitySnapshot(env);
    expect(snapshot.buckets).toHaveLength(36);
    expect(snapshot.buckets[0].timestamp).toBe(createBucket(1).timestamp);
    expect(snapshot.buckets.at(-1).timestamp).toBe(createBucket(36).timestamp);
  });
});
