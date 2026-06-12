import {
  authorizeAdminRequest,
  createForbiddenOriginResponse,
  requireAdminRole,
} from '../../../../src/shared/auth.js';
import { getAdminCorsPolicy } from '../../../../src/shared/corsConfig.js';
import { createAdminActionStatement } from '../../../../src/shared/issueData.js';
import { mapSLARule } from '../../../../src/shared/sla.js';
import { parseJsonBody } from '../../../../src/shared/request.js';
import { checkAdminRateLimit, getClientIP } from '../../../../src/shared/rateLimit.js';
import { createOptionsResponse, errorResponse, methodNotAllowedResponse, successResponse } from '../../../../src/shared/response.js';
import { formatZodError, slaRuleSchema } from '../../../../src/shared/validation.js';

const ALLOWED_METHODS = 'GET, POST, OPTIONS';

function getPriorityOrderSql() {
  return "CASE priority WHEN 'urgent' THEN 1 WHEN 'high' THEN 2 WHEN 'normal' THEN 3 WHEN 'low' THEN 4 ELSE 5 END";
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
        FROM sla_rules
        ORDER BY ${getPriorityOrderSql()}, id ASC
      `).all();

      return successResponse({
        items: (rows.results || []).map(mapSLARule),
      }, { headers: authResult.corsHeaders });
    }

    const parsedBody = await parseJsonBody(request, authResult.corsHeaders);
    if (!parsedBody.ok) {
      return parsedBody.response;
    }

    const validationResult = slaRuleSchema.safeParse(parsedBody.data);
    if (!validationResult.success) {
      return errorResponse(formatZodError(validationResult.error), { status: 400, headers: authResult.corsHeaders });
    }

    const payload = validationResult.data;
    const existing = await env.DB.prepare('SELECT id FROM sla_rules WHERE priority = ? LIMIT 1')
      .bind(payload.priority)
      .first();
    if (existing) {
      return errorResponse('该优先级的 SLA 规则已存在', { status: 409, headers: authResult.corsHeaders });
    }

    const now = new Date().toISOString();
    const insertResult = await env.DB.prepare(`
      INSERT INTO sla_rules (
        name, priority, response_hours, resolution_hours, is_enabled, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?)
    `)
      .bind(
        payload.name,
        payload.priority,
        payload.responseHours,
        payload.resolutionHours,
        payload.isEnabled ? 1 : 0,
        now,
        now,
      )
      .run();
    const ruleId = insertResult.meta.last_row_id;
    const createdRule = await env.DB.prepare('SELECT * FROM sla_rules WHERE id = ? LIMIT 1')
      .bind(ruleId)
      .first();

    await createAdminActionStatement(env.DB, {
      actionType: 'sla_rule_created',
      targetType: 'sla_rule',
      targetId: ruleId,
      details: {
        priority: payload.priority,
        responseHours: payload.responseHours,
        resolutionHours: payload.resolutionHours,
      },
      performedBy: authResult.actor,
      performedAt: now,
      ipAddress: getClientIP(request),
    }).run();

    return successResponse(mapSLARule(createdRule), {
      status: 201,
      headers: authResult.corsHeaders,
    });
  } catch (error) {
    console.error('Admin SLA rules route failed:', error);
    const message = env.ENVIRONMENT === 'production' ? '服务器内部错误' : `数据库错误: ${error.message}`;
    return errorResponse(message, { status: 500, headers: authResult.corsHeaders });
  }
}
