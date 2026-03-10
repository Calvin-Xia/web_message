import { checkRateLimit, getClientIP } from '../../src/shared/rateLimit.js';
import { parseJsonBody } from '../../src/shared/request.js';
import { createPagination, mapPublicIssue, recordAdminAction } from '../../src/shared/issueData.js';
import { successResponse, errorResponse, createOptionsResponse, createPublicCorsHeaders, methodNotAllowedResponse } from '../../src/shared/response.js';
import { generateUniqueTrackingCodeForDb } from '../../src/shared/tracking.js';
import { publicIssueListQuerySchema, issueSchema, formatZodError } from '../../src/shared/validation.js';

const ALLOWED_METHODS = 'GET, POST, OPTIONS';
const PUBLIC_SORT_SQL = {
  newest: 'created_at DESC, id DESC',
  oldest: 'created_at ASC, id ASC',
  updated: 'updated_at DESC, id DESC',
};

function buildPublicListWhere(filters) {
  const clauses = ['is_public = 1'];
  const bindings = [];

  if (filters.status) {
    clauses.push('status = ?');
    bindings.push(filters.status);
  }

  if (filters.category) {
    clauses.push('category = ?');
    bindings.push(filters.category);
  }

  if (filters.q) {
    clauses.push("(content LIKE ? OR COALESCE(public_summary, '') LIKE ?)");
    const keyword = `%${filters.q}%`;
    bindings.push(keyword, keyword);
  }

  return {
    whereSql: clauses.join(' AND '),
    bindings,
  };
}

export async function onRequest(context) {
  const { request, env } = context;
  const url = new URL(request.url);
  const corsHeaders = createPublicCorsHeaders(ALLOWED_METHODS);

  if (request.method === 'OPTIONS') {
    return createOptionsResponse(corsHeaders);
  }

  if (request.method !== 'GET' && request.method !== 'POST') {
    return methodNotAllowedResponse(corsHeaders, ALLOWED_METHODS);
  }

  try {
    if (request.method === 'GET') {
      const rateLimitResponse = await checkRateLimit(env, request, 'getIssues', corsHeaders);
      if (rateLimitResponse) {
        return rateLimitResponse;
      }

      const parsedQuery = publicIssueListQuerySchema.safeParse(Object.fromEntries(url.searchParams.entries()));
      if (!parsedQuery.success) {
        return errorResponse(formatZodError(parsedQuery.error), { status: 400, headers: corsHeaders });
      }

      const { page, pageSize, status, category, q, sort } = parsedQuery.data;
      const offset = (page - 1) * pageSize;
      const { whereSql, bindings } = buildPublicListWhere({ status, category, q });
      const orderBy = PUBLIC_SORT_SQL[sort] || PUBLIC_SORT_SQL.newest;

      const totalRow = await env.DB.prepare(`SELECT COUNT(*) AS total FROM issues WHERE ${whereSql}`)
        .bind(...bindings)
        .first();
      const total = Number(totalRow?.total) || 0;

      const rows = await env.DB.prepare(`
        SELECT tracking_code, content, category, status, priority, public_summary, created_at, updated_at
        FROM issues
        WHERE ${whereSql}
        ORDER BY ${orderBy}
        LIMIT ? OFFSET ?
      `)
        .bind(...bindings, pageSize, offset)
        .all();

      return successResponse({
        items: rows.results.map(mapPublicIssue),
        pagination: createPagination(page, pageSize, total),
      }, {
        headers: {
          ...corsHeaders,
          'Cache-Control': 'public, max-age=60',
        },
      });
    }

    const rateLimitResponse = await checkRateLimit(env, request, 'postIssue', corsHeaders);
    if (rateLimitResponse) {
      return rateLimitResponse;
    }

    const parsedBody = await parseJsonBody(request, corsHeaders);
    if (!parsedBody.ok) {
      return parsedBody.response;
    }

    const validationResult = issueSchema.safeParse(parsedBody.data);
    if (!validationResult.success) {
      return errorResponse(formatZodError(validationResult.error), { status: 400, headers: corsHeaders });
    }

    const payload = validationResult.data;
    const now = new Date().toISOString();
    const trackingCode = await generateUniqueTrackingCodeForDb(env.DB);
    const insertResult = await env.DB.prepare(`
      INSERT INTO issues (
        tracking_code, name, student_id, content, is_public, is_reported,
        category, priority, status, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `)
      .bind(
        trackingCode,
        payload.name,
        payload.studentId,
        payload.content,
        payload.isPublic ? 1 : 0,
        payload.isReported ? 1 : 0,
        payload.category,
        'normal',
        'submitted',
        now,
        now,
      )
      .run();

    const issueId = Number(insertResult.meta?.last_row_id);

    await env.DB.prepare(`
      INSERT INTO issue_updates (
        issue_id, update_type, old_value, new_value, content, is_public, created_by, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `)
      .bind(issueId, 'status_change', null, 'submitted', null, 0, 'system', now)
      .run();

    await recordAdminAction(env.DB, {
      actionType: 'issue_created',
      targetId: issueId,
      details: {
        trackingCode,
        category: payload.category,
        isPublic: payload.isPublic,
        isReported: payload.isReported,
      },
      performedBy: 'system',
      ipAddress: getClientIP(request),
      performedAt: now,
    });

    return successResponse({
      trackingCode,
      status: 'submitted',
      createdAt: now,
      message: '问题已提交，请保存追踪编号以便查询',
    }, {
      status: 201,
      headers: corsHeaders,
    });
  } catch (error) {
    console.error('Public issues route failed:', error);
    const message = env.ENVIRONMENT === 'production' ? '服务器内部错误' : `服务器错误: ${error.message}`;
    return errorResponse(message, { status: 500, headers: corsHeaders });
  }
}
