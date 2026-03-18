import { canTransitionStatus } from '../../../../src/shared/constants.js';
import { getAdminCorsPolicy, createForbiddenOriginResponse, authorizeAdminRequest } from '../../../../src/shared/auth.js';
import {
  createNotificationIdempotencyKey,
  isNotifiableStatus,
  sendIssueStatusNotification,
  shouldNotifyIssue,
} from '../../../../src/shared/email.js';
import {
  createAdminActionStatement,
  getIssueById,
  mapAdminAction,
  mapAdminIssue,
  mapInternalNote,
  mapIssueUpdate,
  toBoolean,
} from '../../../../src/shared/issueData.js';
import { successResponse, errorResponse, createOptionsResponse, methodNotAllowedResponse, notFoundResponse } from '../../../../src/shared/response.js';
import { adminIssuePatchSchema, formatZodError, issueIdSchema } from '../../../../src/shared/validation.js';
import { checkAdminRateLimit, getClientIP } from '../../../../src/shared/rateLimit.js';
import { parseJsonBody } from '../../../../src/shared/request.js';

const ALLOWED_METHODS = 'GET, PATCH, OPTIONS';

function queueBackgroundTask(context, promise) {
  if (typeof context.waitUntil === 'function') {
    context.waitUntil(promise);
    return;
  }

  void promise;
}

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
    updates: (updates.results || []).map(mapIssueUpdate),
    internalNotes: (notes.results || []).map(mapInternalNote),
    history: (history.results || []).map(mapAdminAction),
  };
}

function createConditionalAdminActionStatement(db, {
  issueId,
  expectedUpdatedAt,
  actionType,
  details,
  performedBy,
  ipAddress,
  performedAt,
}) {
  return db.prepare(`
    INSERT INTO admin_actions (
      action_type, target_type, target_id, details, performed_by, performed_at, ip_address
    )
    SELECT ?, ?, id, ?, ?, ?, ?
    FROM issues
    WHERE id = ? AND updated_at = ?
  `)
    .bind(
      actionType,
      'issue',
      JSON.stringify(details),
      performedBy,
      performedAt,
      ipAddress,
      issueId,
      expectedUpdatedAt,
    );
}

function createConditionalStatusUpdateStatement(db, {
  issueId,
  expectedUpdatedAt,
  oldValue,
  newValue,
  createdBy,
  createdAt,
}) {
  return db.prepare(`
    INSERT INTO issue_updates (
      issue_id, update_type, old_value, new_value, content, is_public, created_by, created_at
    )
    SELECT id, ?, ?, ?, ?, ?, ?, ?
    FROM issues
    WHERE id = ? AND updated_at = ?
  `)
    .bind(
      'status_change',
      oldValue,
      newValue,
      null,
      1,
      createdBy,
      createdAt,
      issueId,
      expectedUpdatedAt,
    );
}

