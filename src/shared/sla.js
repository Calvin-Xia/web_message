import { toBoolean } from './utils.js';

const SLA_WARNING_WINDOW_MS = 60 * 60 * 1000;
const RESOLVED_STATUSES = new Set(['resolved', 'closed']);

function toTimestamp(value) {
  if (!value) {
    return null;
  }

  const timestamp = Date.parse(value);
  return Number.isNaN(timestamp) ? null : timestamp;
}

function addHours(baseTimestamp, hours) {
  return new Date(baseTimestamp + Number(hours) * 60 * 60 * 1000).toISOString();
}

function getDeadlineStatus(deadline, nowTimestamp) {
  const deadlineTimestamp = toTimestamp(deadline);
  if (!deadlineTimestamp) {
    return 'normal';
  }

  if (nowTimestamp > deadlineTimestamp) {
    return 'violated';
  }

  if (deadlineTimestamp - nowTimestamp <= SLA_WARNING_WINDOW_MS) {
    return 'warning';
  }

  return 'normal';
}

function getWorstStatus(statuses) {
  if (statuses.includes('violated')) {
    return 'violated';
  }

  if (statuses.includes('warning')) {
    return 'warning';
  }

  return 'normal';
}

export function mapSLARule(row) {
  return {
    id: row.id,
    name: row.name,
    priority: row.priority,
    responseHours: Number(row.response_hours) || 0,
    resolutionHours: Number(row.resolution_hours) || 0,
    isEnabled: toBoolean(row.is_enabled),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export async function getSLARuleByPriority(db, priority) {
  if (!priority) {
    return null;
  }

  const row = await db.prepare(`
    SELECT *
    FROM sla_rules
    WHERE priority = ? AND is_enabled = 1
    LIMIT 1
  `)
    .bind(priority)
    .first();

  return row ? mapSLARule(row) : null;
}

export function calculateSLADeadlines(rule, createdAt = new Date()) {
  if (!rule || !rule.isEnabled) {
    return {
      responseDeadline: null,
      resolutionDeadline: null,
    };
  }

  const baseTimestamp = toTimestamp(createdAt instanceof Date ? createdAt.toISOString() : createdAt);
  if (!baseTimestamp) {
    return {
      responseDeadline: null,
      resolutionDeadline: null,
    };
  }

  return {
    responseDeadline: addHours(baseTimestamp, rule.responseHours),
    resolutionDeadline: addHours(baseTimestamp, rule.resolutionHours),
  };
}

export function getSLAStatus(issue, now = new Date()) {
  const nowTimestamp = toTimestamp(now instanceof Date ? now.toISOString() : now) ?? Date.now();
  const responseDeadline = issue.sla_response_deadline ?? issue.slaResponseDeadline;
  const resolutionDeadline = issue.sla_resolution_deadline ?? issue.slaResolutionDeadline;
  const firstResponseAt = issue.first_response_at ?? issue.firstResponseAt;
  const status = issue.status;
  const statuses = [];

  if (responseDeadline && !firstResponseAt) {
    statuses.push(getDeadlineStatus(responseDeadline, nowTimestamp));
  }

  if (resolutionDeadline && !RESOLVED_STATUSES.has(status)) {
    statuses.push(getDeadlineStatus(resolutionDeadline, nowTimestamp));
  }

  return getWorstStatus(statuses);
}

export function getSLADetail(issue, now = new Date()) {
  const nowTimestamp = toTimestamp(now instanceof Date ? now.toISOString() : now) ?? Date.now();
  const responseDeadline = issue.sla_response_deadline ?? issue.slaResponseDeadline;
  const resolutionDeadline = issue.sla_resolution_deadline ?? issue.slaResolutionDeadline;
  const firstResponseAt = issue.first_response_at ?? issue.firstResponseAt;
  const status = issue.status;
  const responseStatus = responseDeadline && !firstResponseAt
    ? getDeadlineStatus(responseDeadline, nowTimestamp)
    : 'normal';
  const resolutionStatus = resolutionDeadline && !RESOLVED_STATUSES.has(status)
    ? getDeadlineStatus(resolutionDeadline, nowTimestamp)
    : 'normal';

  return {
    slaStatus: getWorstStatus([responseStatus, resolutionStatus]),
    responseStatus,
    resolutionStatus,
  };
}

function mapSLAViolation(row, now) {
  return {
    issueId: row.id,
    trackingCode: row.tracking_code,
    priority: row.priority,
    assignedTo: row.assigned_to,
    slaStatus: getSLAStatus(row, now),
    responseDeadline: row.sla_response_deadline,
    resolutionDeadline: row.sla_resolution_deadline,
    createdAt: row.created_at,
  };
}

export async function checkSLAViolations(db, {
  status = null,
  startDate = null,
  endDate = null,
  now = new Date(),
  limit = 200,
} = {}) {
  const clauses = [
    `(sla_response_deadline IS NOT NULL OR sla_resolution_deadline IS NOT NULL)`,
    `(
      (first_response_at IS NULL AND sla_response_deadline IS NOT NULL)
      OR (status NOT IN ('resolved', 'closed') AND sla_resolution_deadline IS NOT NULL)
    )`,
  ];
  const bindings = [];

  if (startDate) {
    clauses.push('date(created_at) >= date(?)');
    bindings.push(startDate);
  }

  if (endDate) {
    clauses.push('date(created_at) <= date(?)');
    bindings.push(endDate);
  }

  const rows = await db.prepare(`
    SELECT
      id, tracking_code, priority, status, first_response_at, resolved_at, assigned_to,
      sla_response_deadline, sla_resolution_deadline, created_at
    FROM issues
    WHERE ${clauses.join(' AND ')}
    ORDER BY created_at DESC, id DESC
    LIMIT ?
  `)
    .bind(...bindings, limit)
    .all();

  return (rows.results || [])
    .map((row) => mapSLAViolation(row, now))
    .filter((item) => item.slaStatus !== 'normal')
    .filter((item) => !status || item.slaStatus === status);
}

export function getWarningIssues(db, options = {}) {
  return checkSLAViolations(db, { ...options, status: 'warning' });
}

export function getViolatedIssues(db, options = {}) {
  return checkSLAViolations(db, { ...options, status: 'violated' });
}
