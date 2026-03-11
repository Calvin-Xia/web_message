import { getAdminCorsPolicy, createForbiddenOriginResponse, authorizeAdminRequest } from '../../../src/shared/auth.js';
import { successResponse, errorResponse, createOptionsResponse, methodNotAllowedResponse } from '../../../src/shared/response.js';
import { checkAdminRateLimit } from '../../../src/shared/rateLimit.js';
import { adminMetricsQuerySchema, formatZodError } from '../../../src/shared/validation.js';
import { buildDateWhereClause, calculatePercentiles } from '../../../src/shared/issueQueries.js';
import { CATEGORY_VALUES, PRIORITY_VALUES, STATUS_VALUES } from '../../../src/shared/constants.js';

const ALLOWED_METHODS = 'GET, OPTIONS';
const METRICS_CACHE_TTL_MS = 300000;
const METRICS_CACHE = globalThis.__ISSUE_METRICS_CACHE__ ?? (globalThis.__ISSUE_METRICS_CACHE__ = new Map());
const TREND_RANGE_DAYS = {
  day: 13,
  week: 83,
  month: 364,
};

function toDateString(value) {
  return value.toISOString().slice(0, 10);
}

function shiftDate(dateString, days) {
  const nextDate = new Date(`${dateString}T00:00:00.000Z`);
  nextDate.setUTCDate(nextDate.getUTCDate() + days);
  return toDateString(nextDate);
}

function getRollingWindow(daysBack) {
  const endDate = toDateString(new Date());
  const startDate = shiftDate(endDate, -daysBack);
  return { startDate, endDate };
}

function getActivityRange(query) {
  if (query.startDate || query.endDate) {
    return {
      startDate: query.startDate,
      endDate: query.endDate,
      source: 'custom',
    };
  }

  if (query.period === 'day') {
    const today = toDateString(new Date());
    return {
      startDate: today,
      endDate: today,
      source: 'rolling',
    };
  }

  if (query.period === 'month') {
    return {
      ...getRollingWindow(29),
      source: 'rolling',
    };
  }

  return {
    ...getRollingWindow(6),
    source: 'rolling',
  };
}

function getTrendRange(period, query) {
  if (query.startDate || query.endDate) {
    return {
      startDate: query.startDate,
      endDate: query.endDate,
    };
  }

  return getRollingWindow(TREND_RANGE_DAYS[period]);
}

function getTrendConfig(period) {
  if (period === 'month') {
    return {
      key: 'month',
      expression: (column) => `strftime('%Y-%m', ${column})`,
    };
  }

  if (period === 'week') {
    return {
      key: 'week',
      expression: (column) => `strftime('%Y-W%W', ${column})`,
    };
  }

  return {
    key: 'date',
    expression: (column) => `strftime('%Y-%m-%d', ${column})`,
  };
}

function buildScopedWhere(scope, column, { requireNotNull = false } = {}) {
  const clauses = [];
  const bindings = [];

  if (requireNotNull) {
    clauses.push(`${column} IS NOT NULL`);
  }

  if (scope.startDate) {
    clauses.push(`date(${column}) >= date(?)`);
    bindings.push(scope.startDate);
  }

  if (scope.endDate) {
    clauses.push(`date(${column}) <= date(?)`);
    bindings.push(scope.endDate);
  }

  return {
    whereSql: clauses.length > 0 ? `WHERE ${clauses.join(' AND ')}` : '',
    bindings,
  };
}

function getAverage(values) {
  if (!values.length) {
    return 0;
  }

  return Math.round(values.reduce((total, value) => total + value, 0) / values.length);
}

