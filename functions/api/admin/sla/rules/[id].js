import {
  authorizeAdminRequest,
  createForbiddenOriginResponse,
  requireAdminRole,
} from '../../../../../src/shared/auth.js';
import { getAdminCorsPolicy } from '../../../../../src/shared/corsConfig.js';
import { createAdminActionStatement } from '../../../../../src/shared/issueData.js';
import { mapSLARule } from '../../../../../src/shared/sla.js';
import { parseJsonBody } from '../../../../../src/shared/request.js';
import { checkAdminRateLimit, getClientIP } from '../../../../../src/shared/rateLimit.js';
import { createOptionsResponse, errorResponse, methodNotAllowedResponse, notFoundResponse, successResponse } from '../../../../../src/shared/response.js';
import { formatZodError, slaRulePatchSchema } from '../../../../../src/shared/validation.js';

const ALLOWED_METHODS = 'PATCH, OPTIONS';

function parseRuleId(value) {
  const id = Number(value);
  return Number.isInteger(id) && id > 0 ? id : null;
}

export async function onRequest(context) {
  const { request, env, params } = context;
  const origin = request.headers.get('Origin');
  const corsPolicy = getAdminCorsPolicy(origin, env, ALLOWED_METHODS);

  if (corsPolicy.hasOrigin && !corsPolicy.isOriginAllowed) {
    return createForbiddenOriginResponse(corsPolicy.headers);
  }

  if (request.method === 'OPTIONS') {
    return createOptionsResponse(corsPolicy.headers);
  }

  if (request.method !== 'PATCH') {
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

  const ruleId = parseRuleId(params.id);
  if (!ruleId) {
    return errorResponse('SLA 规则 ID 无效', { status: 400, headers: authResult.corsHeaders });
  }

  try {
    const existingRule = await env.DB.prepare('SELECT * FROM sla_rules WHERE id = ? LIMIT 1')
      .bind(ruleId)
      .first();
    if (!existingRule) {
      return notFoundResponse('SLA 规则不存在', authResult.corsHeaders);
    }

    const parsedBody = await parseJsonBody(request, authResult.corsHeaders);
    if (!parsedBody.ok) {
      return parsedBody.response;
    }

    const validationResult = slaRulePatchSchema.safeParse(parsedBody.data);
    if (!validationResult.success) {
      return errorResponse(formatZodError(validationResult.error), { status: 400, headers: authResult.corsHeaders });
    }

    const payload = validationResult.data;
    const effectiveResponseHours = payload.responseHours ?? Number(existingRule.response_hours);
    const effectiveResolutionHours = payload.resolutionHours ?? Number(existingRule.resolution_hours);
    if (effectiveResponseHours > effectiveResolutionHours) {
      return errorResponse('响应时间不能晚于解决时间', { status: 400, headers: authResult.corsHeaders });
    }

    if (payload.priority && payload.priority !== existingRule.priority) {
      const duplicateRule = await env.DB.prepare('SELECT id FROM sla_rules WHERE priority = ? LIMIT 1')
        .bind(payload.priority)
        .first();
      if (duplicateRule) {
        return errorResponse('该优先级的 SLA 规则已存在', { status: 409, headers: authResult.corsHeaders });
      }
    }

    const assignments = [];
    const bindings = [];
    const changes = {};
    const trackChange = (apiField, columnName, currentValue, nextValue, dbValue = nextValue) => {
      if (nextValue === undefined || currentValue === nextValue) {
        return;
      }

      assignments.push(`${columnName} = ?`);
      bindings.push(dbValue);
      changes[apiField] = {
        oldValue: currentValue,
        newValue: nextValue,
      };
    };

    trackChange('name', 'name', existingRule.name, payload.name);
    trackChange('priority', 'priority', existingRule.priority, payload.priority);
    trackChange('responseHours', 'response_hours', Number(existingRule.response_hours), payload.responseHours);
    trackChange('resolutionHours', 'resolution_hours', Number(existingRule.resolution_hours), payload.resolutionHours);
    trackChange('isEnabled', 'is_enabled', Number(existingRule.is_enabled) === 1, payload.isEnabled, payload.isEnabled ? 1 : 0);

    if (assignments.length === 0) {
      return successResponse(mapSLARule(existingRule), { headers: authResult.corsHeaders });
    }

    const now = new Date().toISOString();
    assignments.push('updated_at = ?');
    bindings.push(now);

    const updateResult = await env.DB.prepare(`UPDATE sla_rules SET ${assignments.join(', ')} WHERE id = ? AND updated_at = ?`)
      .bind(...bindings, ruleId, payload.updatedAt)
      .run();
    if (Number(updateResult?.meta?.changes) !== 1) {
      return errorResponse('SLA 规则已被其他管理员更新，请刷新后重试', {
        status: 409,
        headers: authResult.corsHeaders,
      });
    }

    await createAdminActionStatement(env.DB, {
      actionType: 'sla_rule_updated',
      targetType: 'sla_rule',
      targetId: ruleId,
      details: {
        priority: existingRule.priority,
        changes,
      },
      performedBy: authResult.actor,
      performedAt: now,
      ipAddress: getClientIP(request),
    }).run();

    const updatedRule = await env.DB.prepare('SELECT * FROM sla_rules WHERE id = ? LIMIT 1')
      .bind(ruleId)
      .first();
    return successResponse(mapSLARule(updatedRule), { headers: authResult.corsHeaders });
  } catch (error) {
    console.error('Admin SLA rule detail route failed:', error);
    const message = env.ENVIRONMENT === 'production' ? '服务器内部错误' : `数据库错误: ${error.message}`;
    return errorResponse(message, { status: 500, headers: authResult.corsHeaders });
  }
}
