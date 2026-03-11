import { describe, expect, it } from 'vitest';
import { mapAdminIssue, mapPublicIssue, toBoolean } from '../src/shared/issueData.js';

describe('toBoolean', () => {
  it('treats 1 and true as true, and 0 string as false', () => {
    expect(toBoolean(true)).toBe(true);
    expect(toBoolean(1)).toBe(true);
    expect(toBoolean('1')).toBe(true);
    expect(toBoolean(0)).toBe(false);
    expect(toBoolean('0')).toBe(false);
  });
});

describe('mapPublicIssue', () => {
  it('returns only whitelisted public fields', () => {
    const result = mapPublicIssue({
      tracking_code: 'ABCD23EF',
      content: '测试内容',
      category: 'facility',
      status: 'submitted',
      priority: 'high',
      public_summary: '公开摘要',
      created_at: '2026-03-11T00:00:00.000Z',
      updated_at: '2026-03-11T01:00:00.000Z',
      name: '张三',
      student_id: '12345',
    });

    expect(result).toEqual({
      trackingCode: 'ABCD23EF',
      content: '测试内容',
      category: 'facility',
      status: 'submitted',
      priority: 'high',
      publicSummary: '公开摘要',
      createdAt: '2026-03-11T00:00:00.000Z',
      updatedAt: '2026-03-11T01:00:00.000Z',
    });
    expect(result).not.toHaveProperty('name');
    expect(result).not.toHaveProperty('studentId');
  });
});

describe('mapAdminIssue', () => {
  it('maps note and reply counters from D1 rows', () => {
    const issue = mapAdminIssue({
      id: 1,
      tracking_code: 'ABCD23EF',
      content: '测试内容',
      category: 'facility',
      status: 'submitted',
      priority: 'high',
      public_summary: '摘要',
      created_at: '2026-03-11T00:00:00.000Z',
      updated_at: '2026-03-11T01:00:00.000Z',
      name: '张三',
      student_id: '12345',
      is_public: 1,
      is_reported: 0,
      assigned_to: 'admin1',
      first_response_at: null,
      resolved_at: null,
      has_notes: '1',
      has_replies: '0',
      note_count: '2',
      reply_count: '0',
    });

    expect(issue.hasNotes).toBe(true);
    expect(issue.hasReplies).toBe(false);
    expect(issue.noteCount).toBe(2);
    expect(issue.replyCount).toBe(0);
  });
});