async function getDurationSamples(db, scope, targetColumn) {
  const { whereSql, bindings } = buildScopedWhere(scope, 'created_at');
  const extraCondition = `${targetColumn} IS NOT NULL`;
  const scopedWhere = whereSql
    ? `${whereSql} AND ${extraCondition}`
    : `WHERE ${extraCondition}`;

  const rows = await db.prepare(`
    SELECT CAST(strftime('%s', ${targetColumn}) AS INTEGER) - CAST(strftime('%s', created_at) AS INTEGER) AS duration
    FROM issues
    ${scopedWhere}
  `)
    .bind(...bindings)
    .all();

  return (rows.results || [])
    .map((row) => Number(row.duration))
    .filter((value) => Number.isFinite(value) && value >= 0);
}

async function getDistribution(db, scope, columnName, values) {
  const result = Object.fromEntries(values.map((value) => [value, 0]));
  const { whereSql, bindings } = buildScopedWhere(scope, 'created_at');
  const rows = await db.prepare(`
    SELECT ${columnName} AS label, COUNT(*) AS total
    FROM issues
    ${whereSql}
    GROUP BY ${columnName}
  `)
    .bind(...bindings)
    .all();

  for (const row of rows.results || []) {
    if (row.label in result) {
      result[row.label] = Number(row.total) || 0;
    }
  }

  return result;
}

async function getTrendSeries(db, period, scope) {
  const { key, expression } = getTrendConfig(period);
  const createdWhere = buildScopedWhere(scope, 'created_at');
  const resolvedWhere = buildScopedWhere(scope, 'resolved_at', { requireNotNull: true });
  const createdRows = await db.prepare(`
    SELECT ${expression('created_at')} AS bucket, COUNT(*) AS total
    FROM issues
    ${createdWhere.whereSql}
    GROUP BY bucket
    ORDER BY bucket ASC
  `)
    .bind(...createdWhere.bindings)
    .all();
  const resolvedRows = await db.prepare(`
    SELECT ${expression('resolved_at')} AS bucket, COUNT(*) AS total
    FROM issues
    ${resolvedWhere.whereSql}
    GROUP BY bucket
    ORDER BY bucket ASC
  `)
    .bind(...resolvedWhere.bindings)
    .all();

  const buckets = new Map();
  for (const row of createdRows.results || []) {
    buckets.set(row.bucket, { bucket: row.bucket, created: Number(row.total) || 0, resolved: 0 });
  }
  for (const row of resolvedRows.results || []) {
    const current = buckets.get(row.bucket) || { bucket: row.bucket, created: 0, resolved: 0 };
    current.resolved = Number(row.total) || 0;
    buckets.set(row.bucket, current);
  }

  return Array.from(buckets.values())
    .sort((left, right) => left.bucket.localeCompare(right.bucket))
    .map((item) => ({
      [key]: item.bucket,
      created: item.created,
      resolved: item.resolved,
    }));
}

function getCacheEntry(key) {
  const cached = METRICS_CACHE.get(key);
  if (!cached) {
    return null;
  }

  if (cached.expiresAt <= Date.now()) {
    METRICS_CACHE.delete(key);
    return null;
  }

  return cached.value;
}

function setCacheEntry(key, value) {
  METRICS_CACHE.set(key, {
    expiresAt: Date.now() + METRICS_CACHE_TTL_MS,
    value,
  });
}

