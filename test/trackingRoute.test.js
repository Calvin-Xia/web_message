import { describe, expect, it } from 'vitest';
import { createD1Database } from './helpers/fakeCloudflare.js';
import { onRequest } from '../functions/api/issues/[trackingCode].js';

function createRateLimitKv() {
  return {
    get: async () => null,
    put: async () => undefined,
    delete: async () => undefined,
  };
}

function createDbMock(results) {
  let index = 0;
  return {
    prepare() {
      const result = results[index] || {};
      index += 1;
      return {
        bind() {
          return {
            first: async () => result.first ?? null,
            all: async () => result.all ?? { results: [] },
          };
        },
      };
    },
  };
}

describe('tracking route', () => {
  it('supports preflight requests for the public tracking API', async () => {
    const response = await onRequest({
      request: new Request('http://localhost/api/issues/ABCD23EF', {
        method: 'OPTIONS',
      }),
      env: {
        RATE_LIMIT_STORE: createD1Database(),
        DB: createD1Database(),
      },
      params: {
        trackingCode: 'ABCD23EF',
      },
    });

    expect(response.status).toBe(200);
    expect(response.headers.get('Access-Control-Allow-Methods')).toBe('GET, OPTIONS');
  });

  it('rejects unsupported methods before hitting the database', async () => {
    const response = await onRequest({
      request: new Request('http://localhost/api/issues/ABCD23EF', {
        method: 'POST',
      }),
      env: {
        RATE_LIMIT_STORE: createD1Database(),
        DB: createD1Database(),
      },
      params: {
        trackingCode: 'ABCD23EF',
      },
    });
    const payload = await response.json();

    expect(response.status).toBe(405);
    expect(payload.error).toBe('Method not allowed');
  });

  it('returns a validation error for malformed tracking codes', async () => {
    const response = await onRequest({
      request: new Request('http://localhost/api/issues/bad-code'),
      env: {
        RATE_LIMIT_STORE: createD1Database(),
        DB: createD1Database(),
      },
      params: {
        trackingCode: 'bad-code',
      },
    });
    const payload = await response.json();

    expect(response.status).toBe(400);
    expect(payload.error).toBe('追踪编号格式无效');
  });

  it('returns 404 when the tracking code does not exist', async () => {
    const response = await onRequest({
      request: new Request('http://localhost/api/issues/ABCD23EF'),
      env: {
        RATE_LIMIT_STORE: createD1Database(),
        DB: createD1Database(),
      },
      params: {
        trackingCode: 'ABCD23EF',
      },
    });
    const payload = await response.json();

    expect(response.status).toBe(404);
    expect(payload.error).toBe('追踪编号不存在');
  });

  it('uses strict boolean conversion for public updates and disables browser caching', async () => {
    const db = createDbMock([
      {
        first: {
          id: 1,
          tracking_code: 'ABCD23EF',
          content: '图书馆空调不制冷，需要尽快处理。',
          category: 'facility',
          status: 'submitted',
          priority: 'high',
          public_summary: '排查中',
          created_at: '2026-03-11T08:00:00.000Z',
          updated_at: '2026-03-11T09:00:00.000Z',
        },
      },
      {
        all: {
          results: [{
            id: 10,
            update_type: 'public_reply',
            new_value: null,
            content: '已经安排检修。',
            is_public: '0',
            created_at: '2026-03-11T10:00:00.000Z',
          }],
        },
      },
    ]);
    const request = new Request('http://localhost/api/issues/ABCD23EF');

    const response = await onRequest({
      request,
      env: {
        ENVIRONMENT: 'development',
        RATE_LIMIT_STORE: createD1Database(),
        DB: db,
      },
      params: {
        trackingCode: 'ABCD23EF',
      },
    });
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(response.headers.get('Cache-Control')).toBe('private, no-store');
    expect(payload.success).toBe(true);
    expect(payload.data.updates[0].isPublic).toBe(false);
  });
});


