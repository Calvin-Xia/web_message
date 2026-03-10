import { getAdminCorsPolicy, createForbiddenOriginResponse, authorizeAdminRequest } from '../../../src/shared/auth.js';
import { createPagination, mapAdminIssue } from '../../../src/shared/issueData.js';
import { successResponse, errorResponse, createOptionsResponse, methodNotAllowedResponse } from '../../../src/shared/response.js';
import { checkAdminRateLimit } from '../../../src/shared/rateLimit.js';
import { adminIssueListQuerySchema, formatZodError } from '../../../src/shared/validation.js';
import { createContainsLikePattern } from '../../../src/shared/sql.js';

const ALLOWED_METHODS = 'GET, OPTIONS';
const ADMIN_SORT_SQL = {
  newest: 'created_at DESC, id DESC',
  oldest: 'created_at ASC, id ASC',
  updated: 'updated_at DESC, id DESC',
};

function buildAdminListWhere(filters) {
  const clauses = [];
  const bindings = [];

  if (filters.status) {
    clauses.push('status = ?');
    bindings.push(filters.status);
  }

  if (filters.category) {
    clauses.push('category = ?');
    bindings.push(filters.category);
  }

  if (filters.priority) {
    clauses.push('priority = ?');
    bindings.push(filters.priority);
  }

  if (filters.assignedTo) {
    clauses.push('assigned_to = ?');
    bindings.push(filters.assignedTo);
  }

  if (filters.q) {
    clauses.push("(tracking_code LIKE ? ESCAPE '\\' OR name LIKE ? ESCAPE '\\' OR student_id LIKE ? ESCAPE '\\' OR content LIKE ? ESCAPE '\\' OR COALESCE(public_summary, '') LIKE ? ESCAPE '\\')");
    const keyword = createContainsLikePattern(filters.q);
    bindings.push(keyword, keyword, keyword, keyword, keyword);
  }

  return {
    whereSql: clauses.length > 0 ? `WHERE ${clauses.join(' AND ')}` : '',
    bindings,
  };
}

function createStatusBreakdown(row) {
  return {
    submitted: Number(row?.submitted_count) || 0,
    in_review: Number(row?.in_review_count) || 0,
    in_progress: Number(row?.in_progress_count) || 0,
    resolved: Number(row?.resolved_count) || 0,
    closed: Number(row?.closed_count) || 0,
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

  const authResult = authorizeAdminRequest(request, env, ALLOWED_METHODS);
  if (!authResult.ok) {
    return authResult.response;
  }

  try {
    const url = new URL(request.url);
    const parsedQuery = adminIssueListQuerySchema.safeParse(Object.fromEntries(url.searchParams.entries()));
    if (!parsedQuery.success) {
      return errorResponse(formatZodError(parsedQuery.error), { status: 400, headers: authResult.corsHeaders });
    }

    const { page, pageSize, status, category, priority, assignedTo, q, sort } = parsedQuery.data;
    const offset = (page - 1) * pageSize;
    const { whereSql, bindings } = buildAdminListWhere({ status, category, priority, assignedTo, q });
    const orderBy = ADMIN_SORT_SQL[sort] || ADMIN_SORT_SQL.newest;

    const totalRow = await env.DB.prepare(`SELECT COUNT(*) AS total FROM issues ${whereSql}`)
      .bind(...bindings)
      .first();
    const total = Number(totalRow?.total) || 0;

    const listRows = await env.DB.prepare(`
      SELECT *
      FROM issues
      ${whereSql}
      ORDER BY ${orderBy}
      LIMIT ? OFFSET ?
    `)
      .bind(...bindings, pageSize, offset)
      .all();

    const statsRow = await env.DB.prepare(`
      SELECT
        COUNT(*) AS total,
        SUM(CASE WHEN status IN ('submitted', 'in_review', 'in_progress') THEN 1 ELSE 0 END) AS pending_count,
        SUM(CASE WHEN date(created_at) = date('now') THEN 1 ELSE 0 END) AS today_new_count,
        SUM(CASE WHEN resolved_at IS NOT NULL AND resolved_at >= datetime('now', '-6 days') THEN 1 ELSE 0 END) AS week_resolved_count,
        SUM(CASE WHEN status = 'submitted' THEN 1 ELSE 0 END) AS submitted_count,
        SUM(CASE WHEN status = 'in_review' THEN 1 ELSE 0 END) AS in_review_count,
        SUM(CASE WHEN status = 'in_progress' THEN 1 ELSE 0 END) AS in_progress_count,
        SUM(CASE WHEN status = 'resolved' THEN 1 ELSE 0 END) AS resolved_count,
        SUM(CASE WHEN status = 'closed' THEN 1 ELSE 0 END) AS closed_count
      FROM issues
    `).first();

    return successResponse({
      items: listRows.results.map(mapAdminIssue),
      pagination: createPagination(page, pageSize, total),
      stats: {
        total: Number(statsRow?.total) || 0,
        pendingCount: Number(statsRow?.pending_count) || 0,
        todayNewCount: Number(statsRow?.today_new_count) || 0,
        weekResolvedCount: Number(statsRow?.week_resolved_count) || 0,
        byStatus: createStatusBreakdown(statsRow),
      },
    }, {
      headers: authResult.corsHeaders,
    });
  } catch (error) {
    console.error('Admin issue list route failed:', error);
    const message = env.ENVIRONMENT === 'production' ? '服务器内部错误' : `数据库错误: ${error.message}`;
    return errorResponse(message, { status: 500, headers: authResult.corsHeaders });
  }
}