async function buildMetrics(db, query) {
  const overallScope = {
    startDate: query.startDate,
    endDate: query.endDate,
  };
  const activityScope = getActivityRange(query);
  const overallWhere = buildDateWhereClause(overallScope, { column: 'created_at', tableAlias: '' });
  const activityCreatedWhere = buildScopedWhere(activityScope, 'created_at');
  const activityResolvedWhere = buildScopedWhere(activityScope, 'resolved_at', { requireNotNull: true });

  const [overviewRow, createdActivityRow, resolvedActivityRow, byStatus, byCategory, byPriority, firstResponseSamples, resolutionSamples, daily, weekly, monthly] = await Promise.all([
    db.prepare(`
      SELECT
        COUNT(*) AS total_issues,
        SUM(CASE WHEN status IN ('submitted', 'in_review', 'in_progress') THEN 1 ELSE 0 END) AS pending_issues,
        SUM(CASE WHEN status IN ('resolved', 'closed') THEN 1 ELSE 0 END) AS resolved_issues
      FROM issues
      ${overallWhere.whereSql}
    `)
      .bind(...overallWhere.bindings)
      .first(),
    db.prepare(`SELECT COUNT(*) AS total FROM issues ${activityCreatedWhere.whereSql}`)
      .bind(...activityCreatedWhere.bindings)
      .first(),
    db.prepare(`SELECT COUNT(*) AS total FROM issues ${activityResolvedWhere.whereSql}`)
      .bind(...activityResolvedWhere.bindings)
      .first(),
    getDistribution(db, overallScope, 'status', STATUS_VALUES),
    getDistribution(db, overallScope, 'category', CATEGORY_VALUES),
    getDistribution(db, overallScope, 'priority', PRIORITY_VALUES),
    getDurationSamples(db, overallScope, 'first_response_at'),
    getDurationSamples(db, overallScope, 'resolved_at'),
    getTrendSeries(db, 'day', getTrendRange('day', query)),
    getTrendSeries(db, 'week', getTrendRange('week', query)),
    getTrendSeries(db, 'month', getTrendRange('month', query)),
  ]);

  const totalIssues = Number(overviewRow?.total_issues) || 0;
  const resolvedIssues = Number(overviewRow?.resolved_issues) || 0;

  return {
    overview: {
      totalIssues,
      pendingIssues: Number(overviewRow?.pending_issues) || 0,
      createdThisPeriod: Number(createdActivityRow?.total) || 0,
      resolvedThisPeriod: Number(resolvedActivityRow?.total) || 0,
      resolvedThisWeek: Number(resolvedActivityRow?.total) || 0,
      avgFirstResponseTime: getAverage(firstResponseSamples),
      avgResolutionTime: getAverage(resolutionSamples),
      resolutionRate: totalIssues > 0 ? Math.round((resolvedIssues / totalIssues) * 10000) / 100 : 0,
    },
    byStatus,
    byCategory,
    byPriority,
    trends: {
      daily,
      weekly,
      monthly,
    },
    performance: {
      firstResponseTime: calculatePercentiles(firstResponseSamples),
      resolutionTime: calculatePercentiles(resolutionSamples),
    },
    range: {
      startDate: overallScope.startDate ?? null,
      endDate: overallScope.endDate ?? null,
      activityStartDate: activityScope.startDate ?? null,
      activityEndDate: activityScope.endDate ?? null,
      source: activityScope.source,
      period: query.period,
    },
    cache: {
      ttlSeconds: 300,
    },
  };
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

  if (request.method !== 'GET') {
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

  try {
    const url = new URL(request.url);
    const parsedQuery = adminMetricsQuerySchema.safeParse(Object.fromEntries(url.searchParams.entries()));
    if (!parsedQuery.success) {
      return errorResponse(formatZodError(parsedQuery.error), { status: 400, headers: authResult.corsHeaders });
    }

    const query = parsedQuery.data;
    const cacheKey = JSON.stringify({
      startDate: query.startDate ?? null,
      endDate: query.endDate ?? null,
      period: query.period,
    });

    if (query.refresh) {
      METRICS_CACHE.delete(cacheKey);
    } else {
      const cached = getCacheEntry(cacheKey);
      if (cached) {
        return successResponse(cached, {
          headers: {
            ...authResult.corsHeaders,
            'Cache-Control': 'private, max-age=60',
          },
        });
      }
    }

    const metrics = await buildMetrics(env.DB, query);
    setCacheEntry(cacheKey, metrics);

    return successResponse(metrics, {
      headers: {
        ...authResult.corsHeaders,
        'Cache-Control': 'private, max-age=60',
      },
    });
  } catch (error) {
    console.error('Admin metrics route failed:', error);
    const message = env.ENVIRONMENT === 'production' ? '服务器内部错误' : `数据库错误: ${error.message}`;
    return errorResponse(message, { status: 500, headers: authResult.corsHeaders });
  }
}
