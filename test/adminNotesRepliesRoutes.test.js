import { describe, expect, it } from 'vitest';
import { onRequest as onNoteRequest } from '../functions/api/admin/issues/[id]/notes.js';
import { onRequest as onReplyRequest } from '../functions/api/admin/issues/[id]/replies.js';
import { createD1Database } from './helpers/fakeCloudflare.js';

function createAdminEnv(db) {
  return {
    ADMIN_SECRET_KEY: 'test-secret',
    ENVIRONMENT: 'development',
    RATE_LIMIT_STORE: createD1Database(),
    DB: db,
  };
}

function createIssue(overrides = {}) {
  return {
    id: 1,
    tracking_code: 'ABCD23EF',
    name: '测试同学',
    student_id: '2024012345678',
    content: '图书馆空调不制冷，需要尽快安排处理。',
    is_public: 0,
    is_reported: 0,
    category: 'facility',
    priority: 'high',
    status: 'in_review',
    public_summary: null,
    assigned_to: null,
    first_response_at: null,
    resolved_at: null,
    created_at: '2026-03-11T08:00:00.000Z',
    updated_at: '2026-03-11T08:00:00.000Z',
    ...overrides,
  };
}

function createAdminRequest(url, body) {
  return new Request(url, {
    method: 'POST',
    headers: {
      Authorization: 'Bearer test-secret',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });
}

describe('admin note and reply routes', () => {
  it('creates an internal note, timestamps the first response, and records an audit action', async () => {
    const db = createD1Database();
    db.issues.push(createIssue());

    const response = await onNoteRequest({
      request: createAdminRequest('http://localhost/api/admin/issues/1/notes', {
        content: '已联系后勤团队，今天会安排人员到场查看。',
      }),
      env: createAdminEnv(db),
      params: {
        id: '1',
      },
    });
    const payload = await response.json();

    expect(response.status).toBe(201);
    expect(payload.success).toBe(true);
    expect(payload.data.content).toBe('已联系后勤团队，今天会安排人员到场查看。');
    expect(payload.data.createdBy).toBe('admin');
    expect(db.issueInternalNotes).toHaveLength(1);
    expect(db.adminActions).toHaveLength(1);
    expect(db.adminActions[0].action_type).toBe('note_added');
    expect(JSON.parse(db.adminActions[0].details)).toMatchObject({
      trackingCode: 'ABCD23EF',
    });
    expect(db.issues[0].first_response_at).toBeTruthy();
    expect(db.issues[0].updated_at).toBe(db.issues[0].first_response_at);
  });

  it('creates a reply without resetting an existing first response timestamp', async () => {
    const db = createD1Database();
    db.issues.push(createIssue({
      first_response_at: '2026-03-11T09:00:00.000Z',
    }));

    const response = await onReplyRequest({
      request: createAdminRequest('http://localhost/api/admin/issues/1/replies', {
        content: '已经安排今天下午检修，处理完成后会同步结果。',
        isPublic: false,
      }),
      env: createAdminEnv(db),
      params: {
        id: '1',
      },
    });
    const payload = await response.json();

    expect(response.status).toBe(201);
    expect(payload.success).toBe(true);
    expect(payload.data.type).toBe('public_reply');
    expect(payload.data.isPublic).toBe(false);
    expect(db.issueUpdates).toHaveLength(1);
    expect(db.issueUpdates[0].is_public).toBe(0);
    expect(db.adminActions).toHaveLength(1);
    expect(db.adminActions[0].action_type).toBe('reply_added');
    expect(JSON.parse(db.adminActions[0].details)).toMatchObject({
      trackingCode: 'ABCD23EF',
      isPublic: false,
    });
    expect(db.issues[0].first_response_at).toBe('2026-03-11T09:00:00.000Z');
    expect(db.issues[0].updated_at).not.toBe('2026-03-11T08:00:00.000Z');
  });
});
