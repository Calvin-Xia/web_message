import { afterEach, describe, expect, it, vi } from 'vitest';
import { onRequest } from '../functions/api/admin/issues/[id].js';

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
      body: JSON.stringify({ status: 'resolved' }),
    });

    const response = await onRequest({
      request,
      env: {
        ADMIN_SECRET_KEY: 'test-secret',
        ENVIRONMENT: 'development',
        RATE_LIMIT_KV: createRateLimitKv(),
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
});
