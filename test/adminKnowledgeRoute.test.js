import { afterEach, describe, expect, it, vi } from 'vitest';
import { createAppEnv, createD1Database } from './helpers/fakeCloudflare.js';
import { onRequest as onKnowledgeCollectionRequest } from '../functions/api/admin/knowledge.js';
import { onRequest as onKnowledgeItemRequest } from '../functions/api/admin/knowledge/[id].js';

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

function createAuthorizedRequest(url, options = {}) {
  return new Request(url, {
    ...options,
    headers: {
      Authorization: 'Bearer test-secret',
      ...(options.headers || {}),
    },
  });
}

function createAuditFailingDb(backingDb = createD1Database()) {
  return {
    backingDb,
    prepare(sql) {
      if (String(sql).includes('INSERT INTO admin_actions')) {
        throw new Error('audit write failed');
      }

      return backingDb.prepare(sql);
    },
    batch(statements) {
      return backingDb.batch(statements);
    },
  };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('admin knowledge collection route', () => {
  it('returns all knowledge items including disabled entries', async () => {
    const env = createAppEnv();
    env.DB.knowledgeItems.push(
      createKnowledgeItem({ id: 1, title: '禁用条目', is_enabled: 0, sort_order: 20 }),
      createKnowledgeItem({ id: 2, title: '学业压力', tag: 'academic_pressure', sort_order: 10 }),
    );

    const response = await onKnowledgeCollectionRequest({
      request: createAuthorizedRequest('http://localhost/api/admin/knowledge'),
      env,
      params: {},
    });
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.data.items).toEqual([
      expect.objectContaining({ id: 2, title: '学业压力', isEnabled: true }),
      expect.objectContaining({ id: 1, title: '禁用条目', isEnabled: false }),
    ]);
  });

  it('creates a knowledge item and records an audit action', async () => {
    const env = createAppEnv();

    const response = await onKnowledgeCollectionRequest({
      request: createAuthorizedRequest('http://localhost/api/admin/knowledge', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          title: '  情绪波动  ',
          tag: 'mood',
          content: '  先把情绪命名，再做一次缓慢呼吸。  ',
          sortOrder: 40,
          isEnabled: false,
        }),
      }),
      env,
      params: {},
    });
    const payload = await response.json();

    expect(response.status).toBe(201);
    expect(payload.data).toMatchObject({
      id: 1,
      title: '情绪波动',
      tag: 'mood',
      content: '先把情绪命名，再做一次缓慢呼吸。',
      sortOrder: 40,
      isEnabled: false,
    });
    expect(env.DB.knowledgeItems[0]).toMatchObject({
      title: '情绪波动',
      tag: 'mood',
      sort_order: 40,
      is_enabled: 0,
    });
    expect(env.DB.adminActions[0]).toMatchObject({
      action_type: 'knowledge_created',
      target_type: 'knowledge_item',
      target_id: 1,
    });
  });

  it('rejects invalid create payloads', async () => {
    const env = createAppEnv();

    const response = await onKnowledgeCollectionRequest({
      request: createAuthorizedRequest('http://localhost/api/admin/knowledge', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          title: '',
          tag: 'invalid',
          content: '',
        }),
      }),
      env,
      params: {},
    });
    const payload = await response.json();

    expect(response.status).toBe(400);
    expect(payload.success).toBe(false);
  });

  it('does not persist a created item when audit logging fails', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const backingDb = createD1Database();
    const env = createAppEnv({
      DB: createAuditFailingDb(backingDb),
      RATE_LIMIT_STORE: createD1Database(),
    });

    const response = await onKnowledgeCollectionRequest({
      request: createAuthorizedRequest('http://localhost/api/admin/knowledge', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          title: '情绪波动',
          tag: 'mood',
          content: '先把情绪命名，再做一次缓慢呼吸。',
          sortOrder: 40,
          isEnabled: true,
        }),
      }),
      env,
      params: {},
    });

    expect(response.status).toBe(500);
    expect(backingDb.knowledgeItems).toHaveLength(0);
    expect(backingDb.adminActions).toHaveLength(0);
    expect(errorSpy).toHaveBeenCalled();
  });

  it('supports preflight and rejects missing admin authorization', async () => {
    const env = createAppEnv();

    const optionsResponse = await onKnowledgeCollectionRequest({
      request: new Request('http://localhost/api/admin/knowledge', {
        method: 'OPTIONS',
        headers: {
          Origin: 'http://localhost:8788',
        },
      }),
      env,
      params: {},
    });
    const unauthorizedResponse = await onKnowledgeCollectionRequest({
      request: new Request('http://localhost/api/admin/knowledge'),
      env,
      params: {},
    });
    const unauthorizedPayload = await unauthorizedResponse.json();

    expect(optionsResponse.status).toBe(200);
    expect(optionsResponse.headers.get('Access-Control-Allow-Methods')).toBe('GET, POST, OPTIONS');
    expect(unauthorizedResponse.status).toBe(401);
    expect(unauthorizedPayload.error).toBe('缺少授权信息');
  });
});

