import { createForbiddenOriginResponse, authorizeAdminRequest } from '../../../../src/shared/auth.js';
import { getAdminCorsPolicy } from '../../../../src/shared/corsConfig.js';
import { createKnowledgeActionStatement, getKnowledgeItemById, mapKnowledgeItem } from '../../../../src/shared/knowledgeData.js';
import { successResponse, errorResponse, createOptionsResponse, methodNotAllowedResponse, notFoundResponse } from '../../../../src/shared/response.js';
import { checkAdminRateLimit, getClientIP } from '../../../../src/shared/rateLimit.js';
import { parseJsonBody } from '../../../../src/shared/request.js';
import { formatZodError, knowledgeDeleteSchema, knowledgeIdSchema, knowledgePatchSchema } from '../../../../src/shared/validation.js';

const ALLOWED_METHODS = 'PATCH, DELETE, OPTIONS';

function addAssignment(assignments, bindings, columnName, value) {
  assignments.push(`${columnName} = ?`);
  bindings.push(value);
}

function trackKnowledgeChange({
  payload,
  assignments,
  bindings,
  updatedFields,
  changes,
  apiField,
  columnName,
  currentValue,
  nextValue,
  dbValue = nextValue,
}) {
  if (payload[apiField] === undefined || currentValue === nextValue) {
    return;
  }

  addAssignment(assignments, bindings, columnName, dbValue);
  updatedFields.push(apiField);
  changes[apiField] = {
    oldValue: currentValue,
    newValue: nextValue,
  };
}

async function parseRequestBody(request, headers) {
  const parsedBody = await parseJsonBody(request, headers);
  if (!parsedBody.ok) {
    return parsedBody;
  }

  return parsedBody;
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

  const authResult = authorizeAdminRequest(request, env, ALLOWED_METHODS);
  if (!authResult.ok) {
    return authResult.response;
  }

  const parsedItemId = knowledgeIdSchema.safeParse(params.id);
  if (!parsedItemId.success) {
    return errorResponse(formatZodError(parsedItemId.error), { status: 400, headers: authResult.corsHeaders });
  }

  const itemId = parsedItemId.data;

  try {
    const existingItem = await getKnowledgeItemById(env.DB, itemId);
    if (!existingItem) {
      return notFoundResponse('知识条目不存在', authResult.corsHeaders);
    }

    const parsedBody = await parseRequestBody(request, authResult.corsHeaders);
    if (!parsedBody.ok) {
      return parsedBody.response;
    }

    const schema = request.method === 'DELETE' ? knowledgeDeleteSchema : knowledgePatchSchema;
    const validationResult = schema.safeParse(parsedBody.data);
    if (!validationResult.success) {
      return errorResponse(formatZodError(validationResult.error), { status: 400, headers: authResult.corsHeaders });
    }

    const payload = validationResult.data;
    const now = new Date().toISOString();
    const ipAddress = getClientIP(request);

    if (request.method === 'DELETE') {
      const deleteResult = await env.DB.prepare('DELETE FROM knowledge_items WHERE id = ? AND updated_at = ?')
        .bind(itemId, payload.updatedAt)
        .run();

      if (Number(deleteResult?.meta?.changes) !== 1) {
        const latestItem = await getKnowledgeItemById(env.DB, itemId);
        if (!latestItem) {
          return notFoundResponse('知识条目不存在', authResult.corsHeaders);
        }

        return errorResponse('知识条目已被其他管理员更新，请刷新后重试', {
          status: 409,
          headers: authResult.corsHeaders,
        });
      }

      await createKnowledgeActionStatement(env.DB, {
        actionType: 'knowledge_deleted',
        item: existingItem,
        performedBy: authResult.actor,
        ipAddress,
        performedAt: now,
      }).run();

      return successResponse({
        id: itemId,
        deleted: true,
      }, { headers: authResult.corsHeaders });
    }

    const assignments = [];
    const bindings = [];
    const updatedFields = [];
    const changes = {};

    trackKnowledgeChange({
      payload,
      assignments,
      bindings,
      updatedFields,
      changes,
      apiField: 'title',
      columnName: 'title',
      currentValue: existingItem.title,
      nextValue: payload.title,
    });
    trackKnowledgeChange({
      payload,
      assignments,
      bindings,
      updatedFields,
      changes,
      apiField: 'tag',
      columnName: 'tag',
      currentValue: existingItem.tag,
      nextValue: payload.tag,
    });
    trackKnowledgeChange({
      payload,
      assignments,
      bindings,
      updatedFields,
      changes,
      apiField: 'content',
      columnName: 'content',
      currentValue: existingItem.content,
      nextValue: payload.content,
    });
    trackKnowledgeChange({
      payload,
      assignments,
      bindings,
      updatedFields,
      changes,
      apiField: 'sortOrder',
      columnName: 'sort_order',
      currentValue: Number(existingItem.sort_order) || 0,
      nextValue: payload.sortOrder,
    });
    trackKnowledgeChange({
      payload,
      assignments,
      bindings,
      updatedFields,
      changes,
      apiField: 'isEnabled',
      columnName: 'is_enabled',
      currentValue: Boolean(Number(existingItem.is_enabled)),
      nextValue: payload.isEnabled,
      dbValue: payload.isEnabled === undefined ? undefined : (payload.isEnabled ? 1 : 0),
    });

    if (updatedFields.length === 0) {
      return successResponse({
        item: mapKnowledgeItem(existingItem),
        updatedFields: [],
      }, { headers: authResult.corsHeaders });
    }

    addAssignment(assignments, bindings, 'updated_at', now);
    const updateResult = await env.DB.prepare(`
      UPDATE knowledge_items
      SET ${assignments.join(', ')}
      WHERE id = ? AND updated_at = ?
    `)
      .bind(...bindings, itemId, payload.updatedAt)
      .run();

    if (Number(updateResult?.meta?.changes) !== 1) {
      const latestItem = await getKnowledgeItemById(env.DB, itemId);
      if (!latestItem) {
        return notFoundResponse('知识条目不存在', authResult.corsHeaders);
      }

      return errorResponse('知识条目已被其他管理员更新，请刷新后重试', {
        status: 409,
        headers: authResult.corsHeaders,
      });
    }

    const updatedItem = await getKnowledgeItemById(env.DB, itemId);
    await createKnowledgeActionStatement(env.DB, {
      actionType: 'knowledge_updated',
      item: updatedItem,
      details: { changes },
      performedBy: authResult.actor,
      ipAddress,
      performedAt: now,
    }).run();

    return successResponse({
      item: mapKnowledgeItem(updatedItem),
      updatedFields,
    }, { headers: authResult.corsHeaders });
  } catch (error) {
    console.error('Admin knowledge item route failed:', error);
    const message = env.ENVIRONMENT === 'production' ? '服务器内部错误' : `数据库错误: ${error.message}`;
    return errorResponse(message, { status: 500, headers: authResult.corsHeaders });
  }
}
