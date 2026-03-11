import { describe, expect, it } from 'vitest';
import {
  adminIssueListQuerySchema,
  adminIssuePatchSchema,
  adminMetricsQuerySchema,
  issueSchema,
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
});

describe('adminIssuePatchSchema', () => {
  it('requires at least one changed field', () => {
    const result = adminIssuePatchSchema.safeParse({});
    expect(result.success).toBe(false);
  });

  it('allows clearing nullable fields', () => {
    const result = adminIssuePatchSchema.safeParse({
      assignedTo: '',
      publicSummary: '',
      isPublic: true,
    });

    expect(result.success).toBe(true);
    expect(result.data.assignedTo).toBeNull();
    expect(result.data.publicSummary).toBeNull();
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

  it('uses normalized validation messages for invalid enum lists', () => {
    const categoryResult = adminIssueListQuerySchema.safeParse({ category: 'invalid' });
    const priorityResult = adminIssueListQuerySchema.safeParse({ priority: 'invalid' });

    expect(categoryResult.success).toBe(false);
    expect(categoryResult.error.issues[0].message).toBe('分类无效');
    expect(priorityResult.success).toBe(false);
    expect(priorityResult.error.issues[0].message).toBe('优先级无效');
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
});