describe('admin knowledge item route', () => {
  it('updates an item with optimistic concurrency and records an audit action', async () => {
    const env = createAppEnv();
    env.DB.knowledgeItems.push(createKnowledgeItem());

    const response = await onKnowledgeItemRequest({
      request: createAuthorizedRequest('http://localhost/api/admin/knowledge/1', {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          title: '睡眠支持',
          isEnabled: false,
          updatedAt: '2026-04-18T08:00:00.000Z',
        }),
      }),
      env,
      params: { id: '1' },
    });
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.data.item).toMatchObject({
      id: 1,
      title: '睡眠支持',
      isEnabled: false,
    });
    expect(env.DB.knowledgeItems[0]).toMatchObject({
      title: '睡眠支持',
      is_enabled: 0,
    });
    expect(env.DB.adminActions[0]).toMatchObject({
      action_type: 'knowledge_updated',
      target_type: 'knowledge_item',
      target_id: 1,
    });
  });

  it('returns conflict when updatedAt is stale', async () => {
    const env = createAppEnv();
    env.DB.knowledgeItems.push(createKnowledgeItem({
      updated_at: '2026-04-18T09:00:00.000Z',
    }));

    const response = await onKnowledgeItemRequest({
      request: createAuthorizedRequest('http://localhost/api/admin/knowledge/1', {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          title: '睡眠支持',
          updatedAt: '2026-04-18T08:00:00.000Z',
        }),
      }),
      env,
      params: { id: '1' },
    });
    const payload = await response.json();

    expect(response.status).toBe(409);
    expect(payload.error).toBe('知识条目已被其他管理员更新，请刷新后重试');
  });

  it('does not persist item updates when audit logging fails', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const backingDb = createD1Database();
    backingDb.knowledgeItems.push(createKnowledgeItem());
    const env = createAppEnv({
      DB: createAuditFailingDb(backingDb),
      RATE_LIMIT_STORE: createD1Database(),
    });

    const response = await onKnowledgeItemRequest({
      request: createAuthorizedRequest('http://localhost/api/admin/knowledge/1', {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          title: '睡眠支持',
          updatedAt: '2026-04-18T08:00:00.000Z',
        }),
      }),
      env,
      params: { id: '1' },
    });

    expect(response.status).toBe(500);
    expect(backingDb.knowledgeItems[0].title).toBe('睡眠问题');
    expect(backingDb.adminActions).toHaveLength(0);
    expect(errorSpy).toHaveBeenCalled();
  });

  it('deletes an item with optimistic concurrency and records an audit action', async () => {
    const env = createAppEnv();
    env.DB.knowledgeItems.push(createKnowledgeItem());

    const response = await onKnowledgeItemRequest({
      request: createAuthorizedRequest('http://localhost/api/admin/knowledge/1', {
        method: 'DELETE',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          updatedAt: '2026-04-18T08:00:00.000Z',
        }),
      }),
      env,
      params: { id: '1' },
    });
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.data.deleted).toBe(true);
    expect(env.DB.knowledgeItems).toHaveLength(0);
    expect(env.DB.adminActions[0]).toMatchObject({
      action_type: 'knowledge_deleted',
      target_type: 'knowledge_item',
      target_id: 1,
    });
  });

  it('does not delete an item when audit logging fails', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const backingDb = createD1Database();
    backingDb.knowledgeItems.push(createKnowledgeItem());
    const env = createAppEnv({
      DB: createAuditFailingDb(backingDb),
      RATE_LIMIT_STORE: createD1Database(),
    });

    const response = await onKnowledgeItemRequest({
      request: createAuthorizedRequest('http://localhost/api/admin/knowledge/1', {
        method: 'DELETE',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          updatedAt: '2026-04-18T08:00:00.000Z',
        }),
      }),
      env,
      params: { id: '1' },
    });

    expect(response.status).toBe(500);
    expect(backingDb.knowledgeItems).toHaveLength(1);
    expect(backingDb.adminActions).toHaveLength(0);
    expect(errorSpy).toHaveBeenCalled();
  });

  it('rejects invalid ids and unsupported methods', async () => {
    const env = createAppEnv();

    const invalidIdResponse = await onKnowledgeItemRequest({
      request: createAuthorizedRequest('http://localhost/api/admin/knowledge/not-a-number', {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ title: '睡眠支持', updatedAt: '2026-04-18T08:00:00.000Z' }),
      }),
      env,
      params: { id: 'not-a-number' },
    });
    const methodResponse = await onKnowledgeItemRequest({
      request: createAuthorizedRequest('http://localhost/api/admin/knowledge/1', {
        method: 'POST',
      }),
      env,
      params: { id: '1' },
    });

    expect(invalidIdResponse.status).toBe(400);
    expect(methodResponse.status).toBe(405);
    expect(methodResponse.headers.get('Allow')).toBe('PATCH, DELETE, OPTIONS');
  });

  it('returns production-safe errors when update fails', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const env = createAppEnv({
      ENVIRONMENT: 'production',
      DB: {
        prepare() {
          throw new Error('raw database failure');
        },
      },
      RATE_LIMIT_STORE: createD1Database(),
    });

    const response = await onKnowledgeItemRequest({
      request: createAuthorizedRequest('http://localhost/api/admin/knowledge/1', {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ title: '睡眠支持', updatedAt: '2026-04-18T08:00:00.000Z' }),
      }),
      env,
      params: { id: '1' },
    });
    const payload = await response.json();

    expect(response.status).toBe(500);
    expect(payload.error).toBe('服务器内部错误');
    expect(errorSpy).toHaveBeenCalled();
    errorSpy.mockRestore();
  });
});
