import {
  authorizeAdminRequest,
  createForbiddenOriginResponse,
  requireAdminRole,
} from '../../../src/shared/auth.js';
import { getAdminCorsPolicy } from '../../../src/shared/corsConfig.js';
import { mapAssignRule } from '../../../src/shared/assignment.js';
import { createAdminActionStatement } from '../../../src/shared/issueData.js';
import { parseJsonBody } from '../../../src/shared/request.js';
import { checkAdminRateLimit, getClientIP } from '../../../src/shared/rateLimit.js';
import { createOptionsResponse, errorResponse, methodNotAllowedResponse, successResponse } from '../../../src/shared/response.js';
import { assignRuleSchema, formatZodError } from '../../../src/shared/validation.js';

const ALLOWED_METHODS = 'GET, POST, OPTIONS';

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

  if (request.method !== 'GET' && request.method !== 'POST') {
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
    if (request.method === 'GET') {
      const rows = await env.DB.prepare(`
        SELECT *
        FROM assign_rules
        ORDER BY priority DESC, id ASC
      `).all();

      return successResponse({
        items: (rows.results || []).map(mapAssignRule),
      }, { headers: authResult.corsHeaders });
    }

    const parsedBody = await parseJsonBody(request, authResult.corsHeaders);
    if (!parsedBody.ok) {
      return parsedBody.response;
    }

    const validationResult = assignRuleSchema.safeParse(parsedBody.data);
    if (!validationResult.success) {
      return errorResponse(formatZodError(validationResult.error), { status: 400, headers: authResult.corsHeaders });
    }

    const payload = validationResult.data;
    const now = new Date().toISOString();
    const insertResult = await env.DB.prepare(`
      INSERT INTO assign_rules (
        name, category, keywords, assign_to, priority, is_enabled, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `)
      .bind(
        payload.name,
        payload.category,
        JSON.stringify(payload.keywords || []),
        payload.assignTo,
        payload.priority,
        payload.isEnabled ? 1 : 0,
        now,
        now,
      )
      .run();
    const ruleId = insertResult.meta.last_row_id;
    const createdRule = await env.DB.prepare('SELECT * FROM assign_rules WHERE id = ? LIMIT 1')
      .bind(ruleId)
      .first();

    await createAdminActionStatement(env.DB, {
      actionType: 'assign_rule_created',
      targetType: 'assign_rule',
      targetId: ruleId,
      details: {
        name: payload.name,
        category: payload.category,
        assignTo: payload.assignTo,
        priority: payload.priority,
      },
      performedBy: authResult.actor,
      performedAt: now,
      ipAddress: getClientIP(request),
    }).run();

    return successResponse(mapAssignRule(createdRule), {
      status: 201,
      headers: authResult.corsHeaders,
    });
  } catch (error) {
    console.error('Admin assign rules route failed:', error);
    const message = env.ENVIRONMENT === 'production' ? '服务器内部错误' : `数据库错误: ${error.message}`;
    return errorResponse(message, { status: 500, headers: authResult.corsHeaders });
  }
}
