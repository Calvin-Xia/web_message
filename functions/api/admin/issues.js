import { createForbiddenOriginResponse, authorizeAdminRequest } from '../../../src/shared/auth.js';
import { getAdminCorsPolicy } from '../../../src/shared/corsConfig.js';
import { createPagination, mapAdminIssue } from '../../../src/shared/issueData.js';
import { successResponse, errorResponse, createOptionsResponse, methodNotAllowedResponse } from '../../../src/shared/response.js';
import { checkAdminRateLimit } from '../../../src/shared/rateLimit.js';
import { adminIssueListQuerySchema, formatZodError } from '../../../src/shared/validation.js';
import { buildAdminIssueWhere, resolveAdminOrderBy } from '../../../src/shared/issueQueries.js';

const ALLOWED_METHODS = 'GET, OPTIONS';

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

    const query = parsedQuery.data;
    const offset = (query.page - 1) * query.pageSize;
    const { whereSql, bindings } = buildAdminIssueWhere(query, { tableAlias: 'issues' });
    const orderBy = resolveAdminOrderBy(query, { tableAlias: 'issues' });
    const filteredIssuesSql = `SELECT issues.* FROM issues ${whereSql}`;

    const totalRow = await env.DB.prepare(`SELECT COUNT(*) AS total FROM (${filteredIssuesSql}) filtered_issues`)
      .bind(...bindings)
      .first();
    const total = Number(totalRow?.total) || 0;

    const listRows = await env.DB.prepare(`
      SELECT
        issues.*,
        EXISTS (SELECT 1 FROM issue_internal_notes notes WHERE notes.issue_id = issues.id) AS has_notes,
        EXISTS (SELECT 1 FROM issue_updates replies WHERE replies.issue_id = issues.id AND replies.update_type = 'public_reply') AS has_replies,
        (SELECT COUNT(*) FROM issue_internal_notes notes WHERE notes.issue_id = issues.id) AS note_count,
        (SELECT COUNT(*) FROM issue_updates replies WHERE replies.issue_id = issues.id AND replies.update_type = 'public_reply') AS reply_count
      FROM issues
      ${whereSql}
      ORDER BY ${orderBy}
      LIMIT ? OFFSET ?
    `)
      .bind(...bindings, query.pageSize, offset)
      .all();

    const statsRow = await env.DB.prepare(`
      SELECT
        COUNT(*) AS total,
        SUM(CASE WHEN filtered_issues.status IN ('submitted', 'in_review', 'in_progress') THEN 1 ELSE 0 END) AS pending_count,
        SUM(CASE WHEN date(filtered_issues.created_at) = date('now') THEN 1 ELSE 0 END) AS today_new_count,
        SUM(CASE WHEN filtered_issues.resolved_at IS NOT NULL AND filtered_issues.resolved_at >= datetime('now', '-6 days') THEN 1 ELSE 0 END) AS week_resolved_count,
        SUM(CASE WHEN filtered_issues.status = 'submitted' THEN 1 ELSE 0 END) AS submitted_count,
        SUM(CASE WHEN filtered_issues.status = 'in_review' THEN 1 ELSE 0 END) AS in_review_count,
        SUM(CASE WHEN filtered_issues.status = 'in_progress' THEN 1 ELSE 0 END) AS in_progress_count,
        SUM(CASE WHEN filtered_issues.status = 'resolved' THEN 1 ELSE 0 END) AS resolved_count,
        SUM(CASE WHEN filtered_issues.status = 'closed' THEN 1 ELSE 0 END) AS closed_count
      FROM (${filteredIssuesSql}) filtered_issues
    `)
      .bind(...bindings)
      .first();

    const assigneeRows = await env.DB.prepare(`
      SELECT DISTINCT assigned_to
      FROM issues
      WHERE COALESCE(TRIM(assigned_to), '') <> ''
      ORDER BY assigned_to COLLATE NOCASE ASC
    `).all();

    return successResponse({
      items: (listRows.results || []).map(mapAdminIssue),
      pagination: createPagination(query.page, query.pageSize, total),
      stats: {
        total: Number(statsRow?.total) || 0,
        pendingCount: Number(statsRow?.pending_count) || 0,
        todayNewCount: Number(statsRow?.today_new_count) || 0,
        weekResolvedCount: Number(statsRow?.week_resolved_count) || 0,
        byStatus: createStatusBreakdown(statsRow),
      },
      meta: {
        availableAssignees: (assigneeRows.results || []).map((row) => row.assigned_to),
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
