import { createForbiddenOriginResponse, authorizeAdminRequest } from '../../../src/shared/auth.js';
import { getAdminCorsPolicy } from '../../../src/shared/corsConfig.js';
import { createCsvContent } from '../../../src/shared/csv.js';
import { createAdminActionStatement } from '../../../src/shared/issueData.js';
import { successResponse, errorResponse, createOptionsResponse, methodNotAllowedResponse } from '../../../src/shared/response.js';
import { checkAdminRateLimit, getClientIP } from '../../../src/shared/rateLimit.js';
import { adminExportQuerySchema, formatZodError } from '../../../src/shared/validation.js';
import { buildAdminIssueWhere } from '../../../src/shared/issueQueries.js';

const ALLOWED_METHODS = 'GET, OPTIONS';
const CURSOR_PAGE_SIZE = 1000;
const MAX_EXPORT_ROWS = 50_000;
// 管理端导出用于内部运营和审计留档，默认保留原始字段以避免二次核对时信息丢失。
// 导出文件会落地到管理员本机，因此必须继续通过后台鉴权、限流和操作审计控制访问边界。
const EXPORT_HEADERS = [
  'id',
  'tracking_code',
  'name',
  'student_id',
  'content',
  'category',
  'distress_type',
  'scene_tag',
  'priority',
  'status',
  'is_public',
  'is_reported',
  'assigned_to',
  'first_response_at',
  'resolved_at',
  'created_at',
  'updated_at',
  'public_summary',
];

function createExportFilename() {
  const stamp = new Date().toISOString().replace(/[:T]/g, '-').slice(0, 19);
  return `issues_export_${stamp}.csv`;
}

function mapExportRow(row) {
  return [
    row.id,
    row.tracking_code,
    row.name,
    row.student_id,
    row.content,
    row.category,
    row.distress_type,
    row.scene_tag,
    row.priority,
    row.status,
    row.is_public,
    row.is_reported,
    row.assigned_to,
    row.first_response_at,
    row.resolved_at,
    row.created_at,
    row.updated_at,
    row.public_summary,
  ];
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
    const parsedQuery = adminExportQuerySchema.safeParse(Object.fromEntries(url.searchParams.entries()));
    if (!parsedQuery.success) {
      return errorResponse(formatZodError(parsedQuery.error), { status: 400, headers: authResult.corsHeaders });
    }

    const query = parsedQuery.data;
    if (query.format !== 'csv') {
      return errorResponse('暂不支持该导出格式', { status: 400, headers: authResult.corsHeaders });
    }

    const { whereSql, bindings } = buildAdminIssueWhere(query, { tableAlias: 'issues' });
    const totalRow = await env.DB.prepare(`SELECT COUNT(*) AS total FROM issues ${whereSql}`)
      .bind(...bindings)
      .first();
    const total = Number(totalRow?.total) || 0;

    if (total > MAX_EXPORT_ROWS) {
      return errorResponse(`导出结果超过 ${MAX_EXPORT_ROWS} 条，请缩小筛选范围后重试`, {
        status: 413,
        headers: authResult.corsHeaders,
      });
    }

    const rows = [];
    let lastId = 0;

    while (true) {
      const cursorWhere = whereSql
        ? `${whereSql} AND issues.id > ?`
        : 'WHERE issues.id > ?';
      const batch = await env.DB.prepare(`
        SELECT
          issues.id,
          issues.tracking_code,
          issues.name,
          issues.student_id,
          issues.content,
          issues.category,
          issues.distress_type,
          issues.scene_tag,
          issues.priority,
          issues.status,
          issues.is_public,
          issues.is_reported,
          issues.assigned_to,
          issues.first_response_at,
          issues.resolved_at,
          issues.created_at,
          issues.updated_at,
          issues.public_summary
        FROM issues
        ${cursorWhere}
        ORDER BY issues.id ASC
        LIMIT ?
      `)
        .bind(...bindings, lastId, CURSOR_PAGE_SIZE)
        .all();

      const batchRows = batch.results || [];
      if (batchRows.length === 0) {
        break;
      }

      rows.push(...batchRows);
      lastId = Number(batchRows[batchRows.length - 1].id);
    }

    const filename = createExportFilename();
    const csvContent = createCsvContent(EXPORT_HEADERS, rows.map(mapExportRow));
    const now = new Date().toISOString();

    await createAdminActionStatement(env.DB, {
      actionType: 'issues_exported',
      details: {
        filename,
        rowCount: rows.length,
        filters: query,
      },
      performedBy: authResult.actor,
      ipAddress: getClientIP(request),
      performedAt: now,
    }).run();

    return new Response(csvContent, {
      status: 200,
      headers: {
        ...authResult.corsHeaders,
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="${filename}"`,
        'Cache-Control': 'no-store',
      },
    });
  } catch (error) {
    console.error('Admin export route failed:', error);
    const message = env.ENVIRONMENT === 'production' ? '服务器内部错误' : `数据库错误: ${error.message}`;
    return errorResponse(message, { status: 500, headers: authResult.corsHeaders });
  }
}
