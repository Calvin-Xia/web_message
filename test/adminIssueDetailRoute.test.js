import { afterEach, describe, expect, it, vi } from 'vitest';
import { onRequest } from '../functions/api/admin/issues/[id].js';
import { createD1Database } from './helpers/fakeCloudflare.js';

function createDbMock(results, { batchResults = [] } = {}) {
  let index = 0;
  let batchIndex = 0;
  return {
    prepare() {
      const result = results[index] || {};
      index += 1;
      return {
        bind() {
          return {
            first: async () => result.first ?? null,
            all: async () => result.all ?? { results: [] },
            run: async () => {
              if (result.runError) {
                throw result.runError;
              }
              return result.run ?? { success: true };
            },
          };
        },
      };
    },
    async batch() {
      return batchResults[batchIndex++] ?? [{ meta: { changes: 1 } }];
    },
  };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('admin issue detail route', () => {
  it('logs structured context when illegal transition audit recording fails', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const db = createDbMock([
      {
        first: {
          id: 1,
          tracking_code: 'ABCD23EF',
          status: 'submitted',
          category: 'facility',
          priority: 'normal',
          assigned_to: null,
          public_summary: null,
          is_public: '0',
          updated_at: '2026-03-11T00:00:00.000Z',
        },
      },
      {
        runError: new Error('audit write failed'),
      },
    ]);
    const request = new Request('http://localhost/api/admin/issues/1', {
      method: 'PATCH',
      headers: {
        Authorization: 'Bearer test-secret',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ status: 'resolved', updatedAt: '2026-03-11T00:00:00.000Z' }),
    });

    const response = await onRequest({
      request,
      env: {
        ADMIN_SECRET_KEY: 'test-secret',
        ENVIRONMENT: 'development',
        RATE_LIMIT_STORE: createD1Database(),
        DB: db,
      },
      params: {
        id: '1',
      },
    });
    const payload = await response.json();

    expect(response.status).toBe(400);
    expect(payload.error).toBe('状态流转不合法');
    expect(errorSpy).toHaveBeenCalledWith('Failed to record illegal transition attempt', expect.objectContaining({
      issueId: 1,
      trackingCode: 'ABCD23EF',
      currentStatus: 'submitted',
      requestedStatus: 'resolved',
      actor: 'admin',
      ipAddress: 'unknown',
      errorMessage: 'audit write failed',
    }));
  });

  it('returns 409 when the issue has been modified since the client loaded it', async () => {
    const db = createDbMock([
      {
        first: {
          id: 1,
          tracking_code: 'ABCD23EF',
          status: 'submitted',
          category: 'facility',
          priority: 'normal',
          assigned_to: null,
          public_summary: null,
          is_public: '0',
          first_response_at: null,
          updated_at: '2026-03-11T00:00:00.000Z',
        },
      },
      {},
      {},
      {},
      {
        first: {
          id: 1,
          tracking_code: 'ABCD23EF',
          status: 'in_review',
          category: 'facility',
          priority: 'high',
          assigned_to: 'admin2',
          public_summary: '已被他人修改',
          is_public: '1',
          first_response_at: '2026-03-11T00:05:00.000Z',
          updated_at: '2026-03-11T00:06:00.000Z',
        },
      },
    ], {
      batchResults: [[{ meta: { changes: 0 } }]],
    });

    const response = await onRequest({
      request: new Request('http://localhost/api/admin/issues/1', {
        method: 'PATCH',
        headers: {
          Authorization: 'Bearer test-secret',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          status: 'in_review',
          updatedAt: '2026-03-11T00:00:00.000Z',
        }),
      }),
      env: {
        ADMIN_SECRET_KEY: 'test-secret',
        ENVIRONMENT: 'development',
        RATE_LIMIT_STORE: createD1Database(),
        DB: db,
      },
      params: { id: '1' },
    });
    const payload = await response.json();

    expect(response.status).toBe(409);
    expect(payload.error).toBe('问题已被其他管理员更新，请刷新后重试');
  });
});

