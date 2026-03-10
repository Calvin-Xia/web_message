import { parseJsonValue } from './utils.js';

export function toBoolean(value) {
  return Boolean(value);
}

export function mapPublicIssue(row) {
  return {
    trackingCode: row.tracking_code,
    content: row.content,
    category: row.category,
    status: row.status,
    priority: row.priority,
    publicSummary: row.public_summary,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function mapIssueUpdate(row) {
  return {
    id: row.id,
    type: row.update_type,
    oldValue: row.old_value,
    newValue: row.new_value,
    content: row.content,
    isPublic: toBoolean(row.is_public),
    createdBy: row.created_by,
    createdAt: row.created_at,
  };
}

export function mapInternalNote(row) {
  return {
    id: row.id,
    content: row.content,
    createdBy: row.created_by,
    createdAt: row.created_at,
  };
}

export function mapAdminAction(row) {
  return {
    id: row.id,
    actionType: row.action_type,
    targetType: row.target_type,
    targetId: row.target_id,
    details: parseJsonValue(row.details, {}),
    performedBy: row.performed_by,
    performedAt: row.performed_at,
    ipAddress: row.ip_address,
  };
}

export function mapAdminIssue(row) {
  return {
    ...mapPublicIssue(row),
    id: row.id,
    name: row.name,
    studentId: row.student_id,
    isPublic: toBoolean(row.is_public),
    isReported: toBoolean(row.is_reported),
    assignedTo: row.assigned_to,
    firstResponseAt: row.first_response_at,
    resolvedAt: row.resolved_at,
  };
}

export function createPagination(page, pageSize, total) {
  const totalPages = total === 0 ? 0 : Math.ceil(total / pageSize);
  return {
    page,
    pageSize,
    total,
    totalPages,
  };
}

export function createAdminActionStatement(db, {
  actionType,
  targetType = 'issue',
  targetId = null,
  details = null,
  performedBy = 'admin',
  ipAddress = null,
  performedAt = new Date().toISOString(),
}) {
  const serializedDetails = details == null ? null : JSON.stringify(details);

  return db.prepare(`
    INSERT INTO admin_actions (action_type, target_type, target_id, details, performed_by, performed_at, ip_address)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `)
    .bind(actionType, targetType, targetId, serializedDetails, performedBy, performedAt, ipAddress);
}

export async function recordAdminAction(db, options) {
  await createAdminActionStatement(db, options).run();
}

export async function getIssueById(db, issueId) {
  return db.prepare('SELECT * FROM issues WHERE id = ? LIMIT 1').bind(issueId).first();
}

export async function getIssueByTrackingCode(db, trackingCode) {
  return db.prepare('SELECT * FROM issues WHERE tracking_code = ? LIMIT 1').bind(trackingCode).first();
}
