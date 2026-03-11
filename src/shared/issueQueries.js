import {
  ADMIN_SORT_VALUES,
  PUBLIC_SORT_VALUES,
} from './constants.js';
import { createContainsLikePattern } from './sql.js';

const STATUS_SORT_SQL = "CASE {column} WHEN 'submitted' THEN 1 WHEN 'in_review' THEN 2 WHEN 'in_progress' THEN 3 WHEN 'resolved' THEN 4 WHEN 'closed' THEN 5 ELSE 6 END";
const PRIORITY_SORT_SQL = "CASE {column} WHEN 'urgent' THEN 1 WHEN 'high' THEN 2 WHEN 'normal' THEN 3 WHEN 'low' THEN 4 ELSE 5 END";
const LEGACY_ADMIN_SORT_MAP = {
  newest: { sortField: 'createdAt', sortOrder: 'desc' },
  oldest: { sortField: 'createdAt', sortOrder: 'asc' },
  updated: { sortField: 'updatedAt', sortOrder: 'desc' },
};
const LEGACY_PUBLIC_SORT_MAP = {
  newest: { sortField: 'createdAt', sortOrder: 'desc' },
  oldest: { sortField: 'createdAt', sortOrder: 'asc' },
  updated: { sortField: 'updatedAt', sortOrder: 'desc' },
};

function getColumnName(tableAlias, columnName) {
  return tableAlias ? `${tableAlias}.${columnName}` : columnName;
}

function getStatusSortExpression(columnName) {
  return STATUS_SORT_SQL.replace('{column}', columnName);
}

function getPrioritySortExpression(columnName) {
  return PRIORITY_SORT_SQL.replace('{column}', columnName);
}

function pushInClause(clauses, bindings, columnName, values) {
  if (!Array.isArray(values) || values.length === 0) {
    return;
  }

  const placeholders = values.map(() => '?').join(', ');
  clauses.push(`${columnName} IN (${placeholders})`);
  bindings.push(...values);
}

function pushDateRangeClauses(clauses, bindings, columnName, startDate, endDate) {
  if (startDate) {
    clauses.push(`date(${columnName}) >= date(?)`);
    bindings.push(startDate);
  }

  if (endDate) {
    clauses.push(`date(${columnName}) <= date(?)`);
    bindings.push(endDate);
  }
}

function normalizeSortOrder(value, fallback = 'desc') {
  if (value === 'asc') {
    return 'ASC';
  }

  return fallback === 'asc' ? 'ASC' : 'DESC';
}

function resolveLegacySort(sort, legacyMap, fallback) {
  if (typeof sort === 'string' && sort in legacyMap) {
    return legacyMap[sort];
  }

  return fallback;
}

export function buildDateWhereClause({ startDate, endDate }, { tableAlias = 'issues', column = 'created_at' } = {}) {
  const clauses = [];
  const bindings = [];
  const columnName = getColumnName(tableAlias, column);

  pushDateRangeClauses(clauses, bindings, columnName, startDate, endDate);

  return {
    whereSql: clauses.length > 0 ? `WHERE ${clauses.join(' AND ')}` : '',
    bindings,
  };
}

export function buildAdminIssueWhere(filters, { tableAlias = 'issues' } = {}) {
  const clauses = [];
  const bindings = [];
  const idColumn = getColumnName(tableAlias, 'id');

  pushInClause(clauses, bindings, getColumnName(tableAlias, 'status'), filters.status);
  pushInClause(clauses, bindings, getColumnName(tableAlias, 'category'), filters.category);
  pushInClause(clauses, bindings, getColumnName(tableAlias, 'priority'), filters.priority);

  if (filters.assignedTo) {
    clauses.push(`${getColumnName(tableAlias, 'assigned_to')} = ?`);
    bindings.push(filters.assignedTo);
  }

  if (filters.isAssigned === true) {
    clauses.push(`COALESCE(TRIM(${getColumnName(tableAlias, 'assigned_to')}), '') <> ''`);
  } else if (filters.isAssigned === false) {
    clauses.push(`COALESCE(TRIM(${getColumnName(tableAlias, 'assigned_to')}), '') = ''`);
  }

  pushDateRangeClauses(clauses, bindings, getColumnName(tableAlias, 'created_at'), filters.startDate, filters.endDate);

  if (filters.updatedAfter) {
    clauses.push(`date(${getColumnName(tableAlias, 'updated_at')}) >= date(?)`);
    bindings.push(filters.updatedAfter);
  }

  if (filters.hasNotes === true) {
    clauses.push(`EXISTS (SELECT 1 FROM issue_internal_notes notes WHERE notes.issue_id = ${idColumn})`);
  } else if (filters.hasNotes === false) {
    clauses.push(`NOT EXISTS (SELECT 1 FROM issue_internal_notes notes WHERE notes.issue_id = ${idColumn})`);
  }

  if (filters.hasReplies === true) {
    clauses.push(`EXISTS (SELECT 1 FROM issue_updates updates WHERE updates.issue_id = ${idColumn} AND updates.update_type = 'public_reply')`);
  } else if (filters.hasReplies === false) {
    clauses.push(`NOT EXISTS (SELECT 1 FROM issue_updates updates WHERE updates.issue_id = ${idColumn} AND updates.update_type = 'public_reply')`);
  }

  if (filters.q) {
    const keyword = createContainsLikePattern(filters.q);
    clauses.push(`(
      ${getColumnName(tableAlias, 'tracking_code')} LIKE ? ESCAPE '\\'
      OR ${getColumnName(tableAlias, 'name')} LIKE ? ESCAPE '\\'
      OR ${getColumnName(tableAlias, 'student_id')} LIKE ? ESCAPE '\\'
      OR ${getColumnName(tableAlias, 'content')} LIKE ? ESCAPE '\\'
      OR COALESCE(${getColumnName(tableAlias, 'public_summary')}, '') LIKE ? ESCAPE '\\'
    )`);
    bindings.push(keyword, keyword, keyword, keyword, keyword);
  }

  return {
    whereSql: clauses.length > 0 ? `WHERE ${clauses.join(' AND ')}` : '',
    bindings,
  };
}

