import { describe, expect, it, vi } from 'vitest';
import { createD1Database } from './helpers/fakeCloudflare.js';
import { onRequest } from '../functions/api/admin/actions.js';

function createDbMock(results) {
  const statements = [];
  return {
    statements,
    db: {
      prepare(sql) {
        const record = { sql, bindings: [] };
        statements.push(record);
        const result = results[statements.length - 1] || {};

        if (result.error) {
          throw result.error;
        }

        return {
          bind(...bindings) {
            record.bindings = bindings;
            return {
              first: async () => result.first ?? null,
              all: async () => result.all ?? { results: [] },
            };
          },
        };
      },
    },
  };
}

function createAdminContext(request, db, overrides = {}) {
  return {
    request,
    env: {
      ADMIN_SECRET_KEY: 'test-secret',
      ENVIRONMENT: 'development',
      RATE_LIMIT_STORE: createD1Database(),
      DB: db,
      ...overrides,
    },
    params: {},
  };
}

describe('admin actions route', () => {
  it('returns paginated audit actions', async () => {
    const { db } = createDbMock([
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

    const response = await onRequest(createAdminContext(
      new Request('http://localhost/api/admin/actions?page=1&pageSize=20', {
        headers: {
          Authorization: 'Bearer test-secret',
        },
      }),
      db,
    ));
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.success).toBe(true);
    expect(payload.data.items).toHaveLength(1);
    expect(payload.data.items[0].actionType).toBe('reply_added');
  });

  it('applies target and action filters to both audit queries', async () => {
    const { db, statements } = createDbMock([
      { first: { total: 1 } },
      {
        all: {
          results: [{
            id: 11,
            action_type: 'reply_added',
            target_type: 'issue',
            target_id: 2,
            details: '{}',
            performed_by: 'admin',
            performed_at: '2026-03-11T10:00:00.000Z',
            ip_address: '127.0.0.1',
          }],
        },
      },
    ]);

    const response = await onRequest(createAdminContext(
      new Request('http://localhost/api/admin/actions?page=2&pageSize=10&targetId=2&actionType=reply_added', {
        headers: {
          Authorization: 'Bearer test-secret',
        },
      }),
      db,
    ));
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.data.pagination).toMatchObject({
      page: 2,
      pageSize: 10,
      total: 1,
    });
    expect(statements[0].sql).toContain('WHERE target_id = ? AND action_type = ?');
    expect(statements[0].bindings).toEqual([2, 'reply_added']);
    expect(statements[1].bindings).toEqual([2, 'reply_added', 10, 10]);
  });

  it('rejects invalid list query parameters', async () => {
    const { db } = createDbMock([]);

    const response = await onRequest(createAdminContext(
      new Request('http://localhost/api/admin/actions?targetId=0', {
        headers: {
          Authorization: 'Bearer test-secret',
        },
      }),
      db,
    ));
    const payload = await response.json();

    expect(response.status).toBe(400);
    expect(payload.success).toBe(false);
  });

  it('returns forbidden for untrusted origins', async () => {
    const { db } = createDbMock([]);

    const response = await onRequest(createAdminContext(
      new Request('https://issue.calvin-xia.cn/api/admin/actions', {
        headers: {
          Origin: 'https://evil.example.com',
        },
      }),
      db,
      {
        ENVIRONMENT: 'production',
      },
    ));
    const payload = await response.json();

    expect(response.status).toBe(403);
    expect(payload.error).toBe('来源不受信任');
  });

  it('returns method not allowed for non-GET requests', async () => {
    const { db } = createDbMock([]);

    const response = await onRequest(createAdminContext(
      new Request('http://localhost/api/admin/actions', {
        method: 'POST',
      }),
      db,
    ));
    const payload = await response.json();

    expect(response.status).toBe(405);
    expect(response.headers.get('Allow')).toBe('GET, OPTIONS');
    expect(payload.error).toBe('Method not allowed');
  });

  it('returns options response for CORS preflight', async () => {
    const { db } = createDbMock([]);

    const response = await onRequest(createAdminContext(
      new Request('http://localhost/api/admin/actions', {
        method: 'OPTIONS',
        headers: {
          Origin: 'http://localhost:8788',
        },
      }),
      db,
    ));

    expect(response.status).toBe(200);
    expect(response.headers.get('Access-Control-Allow-Methods')).toBe('GET, OPTIONS');
  });

  it('rejects missing admin authorization', async () => {
    const { db } = createDbMock([]);

    const response = await onRequest(createAdminContext(
      new Request('http://localhost/api/admin/actions'),
      db,
    ));
    const payload = await response.json();

    expect(response.status).toBe(401);
    expect(payload.error).toBe('缺少授权信息');
  });

  it('returns a production-safe error when the database throws', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { db } = createDbMock([
      { error: new Error('boom') },
    ]);

    const response = await onRequest(createAdminContext(
      new Request('http://localhost/api/admin/actions', {
        headers: {
          Authorization: 'Bearer test-secret',
        },
      }),
      db,
      {
        ENVIRONMENT: 'production',
      },
    ));
    const payload = await response.json();

    expect(response.status).toBe(500);
    expect(payload.error).toBe('服务器内部错误');
    expect(errorSpy).toHaveBeenCalledWith('Admin actions route failed:', expect.any(Error));
  });
});

