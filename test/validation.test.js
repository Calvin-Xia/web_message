import { ZodError } from 'zod';
import { describe, expect, it } from 'vitest';
import {
  adminActionListQuerySchema,
  adminExportQuerySchema,
  adminIssueListQuerySchema,
  adminMetricsQuerySchema,
  createAdminIssuePatchSchema,
  formatZodError,
  knowledgeCreateSchema,
  knowledgeDeleteSchema,
  knowledgeIdSchema,
  knowledgePatchSchema,
  issueSchema,
  noteSchema,
  publicInsightsQuerySchema,
  publicIssueListQuerySchema,
  replySchema,
  statusUpdateSchema,
  trackingCodeSchema,
} from '../src/shared/validation.js';

describe('issueSchema', () => {
  it('accepts 4, 5 and 13 digit student ids', () => {
    const base = {
      name: '张三',
      content: '图书馆空调在下午完全不制冷，需要尽快维修。',
      category: 'facility',
      isPublic: true,
      isReported: false,
    };

    expect(issueSchema.safeParse({ ...base, studentId: '1234' }).success).toBe(true);
    expect(issueSchema.safeParse({ ...base, studentId: '12345' }).success).toBe(true);
    expect(issueSchema.safeParse({ ...base, studentId: '1234567890123' }).success).toBe(true);
  });

  it('accepts counseling category', () => {
    const result = issueSchema.safeParse({
      name: '李四',
      studentId: '12345',
      content: '最近有持续的心理压力，希望获得进一步咨询支持。',
      category: 'counseling',
      isPublic: false,
      isReported: false,
    });

    expect(result.success).toBe(true);
  });

  it('allows optional counseling insight fields and normalizes omissions to null', () => {
    const omittedResult = issueSchema.safeParse({
      name: '李四',
      studentId: '12345',
      content: '最近有持续的心理压力，希望获得进一步咨询支持。',
      category: 'counseling',
      isPublic: false,
      isReported: false,
    });
    const selectedResult = issueSchema.safeParse({
      name: '王五',
      studentId: '12345',
      content: '最近在宿舍里压力很明显，希望获得温和的支持建议。',
      category: 'counseling',
      distressType: 'academic_pressure',
      sceneTag: 'dormitory',
      isPublic: true,
      isReported: false,
    });

    expect(omittedResult.success).toBe(true);
    expect(omittedResult.data.distressType).toBeNull();
    expect(omittedResult.data.sceneTag).toBeNull();
    expect(selectedResult.success).toBe(true);
    expect(selectedResult.data.distressType).toBe('academic_pressure');
    expect(selectedResult.data.sceneTag).toBe('dormitory');
  });

  it('rejects invalid counseling insight fields', () => {
    const result = issueSchema.safeParse({
      name: '李四',
      studentId: '12345',
      content: '最近有持续的心理压力，希望获得进一步咨询支持。',
      category: 'counseling',
      distressType: 'invalid',
      isPublic: false,
      isReported: false,
    });

    expect(result.success).toBe(false);
    expect(result.error.issues[0].message).toBe('困扰类别无效');
  });

  it('rejects counseling insight fields for non-counseling categories', () => {
    const result = issueSchema.safeParse({
      name: '张三',
      studentId: '12345',
      content: '图书馆空调在下午完全不制冷，需要尽快维修。',
      category: 'facility',
      distressType: 'sleep',
      sceneTag: 'library',
      isPublic: false,
      isReported: false,
    });

    expect(result.success).toBe(false);
    expect(result.error.issues[0].message).toBe('仅心理咨询分类可选择困扰类别');
  });

  it('rejects unsupported student id formats', () => {
    const result = issueSchema.safeParse({
      name: '张三',
      studentId: '123456',
      content: '图书馆空调在下午完全不制冷，需要尽快维修。',
      category: 'facility',
      isPublic: false,
      isReported: false,
    });

    expect(result.success).toBe(false);
  });

  it('uses the normalized category validation message', () => {
    const result = issueSchema.safeParse({
      name: '张三',
      studentId: '12345',
      content: '图书馆空调在下午完全不制冷，需要尽快维修。',
      category: 'invalid',
      isPublic: false,
      isReported: false,
    });

    expect(result.success).toBe(false);
    expect(result.error.issues[0].message).toBe('分类无效');
  });

  it('normalizes optional email notifications', () => {
    const result = issueSchema.safeParse({
      name: '张三',
      studentId: '12345',
      email: ' USER@EXAMPLE.COM ',
      notifyByEmail: true,
      content: '图书馆空调在下午完全不制冷，需要尽快维修。',
      category: 'facility',
      isPublic: false,
      isReported: false,
    });
    const blankEmailResult = issueSchema.safeParse({
      name: '张三',
      studentId: '12345',
      email: '   ',
      notifyByEmail: true,
      content: '图书馆空调在下午完全不制冷，需要尽快维修。',
      category: 'facility',
      isPublic: false,
      isReported: false,
    });

    expect(result.success).toBe(true);
    expect(result.data.email).toBe('user@example.com');
    expect(result.data.notifyByEmail).toBe(true);
    expect(blankEmailResult.success).toBe(true);
    expect(blankEmailResult.data.email).toBeUndefined();
    expect(blankEmailResult.data.notifyByEmail).toBe(false);
  });

  it('rejects invalid email formats', () => {
    const result = issueSchema.safeParse({
      name: '张三',
      studentId: '12345',
      email: 'bad-email',
      notifyByEmail: true,
      content: '图书馆空调在下午完全不制冷，需要尽快维修。',
      category: 'facility',
      isPublic: false,
      isReported: false,
    });

    expect(result.success).toBe(false);
    expect(result.error.issues[0].message).toBe('邮箱格式无效');
  });
});

