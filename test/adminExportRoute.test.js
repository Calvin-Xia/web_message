import { describe, expect, it, vi } from 'vitest';
import { createD1Database } from './helpers/fakeCloudflare.js';
import { onRequest } from '../functions/api/admin/export.js';

function createIssue(overrides = {}) {
  return {
    id: 1,
    tracking_code: 'ABCD23EF',
    name: '测试同学',
    student_id: '2024012345678',
    email: null,
    notify_by_email: 0,
    content: '图书馆空调不制冷，需要尽快安排处理。',
    is_public: 1,
    is_reported: 0,
    category: 'facility',
    distress_type: null,
    scene_tag: null,
    priority: 'high',
    status: 'in_review',
    public_summary: '已安排后勤团队处理',
    assigned_to: 'admin1',
    first_response_at: '2026-03-11T09:00:00.000Z',
    resolved_at: null,
    created_at: '2026-03-11T08:00:00.000Z',
    updated_at: '2026-03-11T09:30:00.000Z',
    ...overrides,
  };
}

function createExportDbMock({ total = 0, batches = [], notes = [], replies = [], rawNestedRows = false } = {}) {
  const statements = [];
  const actions = [];
  let batchIndex = 0;

  return {
    statements,
    actions,
    prepare(sql) {
      const record = { sql, bindings: [] };
      statements.push(record);

      if (sql.includes('SELECT COUNT(*) AS total FROM issues')) {
        return {
          bind(...bindings) {
            record.bindings = bindings;
            return {
              first: async () => ({ total }),
            };
          },
        };
      }

      if (sql.includes('SELECT') && sql.includes('FROM issues')) {
        return {
          bind(...bindings) {
            record.bindings = bindings;
            const results = batches[batchIndex] ?? [];
            batchIndex += 1;
            return {
              all: async () => ({ results }),
            };
          },
        };
      }

      if (sql.includes('FROM issue_internal_notes')) {
        return {
          bind(...bindings) {
            record.bindings = bindings;
            const issueIds = new Set(bindings);
            return {
              all: async () => ({
                results: rawNestedRows ? notes : notes.filter((item) => issueIds.has(item.issue_id)),
              }),
            };
          },
        };
      }

      if (sql.includes('FROM issue_updates') && sql.includes("update_type = 'public_reply'")) {
        return {
          bind(...bindings) {
            record.bindings = bindings;
            const issueIds = new Set(bindings);
            return {
              all: async () => ({
                results: rawNestedRows ? replies : replies.filter((item) => issueIds.has(item.issue_id)),
              }),
            };
          },
        };
      }

      if (sql.includes('INSERT INTO admin_actions')) {
        return {
          bind(...bindings) {
            record.bindings = bindings;
            return {
              run: async () => {
                actions.push({
                  action_type: bindings[0],
                  target_type: bindings[1],
                  target_id: bindings[2],
                  details: bindings[3],
                  performed_by: bindings[4],
                  performed_at: bindings[5],
                  ip_address: bindings[6],
                });

                return {
                  success: true,
                  meta: {
                    last_row_id: actions.length,
                    changes: 1,
                  },
                };
              },
            };
          },
        };
      }

      throw new Error(`Unsupported SQL in export test: ${sql}`);
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

describe('admin export route', () => {
  it('exports filtered issues as csv and records an audit action', async () => {
    const db = createExportDbMock({
      total: 2,
      batches: [[
        createIssue({
          category: 'counseling',
          distress_type: 'sleep',
          scene_tag: 'dormitory',
        }),
        createIssue({
          id: 2,
          tracking_code: 'ZXCV56BN',
          name: '李四',
          assigned_to: '',
          status: 'resolved',
          resolved_at: '2026-03-12T10:00:00.000Z',
        }),
      ], []],
    });

    const response = await onRequest(createAdminContext(
      new Request('http://localhost/api/admin/export?format=csv', {
        headers: {
          Authorization: 'Bearer test-secret',
          'CF-Connecting-IP': '127.0.0.1',
        },
      }),
      db,
    ));
    const csv = await response.text();

    expect(response.status).toBe(200);
    expect(response.headers.get('Content-Type')).toContain('text/csv');
    expect(response.headers.get('Content-Disposition')).toContain('issues_export_');
    expect(csv).toContain('id,tracking_code,name,student_id');
    expect(csv).toContain('distress_type,scene_tag');
    expect(csv).toContain('sleep,dormitory');
    expect(csv).toContain('ABCD23EF');
    expect(csv).toContain('ZXCV56BN');
    expect(db.actions).toHaveLength(1);
    expect(db.actions[0].action_type).toBe('issues_exported');
    expect(JSON.parse(db.actions[0].details)).toMatchObject({
      rowCount: 2,
      filters: {
        format: 'csv',
      },
    });
  });

  it('exports issues as structured json with nested notes and replies', async () => {
    const db = createExportDbMock({
      total: 1,
      batches: [[
        createIssue({
          category: 'counseling',
          distress_type: 'sleep',
          scene_tag: 'dormitory',
        }),
      ], []],
      notes: [{
        id: 10,
        issue_id: 1,
        content: '已联系辅导员跟进。',
        created_by: 'counselor',
        created_at: '2026-03-11T10:00:00.000Z',
      }],
      replies: [{
        id: 20,
        issue_id: 1,
        update_type: 'public_reply',
        old_value: null,
        new_value: null,
        content: '老师会在今天下午联系你。',
        is_public: 1,
        created_by: 'admin1',
        created_at: '2026-03-11T11:00:00.000Z',
      }],
    });

    const response = await onRequest(createAdminContext(
      new Request('http://localhost/api/admin/export?format=json', {
        headers: {
          Authorization: 'Bearer test-secret',
        },
      }),
      db,
    ));
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(response.headers.get('Content-Type')).toContain('application/json');
    expect(response.headers.get('Content-Disposition')).toContain('issues_export_');
    expect(response.headers.get('Content-Disposition')).toContain('.json');
    expect(payload).toMatchObject({
      metadata: {
        format: 'json',
        rowCount: 1,
        nestedRowCounts: {
          internalNotes: 1,
          replies: 1,
        },
        filters: {
          format: 'json',
        },
      },
      issues: [{
        id: 1,
        trackingCode: 'ABCD23EF',
        studentId: '2024012345678',
        category: 'counseling',
        distressType: 'sleep',
        sceneTag: 'dormitory',
        isPublic: true,
        isReported: false,
        internalNotes: [{
          id: 10,
          content: '已联系辅导员跟进。',
          createdBy: 'counselor',
          createdAt: '2026-03-11T10:00:00.000Z',
        }],
        replies: [{
          id: 20,
          type: 'public_reply',
          oldValue: null,
          newValue: null,
          content: '老师会在今天下午联系你。',
          isPublic: true,
          createdBy: 'admin1',
          createdAt: '2026-03-11T11:00:00.000Z',
        }],
      }],
    });
    expect(db.actions).toHaveLength(1);
    expect(JSON.parse(db.actions[0].details)).toMatchObject({
      filename: expect.stringMatching(/\.json$/),
      rowCount: 1,
      filters: {
        format: 'json',
      },
    });
  });

  it('skips nested export rows with invalid issue ids', async () => {
    const invalidNote = {
      id: 99,
      issue_id: null,
      created_by: 'system',
      created_at: '2026-03-11T12:00:00.000Z',
    };
    Object.defineProperty(invalidNote, 'content', {
      enumerable: true,
      get() {
        throw new Error('invalid note should not be mapped');
      },
    });

    const invalidReply = {
      id: 98,
      issue_id: undefined,
      update_type: 'public_reply',
      old_value: null,
      new_value: null,
      is_public: 1,
      created_by: 'system',
      created_at: '2026-03-11T12:10:00.000Z',
    };
    Object.defineProperty(invalidReply, 'content', {
      enumerable: true,
      get() {
        throw new Error('invalid reply should not be mapped');
      },
    });

    const db = createExportDbMock({
      total: 1,
      rawNestedRows: true,
      batches: [[createIssue()], []],
      notes: [{
        id: 10,
        issue_id: 1,
        content: '已联系辅导员跟进。',
        created_by: 'counselor',
        created_at: '2026-03-11T10:00:00.000Z',
      }, invalidNote],
      replies: [{
        id: 20,
        issue_id: 1,
        update_type: 'public_reply',
        old_value: null,
        new_value: null,
        content: '老师会在今天下午联系你。',
        is_public: 1,
        created_by: 'admin1',
        created_at: '2026-03-11T11:00:00.000Z',
      }, invalidReply],
    });

    const response = await onRequest(createAdminContext(
      new Request('http://localhost/api/admin/export?format=json', {
        headers: {
          Authorization: 'Bearer test-secret',
        },
      }),
      db,
    ));
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.metadata.nestedRowCounts).toEqual({
      internalNotes: 1,
      replies: 1,
    });
    expect(payload.issues[0].internalNotes).toEqual([expect.objectContaining({ id: 10 })]);
    expect(payload.issues[0].replies).toEqual([expect.objectContaining({ id: 20 })]);
  });

  it('rejects exports that exceed the safe row limit', async () => {
    const db = createExportDbMock({
      total: 5_001,
      batches: [],
    });

    const response = await onRequest(createAdminContext(
      new Request('http://localhost/api/admin/export?format=csv', {
        headers: {
          Authorization: 'Bearer test-secret',
        },
      }),
      db,
    ));
    const payload = await response.json();

    expect(response.status).toBe(413);
    expect(payload.error).toBe('导出结果超过 5000 条，请缩小筛选范围后重试');
    expect(db.actions).toHaveLength(0);
    expect(db.statements).toHaveLength(1);
  });

  it('rejects invalid export query parameters', async () => {
    const db = createExportDbMock();

    const response = await onRequest(createAdminContext(
      new Request('http://localhost/api/admin/export?startDate=2026-03-12&endDate=2026-03-01', {
        headers: {
          Authorization: 'Bearer test-secret',
        },
      }),
      db,
    ));
    const payload = await response.json();

    expect(response.status).toBe(400);
    expect(payload.success).toBe(false);
  });

  it('rejects missing admin authorization', async () => {
    const db = createExportDbMock();

    const response = await onRequest(createAdminContext(
      new Request('http://localhost/api/admin/export'),
      db,
    ));
    const payload = await response.json();

    expect(response.status).toBe(401);
    expect(payload.error).toBe('缺少授权信息');
  });

  it('returns method not allowed for non-GET requests', async () => {
    const db = createExportDbMock();

    const response = await onRequest(createAdminContext(
      new Request('http://localhost/api/admin/export', {
        method: 'POST',
      }),
      db,
    ));
    const payload = await response.json();

    expect(response.status).toBe(405);
    expect(payload.error).toBe('Method not allowed');
  });

  it('returns a production-safe error when export queries fail', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const db = {
      prepare() {
        throw new Error('boom');
      },
    };

    const response = await onRequest(createAdminContext(
      new Request('http://localhost/api/admin/export', {
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
    expect(errorSpy).toHaveBeenCalledWith('Admin export route failed:', expect.any(Error));
  });
});
