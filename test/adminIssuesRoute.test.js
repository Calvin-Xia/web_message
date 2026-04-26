import { describe, expect, it, vi } from 'vitest';
import { createD1Database } from './helpers/fakeCloudflare.js';
import { onRequest } from '../functions/api/admin/issues.js';

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
              run: async () => result.run ?? { success: true },
            };
          },
          all: async () => result.all ?? { results: [] },
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

describe('admin issues route', () => {
  it('keeps stats and list queries scoped to the same filter bindings', async () => {
    const issueRow = {
      id: 1,
      tracking_code: 'ABCD23EF',
      content: '图书馆空调不制冷，需要尽快处理。',
      category: 'facility',
      status: 'submitted',
      priority: 'high',
      public_summary: '空调维修中',
      created_at: '2026-03-11T08:00:00.000Z',
      updated_at: '2026-03-11T09:00:00.000Z',
      name: '张三',
      student_id: '12345',
      is_public: 1,
      is_reported: 0,
      assigned_to: 'admin1',
      first_response_at: null,
      resolved_at: null,
      has_notes: 1,
      has_replies: 0,
      note_count: 2,
      reply_count: 0,
    };
    const { db, statements } = createDbMock([
      { first: { total: 1 } },
      { all: { results: [issueRow] } },
      {
        first: {
          total: 1,
          pending_count: 1,
          today_new_count: 1,
          week_resolved_count: 0,
          submitted_count: 1,
          in_review_count: 0,
          in_progress_count: 0,
          resolved_count: 0,
          closed_count: 0,
        },
      },
      { all: { results: [{ assigned_to: 'admin1' }] } },
    ]);
    const request = new Request('http://localhost/api/admin/issues?status=submitted&startDate=2026-03-01&endDate=2026-03-11&hasNotes=true&sortField=createdAt&sortOrder=desc', {
      headers: {
        Authorization: 'Bearer test-secret',
      },
    });

    const response = await onRequest(createAdminContext(request, db));
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(response.headers.get('Cache-Control')).toBe('no-store');
    expect(payload.success).toBe(true);
    expect(payload.data.items).toHaveLength(1);

    const [totalStatement, listStatement, statsStatement] = statements;
    expect(totalStatement.bindings).toEqual(['submitted', '2026-03-01', '2026-03-11']);
    expect(statsStatement.bindings).toEqual(totalStatement.bindings);
    expect(listStatement.bindings.slice(0, -2)).toEqual(totalStatement.bindings);
    expect(totalStatement.sql).toContain('FROM (SELECT issues.* FROM issues');
    expect(totalStatement.sql).toContain('issues.status IN (?)');
    expect(totalStatement.sql).toContain('EXISTS (SELECT 1 FROM issue_internal_notes notes WHERE notes.issue_id = issues.id)');
    expect(statsStatement.sql).toContain('filtered_issues.status');
  });

  it('rejects invalid date ranges before querying the database', async () => {
    const { db, statements } = createDbMock([]);

    const response = await onRequest(createAdminContext(
      new Request('http://localhost/api/admin/issues?startDate=2026-03-12&endDate=2026-03-01', {
        headers: {
          Authorization: 'Bearer test-secret',
        },
      }),
      db,
    ));
    const payload = await response.json();

    expect(response.status).toBe(400);
    expect(payload.success).toBe(false);
    expect(statements).toHaveLength(0);
  });

  it('rejects missing admin authorization', async () => {
    const { db } = createDbMock([]);

    const response = await onRequest(createAdminContext(
      new Request('http://localhost/api/admin/issues'),
      db,
    ));
    const payload = await response.json();

    expect(response.status).toBe(401);
    expect(payload.error).toBe('缺少授权信息');
  });

  it('rejects untrusted origins before auth', async () => {
    const { db } = createDbMock([]);

    const response = await onRequest(createAdminContext(
      new Request('https://issue.calvin-xia.cn/api/admin/issues', {
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

  it('returns a production-safe error when the query fails', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { db } = createDbMock([
      { error: new Error('boom') },
    ]);

    const response = await onRequest(createAdminContext(
      new Request('http://localhost/api/admin/issues', {
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
    expect(errorSpy).toHaveBeenCalledWith('Admin issue list route failed:', expect.any(Error));
  });
});

