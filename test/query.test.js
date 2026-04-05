import { describe, expect, it } from 'vitest';
import {
  buildAdminIssueWhere,
  buildDateWhereClause,
  buildPublicIssueWhere,
  calculatePercentiles,
  isSupportedLegacyAdminSort,
  isSupportedLegacyPublicSort,
  resolveAdminOrderBy,
  resolvePublicOrderBy,
} from '../src/shared/issueQueries.js';

describe('buildDateWhereClause', () => {
  it('returns an empty where clause when no dates are provided', () => {
    const result = buildDateWhereClause({});

    expect(result).toEqual({
      whereSql: '',
      bindings: [],
    });
  });

  it('builds aliased date boundaries when provided', () => {
    const result = buildDateWhereClause({
      startDate: '2026-03-01',
      endDate: '2026-03-11',
    }, {
      tableAlias: 'records',
      column: 'updated_at',
    });

    expect(result.whereSql).toBe('WHERE date(records.updated_at) >= date(?) AND date(records.updated_at) <= date(?)');
    expect(result.bindings).toEqual(['2026-03-01', '2026-03-11']);
  });
});

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

  it('builds false-branch existence filters without extra bindings', () => {
    const result = buildAdminIssueWhere({
      hasNotes: false,
      hasReplies: true,
      isAssigned: false,
    }, { tableAlias: 'tickets' });

    expect(result.whereSql).toContain("COALESCE(TRIM(tickets.assigned_to), '') = ''");
    expect(result.whereSql).toContain('NOT EXISTS (SELECT 1 FROM issue_internal_notes notes WHERE notes.issue_id = tickets.id)');
    expect(result.whereSql).toContain("EXISTS (SELECT 1 FROM issue_updates updates WHERE updates.issue_id = tickets.id AND updates.update_type = 'public_reply')");
    expect(result.bindings).toEqual([]);
  });
});

describe('buildPublicIssueWhere', () => {
  it('always scopes to public issues and supports keyword/date filters', () => {
    const result = buildPublicIssueWhere({
      status: ['resolved'],
      category: ['facility'],
      startDate: '2026-03-01',
      endDate: '2026-03-11',
      q: '空调',
    }, { tableAlias: 'issues' });

    expect(result.whereSql).toContain('issues.is_public = 1');
    expect(result.whereSql).toContain('issues.status IN (?)');
    expect(result.whereSql).toContain('issues.category IN (?)');
    expect(result.whereSql).toContain('date(issues.created_at) >= date(?)');
    expect(result.whereSql).toContain('COALESCE(issues.public_summary, \'\') LIKE ? ESCAPE');
    expect(result.bindings).toEqual([
      'resolved',
      'facility',
      '2026-03-01',
      '2026-03-11',
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

  it('supports legacy updated sorting values', () => {
    const orderBy = resolveAdminOrderBy({ sort: 'updated' }, { tableAlias: 'tickets' });

    expect(orderBy).toBe('tickets.updated_at DESC, tickets.id DESC');
  });
});

describe('resolvePublicOrderBy', () => {
  it('supports status sorting', () => {
    const orderBy = resolvePublicOrderBy({ sortField: 'status', sortOrder: 'desc' }, { tableAlias: 'issues' });
    expect(orderBy).toContain('CASE issues.status');
    expect(orderBy).toContain('DESC');
  });

  it('supports legacy oldest sorting values', () => {
    const orderBy = resolvePublicOrderBy({ sort: 'oldest' }, { tableAlias: 'records' });

    expect(orderBy).toBe('records.created_at ASC, records.id ASC');
  });
});

describe('legacy sort guards', () => {
  it('recognizes known legacy sort options', () => {
    expect(isSupportedLegacyAdminSort('newest')).toBe(true);
    expect(isSupportedLegacyPublicSort('updated')).toBe(true);
  });

  it('rejects unknown sort options', () => {
    expect(isSupportedLegacyAdminSort('priority')).toBe(false);
    expect(isSupportedLegacyPublicSort('priority')).toBe(false);
  });
});

describe('calculatePercentiles', () => {
  it('returns zeros for empty or non-finite input values', () => {
    expect(calculatePercentiles([])).toEqual({
      p50: 0,
      p75: 0,
      p95: 0,
    });
    expect(calculatePercentiles([Number.NaN, Number.POSITIVE_INFINITY])).toEqual({
      p50: 0,
      p75: 0,
      p95: 0,
    });
  });

  it('rounds selected percentile values from sorted samples', () => {
    expect(calculatePercentiles([10.2, 1.2, 3.6, 2.4])).toEqual({
      p50: 2,
      p75: 4,
      p95: 10,
    });
  });
});
