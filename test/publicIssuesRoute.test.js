import { describe, expect, it } from 'vitest';
import { onRequest } from '../functions/api/issues.js';

function createRateLimitKv() {
  return {
    async get() {
      return null;
    },
    async put() {},
    async delete() {},
  };
}

function createDbMock() {
  let index = 0;
  const results = [
    { first: { total: 1 } },
    {
      all: {
        results: [{
          tracking_code: 'ABCD23EF',
          content: '图书馆空调异常。',
          category: 'facility',
          status: 'submitted',
          priority: 'high',
          public_summary: '正在处理',
          created_at: '2026-03-11T08:00:00.000Z',
          updated_at: '2026-03-11T09:00:00.000Z',
          name: '张三',
          student_id: '12345',
        }],
      },
    },
  ];

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

describe('public issues route', () => {
  it('returns public fields only', async () => {
    const response = await onRequest({
      request: new Request('http://localhost/api/issues?page=1&pageSize=20'),
      env: {
        ENVIRONMENT: 'development',
        RATE_LIMIT_KV: createRateLimitKv(),
        DB: createDbMock(),
      },
      params: {},
    });
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.success).toBe(true);
    expect(payload.data.items[0]).not.toHaveProperty('name');
    expect(payload.data.items[0]).not.toHaveProperty('studentId');
  });
});
