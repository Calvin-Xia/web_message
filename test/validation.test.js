import { describe, expect, it } from 'vitest';
import { issueSchema, adminIssuePatchSchema } from '../src/shared/validation.js';

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