describe('statusUpdateSchema', () => {
  it('requires at least one changed field', () => {
    const result = statusUpdateSchema.safeParse({ updatedAt: '2026-03-11T00:00:00.000Z' });
    expect(result.success).toBe(false);
  });

  it('allows clearing nullable fields and preserves null inputs', () => {
    const blankResult = statusUpdateSchema.safeParse({
      updatedAt: '2026-03-11T00:00:00.000Z',
      assignedTo: '',
      publicSummary: '',
      isPublic: true,
    });
    const nullResult = statusUpdateSchema.safeParse({ updatedAt: '2026-03-11T00:00:00.000Z', assignedTo: null });

    expect(blankResult.success).toBe(true);
    expect(blankResult.data.assignedTo).toBeNull();
    expect(blankResult.data.publicSummary).toBeNull();
    expect(nullResult.success).toBe(true);
    expect(nullResult.data.assignedTo).toBeNull();
  });
});

describe('createAdminIssuePatchSchema', () => {
  it('rejects non-null counseling fields when the effective category is not counseling', () => {
    const schema = createAdminIssuePatchSchema('facility');
    const result = schema.safeParse({
      updatedAt: '2026-03-11T00:00:00.000Z',
      distressType: 'sleep',
    });

    expect(result.success).toBe(false);
    expect(result.error.issues[0].message).toBe('仅心理咨询分类可选择困扰类别');
  });

  it('allows counseling fields for an existing counseling issue when category is omitted', () => {
    const schema = createAdminIssuePatchSchema('counseling');
    const result = schema.safeParse({
      updatedAt: '2026-03-11T00:00:00.000Z',
      distressType: 'sleep',
      sceneTag: 'dormitory',
    });

    expect(result.success).toBe(true);
    expect(result.data.distressType).toBe('sleep');
    expect(result.data.sceneTag).toBe('dormitory');
  });

  it('allows null counseling fields when changing away from counseling', () => {
    const schema = createAdminIssuePatchSchema('counseling');
    const result = schema.safeParse({
      updatedAt: '2026-03-11T00:00:00.000Z',
      category: 'facility',
      distressType: null,
      sceneTag: null,
    });

    expect(result.success).toBe(true);
  });
});

