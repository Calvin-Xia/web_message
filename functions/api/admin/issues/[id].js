import { canTransitionStatus } from '../../../../src/shared/constants.js';
import { getAdminCorsPolicy, createForbiddenOriginResponse, authorizeAdminRequest } from '../../../../src/shared/auth.js';
import {
  getIssueById,
  mapAdminAction,
  mapAdminIssue,
  mapInternalNote,
  mapIssueUpdate,
  recordAdminAction,
} from '../../../../src/shared/issueData.js';
import { successResponse, errorResponse, createOptionsResponse, methodNotAllowedResponse, notFoundResponse } from '../../../../src/shared/response.js';
import { adminIssuePatchSchema, formatZodError, issueIdSchema } from '../../../../src/shared/validation.js';
import { getClientIP } from '../../../../src/shared/rateLimit.js';
import { parseJsonBody } from '../../../../src/shared/request.js';

const ALLOWED_METHODS = 'GET, PATCH, OPTIONS';

async function loadIssueDetail(db, issueId) {
  const issue = await getIssueById(db, issueId);
  if (!issue) {
    return null;
  }

  const [updates, notes, history] = await Promise.all([
    db.prepare('SELECT * FROM issue_updates WHERE issue_id = ? ORDER BY created_at ASC, id ASC').bind(issueId).all(),
    db.prepare('SELECT * FROM issue_internal_notes WHERE issue_id = ? ORDER BY created_at DESC, id DESC').bind(issueId).all(),
    db.prepare(`
      SELECT *
      FROM admin_actions
      WHERE target_type = 'issue' AND target_id = ?
      ORDER BY performed_at DESC, id DESC
    `).bind(issueId).all(),
  ]);

  return {
    ...mapAdminIssue(issue),
    updates: updates.results.map(mapIssueUpdate),
    internalNotes: notes.results.map(mapInternalNote),
    history: history.results.map(mapAdminAction),
  };
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

  if (request.method !== 'GET' && request.method !== 'PATCH') {
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
    if (request.method === 'GET') {
      const detail = await loadIssueDetail(env.DB, issueId);
      if (!detail) {
        return notFoundResponse('问题不存在', authResult.corsHeaders);
      }

      return successResponse(detail, { headers: authResult.corsHeaders });
    }

    const existingIssue = await getIssueById(env.DB, issueId);
    if (!existingIssue) {
      return notFoundResponse('问题不存在', authResult.corsHeaders);
    }

    const parsedBody = await parseJsonBody(request, authResult.corsHeaders);
    if (!parsedBody.ok) {
      return parsedBody.response;
    }

    const validationResult = adminIssuePatchSchema.safeParse(parsedBody.data);
    if (!validationResult.success) {
      return errorResponse(formatZodError(validationResult.error), { status: 400, headers: authResult.corsHeaders });
    }

    const payload = validationResult.data;
    if (payload.status && !canTransitionStatus(existingIssue.status, payload.status)) {
      return errorResponse('状态流转不合法', { status: 400, headers: authResult.corsHeaders });
    }

    const now = new Date().toISOString();
    const updatedFields = [];
    const fieldChanges = {};
    let statusChange = null;
    const assignments = [];
    const bindings = [];

    const addFieldChange = (apiField, columnName, currentValue, nextValue, dbValue = nextValue) => {
      if (currentValue === nextValue) {
        return;
      }

      assignments.push(`${columnName} = ?`);
      bindings.push(dbValue);
      updatedFields.push(apiField);
      fieldChanges[apiField] = {
        oldValue: currentValue,
        newValue: nextValue,
      };
    };

    if (payload.category !== undefined) {
      addFieldChange('category', 'category', existingIssue.category, payload.category);
    }

    if (payload.priority !== undefined) {
      addFieldChange('priority', 'priority', existingIssue.priority, payload.priority);
    }

    if (payload.assignedTo !== undefined) {
      addFieldChange('assignedTo', 'assigned_to', existingIssue.assigned_to ?? null, payload.assignedTo, payload.assignedTo);
    }

    if (payload.publicSummary !== undefined) {
      addFieldChange('publicSummary', 'public_summary', existingIssue.public_summary ?? null, payload.publicSummary, payload.publicSummary);
    }

    if (payload.isPublic !== undefined) {
      const currentIsPublic = Boolean(existingIssue.is_public);
      addFieldChange('isPublic', 'is_public', currentIsPublic, payload.isPublic, payload.isPublic ? 1 : 0);
    }

    if (payload.status !== undefined && payload.status !== existingIssue.status) {
      assignments.push('status = ?');
      bindings.push(payload.status);
      updatedFields.push('status');
      statusChange = {
        oldValue: existingIssue.status,
        newValue: payload.status,
      };

      if (payload.status === 'resolved') {
        assignments.push('resolved_at = ?');
        bindings.push(now);
      } else if (existingIssue.status === 'resolved' && payload.status === 'in_progress') {
        assignments.push('resolved_at = ?');
        bindings.push(null);
      }
    }

    if (updatedFields.length === 0) {
      return successResponse({
        id: issueId,
        trackingCode: existingIssue.tracking_code,
        updatedFields: [],
        updatedAt: existingIssue.updated_at,
      }, { headers: authResult.corsHeaders });
    }

    if (!existingIssue.first_response_at) {
      assignments.push('first_response_at = ?');
      bindings.push(now);
    }

    assignments.push('updated_at = ?');
    bindings.push(now);

    await env.DB.prepare(`UPDATE issues SET ${assignments.join(', ')} WHERE id = ?`)
      .bind(...bindings, issueId)
      .run();

    if (statusChange) {
      await env.DB.prepare(`
        INSERT INTO issue_updates (issue_id, update_type, old_value, new_value, content, is_public, created_by, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `)
        .bind(issueId, 'status_change', statusChange.oldValue, statusChange.newValue, null, 1, authResult.actor, now)
        .run();

      await recordAdminAction(env.DB, {
        actionType: 'status_update',
        targetId: issueId,
        details: {
          trackingCode: existingIssue.tracking_code,
          ...statusChange,
        },
        performedBy: authResult.actor,
        ipAddress: getClientIP(request),
        performedAt: now,
      });
    }

    const nonStatusChanges = Object.fromEntries(
      Object.entries(fieldChanges).filter(([key]) => key !== 'status')
    );

    if (Object.keys(nonStatusChanges).length > 0) {
      await recordAdminAction(env.DB, {
        actionType: 'field_edit',
        targetId: issueId,
        details: {
          trackingCode: existingIssue.tracking_code,
          changes: nonStatusChanges,
        },
        performedBy: authResult.actor,
        ipAddress: getClientIP(request),
        performedAt: now,
      });
    }

    return successResponse({
      id: issueId,
      trackingCode: existingIssue.tracking_code,
      updatedFields,
      updatedAt: now,
    }, { headers: authResult.corsHeaders });
  } catch (error) {
    console.error('Admin issue detail route failed:', error);
    const message = env.ENVIRONMENT === 'production' ? '服务器内部错误' : `数据库错误: ${error.message}`;
    return errorResponse(message, { status: 500, headers: authResult.corsHeaders });
  }
}
