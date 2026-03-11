import { ZodError } from 'zod';
import { describe, expect, it } from 'vitest';
import {
  adminActionListQuerySchema,
  adminExportQuerySchema,
  adminIssueListQuerySchema,
  adminMetricsQuerySchema,
  formatZodError,
  issueSchema,
  noteSchema,
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
});

describe('statusUpdateSchema', () => {
  it('requires at least one changed field', () => {
    const result = statusUpdateSchema.safeParse({});
    expect(result.success).toBe(false);
  });

  it('allows clearing nullable fields and preserves null inputs', () => {
    const blankResult = statusUpdateSchema.safeParse({
      assignedTo: '',
      publicSummary: '',
      isPublic: true,
    });
    const nullResult = statusUpdateSchema.safeParse({ assignedTo: null });

    expect(blankResult.success).toBe(true);
    expect(blankResult.data.assignedTo).toBeNull();
    expect(blankResult.data.publicSummary).toBeNull();
    expect(nullResult.success).toBe(true);
    expect(nullResult.data.assignedTo).toBeNull();
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

describe('formatZodError', () => {
  it('returns the first issue message and falls back when none exists', () => {
    const error = new ZodError([{ code: 'custom', path: ['field'], message: '字段错误' }]);
    expect(formatZodError(error)).toBe('字段错误');
    expect(formatZodError({ issues: [] })).toBe('请求参数无效');
  });
});