describe('publicInsightsQuerySchema', () => {
  it('defaults to a 90 day window and validates explicit ranges', () => {
    const defaultResult = publicInsightsQuerySchema.safeParse({});
    const rangeResult = publicInsightsQuerySchema.safeParse({
      startDate: '2026-03-01',
      endDate: '2026-03-31',
      days: '30',
    });

    expect(defaultResult.success).toBe(true);
    expect(defaultResult.data.days).toBe(90);
    expect(rangeResult.success).toBe(true);
    expect(rangeResult.data.days).toBe(30);
  });

  it('rejects invalid or excessive public insight windows', () => {
    const invalidDays = publicInsightsQuerySchema.safeParse({ days: '366' });
    const reversedRange = publicInsightsQuerySchema.safeParse({
      startDate: '2026-03-31',
      endDate: '2026-03-01',
    });
    const excessiveRange = publicInsightsQuerySchema.safeParse({
      startDate: '2025-01-01',
      endDate: '2026-04-01',
    });

    expect(invalidDays.success).toBe(false);
    expect(reversedRange.success).toBe(false);
    expect(excessiveRange.success).toBe(false);
    expect(excessiveRange.error.issues[0].message).toBe('公开热区统计范围不能超过365天');
  });
});

describe('noteSchema', () => {
  it('accepts valid note content', () => {
    const result = noteSchema.safeParse({ content: '已经联系后勤，等待明早到场确认设备故障。' });
    expect(result.success).toBe(true);
  });

  it('rejects empty note content', () => {
    const result = noteSchema.safeParse({ content: '   ' });
    expect(result.success).toBe(false);
  });
});

describe('replySchema', () => {
  it('defaults public visibility to true', () => {
    const result = replySchema.safeParse({ content: '已安排工作人员现场处理。' });
    expect(result.success).toBe(true);
    expect(result.data.isPublic).toBe(true);
  });

  it('rejects replies that exceed the maximum length', () => {
    const result = replySchema.safeParse({
      content: 'a'.repeat(1001),
      isPublic: false,
    });

    expect(result.success).toBe(false);
  });
});

describe('publicIssueListQuerySchema', () => {
  it('normalizes empty strings and supports array-based status filters', () => {
    const result = publicIssueListQuerySchema.safeParse({
      status: ['submitted', 'resolved'],
      category: ' ',
      q: '   ',
      sort: '',
      sortField: '',
      sortOrder: '',
    });

    expect(result.success).toBe(true);
    expect(result.data.status).toEqual(['submitted', 'resolved']);
    expect(result.data.category).toBeUndefined();
    expect(result.data.q).toBeUndefined();
    expect(result.data.sort).toBe('newest');
  });
});

describe('trackingCodeSchema', () => {
  it('normalizes lower-case codes and rejects malformed values', () => {
    expect(trackingCodeSchema.parse('abcd23ef')).toBe('ABCD23EF');
    expect(() => trackingCodeSchema.parse('bad-code')).toThrow();
  });
});

describe('adminIssueListQuerySchema', () => {
  it('parses csv lists, booleans and date filters', () => {
    const result = adminIssueListQuerySchema.safeParse({
      status: 'submitted,in_review',
      category: 'facility,service',
      priority: 'high,urgent',
      distressType: 'academic_pressure,sleep',
      sceneTag: 'dormitory,library',
      hasNotes: 'true',
      hasReplies: 'false',
      isAssigned: '1',
      startDate: '2026-03-01',
      endDate: '2026-03-11',
      updatedAfter: '2026-03-05',
      sortField: 'priority',
      sortOrder: 'asc',
    });

    expect(result.success).toBe(true);
    expect(result.data.status).toEqual(['submitted', 'in_review']);
    expect(result.data.category).toEqual(['facility', 'service']);
    expect(result.data.priority).toEqual(['high', 'urgent']);
    expect(result.data.distressType).toEqual(['academic_pressure', 'sleep']);
    expect(result.data.sceneTag).toEqual(['dormitory', 'library']);
    expect(result.data.hasNotes).toBe(true);
    expect(result.data.hasReplies).toBe(false);
    expect(result.data.isAssigned).toBe(true);
  });

  it('uses normalized validation messages for invalid enum lists and booleans', () => {
    const categoryResult = adminIssueListQuerySchema.safeParse({ category: 'invalid' });
    const priorityResult = adminIssueListQuerySchema.safeParse({ priority: 'invalid' });
    const booleanResult = adminIssueListQuerySchema.safeParse({ hasNotes: 'maybe' });

    expect(categoryResult.success).toBe(false);
    expect(categoryResult.error.issues[0].message).toBe('分类无效');
    expect(priorityResult.success).toBe(false);
    expect(priorityResult.error.issues[0].message).toBe('优先级无效');
    expect(booleanResult.success).toBe(false);
  });

  it('rejects inverted date ranges', () => {
    const result = adminIssueListQuerySchema.safeParse({
      startDate: '2026-03-11',
      endDate: '2026-03-01',
    });

    expect(result.success).toBe(false);
  });
});

