import { describe, expect, it } from 'vitest';
import { onRequest as publicIssuesRequest } from '../functions/api/issues.js';
import { onRequest as batchIssuesRequest } from '../functions/api/admin/issues/batch.js';
import { onRequest as slaRulesRequest } from '../functions/api/admin/sla/rules.js';
import { onRequest as slaRuleDetailRequest } from '../functions/api/admin/sla/rules/[id].js';
import { onRequest as assignRulesRequest } from '../functions/api/admin/assign-rules.js';
import { onRequest as assignRuleDetailRequest } from '../functions/api/admin/assign-rules/[id].js';
import { onRequest as assignStatsRequest } from '../functions/api/admin/assign-stats.js';
import { onRequest as slaViolationsRequest } from '../functions/api/admin/sla/violations.js';
import { calculateSLADeadlines, getSLAStatus } from '../src/shared/sla.js';
import { matchAssignRule, segmentChineseText } from '../src/shared/assignment.js';
import { createAppEnv } from './helpers/fakeCloudflare.js';

function adminRequest(url, { method = 'GET', body = null } = {}) {
  return new Request(url, {
    method,
    headers: {
      Authorization: 'Bearer test-secret',
      'Content-Type': 'application/json',
    },
    body: body == null ? undefined : JSON.stringify(body),
  });
}

function seedIssue(env, overrides = {}) {
  env.DB.issues.push({
    id: env.DB.ids.issue++,
    tracking_code: 'ABCD23EF',
    name: '测试同学',
    student_id: '2024012345678',
    email: null,
    notify_by_email: 0,
    content: '最近考试成绩压力很大，希望获得支持。',
    is_public: 0,
    is_reported: 0,
    category: 'academic',
    distress_type: null,
    scene_tag: null,
    priority: 'normal',
    status: 'submitted',
    public_summary: null,
    assigned_to: null,
    assigned_at: null,
    first_response_at: null,
    resolved_at: null,
    sla_response_deadline: null,
    sla_resolution_deadline: null,
    created_at: '2026-06-05T08:00:00.000Z',
    updated_at: '2026-06-05T08:00:00.000Z',
    ...overrides,
  });
}

describe('phase 2 SLA helpers', () => {
  it('calculates deadlines and reports warning/violated status', () => {
    const deadlines = calculateSLADeadlines({
      isEnabled: true,
      responseHours: 4,
      resolutionHours: 24,
    }, '2026-06-05T08:00:00.000Z');

    expect(deadlines).toEqual({
      responseDeadline: '2026-06-05T12:00:00.000Z',
      resolutionDeadline: '2026-06-06T08:00:00.000Z',
    });
    expect(getSLAStatus({
      status: 'submitted',
      first_response_at: null,
      sla_response_deadline: '2026-06-05T12:00:00.000Z',
      sla_resolution_deadline: '2026-06-06T08:00:00.000Z',
    }, '2026-06-05T11:30:00.000Z')).toBe('warning');
    expect(getSLAStatus({
      status: 'in_progress',
      first_response_at: '2026-06-05T09:00:00.000Z',
      sla_response_deadline: '2026-06-05T12:00:00.000Z',
      sla_resolution_deadline: '2026-06-06T08:00:00.000Z',
    }, '2026-06-06T09:00:00.000Z')).toBe('violated');
  });
});

describe('phase 2 assignment helpers', () => {
  it('segments Chinese content and matches the highest priority enabled rule', async () => {
    const tokens = await segmentChineseText('最近考试成绩压力很大');
    const matched = await matchAssignRule({
      category: 'academic',
      content: '最近考试成绩压力很大',
    }, [
      {
        id: 1,
        category: 'academic',
        keywords: ['考试'],
        assignTo: 'teacher_low',
        priority: 1,
        isEnabled: true,
      },
      {
        id: 2,
        category: 'academic',
        keywords: ['成绩'],
        assignTo: 'teacher_high',
        priority: 10,
        isEnabled: true,
      },
    ]);

    expect(tokens).toContain('考试');
    expect(matched.assignTo).toBe('teacher_high');
  });
});

