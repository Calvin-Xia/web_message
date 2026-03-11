import { describe, expect, it } from 'vitest';
import { createD1Database } from './helpers/fakeCloudflare.js';
import { onRequest } from '../functions/api/admin/actions.js';

function createRateLimitKv() {
  return {
    async get() {
      return null;
    },
    async put() {},
    async delete() {},
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

describe('admin actions route', () => {
  it('returns paginated audit actions', async () => {
    const db = createDbMock([
      { first: { total: 1 } },
      {
        all: {
          results: [{
            id: 9,
            action_type: 'reply_added',
            target_type: 'issue',
            target_id: 2,
            details: JSON.stringify({ trackingCode: 'ABCD23EF' }),
            performed_by: 'admin',
            performed_at: '2026-03-11T10:00:00.000Z',
            ip_address: '127.0.0.1',
          }],
        },
      },
    ]);

    const response = await onRequest({
      request: new Request('http://localhost/api/admin/actions?page=1&pageSize=20', {
        headers: {
          Authorization: 'Bearer test-secret',
        },
      }),
      env: {
        ADMIN_SECRET_KEY: 'test-secret',
        ENVIRONMENT: 'development',
        RATE_LIMIT_STORE: createD1Database(),
        DB: db,
      },
      params: {},
    });
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.success).toBe(true);
    expect(payload.data.items).toHaveLength(1);
    expect(payload.data.items[0].actionType).toBe('reply_added');
  });
});

