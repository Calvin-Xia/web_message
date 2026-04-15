import { afterEach, describe, expect, it, vi } from 'vitest';
import { createAppEnv, createD1Database } from './helpers/fakeCloudflare.js';
import { onRequest } from '../functions/api/insights.js';

function createIssue(overrides = {}) {
  return {
    id: overrides.id ?? 1,
    tracking_code: overrides.tracking_code ?? 'ABCD23EF',
    name: '测试同学',
    student_id: '2024012345678',
    email: null,
    notify_by_email: 0,
    content: '最近心理压力比较明显，希望获得进一步支持。',
    is_public: 1,
    is_reported: 0,
    category: 'counseling',
    distress_type: 'sleep',
    scene_tag: 'dormitory',
    priority: 'normal',
    status: 'submitted',
    public_summary: null,
    assigned_to: null,
    first_response_at: null,
    resolved_at: null,
    created_at: '2026-03-11T08:00:00.000Z',
    updated_at: '2026-03-11T08:00:00.000Z',
    ...overrides,
  };
}

describe('public insights route', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('supports preflight requests', async () => {
    const response = await onRequest({
      request: new Request('http://localhost/api/insights', {
        method: 'OPTIONS',
      }),
      env: createAppEnv(),
      params: {},
    });

    expect(response.status).toBe(200);
    expect(response.headers.get('Access-Control-Allow-Methods')).toBe('GET, OPTIONS');
  });

  it('rejects unsupported methods before querying insights', async () => {
    const response = await onRequest({
      request: new Request('http://localhost/api/insights', {
        method: 'POST',
      }),
      env: createAppEnv(),
      params: {},
    });
    const payload = await response.json();

    expect(response.status).toBe(405);
    expect(payload.error).toBe('Method not allowed');
  });

  it('aggregates only public counseling issue scene hotspots', async () => {
    const env = createAppEnv();
    env.DB.issues.push(
      createIssue(),
      createIssue({
        id: 2,
        tracking_code: 'ZXCV56BN',
        scene_tag: 'library',
        distress_type: 'academic_pressure',
        status: 'resolved',
      }),
      createIssue({
        id: 3,
        tracking_code: 'QWER78TY',
        is_public: 0,
        scene_tag: 'dormitory',
      }),
      createIssue({
        id: 4,
        tracking_code: 'LMNO34PQ',
        category: 'facility',
        distress_type: null,
        scene_tag: null,
      }),
    );

    const response = await onRequest({
      request: new Request('http://localhost/api/insights?startDate=2026-03-01&endDate=2026-03-31'),
      env,
      params: {},
    });
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.success).toBe(true);
    expect(payload.data.overview.publicCounselingIssues).toBe(2);
    expect(payload.data.range).toEqual({
      startDate: '2026-03-01',
      endDate: '2026-03-31',
      days: 31,
    });
    expect(payload.data.sceneHotspots).toEqual([
      { scene: 'dormitory', total: 1, pending: 1 },
      { scene: 'library', total: 1, pending: 0 },
    ]);
    expect(payload.data.distressTypes).toEqual([
      { distressType: 'academic_pressure', total: 1 },
      { distressType: 'sleep', total: 1 },
    ]);
  });

  it('defaults public insights to the latest 90 days', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-04-15T12:00:00.000Z'));

    const env = createAppEnv();
    env.DB.issues.push(
      createIssue({
        id: 1,
        tracking_code: 'RECENT01',
        created_at: '2026-04-01T08:00:00.000Z',
        updated_at: '2026-04-01T08:00:00.000Z',
      }),
      createIssue({
        id: 2,
        tracking_code: 'OLD00001',
        created_at: '2025-12-01T08:00:00.000Z',
        updated_at: '2025-12-01T08:00:00.000Z',
      }),
    );

    const response = await onRequest({
      request: new Request('http://localhost/api/insights'),
      env,
      params: {},
    });
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.data.range).toEqual({
      startDate: '2026-01-16',
      endDate: '2026-04-15',
      days: 90,
    });
    expect(payload.data.overview.publicCounselingIssues).toBe(1);
    expect(payload.data.sceneHotspots).toEqual([
      { scene: 'dormitory', total: 1, pending: 1 },
    ]);
  });

  it('rejects public insight ranges over 365 days', async () => {
    const response = await onRequest({
      request: new Request('http://localhost/api/insights?startDate=2025-01-01&endDate=2026-04-01'),
      env: createAppEnv(),
      params: {},
    });
    const payload = await response.json();

    expect(response.status).toBe(400);
    expect(payload.error).toBe('公开热区统计范围不能超过365天');
  });

  it('returns empty aggregate arrays when no public counseling data exists', async () => {
    const response = await onRequest({
      request: new Request('http://localhost/api/insights'),
      env: createAppEnv(),
      params: {},
    });
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.data.overview.publicCounselingIssues).toBe(0);
    expect(payload.data.sceneHotspots).toEqual([]);
    expect(payload.data.distressTypes).toEqual([]);
  });

  it('returns production-safe errors when aggregation fails', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const env = createAppEnv({
      ENVIRONMENT: 'production',
      RATE_LIMIT_STORE: createD1Database(),
      DB: {
        prepare() {
          throw new Error('boom');
        },
      },
    });

    const response = await onRequest({
      request: new Request('http://localhost/api/insights'),
      env,
      params: {},
    });
    const payload = await response.json();

    expect(response.status).toBe(500);
    expect(payload.error).toBe('服务器内部错误');
    expect(errorSpy).toHaveBeenCalledWith('Public insights route failed:', expect.any(Error));
  });
});