function logIllegalTransitionAuditFailure(context, error) {
  console.error('Failed to record illegal transition attempt', {
    ...context,
    errorMessage: error instanceof Error ? error.message : String(error),
  });
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

  const rateLimitResponse = await checkAdminRateLimit(env, request, corsPolicy.headers);
  if (rateLimitResponse) {
    return rateLimitResponse;
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
    const now = new Date().toISOString();
    const ipAddress = getClientIP(request);
    const expectedUpdatedAt = payload.updatedAt;

    if (payload.status && !canTransitionStatus(existingIssue.status, payload.status)) {
      try {
        await createAdminActionStatement(env.DB, {
          actionType: 'illegal_transition_attempt',
          targetId: issueId,
          details: {
            trackingCode: existingIssue.tracking_code,
            currentStatus: existingIssue.status,
            requestedStatus: payload.status,
          },
          performedBy: authResult.actor,
          ipAddress,
          performedAt: now,
        }).run();
      } catch (auditError) {
        logIllegalTransitionAuditFailure({
          issueId,
          trackingCode: existingIssue.tracking_code,
          currentStatus: existingIssue.status,
          requestedStatus: payload.status,
          actor: authResult.actor,
          ipAddress,
        }, auditError);
      }

      return errorResponse('状态流转不合法', { status: 400, headers: authResult.corsHeaders });
    }

    const updatedFields = [];
    const fieldChanges = {};
    const assignments = [];
    const bindings = [];

    const assignColumn = (columnName, value) => {
      assignments.push(`${columnName} = ?`);
      bindings.push(value);
    };

    const trackFieldChange = (apiField, columnName, currentValue, nextValue, {
      dbValue = nextValue,
      onChange,
    } = {}) => {
      if (nextValue === undefined || currentValue === nextValue) {
        return;
      }

      assignColumn(columnName, dbValue);
      updatedFields.push(apiField);
      fieldChanges[apiField] = {
        oldValue: currentValue,
        newValue: nextValue,
      };
      onChange?.({ currentValue, nextValue });
    };

    trackFieldChange('category', 'category', existingIssue.category, payload.category);
    trackFieldChange('priority', 'priority', existingIssue.priority, payload.priority);
    trackFieldChange('assignedTo', 'assigned_to', existingIssue.assigned_to ?? null, payload.assignedTo);
    trackFieldChange('publicSummary', 'public_summary', existingIssue.public_summary ?? null, payload.publicSummary);
    trackFieldChange('isPublic', 'is_public', toBoolean(existingIssue.is_public), payload.isPublic, {
      dbValue: payload.isPublic === undefined ? undefined : (payload.isPublic ? 1 : 0),
    });
    trackFieldChange('status', 'status', existingIssue.status, payload.status, {
      onChange: ({ currentValue, nextValue }) => {
        if (nextValue === 'resolved') {
          assignColumn('resolved_at', now);
        } else if (currentValue === 'resolved' && nextValue === 'in_progress') {
          assignColumn('resolved_at', null);
        }
      },
    });

    const statusChange = fieldChanges.status ?? null;

    if (updatedFields.length === 0) {
      return successResponse({
        id: issueId,
        trackingCode: existingIssue.tracking_code,
        updatedFields: [],
        updatedAt: existingIssue.updated_at,
      }, { headers: authResult.corsHeaders });
    }

    if (!existingIssue.first_response_at) {
      assignColumn('first_response_at', now);
    }

    assignColumn('updated_at', now);

    const nonStatusChanges = Object.fromEntries(
      Object.entries(fieldChanges).filter(([key]) => key !== 'status')
    );

    const statements = [
      env.DB.prepare(`UPDATE issues SET ${assignments.join(', ')} WHERE id = ? AND updated_at = ?`)
        .bind(...bindings, issueId, expectedUpdatedAt),
    ];

    if (statusChange) {
      statements.push(
        createConditionalStatusUpdateStatement(env.DB, {
          issueId,
          expectedUpdatedAt: now,
          oldValue: statusChange.oldValue,
          newValue: statusChange.newValue,
          createdBy: authResult.actor,
          createdAt: now,
        }),
        createConditionalAdminActionStatement(env.DB, {
          issueId,
          expectedUpdatedAt: now,
          actionType: 'status_update',
          details: {
            trackingCode: existingIssue.tracking_code,
            ...statusChange,
          },
          performedBy: authResult.actor,
          ipAddress,
          performedAt: now,
        }),
      );
    }

    if (Object.keys(nonStatusChanges).length > 0) {
      statements.push(createConditionalAdminActionStatement(env.DB, {
        issueId,
        expectedUpdatedAt: now,
        actionType: 'field_edit',
        details: {
          trackingCode: existingIssue.tracking_code,
          changes: nonStatusChanges,
        },
        performedBy: authResult.actor,
        ipAddress,
        performedAt: now,
      }));
    }

    const [updateResult] = await env.DB.batch(statements);
    if (Number(updateResult?.meta?.changes) !== 1) {
      const latestIssue = await getIssueById(env.DB, issueId);
      if (!latestIssue) {
        return notFoundResponse('问题不存在', authResult.corsHeaders);
      }

      return errorResponse('问题已被其他管理员更新，请刷新后重试', {
        status: 409,
        headers: authResult.corsHeaders,
      });
    }

    if (statusChange && isNotifiableStatus(statusChange.newValue)) {
      const notificationIssue = {
        ...existingIssue,
        status: statusChange.newValue,
        public_summary: payload.publicSummary ?? existingIssue.public_summary,
        updated_at: now,
      };
      if (shouldNotifyIssue(notificationIssue)) {
        const idempotencyKey = createNotificationIdempotencyKey(
          issueId,
          `status-${statusChange.newValue}`,
          now,
        );

        queueBackgroundTask(context, (async () => {
          const result = await sendIssueStatusNotification({
            env,
            requestUrl: request.url,
            issue: notificationIssue,
            status: statusChange.newValue,
            idempotencyKey,
          });

          if (!result.success && !result.skipped) {
            console.error('Issue status notification failed:', {
              issueId,
              trackingCode: existingIssue.tracking_code,
              status: statusChange.newValue,
              error: result.error,
              responseStatus: result.status ?? null,
            });
          }
        })());
      }
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


