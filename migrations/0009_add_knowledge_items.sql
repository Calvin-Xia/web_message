CREATE TABLE IF NOT EXISTS knowledge_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL,
  tag TEXT NOT NULL CHECK (tag IN ('academic_pressure', 'relationship', 'adaptation', 'mood', 'sleep', 'other')),
  content TEXT NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0,
  is_enabled INTEGER NOT NULL DEFAULT 1,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_knowledge_items_enabled_sort
ON knowledge_items(is_enabled, sort_order, id);

CREATE INDEX IF NOT EXISTS idx_knowledge_items_tag
ON knowledge_items(tag);

INSERT INTO knowledge_items (title, tag, content, sort_order, is_enabled)
SELECT '学业压力', 'academic_pressure', '先把任务拆成今天能完成的一小步，给自己留出固定休息段。压力持续影响睡眠或饮食时，建议尽早联系辅导员或心理中心。', 10, 1
WHERE NOT EXISTS (
  SELECT 1 FROM knowledge_items WHERE title = '学业压力' AND tag = 'academic_pressure'
);

INSERT INTO knowledge_items (title, tag, content, sort_order, is_enabled)
SELECT '人际关系', 'relationship', '先记录让你不舒服的具体事件和边界需求，再选择合适时机沟通。冲突升级或感到孤立时，可以请可信任的老师陪同梳理。', 20, 1
WHERE NOT EXISTS (
  SELECT 1 FROM knowledge_items WHERE title = '人际关系' AND tag = 'relationship'
);

INSERT INTO knowledge_items (title, tag, content, sort_order, is_enabled)
SELECT '睡眠问题', 'sleep', '睡前减少刷屏和高强度学习，尝试固定起床时间。连续多日明显失眠、早醒或白天难以学习时，请寻求专业支持。', 30, 1
WHERE NOT EXISTS (
  SELECT 1 FROM knowledge_items WHERE title = '睡眠问题' AND tag = 'sleep'
);
