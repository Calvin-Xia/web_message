import { describe, expect, it } from 'vitest';
import { onRequest as adminExportRoute } from '../functions/api/admin/export.js';
import { onRequest as adminIssueDetailRoute } from '../functions/api/admin/issues/[id].js';
import { onRequest as noteRoute } from '../functions/api/admin/issues/[id]/notes.js';
import { onRequest as replyRoute } from '../functions/api/admin/issues/[id]/replies.js';
import { onRequest as publicIssuesRoute } from '../functions/api/issues.js';
import { onRequest as trackingRoute } from '../functions/api/issues/[trackingCode].js';
import { createAppEnv } from './helpers/fakeCloudflare.js';

function createJsonRequest(url, method, body, headers = {}) {
  return new Request(url, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...headers,
    },
    body: JSON.stringify(body),
  });
}

function createIssuePayload(overrides = {}) {
  return {
    name: '测试用户',
    studentId: '2024001001001',
    category: 'facility',
    content: '测试内容已经超过十个字符，用于完整流程校验。',
    isPublic: false,
    isReported: false,
    ...overrides,
  };
}

describe('end-to-end flows', () => {
  it('completes submit and track flow', async () => {
    const env = createAppEnv();
    const submitResponse = await publicIssuesRoute({
      request: createJsonRequest('http://localhost/api/issues', 'POST', createIssuePayload({ isPublic: true })),
      env,
      params: {},
    });
    const submitPayload = await submitResponse.json();
    const trackingCode = submitPayload.data.trackingCode;

    const trackResponse = await trackingRoute({
      request: new Request(`http://localhost/api/issues/${trackingCode}`),
      env,
      params: {
        trackingCode,
      },
    });
    const trackPayload = await trackResponse.json();

    expect(submitResponse.status).toBe(201);
    expect(trackResponse.status).toBe(200);
    expect(trackPayload.success).toBe(true);
    expect(trackPayload.data.trackingCode).toBe(trackingCode);
  });

  it('completes admin management flow', async () => {
    const env = createAppEnv();
    const submitResponse = await publicIssuesRoute({
      request: createJsonRequest('http://localhost/api/issues', 'POST', createIssuePayload({
        category: 'service',
        content: '需要后台跟进的测试问题内容，长度满足校验要求。',
        isReported: true,
      })),
      env,
      params: {},
    });
    const submitPayload = await submitResponse.json();
    const issueId = env.DB.issues[0].id;

    const authHeaders = {
      Authorization: 'Bearer test-secret',
    };

    await adminIssueDetailRoute({
      request: createJsonRequest(`http://localhost/api/admin/issues/${issueId}`, 'PATCH', {
        status: 'in_review',
        assignedTo: 'admin1',
        publicSummary: '已开始人工核实。',
        isPublic: true,
        updatedAt: env.DB.issues[0].updated_at,
      }, authHeaders),
      env,
      params: { id: String(issueId) },
    });

    await noteRoute({
      request: createJsonRequest(`http://localhost/api/admin/issues/${issueId}/notes`, 'POST', {
        content: '已联系相关部门，等待书面反馈。',
      }, authHeaders),
      env,
      params: { id: String(issueId) },
    });

    await replyRoute({
      request: createJsonRequest(`http://localhost/api/admin/issues/${issueId}/replies`, 'POST', {
        content: '我们已经收到反馈，正在跟进处理。',
        isPublic: true,
      }, authHeaders),
      env,
      params: { id: String(issueId) },
    });

    const detailResponse = await adminIssueDetailRoute({
      request: new Request(`http://localhost/api/admin/issues/${issueId}`, {
        headers: authHeaders,
      }),
      env,
      params: { id: String(issueId) },
    });
    const detailPayload = await detailResponse.json();

    expect(detailResponse.status).toBe(200);
    expect(detailPayload.data.status).toBe('in_review');
    expect(detailPayload.data.assignedTo).toBe('admin1');
    expect(detailPayload.data.publicSummary).toBe('已开始人工核实。');
    expect(detailPayload.data.internalNotes).toHaveLength(1);
    expect(detailPayload.data.updates.some((item) => item.type === 'public_reply')).toBe(true);
    expect(detailPayload.data.history.length).toBeGreaterThanOrEqual(3);
    expect(submitPayload.data.trackingCode).toBe(detailPayload.data.trackingCode);
  });

  it('completes data export flow', async () => {
    const env = createAppEnv();
    await publicIssuesRoute({
      request: createJsonRequest('http://localhost/api/issues', 'POST', createIssuePayload({
        name: '导出用户',
        category: 'complaint',
        content: '用于导出的完整流程测试内容，满足接口校验。',
      })),
      env,
      params: {},
    });

    const response = await adminExportRoute({
      request: new Request('http://localhost/api/admin/export?format=csv', {
        headers: {
          Authorization: 'Bearer test-secret',
        },
      }),
      env,
      params: {},
    });
    const csv = await response.text();

    expect(response.status).toBe(200);
    expect(response.headers.get('Content-Type')).toContain('text/csv');
    expect(csv).toContain('tracking_code');
    expect(csv).toContain('导出用户');
    expect(env.DB.adminActions.some((item) => item.action_type === 'issues_exported')).toBe(true);
  });
});

