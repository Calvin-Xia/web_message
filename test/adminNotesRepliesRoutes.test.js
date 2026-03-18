import { afterEach, describe, expect, it, vi } from 'vitest';
import { onRequest as onNoteRequest } from '../functions/api/admin/issues/[id]/notes.js';
import { onRequest as onReplyRequest } from '../functions/api/admin/issues/[id]/replies.js';
import { createD1Database } from './helpers/fakeCloudflare.js';

function createAdminEnv(db, overrides = {}) {
  return {
    ADMIN_SECRET_KEY: 'test-secret',
    ENVIRONMENT: 'development',
    RATE_LIMIT_STORE: createD1Database(),
    DB: db,
    ...overrides,
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
    email: null,
    notify_by_email: 0,
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

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

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

  it('sends a public reply notification when email reminders are enabled', async () => {
    const fetchSpy = vi.fn().mockResolvedValue(new Response(JSON.stringify({ id: 'email_123' }), {
      status: 200,
      headers: {
        'Content-Type': 'application/json',
      },
    }));
    vi.stubGlobal('fetch', fetchSpy);

    const db = createD1Database();
    db.issues.push(createIssue({
      email: 'student@example.com',
      notify_by_email: 1,
    }));
    const backgroundTasks = [];

    const response = await onReplyRequest({
      request: createAdminRequest('http://localhost/api/admin/issues/1/replies', {
        content: '已经安排今天下午检修，处理完成后会同步结果。',
        isPublic: true,
      }),
      env: createAdminEnv(db, {
        PUBLIC_BASE_URL: 'https://issue.calvin-xia.cn',
        RESEND_API_KEY: 're_test_key',
      }),
      params: {
        id: '1',
      },
      waitUntil(promise) {
        backgroundTasks.push(promise);
      },
    });

    await Promise.all(backgroundTasks);

    expect(response.status).toBe(201);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(fetchSpy).toHaveBeenCalledWith('https://api.resend.com/emails', expect.any(Object));

    const [, options] = fetchSpy.mock.calls[0];
    const payload = JSON.parse(options.body);
    expect(options.headers['Idempotency-Key']).toContain('issue-notify/1/public-reply/');
    expect(payload).toMatchObject({
      from: 'support@calvin-xia.cn',
      to: ['student@example.com'],
      reply_to: ['support@calvin-xia.cn'],
      subject: '管理员已回复你的问题（ABCD23EF）',
    });
    expect(payload.text).toContain('查看追踪页：https://issue.calvin-xia.cn/tracking.html?code=ABCD23EF');
  });

  it('keeps reply creation successful when email delivery fails', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const fetchSpy = vi.fn().mockResolvedValue(new Response(JSON.stringify({ message: 'invalid email payload' }), {
      status: 400,
      headers: {
        'Content-Type': 'application/json',
      },
    }));
    vi.stubGlobal('fetch', fetchSpy);

    const db = createD1Database();
    db.issues.push(createIssue({
      email: 'student@example.com',
      notify_by_email: 1,
    }));
    const backgroundTasks = [];

    const response = await onReplyRequest({
      request: createAdminRequest('http://localhost/api/admin/issues/1/replies', {
        content: '已经安排今天下午检修，处理完成后会同步结果。',
        isPublic: true,
      }),
      env: createAdminEnv(db, {
        PUBLIC_BASE_URL: 'https://issue.calvin-xia.cn',
        RESEND_API_KEY: 're_test_key',
      }),
      params: {
        id: '1',
      },
      waitUntil(promise) {
        backgroundTasks.push(promise);
      },
    });

    await Promise.all(backgroundTasks);

    expect(response.status).toBe(201);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(errorSpy).toHaveBeenCalledWith('Issue reply notification failed:', expect.objectContaining({
      issueId: 1,
      trackingCode: 'ABCD23EF',
      error: 'invalid email payload',
      responseStatus: 400,
    }));
  });
});
