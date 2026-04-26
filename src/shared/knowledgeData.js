import { createAdminActionStatement, toBoolean } from './issueData.js';

export function mapKnowledgeItem(row) {
  return {
    id: row.id,
    title: row.title,
    tag: row.tag,
    content: row.content,
    sortOrder: Number(row.sort_order) || 0,
    isEnabled: toBoolean(row.is_enabled),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export async function getKnowledgeItemById(db, itemId) {
  return db.prepare('SELECT * FROM knowledge_items WHERE id = ? LIMIT 1').bind(itemId).first();
}

export function createKnowledgeAuditDetails(item, extra = {}) {
  return {
    id: item.id,
    title: item.title,
    tag: item.tag,
    ...extra,
  };
}

export function createKnowledgeActionStatement(db, {
  actionType,
  item,
  details = {},
  performedBy,
  ipAddress,
  performedAt,
}) {
  return createAdminActionStatement(db, {
    actionType,
    targetType: 'knowledge_item',
    targetId: item.id,
    details: createKnowledgeAuditDetails(mapKnowledgeItem(item), details),
    performedBy,
    ipAddress,
    performedAt,
  });
}

export function createKnowledgeCreatedActionStatement(db, {
  actionType,
  payload,
  performedBy,
  ipAddress,
  performedAt,
}) {
  return db.prepare(`
    INSERT INTO admin_actions (
      action_type, target_type, target_id, details, performed_by, performed_at, ip_address
    )
    SELECT ?, ?, id, ?, ?, ?, ?
    FROM knowledge_items
    WHERE title = ?
      AND tag = ?
      AND content = ?
      AND sort_order = ?
      AND is_enabled = ?
      AND created_at = ?
      AND updated_at = ?
    ORDER BY id DESC
    LIMIT 1
  `)
    .bind(
      actionType,
      'knowledge_item',
      JSON.stringify({
        title: payload.title,
        tag: payload.tag,
      }),
      performedBy,
      performedAt,
      ipAddress,
      payload.title,
      payload.tag,
      payload.content,
      payload.sortOrder,
      payload.isEnabled ? 1 : 0,
      performedAt,
      performedAt,
    );
}

export function createConditionalKnowledgeActionStatement(db, {
  actionType,
  item,
  expectedUpdatedAt,
  details = {},
  performedBy,
  ipAddress,
  performedAt,
}) {
  return db.prepare(`
    INSERT INTO admin_actions (
      action_type, target_type, target_id, details, performed_by, performed_at, ip_address
    )
    SELECT ?, ?, id, ?, ?, ?, ?
    FROM knowledge_items
    WHERE id = ? AND updated_at = ?
  `)
    .bind(
      actionType,
      'knowledge_item',
      JSON.stringify(createKnowledgeAuditDetails(mapKnowledgeItem(item), details)),
      performedBy,
      performedAt,
      ipAddress,
      item.id,
      expectedUpdatedAt,
    );
}
