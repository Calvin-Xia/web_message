import { getAdminCorsPolicy, createForbiddenOriginResponse, authorizeAdminRequest } from '../../../src/shared/auth.js';
import { createPagination, mapAdminAction } from '../../../src/shared/issueData.js';
import { successResponse, errorResponse, createOptionsResponse, methodNotAllowedResponse } from '../../../src/shared/response.js';
import { adminActionListQuerySchema, formatZodError } from '../../../src/shared/validation.js';

const ALLOWED_METHODS = 'GET, OPTIONS';

function buildAuditWhere(filters) {
  const clauses = [];
  const bindings = [];

  if (filters.targetId) {
    clauses.push('target_id = ?');
    bindings.push(filters.targetId);
  }

  if (filters.actionType) {
    clauses.push('action_type = ?');
    bindings.push(filters.actionType);
  }

  return {
    whereSql: clauses.length > 0 ? `WHERE ${clauses.join(' AND ')}` : '',
    bindings,
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

  const authResult = authorizeAdminRequest(request, env, ALLOWED_METHODS);
  if (!authResult.ok) {
    return authResult.response;
  }

  try {
    const url = new URL(request.url);
    const parsedQuery = adminActionListQuerySchema.safeParse(Object.fromEntries(url.searchParams.entries()));
    if (!parsedQuery.success) {
      return errorResponse(formatZodError(parsedQuery.error), { status: 400, headers: authResult.corsHeaders });
    }

    const { page, pageSize, targetId, actionType } = parsedQuery.data;
    const offset = (page - 1) * pageSize;
    const { whereSql, bindings } = buildAuditWhere({ targetId, actionType });

    const totalRow = await env.DB.prepare(`SELECT COUNT(*) AS total FROM admin_actions ${whereSql}`)
      .bind(...bindings)
      .first();
    const total = Number(totalRow?.total) || 0;

    const rows = await env.DB.prepare(`
      SELECT *
      FROM admin_actions
      ${whereSql}
      ORDER BY performed_at DESC, id DESC
      LIMIT ? OFFSET ?
    `)
      .bind(...bindings, pageSize, offset)
      .all();

    return successResponse({
      items: rows.results.map(mapAdminAction),
      pagination: createPagination(page, pageSize, total),
    }, {
      headers: authResult.corsHeaders,
    });
  } catch (error) {
    console.error('Admin actions route failed:', error);
    const message = env.ENVIRONMENT === 'production' ? '服务器内部错误' : `数据库错误: ${error.message}`;
    return errorResponse(message, { status: 500, headers: authResult.corsHeaders });
  }
}
