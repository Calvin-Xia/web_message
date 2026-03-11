import { describe, expect, it } from 'vitest';
import { onRequest } from '../functions/api/admin/metrics.js';

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

describe('admin metrics route', () => {
  it('returns overview, distribution and trend metrics', async () => {
    const db = createDbMock([
      {
        first: {
          total_issues: 12,
          pending_issues: 4,
          resolved_issues: 8,
        },
      },
      { first: { total: 5 } },
      { first: { total: 3 } },
      {
        all: {
          results: [
            { label: 'submitted', total: 2 },
            { label: 'resolved', total: 8 },
          ],
        },
      },
      {
        all: {
          results: [
            { label: 'facility', total: 7 },
            { label: 'service', total: 5 },
          ],
        },
      },
      {
        all: {
          results: [
            { label: 'normal', total: 10 },
            { label: 'high', total: 2 },
          ],
        },
      },
      {
        all: {
          results: [
            { duration: 60 },
            { duration: 120 },
          ],
        },
      },
      {
        all: {
          results: [
            { duration: 3600 },
            { duration: 7200 },
          ],
        },
      },
      {
        all: {
          results: [
            { bucket: '2026-03-10', total: 2 },
            { bucket: '2026-03-11', total: 3 },
          ],
        },
      },
      {
        all: {
          results: [
            { bucket: '2026-03-10', total: 1 },
          ],
        },
      },
      {
        all: {
          results: [
            { bucket: '2026-W10', total: 5 },
          ],
        },
      },
      {
        all: {
          results: [
            { bucket: '2026-W10', total: 4 },
          ],
        },
      },
      {
        all: {
          results: [
            { bucket: '2026-03', total: 12 },
          ],
        },
      },
      {
        all: {
          results: [
            { bucket: '2026-03', total: 8 },
          ],
        },
      },
    ]);

    const response = await onRequest({
      request: new Request('http://localhost/api/admin/metrics?period=week', {
        headers: {
          Authorization: 'Bearer test-secret',
        },
      }),
      env: {
        ADMIN_SECRET_KEY: 'test-secret',
        ENVIRONMENT: 'development',
        RATE_LIMIT_KV: createRateLimitKv(),
        DB: db,
      },
      params: {},
    });
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.success).toBe(true);
    expect(payload.data.overview.totalIssues).toBe(12);
    expect(payload.data.overview.resolutionRate).toBeCloseTo(66.67, 2);
    expect(payload.data.byStatus.resolved).toBe(8);
    expect(payload.data.trends.daily.length).toBeGreaterThanOrEqual(2);
    expect(payload.data.performance.firstResponseTime.p50).toBe(60);
  });
});


