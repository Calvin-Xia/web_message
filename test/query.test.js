import { describe, expect, it } from 'vitest';
import { buildAdminIssueWhere, resolveAdminOrderBy, resolvePublicOrderBy } from '../src/shared/issueQueries.js';

describe('buildAdminIssueWhere', () => {
  it('builds composite filters with list values and existence checks', () => {
    const result = buildAdminIssueWhere({
      status: ['submitted', 'in_review'],
      category: ['facility'],
      priority: ['urgent'],
      q: '空调',
      assignedTo: 'admin1',
      startDate: '2026-03-01',
      endDate: '2026-03-11',
      updatedAfter: '2026-03-05',
      hasNotes: true,
      hasReplies: false,
      isAssigned: true,
    }, { tableAlias: 'issues' });

    expect(result.whereSql).toContain('issues.status IN (?, ?)');
    expect(result.whereSql).toContain('EXISTS (SELECT 1 FROM issue_internal_notes');
    expect(result.whereSql).toContain('NOT EXISTS (SELECT 1 FROM issue_updates');
    expect(result.bindings).toEqual([
      'submitted',
      'in_review',
      'facility',
      'urgent',
      'admin1',
      '2026-03-01',
      '2026-03-11',
      '2026-03-05',
      '%空调%',
      '%空调%',
      '%空调%',
      '%空调%',
      '%空调%',
    ]);
  });
});

describe('resolveAdminOrderBy', () => {
  it('supports priority sorting', () => {
    const orderBy = resolveAdminOrderBy({ sortField: 'priority', sortOrder: 'asc' }, { tableAlias: 'issues' });
    expect(orderBy).toContain('CASE issues.priority');
    expect(orderBy).toContain('ASC');
  });
});

describe('resolvePublicOrderBy', () => {
  it('supports status sorting', () => {
    const orderBy = resolvePublicOrderBy({ sortField: 'status', sortOrder: 'desc' }, { tableAlias: 'issues' });
    expect(orderBy).toContain('CASE issues.status');
    expect(orderBy).toContain('DESC');
  });
});
