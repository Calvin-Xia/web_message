import { describe, expect, it } from 'vitest';
import { checkRateLimit } from '../src/shared/rateLimit.js';

function createKvStore(initial = {}) {
  const store = new Map(Object.entries(initial));
  return {
    store,
    async get(key) {
      return store.has(key) ? store.get(key) : null;
    },
    async put(key, value) {
      store.set(key, value);
    },
    async delete(key) {
      store.delete(key);
    },
  };
}

describe('checkRateLimit', () => {
  it('returns a 429 response once the threshold is exceeded', async () => {
    const kv = createKvStore({ 'ratelimit:postIssue:127.0.0.1:count': '10' });
    const request = new Request('http://localhost/api/issues', {
      method: 'POST',
      headers: {
        'CF-Connecting-IP': '127.0.0.1',
      },
    });

    const response = await checkRateLimit({ RATE_LIMIT_KV: kv }, request, 'postIssue', {});
    const payload = await response.json();

    expect(response.status).toBe(429);
    expect(payload.error).toBe('请求过于频繁，请稍后再试');
    expect(payload.retryAfter).toBeGreaterThan(0);
  });

  it('increments the current window counter when under the threshold', async () => {
    const kv = createKvStore();
    const request = new Request('http://localhost/api/issues', {
      method: 'GET',
      headers: {
        'CF-Connecting-IP': '127.0.0.1',
      },
    });

    const response = await checkRateLimit({ RATE_LIMIT_KV: kv }, request, 'getIssues', {});

    expect(response).toBeNull();
    expect(kv.store.get('ratelimit:getIssues:127.0.0.1:count')).toBe('1');
  });
});