describe('adminMetricsQuerySchema', () => {
  it('defaults period to week', () => {
    const result = adminMetricsQuerySchema.safeParse({});
    expect(result.success).toBe(true);
    expect(result.data.period).toBe('week');
  });

  it('normalizes empty boolean filters and rejects unsupported non-string inputs', () => {
    const emptyResult = adminMetricsQuerySchema.safeParse({ refresh: '   ' });
    const invalidTypeResult = adminMetricsQuerySchema.safeParse({ refresh: 1 });

    expect(emptyResult.success).toBe(true);
    expect(emptyResult.data.refresh).toBeUndefined();
    expect(invalidTypeResult.success).toBe(false);
  });
});

describe('adminActionListQuerySchema', () => {
  it('parses optional numeric filters', () => {
    const result = adminActionListQuerySchema.safeParse({ targetId: '12', actionType: 'reply_added' });
    expect(result.success).toBe(true);
    expect(result.data.targetId).toBe(12);
  });
});

describe('adminExportQuerySchema', () => {
  it('defaults export format to csv', () => {
    const result = adminExportQuerySchema.safeParse({ hasReplies: 'no' });
    expect(result.success).toBe(true);
    expect(result.data.format).toBe('csv');
    expect(result.data.hasReplies).toBe(false);
  });
});

describe('knowledge validation schemas', () => {
  it('normalizes create payloads and defaults optional fields', () => {
    const result = knowledgeCreateSchema.safeParse({
      title: '  学业压力  ',
      tag: 'academic_pressure',
      content: '  先把任务拆成今天能完成的一小步。  ',
      sortOrder: '20',
    });

    expect(result.success).toBe(true);
    expect(result.data).toEqual({
      title: '学业压力',
      tag: 'academic_pressure',
      content: '先把任务拆成今天能完成的一小步。',
      sortOrder: 20,
      isEnabled: true,
    });
  });

  it('rejects invalid create fields', () => {
    const result = knowledgeCreateSchema.safeParse({
      title: '',
      tag: 'invalid',
      content: '',
      sortOrder: '-1',
    });

    expect(result.success).toBe(false);
    expect(result.error.issues.map((issue) => issue.message)).toContain('标题不能为空');
    expect(result.error.issues.map((issue) => issue.message)).toContain('困扰类别无效');
    expect(result.error.issues.map((issue) => issue.message)).toContain('内容不能为空');
    expect(result.error.issues.map((issue) => issue.message)).toContain('排序必须为非负整数');
  });

  it('requires updatedAt and at least one changed field for patch payloads', () => {
    const emptyPatch = knowledgePatchSchema.safeParse({
      updatedAt: '2026-04-18T08:00:00.000Z',
    });
    const validPatch = knowledgePatchSchema.safeParse({
      updatedAt: '2026-04-18T08:00:00.000Z',
      isEnabled: false,
      sortOrder: 0,
    });

    expect(emptyPatch.success).toBe(false);
    expect(emptyPatch.error.issues[0].message).toBe('至少提供一个更新字段');
    expect(validPatch.success).toBe(true);
    expect(validPatch.data).toEqual({
      updatedAt: '2026-04-18T08:00:00.000Z',
      isEnabled: false,
      sortOrder: 0,
    });
  });

  it('validates ids and delete concurrency payloads', () => {
    expect(knowledgeIdSchema.parse('12')).toBe(12);
    expect(() => knowledgeIdSchema.parse('bad-id')).toThrow();

    const deleteResult = knowledgeDeleteSchema.safeParse({
      updatedAt: 'not-a-date',
    });

    expect(deleteResult.success).toBe(false);
    expect(deleteResult.error.issues[0].message).toBe('更新时间格式无效');
  });
});

describe('formatZodError', () => {
  it('returns the first issue message and falls back when none exists', () => {
    const error = new ZodError([{ code: 'custom', path: ['field'], message: '字段错误' }]);
    expect(formatZodError(error)).toBe('字段错误');
    expect(formatZodError({ issues: [] })).toBe('请求参数无效');
  });
});