export function buildPublicIssueWhere(filters, { tableAlias = 'issues' } = {}) {
  const clauses = [`${getColumnName(tableAlias, 'is_public')} = 1`];
  const bindings = [];

  pushInClause(clauses, bindings, getColumnName(tableAlias, 'status'), filters.status);
  pushInClause(clauses, bindings, getColumnName(tableAlias, 'category'), filters.category);
  pushDateRangeClauses(clauses, bindings, getColumnName(tableAlias, 'created_at'), filters.startDate, filters.endDate);

  if (filters.q) {
    const keyword = createContainsLikePattern(filters.q);
    clauses.push(`(
      ${getColumnName(tableAlias, 'tracking_code')} LIKE ? ESCAPE '\\'
      OR ${getColumnName(tableAlias, 'content')} LIKE ? ESCAPE '\\'
      OR COALESCE(${getColumnName(tableAlias, 'public_summary')}, '') LIKE ? ESCAPE '\\'
    )`);
    bindings.push(keyword, keyword, keyword);
  }

  return {
    whereSql: `WHERE ${clauses.join(' AND ')}`,
    bindings,
  };
}

export function resolveAdminOrderBy({ sort, sortField, sortOrder }, { tableAlias = 'issues' } = {}) {
  const fallback = { sortField: 'createdAt', sortOrder: 'desc' };
  const resolved = sortField
    ? { sortField, sortOrder: sortOrder ?? fallback.sortOrder }
    : resolveLegacySort(sort, LEGACY_ADMIN_SORT_MAP, fallback);
  const order = normalizeSortOrder(resolved.sortOrder, fallback.sortOrder);

  if (resolved.sortField === 'updatedAt') {
    return `${getColumnName(tableAlias, 'updated_at')} ${order}, ${getColumnName(tableAlias, 'id')} ${order}`;
  }

  if (resolved.sortField === 'priority') {
    return `${getPrioritySortExpression(getColumnName(tableAlias, 'priority'))} ${order}, ${getColumnName(tableAlias, 'updated_at')} DESC, ${getColumnName(tableAlias, 'id')} DESC`;
  }

  return `${getColumnName(tableAlias, 'created_at')} ${order}, ${getColumnName(tableAlias, 'id')} ${order}`;
}

export function resolvePublicOrderBy({ sort, sortField, sortOrder }, { tableAlias = 'issues' } = {}) {
  const fallback = { sortField: 'createdAt', sortOrder: 'desc' };
  const resolved = sortField
    ? { sortField, sortOrder: sortOrder ?? fallback.sortOrder }
    : resolveLegacySort(sort, LEGACY_PUBLIC_SORT_MAP, fallback);
  const order = normalizeSortOrder(resolved.sortOrder, fallback.sortOrder);

  if (resolved.sortField === 'updatedAt') {
    return `${getColumnName(tableAlias, 'updated_at')} ${order}, ${getColumnName(tableAlias, 'id')} ${order}`;
  }

  if (resolved.sortField === 'status') {
    return `${getStatusSortExpression(getColumnName(tableAlias, 'status'))} ${order}, ${getColumnName(tableAlias, 'updated_at')} DESC, ${getColumnName(tableAlias, 'id')} DESC`;
  }

  return `${getColumnName(tableAlias, 'created_at')} ${order}, ${getColumnName(tableAlias, 'id')} ${order}`;
}

export function isLegacyAdminSort(value) {
  return typeof value === 'string' && ADMIN_SORT_VALUES.includes(value);
}

export function isLegacyPublicSort(value) {
  return typeof value === 'string' && PUBLIC_SORT_VALUES.includes(value);
}

export function calculatePercentiles(values) {
  if (!Array.isArray(values) || values.length === 0) {
    return {
      p50: 0,
      p75: 0,
      p95: 0,
    };
  }

  const sorted = values
    .filter((value) => Number.isFinite(value))
    .sort((left, right) => left - right);

  if (sorted.length === 0) {
    return {
      p50: 0,
      p75: 0,
      p95: 0,
    };
  }

  const pick = (percentile) => {
    const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil(sorted.length * percentile) - 1));
    return Math.round(sorted[index]);
  };

  return {
    p50: pick(0.5),
    p75: pick(0.75),
    p95: pick(0.95),
  };
}
