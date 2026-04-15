import { checkRateLimit } from '../../../src/shared/rateLimit.js';
import { getIssueByTrackingCode, toBoolean } from '../../../src/shared/issueData.js';
import { successResponse, errorResponse, createOptionsResponse, createPublicCorsHeaders, methodNotAllowedResponse, notFoundResponse } from '../../../src/shared/response.js';
import { trackingCodeSchema, formatZodError } from '../../../src/shared/validation.js';

const ALLOWED_METHODS = 'GET, OPTIONS';

function mapPublicUpdate(row) {
  const update = {
    type: row.update_type,
    isPublic: toBoolean(row.is_public),
    createdAt: row.created_at,
  };

  if (row.new_value) {
    update.newValue = row.new_value;
  }

  if (row.content) {
    update.content = row.content;
  }

  return update;
}

export async function onRequest(context) {
  const { request, env, params } = context;
  const corsHeaders = createPublicCorsHeaders(ALLOWED_METHODS);

  if (request.method === 'OPTIONS') {
    return createOptionsResponse(corsHeaders);
  }

  if (request.method !== 'GET') {
    return methodNotAllowedResponse(corsHeaders, ALLOWED_METHODS);
  }

  try {
    const rateLimitResponse = await checkRateLimit(env, request, 'getIssues', corsHeaders);
    if (rateLimitResponse) {
      return rateLimitResponse;
    }

    const parsedCode = trackingCodeSchema.safeParse(params.trackingCode);
    if (!parsedCode.success) {
      return errorResponse(formatZodError(parsedCode.error), { status: 400, headers: corsHeaders });
    }

    const issue = await getIssueByTrackingCode(env.DB, parsedCode.data);
    if (!issue) {
      return notFoundResponse('追踪编号不存在', corsHeaders);
    }

    const updates = await env.DB.prepare(`
      SELECT update_type, old_value, new_value, content, is_public, created_at, id
      FROM issue_updates
      WHERE issue_id = ?
        AND (update_type = 'status_change' OR is_public = 1)
        AND NOT (update_type = 'status_change' AND old_value IS NULL AND new_value = 'submitted')
      ORDER BY created_at ASC, id ASC
    `)
      .bind(issue.id)
      .all();

    return successResponse({
      trackingCode: issue.tracking_code,
      content: issue.content,
      category: issue.category,
      distressType: issue.distress_type ?? null,
      sceneTag: issue.scene_tag ?? null,
      status: issue.status,
      priority: issue.priority,
      publicSummary: issue.public_summary,
      updates: updates.results.map(mapPublicUpdate),
      createdAt: issue.created_at,
      updatedAt: issue.updated_at,
    }, {
      headers: {
        ...corsHeaders,
        'Cache-Control': 'private, no-store',
      },
    });
  } catch (error) {
    console.error('Issue tracking route failed:', error);
    const message = env.ENVIRONMENT === 'production' ? '服务器内部错误' : `服务器错误: ${error.message}`;
    return errorResponse(message, { status: 500, headers: corsHeaders });
  }
}
