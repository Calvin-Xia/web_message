import { describe, expect, it } from 'vitest';
import { createD1Database } from './helpers/fakeCloudflare.js';
import { onRequest } from '../functions/api/admin/issues.js';

function createRateLimitKv() {
  return {
    get: async () => null,
    put: async () => undefined,
    delete: async () => undefined,
  };
}

function createDbMock(results) {
  const statements = [];
  return {
    statements,
    db: {
      prepare(sql) {
        const record = { sql, bindings: [] };
        statements.push(record);
        const result = results[statements.length - 1] || {};
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

    const response = await onRequest({
      request,
      env: {
        ADMIN_SECRET_KEY: 'test-secret',
        ENVIRONMENT: 'development',
        RATE_LIMIT_STORE: createD1Database(),
        DB: db,
      },
      params: {},
    });
    const payload = await response.json();

    expect(response.status).toBe(200);
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
});

