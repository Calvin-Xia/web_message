import { APP_VERSION } from '../../src/shared/constants.js';
import { ALERT_RULES, buildMetricsSummary, evaluateAlerts, loadObservabilitySnapshot, sanitizeErrorMessage } from '../../src/shared/observability.js';
import { createOptionsResponse, createPublicCorsHeaders, errorResponse, methodNotAllowedResponse, successResponse } from '../../src/shared/response.js';

const ALLOWED_METHODS = 'GET, OPTIONS';

async function checkD1(env, checkedAt) {
  const startedAt = Date.now();

  try {
    await env.DB.prepare('SELECT 1 AS ok').first();
    return {
      status: 'connected',
      latency: Date.now() - startedAt,
      lastChecked: checkedAt,
    };
  } catch (error) {
    return {
      status: 'error',
      latency: Date.now() - startedAt,
      lastChecked: checkedAt,
      error: sanitizeErrorMessage(error instanceof Error ? error.message : String(error), 500),
    };
  }
}

async function checkKv(env, checkedAt) {
  if (!env.RATE_LIMIT_KV) {
    return {
      status: 'not_configured',
      latency: null,
      lastChecked: checkedAt,
    };
  }

  const startedAt = Date.now();

  try {
    await env.RATE_LIMIT_KV.get('ops:health:ping');
    return {
      status: 'connected',
      latency: Date.now() - startedAt,
      lastChecked: checkedAt,
    };
  } catch (error) {
    return {
      status: 'error',
      latency: Date.now() - startedAt,
      lastChecked: checkedAt,
      error: sanitizeErrorMessage(error instanceof Error ? error.message : String(error), 500),
    };
  }
}

function buildChecks(services) {
  return {
    database: services.d1.status === 'connected' ? 'pass' : 'fail',
    cache: services.kv.status === 'connected' ? 'pass' : services.kv.status === 'not_configured' ? 'warn' : 'fail',
    rateLimiter: services.kv.status === 'connected' ? 'pass' : services.kv.status === 'not_configured' ? 'warn' : 'fail',
  };
}

function resolveHealthStatus(checks) {
  if (checks.database === 'fail') {
    return 'unhealthy';
  }

  if (Object.values(checks).some((value) => value === 'warn' || value === 'fail')) {
    return 'degraded';
  }

  return 'healthy';
}

export async function onRequest(context) {
  const { request, env } = context;
  const corsHeaders = createPublicCorsHeaders(ALLOWED_METHODS);

  if (request.method === 'OPTIONS') {
    return createOptionsResponse(corsHeaders);
  }

  if (request.method !== 'GET') {
    return methodNotAllowedResponse(corsHeaders, ALLOWED_METHODS);
  }

  try {
    const checkedAt = new Date().toISOString();
    const [d1, kv, snapshot] = await Promise.all([
      checkD1(env, checkedAt),
      checkKv(env, checkedAt),
      loadObservabilitySnapshot(env),
    ]);

    const services = { d1, kv };
    const checks = buildChecks(services);
    const metrics = buildMetricsSummary(snapshot);
    const alerts = evaluateAlerts({ metrics, services });
    const status = resolveHealthStatus(checks);

    return successResponse({
      status,
      timestamp: checkedAt,
      version: APP_VERSION,
      services,
      metrics: {
        requestCount: metrics.requestCount,
        errorRate: metrics.errorRate,
        avgResponseTime: metrics.avgResponseTime,
        rateLimitHits: metrics.rateLimitHits,
      },
      checks,
      alerts,
      alertRules: ALERT_RULES,
      trends: metrics.trends,
      recentErrors: snapshot.recentErrors || [],
    }, {
      status: status === 'unhealthy' ? 503 : 200,
      headers: {
        ...corsHeaders,
        'Cache-Control': 'no-store',
      },
    });
  } catch (error) {
    console.error('Health check failed:', error);
    const message = sanitizeErrorMessage(error instanceof Error ? error.message : String(error), 500);
    return errorResponse(message, {
      status: 503,
      headers: {
        ...corsHeaders,
        'Cache-Control': 'no-store',
      },
    });
  }
}
