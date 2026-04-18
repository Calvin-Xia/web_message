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
