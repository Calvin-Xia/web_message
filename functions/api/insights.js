import { checkRateLimit } from '../../src/shared/rateLimit.js';
import { successResponse, errorResponse, createOptionsResponse, createPublicCorsHeaders, methodNotAllowedResponse } from '../../src/shared/response.js';
import { formatZodError, publicInsightsQuerySchema } from '../../src/shared/validation.js';

const ALLOWED_METHODS = 'GET, OPTIONS';
const MS_PER_DAY = 86400000;
const MAX_INSIGHTS_RANGE_DAYS = 365;

function formatDateOnly(date) {
  return date.toISOString().slice(0, 10);
}

function parseDateOnly(value) {
  return new Date(`${value}T00:00:00.000Z`);
}

function addDays(date, days) {
  const next = new Date(date);
  next.setUTCDate(next.getUTCDate() + days);
  return next;
}

function getInclusiveRangeDays(startDate, endDate) {
  return Math.floor((parseDateOnly(endDate) - parseDateOnly(startDate)) / MS_PER_DAY) + 1;
}

function resolveInsightsRange(query, now = new Date()) {
  const endDate = query.endDate ?? formatDateOnly(now);
  const end = parseDateOnly(endDate);
  const startDate = query.startDate ?? formatDateOnly(addDays(end, -(query.days - 1)));
  const rangeDays = getInclusiveRangeDays(startDate, endDate);

  if (rangeDays < 1) {
    return { ok: false, error: '开始日期不能晚于结束日期' };
  }

  if (rangeDays > MAX_INSIGHTS_RANGE_DAYS) {
    return { ok: false, error: '公开热区统计范围不能超过365天' };
  }

  return {
    ok: true,
    range: {
      startDate,
      endDate,
      days: rangeDays,
    },
  };
}

function buildInsightsWhere(range, extraClause = '') {
  const clauses = [
    'issues.is_public = 1',
    "issues.category = 'counseling'",
    'date(issues.created_at) >= date(?)',
    'date(issues.created_at) <= date(?)',
  ];

  if (extraClause) {
    clauses.push(extraClause);
  }

  return {
    whereSql: `WHERE ${clauses.join(' AND ')}`,
    bindings: [range.startDate, range.endDate],
  };
}

function mapCountRows(rows, keyName) {
  return (rows.results || []).map((row) => ({
    [keyName]: row.label,
    total: Number(row.total) || 0,
  }));
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

  const rateLimitResponse = await checkRateLimit(env, request, 'getIssues', corsHeaders);
  if (rateLimitResponse) {
    return rateLimitResponse;
  }

  try {
    const url = new URL(request.url);
    const parsedQuery = publicInsightsQuerySchema.safeParse(Object.fromEntries(url.searchParams.entries()));
    if (!parsedQuery.success) {
      return errorResponse(formatZodError(parsedQuery.error), { status: 400, headers: corsHeaders });
    }

    const resolvedRange = resolveInsightsRange(parsedQuery.data);
    if (!resolvedRange.ok) {
      return errorResponse(resolvedRange.error, { status: 400, headers: corsHeaders });
    }

    const overviewWhere = buildInsightsWhere(resolvedRange.range);
    const sceneWhere = buildInsightsWhere(resolvedRange.range, 'issues.scene_tag IS NOT NULL');
    const distressWhere = buildInsightsWhere(resolvedRange.range, 'issues.distress_type IS NOT NULL');

    const [overviewRow, sceneRows, distressRows] = await Promise.all([
      env.DB.prepare(`
        SELECT COUNT(*) AS total
        FROM issues
        ${overviewWhere.whereSql}
      `)
        .bind(...overviewWhere.bindings)
        .first(),
      env.DB.prepare(`
        SELECT
          scene_tag AS scene,
          COUNT(*) AS total,
          SUM(CASE WHEN status IN ('submitted', 'in_review', 'in_progress') THEN 1 ELSE 0 END) AS pending
        FROM issues
        ${sceneWhere.whereSql}
        GROUP BY scene_tag
        ORDER BY total DESC, scene_tag ASC
      `)
        .bind(...sceneWhere.bindings)
        .all(),
      env.DB.prepare(`
        SELECT distress_type AS label, COUNT(*) AS total
        FROM issues
        ${distressWhere.whereSql}
        GROUP BY distress_type
        ORDER BY total DESC, distress_type ASC
      `)
        .bind(...distressWhere.bindings)
        .all(),
    ]);

    return successResponse({
      overview: {
        publicCounselingIssues: Number(overviewRow?.total) || 0,
      },
      range: resolvedRange.range,
      sceneHotspots: (sceneRows.results || []).map((row) => ({
        scene: row.scene,
        total: Number(row.total) || 0,
        pending: Number(row.pending) || 0,
      })),
      distressTypes: mapCountRows(distressRows, 'distressType'),
    }, {
      headers: {
        ...corsHeaders,
        'Cache-Control': 'public, max-age=300',
      },
    });
  } catch (error) {
    console.error('Public insights route failed:', error);
    const message = env.ENVIRONMENT === 'production' ? '服务器内部错误' : `服务器错误: ${error.message}`;
    return errorResponse(message, { status: 500, headers: corsHeaders });
  }
}
