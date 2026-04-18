import { describe, expect, it, vi } from 'vitest';
import { createAppEnv } from './helpers/fakeCloudflare.js';
import { onRequest } from '../functions/api/knowledge.js';

function createKnowledgeItem(overrides = {}) {
  return {
    id: overrides.id ?? 1,
    title: overrides.title ?? '睡眠问题',
    tag: overrides.tag ?? 'sleep',
    content: overrides.content ?? '睡前减少刷屏和高强度学习，尝试固定起床时间。',
    sort_order: overrides.sort_order ?? 10,
    is_enabled: overrides.is_enabled ?? 1,
    created_at: overrides.created_at ?? '2026-04-18T08:00:00.000Z',
    updated_at: overrides.updated_at ?? '2026-04-18T08:00:00.000Z',
  };
}

describe('public knowledge route', () => {
  it('supports preflight requests', async () => {
    const response = await onRequest({
      request: new Request('http://localhost/api/knowledge', {
        method: 'OPTIONS',
      }),
      env: createAppEnv(),
      params: {},
    });

    expect(response.status).toBe(200);
    expect(response.headers.get('Access-Control-Allow-Methods')).toBe('GET, OPTIONS');
  });

  it('rejects unsupported methods', async () => {
    const response = await onRequest({
      request: new Request('http://localhost/api/knowledge', {
        method: 'POST',
      }),
      env: createAppEnv(),
      params: {},
    });
    const payload = await response.json();

    expect(response.status).toBe(405);
    expect(response.headers.get('Allow')).toBe('GET, OPTIONS');
    expect(payload.error).toBe('Method not allowed');
  });

  it('returns enabled knowledge items sorted by sort order and id', async () => {
    const env = createAppEnv();
    env.DB.knowledgeItems.push(
      createKnowledgeItem({
        id: 1,
        title: '禁用条目',
        tag: 'mood',
        sort_order: 1,
        is_enabled: 0,
      }),
      createKnowledgeItem({
        id: 2,
        title: '人际关系',
        tag: 'relationship',
        sort_order: 30,
      }),
      createKnowledgeItem({
        id: 3,
        title: '学业压力',
        tag: 'academic_pressure',
        sort_order: 10,
      }),
    );

    const response = await onRequest({
      request: new Request('http://localhost/api/knowledge'),
      env,
      params: {},
    });
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(response.headers.get('Cache-Control')).toBe('public, max-age=60');
    expect(payload.success).toBe(true);
    expect(payload.data.items).toEqual([
      expect.objectContaining({
        id: 3,
        title: '学业压力',
        tag: 'academic_pressure',
        sortOrder: 10,
        isEnabled: true,
      }),
      expect.objectContaining({
        id: 2,
        title: '人际关系',
        tag: 'relationship',
        sortOrder: 30,
        isEnabled: true,
      }),
    ]);
  });

  it('returns production-safe errors when the database fails', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const env = createAppEnv({
      ENVIRONMENT: 'production',
      DB: {
        prepare() {
          throw new Error('raw database failure');
        },
      },
    });

    const response = await onRequest({
      request: new Request('http://localhost/api/knowledge'),
      env,
      params: {},
    });
    const payload = await response.json();

    expect(response.status).toBe(500);
    expect(payload.error).toBe('服务器内部错误');
    expect(errorSpy).toHaveBeenCalled();
    errorSpy.mockRestore();
  });
});
