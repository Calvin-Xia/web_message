import {
  authorizeAdminRequest,
  createForbiddenOriginResponse,
  requireAdminRole,
} from '../../../../src/shared/auth.js';
import { getAdminCorsPolicy } from '../../../../src/shared/corsConfig.js';
import { getAdminUserById, mapAdminUser } from '../../../../src/shared/adminUsers.js';
import { createAdminActionStatement } from '../../../../src/shared/issueData.js';
import { parseJsonBody } from '../../../../src/shared/request.js';
import { checkAdminRateLimit, getClientIP } from '../../../../src/shared/rateLimit.js';
import { createOptionsResponse, errorResponse, methodNotAllowedResponse, notFoundResponse, successResponse } from '../../../../src/shared/response.js';
import { formatZodError, updateUserSchema } from '../../../../src/shared/validation.js';

const ALLOWED_METHODS = 'PATCH, DELETE, OPTIONS';

function parseUserId(value) {
  const userId = Number(value);
  return Number.isInteger(userId) && userId > 0 ? userId : null;
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

  const userId = parseUserId(params.id);
  if (!userId) {
    return errorResponse('用户 ID 无效', { status: 400, headers: authResult.corsHeaders });
  }

  try {
    const existingUser = await getAdminUserById(env.DB, userId);
    if (!existingUser) {
      return notFoundResponse('用户不存在', authResult.corsHeaders);
    }

    const now = new Date().toISOString();

    if (request.method === 'DELETE') {
      if (authResult.user?.id === userId) {
        return errorResponse('不能删除当前登录用户', { status: 400, headers: authResult.corsHeaders });
      }

      await env.DB.batch([
        env.DB.prepare('UPDATE admin_users SET is_enabled = ?, updated_at = ? WHERE id = ?')
          .bind(0, now, userId),
        createAdminActionStatement(env.DB, {
          actionType: 'user_disabled',
          targetType: 'admin_user',
          targetId: userId,
          details: { username: existingUser.username },
          performedBy: authResult.actor,
          performedAt: now,
          ipAddress: getClientIP(request),
        }),
      ]);

      return successResponse({ message: '用户已禁用' }, { headers: authResult.corsHeaders });
    }

    const parsedBody = await parseJsonBody(request, authResult.corsHeaders);
    if (!parsedBody.ok) {
      return parsedBody.response;
    }

    const validationResult = updateUserSchema.safeParse(parsedBody.data);
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

    trackChange('displayName', 'display_name', existingUser.display_name, payload.displayName);
    trackChange('role', 'role', existingUser.role, payload.role);
    trackChange('isEnabled', 'is_enabled', Number(existingUser.is_enabled) === 1, payload.isEnabled, payload.isEnabled ? 1 : 0);

    if (assignments.length === 0) {
      return successResponse(mapAdminUser(existingUser), { headers: authResult.corsHeaders });
    }

    assignments.push('updated_at = ?');
    bindings.push(now);

    await env.DB.batch([
      env.DB.prepare(`UPDATE admin_users SET ${assignments.join(', ')} WHERE id = ?`)
        .bind(...bindings, userId),
      createAdminActionStatement(env.DB, {
        actionType: 'user_updated',
        targetType: 'admin_user',
        targetId: userId,
        details: {
          username: existingUser.username,
          changes,
        },
        performedBy: authResult.actor,
        performedAt: now,
        ipAddress: getClientIP(request),
      }),
    ]);

    const updatedUser = await getAdminUserById(env.DB, userId);
    return successResponse(mapAdminUser(updatedUser), { headers: authResult.corsHeaders });
  } catch (error) {
    console.error('Admin user detail route failed:', error);
    const message = env.ENVIRONMENT === 'production' ? '服务器内部错误' : `数据库错误: ${error.message}`;
    return errorResponse(message, { status: 500, headers: authResult.corsHeaders });
  }
}
