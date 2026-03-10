import { getAdminCorsPolicy, createForbiddenOriginResponse, authorizeAdminRequest } from '../../../../../src/shared/auth.js';
import { getIssueById, mapInternalNote, recordAdminAction } from '../../../../../src/shared/issueData.js';
import { successResponse, errorResponse, createOptionsResponse, methodNotAllowedResponse, notFoundResponse } from '../../../../../src/shared/response.js';
import { formatZodError, issueIdSchema, noteSchema } from '../../../../../src/shared/validation.js';
import { getClientIP } from '../../../../../src/shared/rateLimit.js';
import { parseJsonBody } from '../../../../../src/shared/request.js';

const ALLOWED_METHODS = 'POST, OPTIONS';

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

  if (request.method !== 'POST') {
    return methodNotAllowedResponse(corsPolicy.headers, ALLOWED_METHODS);
  }

  const authResult = authorizeAdminRequest(request, env, ALLOWED_METHODS);
  if (!authResult.ok) {
    return authResult.response;
  }

  const parsedIssueId = issueIdSchema.safeParse(params.id);
  if (!parsedIssueId.success) {
    return errorResponse(formatZodError(parsedIssueId.error), { status: 400, headers: authResult.corsHeaders });
  }

  const issueId = parsedIssueId.data;

  try {
    const issue = await getIssueById(env.DB, issueId);
    if (!issue) {
      return notFoundResponse('问题不存在', authResult.corsHeaders);
    }

    const parsedBody = await parseJsonBody(request, authResult.corsHeaders);
    if (!parsedBody.ok) {
      return parsedBody.response;
    }

    const validationResult = noteSchema.safeParse(parsedBody.data);
    if (!validationResult.success) {
      return errorResponse(formatZodError(validationResult.error), { status: 400, headers: authResult.corsHeaders });
    }

    const now = new Date().toISOString();
    const note = validationResult.data;
    const insertResult = await env.DB.prepare(`
      INSERT INTO issue_internal_notes (issue_id, content, created_by, created_at)
      VALUES (?, ?, ?, ?)
    `)
      .bind(issueId, note.content, authResult.actor, now)
      .run();

    if (!issue.first_response_at) {
      await env.DB.prepare('UPDATE issues SET first_response_at = ?, updated_at = ? WHERE id = ?')
        .bind(now, now, issueId)
        .run();
    } else {
      await env.DB.prepare('UPDATE issues SET updated_at = ? WHERE id = ?')
        .bind(now, issueId)
        .run();
    }

    await recordAdminAction(env.DB, {
      actionType: 'note_added',
      targetId: issueId,
      details: {
        trackingCode: issue.tracking_code,
        contentPreview: note.content.slice(0, 120),
      },
      performedBy: authResult.actor,
      ipAddress: getClientIP(request),
      performedAt: now,
    });

    return successResponse(mapInternalNote({
      id: Number(insertResult.meta?.last_row_id),
      content: note.content,
      created_by: authResult.actor,
      created_at: now,
    }), {
      status: 201,
      headers: authResult.corsHeaders,
    });
  } catch (error) {
    console.error('Admin note route failed:', error);
    const message = env.ENVIRONMENT === 'production' ? '服务器内部错误' : `数据库错误: ${error.message}`;
    return errorResponse(message, { status: 500, headers: authResult.corsHeaders });
  }
}