describe('phase 2 admin APIs', () => {
  it('creates and updates SLA rules with audit logs', async () => {
    const env = createAppEnv();

    const created = await slaRulesRequest({
      request: adminRequest('http://localhost/api/admin/sla/rules', {
        method: 'POST',
        body: {
          name: '普通问题 24 小时响应',
          priority: 'normal',
          responseHours: 24,
          resolutionHours: 72,
          isEnabled: true,
        },
      }),
      env,
      params: {},
    });
    const createdPayload = await created.json();

    expect(created.status).toBe(201);
    expect(createdPayload.data.priority).toBe('normal');

    const updated = await slaRuleDetailRequest({
      request: adminRequest('http://localhost/api/admin/sla/rules/1', {
        method: 'PATCH',
        body: {
          updatedAt: createdPayload.data.updatedAt,
          responseHours: 12,
        },
      }),
      env,
      params: { id: '1' },
    });
    const updatedPayload = await updated.json();

    expect(updated.status).toBe(200);
    expect(updatedPayload.data.responseHours).toBe(12);
    expect(env.DB.adminActions.map((item) => item.action_type)).toContain('sla_rule_updated');
  });

  it('manages assignment rules and records deletion', async () => {
    const env = createAppEnv();

    const created = await assignRulesRequest({
      request: adminRequest('http://localhost/api/admin/assign-rules', {
        method: 'POST',
        body: {
          name: '学业压力分配',
          category: 'academic',
          keywords: ['考试', '成绩'],
          assignTo: 'handler1',
          priority: 10,
          isEnabled: true,
        },
      }),
      env,
      params: {},
    });
    const createdPayload = await created.json();

    expect(created.status).toBe(201);
    expect(createdPayload.data.keywords).toEqual(['考试', '成绩']);

    const patched = await assignRuleDetailRequest({
      request: adminRequest('http://localhost/api/admin/assign-rules/1', {
        method: 'PATCH',
        body: {
          updatedAt: createdPayload.data.updatedAt,
          assignTo: 'handler2',
        },
      }),
      env,
      params: { id: '1' },
    });
    expect(patched.status).toBe(200);
    expect((await patched.json()).data.assignTo).toBe('handler2');

    const deleted = await assignRuleDetailRequest({
      request: adminRequest('http://localhost/api/admin/assign-rules/1', { method: 'DELETE' }),
      env,
      params: { id: '1' },
    });
    expect(deleted.status).toBe(200);
    expect(env.DB.assignRules).toHaveLength(0);
    expect(env.DB.adminActions.at(-1).action_type).toBe('assign_rule_deleted');
  });

  it('batch-updates issues and returns failures for illegal transitions', async () => {
    const env = createAppEnv();
    seedIssue(env, { id: 1, status: 'submitted' });
    seedIssue(env, { id: 2, tracking_code: 'BCDE34FG', status: 'closed' });

    const response = await batchIssuesRequest({
      request: adminRequest('http://localhost/api/admin/issues/batch', {
        method: 'POST',
        body: {
          issueIds: [1, 2],
          updates: {
            status: 'in_review',
            priority: 'high',
            assignedTo: 'handler1',
          },
          updatedAt: '2026-06-05T08:00:00.000Z',
        },
      }),
      env,
      params: {},
    });
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.data.updatedCount).toBe(1);
    expect(payload.data.failedIds).toEqual([2]);
    expect(env.DB.issues[0]).toMatchObject({
      status: 'in_review',
      priority: 'high',
      assigned_to: 'handler1',
    });
    expect(env.DB.issues[0].assigned_at).toBeTruthy();
  });

  it('returns assignment statistics grouped by handler', async () => {
    const env = createAppEnv();
    env.DB.adminUsers.push({
      id: 1,
      username: 'handler1',
      password_hash: 'hash',
      display_name: '处理员1',
      role: 'handler',
      is_enabled: 1,
      last_login_at: null,
      created_at: '2026-06-01T00:00:00.000Z',
      updated_at: '2026-06-01T00:00:00.000Z',
    });
    seedIssue(env, {
      assigned_to: 'handler1',
      first_response_at: '2026-06-05T10:00:00.000Z',
      resolved_at: '2026-06-06T08:00:00.000Z',
      status: 'resolved',
    });

    const response = await assignStatsRequest({
      request: adminRequest('http://localhost/api/admin/assign-stats?period=week'),
      env,
      params: {},
    });
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.data.summary.totalIssues).toBe(1);
    expect(payload.data.handlers[0]).toMatchObject({
      username: 'handler1',
      displayName: '处理员1',
      resolved: 1,
      avgResponseTime: 2,
      avgResolutionTime: 24,
    });
  });
});

describe('phase 2 public submission integration', () => {
  it('auto-assigns matching submissions and stores SLA deadlines', async () => {
    const env = createAppEnv();
    env.DB.assignRules.push({
      id: 1,
      name: '学业压力分配',
      category: 'academic',
      keywords: JSON.stringify(['考试']),
      assign_to: 'handler1',
      priority: 10,
      is_enabled: 1,
      created_at: '2026-06-01T00:00:00.000Z',
      updated_at: '2026-06-01T00:00:00.000Z',
    });
    env.DB.slaRules.push({
      id: 1,
      name: '普通问题 24 小时响应',
      priority: 'normal',
      response_hours: 24,
      resolution_hours: 72,
      is_enabled: 1,
      created_at: '2026-06-01T00:00:00.000Z',
      updated_at: '2026-06-01T00:00:00.000Z',
    });

    const response = await publicIssuesRequest({
      request: new Request('http://localhost/api/issues', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: '李四',
          studentId: '12345',
          content: '最近考试成绩压力特别大，希望获得支持。',
          category: 'academic',
          isPublic: false,
          isReported: false,
        }),
      }),
      env,
      params: {},
    });

    expect(response.status).toBe(201);
    expect(env.DB.issues[0].assigned_to).toBe('handler1');
    expect(env.DB.issues[0].assigned_at).toBeTruthy();
    expect(env.DB.issues[0].sla_response_deadline).toBeTruthy();
    expect(env.DB.issues[0].sla_resolution_deadline).toBeTruthy();
    expect(env.DB.adminActions.map((item) => item.action_type)).toContain('auto_assigned');
  });
});

describe('phase 2 SLA violations endpoint', () => {
  it('returns warning and violated issues filtered by status', async () => {
    const env = createAppEnv();
    seedIssue(env, {
      id: 1,
      status: 'submitted',
      first_response_at: null,
      sla_response_deadline: '2026-06-05T08:30:00.000Z',
      sla_resolution_deadline: '2026-06-06T08:00:00.000Z',
    });
    seedIssue(env, {
      id: 2,
      tracking_code: 'BCDE34FG',
      status: 'submitted',
      first_response_at: null,
      sla_response_deadline: '2026-06-04T00:00:00.000Z',
      sla_resolution_deadline: '2026-06-05T00:00:00.000Z',
    });

    const now = '2026-06-05T08:00:00.000Z';
    const response = await slaViolationsRequest({
      request: adminRequest(`http://localhost/api/admin/sla/violations?status=violated`),
      env,
      params: {},
    });
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.data.items.length).toBeGreaterThanOrEqual(1);
    expect(payload.data.items.every((item) => item.slaStatus === 'violated')).toBe(true);
  });
});
