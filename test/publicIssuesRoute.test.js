import { afterEach, describe, expect, it, vi } from 'vitest';
import { createAppEnv, createD1Database } from './helpers/fakeCloudflare.js';
import { onRequest } from '../functions/api/issues.js';

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

function createIssuePayload() {
  return {
    name: '测试用户',
    studentId: '2024001001001',
    category: 'facility',
    content: '测试内容已经超过十个字符，用于验证公开提交流程。',
    isPublic: true,
    isReported: false,
  };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('public issues route', () => {
  it('returns public fields only', async () => {
    const response = await onRequest({
      request: new Request('http://localhost/api/issues?page=1&pageSize=20'),
      env: {
        ENVIRONMENT: 'development',
        RATE_LIMIT_STORE: createD1Database(),
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

  it('rolls back the issue insert when a later submit write fails', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});

    const env = createAppEnv();
    const originalPrepare = env.DB.prepare.bind(env.DB);
    env.DB.prepare = (sql) => {
      if (sql.includes('INSERT INTO issue_updates') && sql.includes('SELECT id')) {
        return {
          bind() {
            return {
              run: async () => {
                throw new Error('issue update insert failed');
              },
            };
          },
        };
      }

      return originalPrepare(sql);
    };

    const response = await onRequest({
      request: new Request('http://localhost/api/issues', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(createIssuePayload()),
      }),
      env,
      params: {},
    });
    const payload = await response.json();

    expect(response.status).toBe(500);
    expect(payload.success).toBe(false);
    expect(env.DB.issues).toHaveLength(0);
    expect(env.DB.issueUpdates).toHaveLength(0);
    expect(env.DB.adminActions).toHaveLength(0);
  });
});
