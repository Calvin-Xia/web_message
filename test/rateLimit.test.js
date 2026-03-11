import { describe, expect, it } from 'vitest';
import { checkRateLimit } from '../src/shared/rateLimit.js';
import { createD1Database } from './helpers/fakeCloudflare.js';

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
});
