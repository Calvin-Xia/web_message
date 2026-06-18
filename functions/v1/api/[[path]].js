import { onRequest as healthRequest } from '../../api/health.js';
import { onRequest as insightsRequest } from '../../api/insights.js';
import { onRequest as issuesRequest } from '../../api/issues.js';
import { onRequest as issueDetailRequest } from '../../api/issues/[trackingCode].js';
import { onRequest as knowledgeRequest } from '../../api/knowledge.js';
import { onRequest as adminActionsRequest } from '../../api/admin/actions.js';
import { onRequest as adminAssignRulesRequest } from '../../api/admin/assign-rules.js';
import { onRequest as adminAssignRuleDetailRequest } from '../../api/admin/assign-rules/[id].js';
import { onRequest as adminAssignStatsRequest } from '../../api/admin/assign-stats.js';
import { onRequest as adminForgotPasswordRequest } from '../../api/admin/auth/forgot-password.js';
import { onRequest as adminLoginRequest } from '../../api/admin/auth/login.js';
import { onRequest as adminLogoutRequest } from '../../api/admin/auth/logout.js';
import { onRequest as adminResetPasswordRequest } from '../../api/admin/auth/reset-password.js';
import { onRequest as adminExportRequest } from '../../api/admin/export.js';
import { onRequest as adminIssuesRequest } from '../../api/admin/issues.js';
import { onRequest as adminIssueDetailRequest } from '../../api/admin/issues/[id].js';
import { onRequest as adminIssueNotesRequest } from '../../api/admin/issues/[id]/notes.js';
import { onRequest as adminIssueRepliesRequest } from '../../api/admin/issues/[id]/replies.js';
import { onRequest as adminIssueBatchRequest } from '../../api/admin/issues/batch.js';
import { onRequest as adminKnowledgeRequest } from '../../api/admin/knowledge.js';
import { onRequest as adminKnowledgeDetailRequest } from '../../api/admin/knowledge/[id].js';
import { onRequest as adminMetricsRequest } from '../../api/admin/metrics.js';
import { onRequest as adminSlaRulesRequest } from '../../api/admin/sla/rules.js';
import { onRequest as adminSlaRuleDetailRequest } from '../../api/admin/sla/rules/[id].js';
import { onRequest as adminSlaViolationsRequest } from '../../api/admin/sla/violations.js';
import { onRequest as adminUsersRequest } from '../../api/admin/users.js';
import { onRequest as adminUserDetailRequest } from '../../api/admin/users/[id].js';
import { errorResponse } from '../../../src/shared/response.js';

const ROUTE_HANDLERS = {
  health: healthRequest,
  insights: insightsRequest,
  issues: issuesRequest,
  issueDetail: issueDetailRequest,
  knowledge: knowledgeRequest,
  adminActions: adminActionsRequest,
  adminAssignRules: adminAssignRulesRequest,
  adminAssignRuleDetail: adminAssignRuleDetailRequest,
  adminAssignStats: adminAssignStatsRequest,
  adminForgotPassword: adminForgotPasswordRequest,
  adminLogin: adminLoginRequest,
  adminLogout: adminLogoutRequest,
  adminResetPassword: adminResetPasswordRequest,
  adminExport: adminExportRequest,
  adminIssues: adminIssuesRequest,
  adminIssueDetail: adminIssueDetailRequest,
  adminIssueNotes: adminIssueNotesRequest,
  adminIssueReplies: adminIssueRepliesRequest,
  adminIssueBatch: adminIssueBatchRequest,
  adminKnowledge: adminKnowledgeRequest,
  adminKnowledgeDetail: adminKnowledgeDetailRequest,
  adminMetrics: adminMetricsRequest,
  adminSlaRules: adminSlaRulesRequest,
  adminSlaRuleDetail: adminSlaRuleDetailRequest,
  adminSlaViolations: adminSlaViolationsRequest,
  adminUsers: adminUsersRequest,
  adminUserDetail: adminUserDetailRequest,
};

const STATIC_ROUTES = {
  health: 'health',
  insights: 'insights',
  issues: 'issues',
  knowledge: 'knowledge',
  'admin/actions': 'adminActions',
  'admin/assign-rules': 'adminAssignRules',
  'admin/assign-stats': 'adminAssignStats',
  'admin/auth/forgot-password': 'adminForgotPassword',
  'admin/auth/login': 'adminLogin',
  'admin/auth/logout': 'adminLogout',
  'admin/auth/reset-password': 'adminResetPassword',
  'admin/export': 'adminExport',
  'admin/issues': 'adminIssues',
  'admin/issues/batch': 'adminIssueBatch',
  'admin/knowledge': 'adminKnowledge',
  'admin/metrics': 'adminMetrics',
  'admin/sla/rules': 'adminSlaRules',
  'admin/sla/violations': 'adminSlaViolations',
  'admin/users': 'adminUsers',
};

function createDynamicMatch(routeKey, parameterName, value) {
  return {
    routeKey,
    params: {
      [parameterName]: value,
    },
  };
}

export function matchVersionedApiPath(pathSegments) {
  const segments = Array.isArray(pathSegments)
    ? pathSegments.map((segment) => String(segment))
    : [];
  const routePath = segments.join('/');
  const staticRouteKey = STATIC_ROUTES[routePath];

  if (staticRouteKey) {
    return {
      routeKey: staticRouteKey,
      params: {},
    };
  }

  if (segments.length === 2 && segments[0] === 'issues') {
    return createDynamicMatch('issueDetail', 'trackingCode', segments[1]);
  }

  if (segments.length === 3 && segments[0] === 'admin') {
    if (segments[1] === 'assign-rules') {
      return createDynamicMatch('adminAssignRuleDetail', 'id', segments[2]);
    }
    if (segments[1] === 'issues') {
      return createDynamicMatch('adminIssueDetail', 'id', segments[2]);
    }
    if (segments[1] === 'knowledge') {
      return createDynamicMatch('adminKnowledgeDetail', 'id', segments[2]);
    }
    if (segments[1] === 'users') {
      return createDynamicMatch('adminUserDetail', 'id', segments[2]);
    }
  }

  if (
    segments.length === 4
    && segments[0] === 'admin'
    && segments[1] === 'issues'
    && segments[3] === 'notes'
  ) {
    return createDynamicMatch('adminIssueNotes', 'id', segments[2]);
  }

  if (
    segments.length === 4
    && segments[0] === 'admin'
    && segments[1] === 'issues'
    && segments[3] === 'replies'
  ) {
    return createDynamicMatch('adminIssueReplies', 'id', segments[2]);
  }

  if (
    segments.length === 4
    && segments[0] === 'admin'
    && segments[1] === 'sla'
    && segments[2] === 'rules'
  ) {
    return createDynamicMatch('adminSlaRuleDetail', 'id', segments[3]);
  }

  return null;
}

export async function onRequest(context) {
  const match = matchVersionedApiPath(context.params.path);
  if (!match) {
    return errorResponse('API 路由不存在', { status: 404 });
  }

  return ROUTE_HANDLERS[match.routeKey]({
    ...context,
    params: {
      ...context.params,
      ...match.params,
    },
  });
}
