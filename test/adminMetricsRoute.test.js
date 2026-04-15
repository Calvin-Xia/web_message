import { describe, expect, it, vi } from 'vitest';
import { createD1Database } from './helpers/fakeCloudflare.js';
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
  const statements = [];
  return {
    statements,
    prepare() {
      const result = results[index] || {};
      index += 1;
      const record = { result, bindings: [] };
      statements.push(record);
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

function createSuccessfulMetricsDbMock(overrides = {}) {
  return createDbMock([
    {
      first: {
        total_issues: overrides.totalIssues ?? 12,
        pending_issues: overrides.pendingIssues ?? 4,
        resolved_issues: overrides.resolvedIssues ?? 8,
      },
    },
    { first: { total: overrides.createdTotal ?? 5 } },
    { first: { total: overrides.resolvedTotal ?? 3 } },
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
          { label: 'sleep', total: 3 },
        ],
      },
    },
    {
      all: {
        results: [
          { label: 'dormitory', total: 2 },
        ],
      },
    },
    {
      all: {
        results: [
          { scene: 'dormitory', total: 2, pending: 1 },
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
}

function createAdminMetricsContext(request, db, overrides = {}) {
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

describe('admin metrics route', () => {
  it('returns overview, distribution and trend metrics', async () => {
    const db = createSuccessfulMetricsDbMock();

    const response = await onRequest(createAdminMetricsContext(
      new Request('http://localhost/api/admin/metrics?period=week&refresh=true', {
        headers: {
          Authorization: 'Bearer test-secret',
        },
      }),
      db,
    ));
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.success).toBe(true);
    expect(payload.data.overview.totalIssues).toBe(12);
    expect(payload.data.overview.resolutionRate).toBeCloseTo(66.67, 2);
    expect(payload.data.byStatus.resolved).toBe(8);
    expect(payload.data.byDistressType.sleep).toBe(3);
    expect(payload.data.bySceneTag.dormitory).toBe(2);
    expect(payload.data.sceneHotspots[0].scene).toBe('dormitory');
    expect(payload.data.trends.daily.length).toBeGreaterThanOrEqual(2);
    expect(payload.data.performance.firstResponseTime.p50).toBe(60);
  });

  it('supports preflight and method guards', async () => {
    const optionsResponse = await onRequest(createAdminMetricsContext(
      new Request('http://localhost/api/admin/metrics', { method: 'OPTIONS' }),
      createSuccessfulMetricsDbMock(),
    ));
    const postResponse = await onRequest(createAdminMetricsContext(
      new Request('http://localhost/api/admin/metrics', { method: 'POST' }),
      createSuccessfulMetricsDbMock(),
    ));
    const postPayload = await postResponse.json();

    expect(optionsResponse.status).toBe(200);
    expect(optionsResponse.headers.get('Access-Control-Allow-Methods')).toBe('GET, OPTIONS');
    expect(postResponse.status).toBe(405);
    expect(postPayload.error).toBe('Method not allowed');
  });

  it('rejects untrusted origins and missing authorization', async () => {
    const originResponse = await onRequest(createAdminMetricsContext(
      new Request('https://issue.calvin-xia.cn/api/admin/metrics', {
        headers: {
          Origin: 'https://evil.example.com',
        },
      }),
      createSuccessfulMetricsDbMock(),
      { ENVIRONMENT: 'production' },
    ));
    const authResponse = await onRequest(createAdminMetricsContext(
      new Request('http://localhost/api/admin/metrics'),
      createSuccessfulMetricsDbMock(),
    ));
    const originPayload = await originResponse.json();
    const authPayload = await authResponse.json();

    expect(originResponse.status).toBe(403);
    expect(originPayload.error).toBe('来源不受信任');
    expect(authResponse.status).toBe(401);
    expect(authPayload.error).toBe('缺少授权信息');
  });

  it('rejects invalid date ranges before querying metrics', async () => {
    const db = createSuccessfulMetricsDbMock();
    const response = await onRequest(createAdminMetricsContext(
      new Request('http://localhost/api/admin/metrics?startDate=2026-03-12&endDate=2026-03-01', {
        headers: {
          Authorization: 'Bearer test-secret',
        },
      }),
      db,
    ));
    const payload = await response.json();

    expect(response.status).toBe(400);
    expect(payload.success).toBe(false);
    expect(db.statements).toHaveLength(0);
  });

  it('uses cached metrics unless refresh is requested', async () => {
    const db = createSuccessfulMetricsDbMock({ totalIssues: 7, resolvedIssues: 0 });
    const cacheUrl = 'http://localhost/api/admin/metrics?period=month&startDate=2026-02-01&endDate=2026-02-02';
    const requestInit = {
      headers: {
        Authorization: 'Bearer test-secret',
      },
    };

    const firstResponse = await onRequest(createAdminMetricsContext(new Request(cacheUrl, requestInit), db));
    const firstPayload = await firstResponse.json();
    const throwingDb = {
      prepare() {
        throw new Error('cache miss');
      },
    };
    const cachedResponse = await onRequest(createAdminMetricsContext(new Request(cacheUrl, requestInit), throwingDb));
    const cachedPayload = await cachedResponse.json();

    expect(firstResponse.status).toBe(200);
    expect(cachedResponse.status).toBe(200);
    expect(firstPayload.data.overview.totalIssues).toBe(7);
    expect(cachedPayload.data.overview.totalIssues).toBe(7);
  });

  it('bypasses cached metrics when refresh is true', async () => {
    const cacheUrl = 'http://localhost/api/admin/metrics?period=month&startDate=2026-02-03&endDate=2026-02-04';
    const requestInit = {
      headers: {
        Authorization: 'Bearer test-secret',
      },
    };

    await onRequest(createAdminMetricsContext(new Request(cacheUrl, requestInit), createSuccessfulMetricsDbMock({ totalIssues: 3 })));

    const refreshedResponse = await onRequest(createAdminMetricsContext(
      new Request(`${cacheUrl}&refresh=true`, requestInit),
      createSuccessfulMetricsDbMock({ totalIssues: 9, resolvedIssues: 0 }),
    ));
    const refreshedPayload = await refreshedResponse.json();

    expect(refreshedResponse.status).toBe(200);
    expect(refreshedPayload.data.overview.totalIssues).toBe(9);
    expect(refreshedPayload.data.range.source).toBe('custom');
  });

  it('returns production-safe errors when metric queries fail', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const response = await onRequest(createAdminMetricsContext(
      new Request('http://localhost/api/admin/metrics?period=day&refresh=true', {
        headers: {
          Authorization: 'Bearer test-secret',
        },
      }),
      {
        prepare() {
          throw new Error('boom');
        },
      },
      { ENVIRONMENT: 'production' },
    ));
    const payload = await response.json();

    expect(response.status).toBe(500);
    expect(payload.error).toBe('服务器内部错误');
    expect(errorSpy).toHaveBeenCalledWith('Admin metrics route failed:', expect.any(Error));
  });
});



