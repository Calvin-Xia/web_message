import {
  authorizeAdminRequest,
  createForbiddenOriginResponse,
  requireAdminRole,
} from '../../../../src/shared/auth.js';
import { getAdminCorsPolicy } from '../../../../src/shared/corsConfig.js';
import { mapAssignRule } from '../../../../src/shared/assignment.js';
import { createAdminActionStatement } from '../../../../src/shared/issueData.js';
import { parseJsonBody } from '../../../../src/shared/request.js';
import { checkAdminRateLimit, getClientIP } from '../../../../src/shared/rateLimit.js';
import { createOptionsResponse, errorResponse, methodNotAllowedResponse, notFoundResponse, successResponse } from '../../../../src/shared/response.js';
import { assignRulePatchSchema, formatZodError } from '../../../../src/shared/validation.js';

const ALLOWED_METHODS = 'PATCH, DELETE, OPTIONS';

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

  if (request.method !== 'PATCH' && request.method !== 'DELETE') {
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
    return errorResponse('自动分配规则 ID 无效', { status: 400, headers: authResult.corsHeaders });
  }

  try {
    const existingRule = await env.DB.prepare('SELECT * FROM assign_rules WHERE id = ? LIMIT 1')
      .bind(ruleId)
      .first();
    if (!existingRule) {
      return notFoundResponse('自动分配规则不存在', authResult.corsHeaders);
    }

    const now = new Date().toISOString();

    if (request.method === 'DELETE') {
      await env.DB.batch([
        env.DB.prepare('DELETE FROM assign_rules WHERE id = ?')
          .bind(ruleId),
        createAdminActionStatement(env.DB, {
          actionType: 'assign_rule_deleted',
          targetType: 'assign_rule',
          targetId: ruleId,
          details: {
            name: existingRule.name,
            assignTo: existingRule.assign_to,
          },
          performedBy: authResult.actor,
          performedAt: now,
          ipAddress: getClientIP(request),
        }),
      ]);

      return successResponse({ message: '自动分配规则已删除' }, { headers: authResult.corsHeaders });
    }

    const parsedBody = await parseJsonBody(request, authResult.corsHeaders);
    if (!parsedBody.ok) {
      return parsedBody.response;
    }

    const validationResult = assignRulePatchSchema.safeParse(parsedBody.data);
    if (!validationResult.success) {
      return errorResponse(formatZodError(validationResult.error), { status: 400, headers: authResult.corsHeaders });
    }

    const payload = validationResult.data;
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
    trackChange('category', 'category', existingRule.category ?? null, payload.category);
    trackChange('assignTo', 'assign_to', existingRule.assign_to, payload.assignTo);
    trackChange('priority', 'priority', Number(existingRule.priority), payload.priority);
    trackChange('isEnabled', 'is_enabled', Number(existingRule.is_enabled) === 1, payload.isEnabled, payload.isEnabled ? 1 : 0);
    if (payload.keywords !== undefined) {
      const currentKeywords = JSON.stringify(mapAssignRule(existingRule).keywords);
      const nextKeywords = JSON.stringify(payload.keywords);
      trackChange('keywords', 'keywords', currentKeywords, nextKeywords, nextKeywords);
    }

    if (assignments.length === 0) {
      return successResponse(mapAssignRule(existingRule), { headers: authResult.corsHeaders });
    }

    assignments.push('updated_at = ?');
    bindings.push(now);

    const updateResult = await env.DB.prepare(`UPDATE assign_rules SET ${assignments.join(', ')} WHERE id = ? AND updated_at = ?`)
      .bind(...bindings, ruleId, payload.updatedAt)
      .run();
    if (Number(updateResult?.meta?.changes) !== 1) {
      return errorResponse('自动分配规则已被其他管理员更新，请刷新后重试', {
        status: 409,
        headers: authResult.corsHeaders,
      });
    }

    await createAdminActionStatement(env.DB, {
      actionType: 'assign_rule_updated',
      targetType: 'assign_rule',
      targetId: ruleId,
      details: {
        name: existingRule.name,
        changes,
      },
      performedBy: authResult.actor,
      performedAt: now,
      ipAddress: getClientIP(request),
    }).run();

    const updatedRule = await env.DB.prepare('SELECT * FROM assign_rules WHERE id = ? LIMIT 1')
      .bind(ruleId)
      .first();
    return successResponse(mapAssignRule(updatedRule), { headers: authResult.corsHeaders });
  } catch (error) {
    console.error('Admin assign rule detail route failed:', error);
    const message = env.ENVIRONMENT === 'production' ? '服务器内部错误' : `数据库错误: ${error.message}`;
    return errorResponse(message, { status: 500, headers: authResult.corsHeaders });
  }
}
