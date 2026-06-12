import { canTransitionStatus } from '../../../../src/shared/constants.js';
import { authorizeAdminRequest, createForbiddenOriginResponse } from '../../../../src/shared/auth.js';
import { getAdminCorsPolicy } from '../../../../src/shared/corsConfig.js';
import { createAdminActionStatement, getIssueById } from '../../../../src/shared/issueData.js';
import { parseJsonBody } from '../../../../src/shared/request.js';
import { checkRateLimit, getClientIP } from '../../../../src/shared/rateLimit.js';
import { createOptionsResponse, errorResponse, methodNotAllowedResponse, successResponse } from '../../../../src/shared/response.js';
import { batchUpdateSchema, formatZodError } from '../../../../src/shared/validation.js';

const ALLOWED_METHODS = 'POST, OPTIONS';

function buildIssueUpdate({ db, issue, updates, now, updatedAt }) {
  const assignments = [];
  const bindings = [];
  const changes = {};

  const assignColumn = (columnName, value) => {
    assignments.push(`${columnName} = ?`);
    bindings.push(value);
  };

  const trackChange = (apiField, columnName, currentValue, nextValue, dbValue = nextValue) => {
    if (nextValue === undefined || currentValue === nextValue) {
      return;
    }

    assignColumn(columnName, dbValue);
    changes[apiField] = {
      oldValue: currentValue,
      newValue: nextValue,
    };
  };

  trackChange('status', 'status', issue.status, updates.status);
  trackChange('priority', 'priority', issue.priority, updates.priority);
  trackChange('assignedTo', 'assigned_to', issue.assigned_to ?? null, updates.assignedTo);

  if (updates.assignedTo !== undefined) {
    const nextAssignedAt = updates.assignedTo ? now : null;
    trackChange('assignedAt', 'assigned_at', issue.assigned_at ?? null, nextAssignedAt);
  }

  if (updates.status === 'resolved' && issue.status !== 'resolved') {
    assignColumn('resolved_at', now);
  } else if (updates.status && issue.status === 'resolved' && updates.status === 'in_progress') {
    assignColumn('resolved_at', null);
  }

  if (!issue.first_response_at) {
    assignColumn('first_response_at', now);
  }

  assignColumn('updated_at', now);

  return {
    changes,
    statement: db.prepare(`UPDATE issues SET ${assignments.join(', ')} WHERE id = ? AND updated_at = ?`)
      .bind(...bindings, issue.id, updatedAt),
  };
}

function createStatusUpdateStatement(db, { issue, nextStatus, actor, now }) {
  return db.prepare(`
    INSERT INTO issue_updates (
      issue_id, update_type, old_value, new_value, content, is_public, created_by, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `)
    .bind(issue.id, 'status_change', issue.status, nextStatus, null, 1, actor, now);
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

  if (request.method !== 'POST') {
    return methodNotAllowedResponse(corsPolicy.headers, ALLOWED_METHODS);
  }

  const rateLimitResponse = await checkRateLimit(env, request, 'adminBatch', corsPolicy.headers);
  if (rateLimitResponse) {
    return rateLimitResponse;
  }

  const authResult = await authorizeAdminRequest(request, env, ALLOWED_METHODS);
  if (!authResult.ok) {
    return authResult.response;
  }

  try {
    const parsedBody = await parseJsonBody(request, authResult.corsHeaders);
    if (!parsedBody.ok) {
      return parsedBody.response;
    }

    const validationResult = batchUpdateSchema.safeParse(parsedBody.data);
    if (!validationResult.success) {
      return errorResponse(formatZodError(validationResult.error), { status: 400, headers: authResult.corsHeaders });
    }

    const { issueIds, updates, updatedAt } = validationResult.data;
    const failedIds = [];
    let updatedCount = 0;
    const now = new Date().toISOString();
    const ipAddress = getClientIP(request);

    for (const issueId of issueIds) {
      const issue = await getIssueById(env.DB, issueId);
      if (!issue) {
        failedIds.push(issueId);
        continue;
      }

      if (updates.status && !canTransitionStatus(issue.status, updates.status)) {
        failedIds.push(issueId);
        continue;
      }

      const { statement, changes } = buildIssueUpdate({ db: env.DB, issue, updates, now, updatedAt });
      const statements = [statement];

      if (updates.status && updates.status !== issue.status) {
        statements.push(createStatusUpdateStatement(env.DB, {
          issue,
          nextStatus: updates.status,
          actor: authResult.actor,
          now,
        }));
      }

      statements.push(createAdminActionStatement(env.DB, {
        actionType: 'batch_update',
        targetId: issue.id,
        details: {
          trackingCode: issue.tracking_code,
          changes,
        },
        performedBy: authResult.actor,
        performedAt: now,
        ipAddress,
      }));

      const [updateResult] = await env.DB.batch(statements);
      if (Number(updateResult?.meta?.changes) === 1) {
        updatedCount += 1;
      } else {
        failedIds.push(issueId);
      }
    }

    return successResponse({
      updatedCount,
      failedIds,
    }, { headers: authResult.corsHeaders });
  } catch (error) {
    console.error('Admin batch issues route failed:', error);
    const message = env.ENVIRONMENT === 'production' ? '服务器内部错误' : `数据库错误: ${error.message}`;
    return errorResponse(message, { status: 500, headers: authResult.corsHeaders });
  }
}
