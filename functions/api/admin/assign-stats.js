import {
  authorizeAdminRequest,
  createForbiddenOriginResponse,
  requireAdminRole,
} from '../../../src/shared/auth.js';
import { getAdminCorsPolicy } from '../../../src/shared/corsConfig.js';
import { buildDateWhereClause } from '../../../src/shared/issueQueries.js';
import { checkAdminRateLimit } from '../../../src/shared/rateLimit.js';
import { createOptionsResponse, errorResponse, methodNotAllowedResponse, successResponse } from '../../../src/shared/response.js';
import { assignStatsQuerySchema, formatZodError } from '../../../src/shared/validation.js';

const ALLOWED_METHODS = 'GET, OPTIONS';

function hoursBetween(start, end) {
  const startTime = Date.parse(start);
  const endTime = Date.parse(end);
  if (Number.isNaN(startTime) || Number.isNaN(endTime) || endTime < startTime) {
    return null;
  }

  return Math.round(((endTime - startTime) / 3600000) * 10) / 10;
}

function average(values) {
  const filtered = values.filter((value) => Number.isFinite(value));
  if (filtered.length === 0) {
    return 0;
  }

  return Math.round((filtered.reduce((sum, value) => sum + value, 0) / filtered.length) * 10) / 10;
}

function getIsoWeek(date) {
  const copy = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const day = copy.getUTCDay() || 7;
  copy.setUTCDate(copy.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(copy.getUTCFullYear(), 0, 1));
  const week = Math.ceil((((copy - yearStart) / 86400000) + 1) / 7);
  return `${copy.getUTCFullYear()}-W${String(week).padStart(2, '0')}`;
}

function getTrendPeriod(value, period) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return null;
  }

  if (period === 'month') {
    return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`;
  }

  return getIsoWeek(date);
}

function createEmptyStatusCounts(username, displayName) {
  return {
    username,
    displayName,
    pending: 0,
    inProgress: 0,
    resolved: 0,
    avgResponseTime: 0,
    avgResolutionTime: 0,
    responseSamples: [],
    resolutionSamples: [],
  };
}

function finalizeHandlerStats(entry) {
  return {
    username: entry.username,
    displayName: entry.displayName,
    pending: entry.pending,
    inProgress: entry.inProgress,
    resolved: entry.resolved,
    avgResponseTime: average(entry.responseSamples),
    avgResolutionTime: average(entry.resolutionSamples),
  };
}

function summarizeIssues(issues, users, period) {
  const userLabels = new Map(users.map((user) => [user.username, user.display_name]));
  const handlers = new Map();
  const trend = new Map();
  const summary = {
    totalIssues: issues.length,
    pending: 0,
    inProgress: 0,
    resolved: 0,
  };

  for (const issue of issues) {
    if (issue.status === 'in_progress') {
      summary.inProgress += 1;
    } else if (issue.status === 'resolved') {
      summary.resolved += 1;
    } else if (issue.status === 'submitted' || issue.status === 'in_review') {
      summary.pending += 1;
    }

    const username = issue.assigned_to || '未分配';
    if (!handlers.has(username)) {
      handlers.set(username, createEmptyStatusCounts(username, userLabels.get(username) || username));
    }
    const handler = handlers.get(username);
    if (issue.status === 'in_progress') {
      handler.inProgress += 1;
    } else if (issue.status === 'resolved') {
      handler.resolved += 1;
    } else if (issue.status === 'submitted' || issue.status === 'in_review') {
      handler.pending += 1;
    }

    const responseHours = hoursBetween(issue.created_at, issue.first_response_at);
    const resolutionHours = hoursBetween(issue.created_at, issue.resolved_at);
    if (responseHours != null) {
      handler.responseSamples.push(responseHours);
    }
    if (resolutionHours != null) {
      handler.resolutionSamples.push(resolutionHours);
    }

    const createdPeriod = getTrendPeriod(issue.created_at, period);
    if (createdPeriod) {
      const current = trend.get(createdPeriod) || { period: createdPeriod, created: 0, resolved: 0 };
      current.created += 1;
      trend.set(createdPeriod, current);
    }

    const resolvedPeriod = getTrendPeriod(issue.resolved_at, period);
    if (resolvedPeriod) {
      const current = trend.get(resolvedPeriod) || { period: resolvedPeriod, created: 0, resolved: 0 };
      current.resolved += 1;
      trend.set(resolvedPeriod, current);
    }
  }

  return {
    summary,
    handlers: Array.from(handlers.values())
      .map(finalizeHandlerStats)
      .sort((left, right) => (right.pending + right.inProgress + right.resolved) - (left.pending + left.inProgress + left.resolved) || left.username.localeCompare(right.username)),
    trend: Array.from(trend.values()).sort((left, right) => left.period.localeCompare(right.period)),
  };
}

export async function onRequest(context) {
  const { request, env } = context;
  const origin = request.headers.get('Origin');
  const corsPolicy = getAdminCorsPolicy(origin, env, ALLOWED_METHODS);

  if (corsPolicy.hasOrigin && !corsPolicy.isOriginAllowed) {
    return createForbiddenOriginResponse(corsPolicy.headers);
  }

  if (request.method === 'OPTIONS') {
    return createOptionsResponse(corsPolicy.headers);
  }

  if (request.method !== 'GET') {
    return methodNotAllowedResponse(corsPolicy.headers, ALLOWED_METHODS);
  }

  const rateLimitResponse = await checkAdminRateLimit(env, request, corsPolicy.headers);
  if (rateLimitResponse) {
    return rateLimitResponse;
  }

  const authResult = requireAdminRole(await authorizeAdminRequest(request, env, ALLOWED_METHODS));
  if (!authResult.ok) {
    return authResult.response;
  }

  try {
    const url = new URL(request.url);
    const parsedQuery = assignStatsQuerySchema.safeParse(Object.fromEntries(url.searchParams.entries()));
    if (!parsedQuery.success) {
      return errorResponse(formatZodError(parsedQuery.error), { status: 400, headers: authResult.corsHeaders });
    }

    const query = parsedQuery.data;
    const { whereSql, bindings } = buildDateWhereClause(query, { tableAlias: 'issues', column: 'created_at' });
    const [issueRows, userRows] = await Promise.all([
      env.DB.prepare(`
        SELECT *
        FROM issues
        ${whereSql}
        ORDER BY created_at ASC, id ASC
      `)
        .bind(...bindings)
        .all(),
      env.DB.prepare(`
        SELECT username, display_name
        FROM admin_users
        WHERE is_enabled = 1
        ORDER BY username COLLATE NOCASE ASC
      `).all(),
    ]);

    return successResponse(summarizeIssues(issueRows.results || [], userRows.results || [], query.period), {
      headers: authResult.corsHeaders,
    });
  } catch (error) {
    console.error('Admin assign stats route failed:', error);
    const message = env.ENVIRONMENT === 'production' ? '服务器内部错误' : `数据库错误: ${error.message}`;
    return errorResponse(message, { status: 500, headers: authResult.corsHeaders });
  }
}
