import { describe, expect, it } from 'vitest';
import { loadObservabilitySnapshot, readErrorMessageFromResponse, recordRequestObservation } from '../src/shared/observability.js';
import { createD1Database } from './helpers/fakeCloudflare.js';

const BUCKET_MS = 5 * 60 * 1000;
const BASE_TIMESTAMP = Math.floor(Date.now() / BUCKET_MS) * BUCKET_MS - (36 * BUCKET_MS);

function createBucket(offset) {
  return BASE_TIMESTAMP + (offset * BUCKET_MS);
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
    const store = createD1Database();
    const env = { OBSERVABILITY_STORE: store };

    await recordRequestObservation(env, {
      path: '/api/issues',
      method: 'GET',
      status: 200,
      durationMs: 10,
      timestamp: createBucket(2),
    });
    await recordRequestObservation(env, {
      path: '/api/issues',
      method: 'GET',
      status: 200,
      durationMs: 12,
      timestamp: createBucket(4),
    });
    await recordRequestObservation(env, {
      path: '/api/issues',
      method: 'GET',
      status: 200,
      durationMs: 25,
      timestamp: createBucket(3),
    });

    const snapshot = await loadObservabilitySnapshot(env);
    expect(snapshot.buckets.map((bucket) => bucket.timestamp)).toEqual([
      createBucket(2),
      createBucket(3),
      createBucket(4),
    ]);
  });

  it('prunes the oldest buckets when the retention window is exceeded', async () => {
    const store = createD1Database();
    const env = { OBSERVABILITY_STORE: store };

    for (let index = 0; index < 37; index += 1) {
      await recordRequestObservation(env, {
        path: '/api/issues',
        method: 'POST',
        status: 200,
        durationMs: 30,
        timestamp: createBucket(index),
      });
    }

    const snapshot = await loadObservabilitySnapshot(env);
    expect(snapshot.buckets).toHaveLength(36);
    expect(snapshot.buckets[0].timestamp).toBe(createBucket(1));
    expect(snapshot.buckets.at(-1).timestamp).toBe(createBucket(36));
  });
});
