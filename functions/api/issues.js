import { checkRateLimit, getClientIP } from '../../src/shared/rateLimit.js';
import { parseJsonBody } from '../../src/shared/request.js';
import { createPagination, mapPublicIssue } from '../../src/shared/issueData.js';
import { successResponse, errorResponse, createOptionsResponse, createPublicCorsHeaders, methodNotAllowedResponse } from '../../src/shared/response.js';
import { insertWithUniqueTrackingCode } from '../../src/shared/tracking.js';
import { publicIssueListQuerySchema, issueSchema, formatZodError } from '../../src/shared/validation.js';
import { buildPublicIssueWhere, resolvePublicOrderBy } from '../../src/shared/issueQueries.js';

const ALLOWED_METHODS = 'GET, POST, OPTIONS';

function createIssueCreatedAuditStatement(db, trackingCode, payload, request, createdAt) {
  return db.prepare(`
    INSERT INTO admin_actions (
      action_type, target_type, target_id, details, performed_by, performed_at, ip_address
    )
    SELECT ?, ?, id, ?, ?, ?, ?
    FROM issues
    WHERE tracking_code = ?
  `)
    .bind(
      'issue_created',
      'issue',
      JSON.stringify({
        trackingCode,
        category: payload.category,
        isPublic: payload.isPublic,
        isReported: payload.isReported,
      }),
      'system',
      createdAt,
      getClientIP(request),
      trackingCode,
    );
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

      const query = parsedQuery.data;
      const offset = (query.page - 1) * query.pageSize;
      const { whereSql, bindings } = buildPublicIssueWhere(query, { tableAlias: 'issues' });
      const orderBy = resolvePublicOrderBy(query, { tableAlias: 'issues' });

      const totalRow = await env.DB.prepare(`SELECT COUNT(*) AS total FROM issues ${whereSql}`)
        .bind(...bindings)
        .first();
      const total = Number(totalRow?.total) || 0;

      const rows = await env.DB.prepare(`
        SELECT tracking_code, content, category, status, priority, public_summary, created_at, updated_at
        FROM issues
        ${whereSql}
        ORDER BY ${orderBy}
        LIMIT ? OFFSET ?
      `)
        .bind(...bindings, query.pageSize, offset)
        .all();

      return successResponse({
        items: (rows.results || []).map(mapPublicIssue),
        pagination: createPagination(query.page, query.pageSize, total),
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

    const { trackingCode } = await insertWithUniqueTrackingCode((nextTrackingCode) => (
      env.DB.batch([
        env.DB.prepare(`
          INSERT INTO issues (
            tracking_code, name, student_id, content, is_public, is_reported,
            category, priority, status, created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `)
          .bind(
            nextTrackingCode,
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
          ),
        env.DB.prepare(`
          INSERT INTO issue_updates (
            issue_id, update_type, old_value, new_value, content, is_public, created_by, created_at
          )
          SELECT id, ?, ?, ?, ?, ?, ?, ?
          FROM issues
          WHERE tracking_code = ?
        `)
          .bind('status_change', null, 'submitted', null, 0, 'system', now, nextTrackingCode),
        createIssueCreatedAuditStatement(env.DB, nextTrackingCode, payload, request, now),
      ])
    ));

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
