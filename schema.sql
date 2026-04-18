PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS issues (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tracking_code TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  student_id TEXT NOT NULL,
  email TEXT,
  notify_by_email INTEGER NOT NULL DEFAULT 0,
  content TEXT NOT NULL,
  is_public INTEGER NOT NULL DEFAULT 0,
  is_reported INTEGER NOT NULL DEFAULT 0,
  category TEXT NOT NULL DEFAULT 'other' CHECK (category IN ('academic', 'facility', 'service', 'complaint', 'counseling', 'other')),
  distress_type TEXT CHECK (distress_type IS NULL OR distress_type IN ('academic_pressure', 'relationship', 'adaptation', 'mood', 'sleep', 'other')),
  scene_tag TEXT CHECK (scene_tag IS NULL OR scene_tag IN ('dormitory', 'classroom', 'library', 'self_study', 'cafeteria', 'playground', 'other')),
  priority TEXT NOT NULL DEFAULT 'normal' CHECK (priority IN ('low', 'normal', 'high', 'urgent')),
  status TEXT NOT NULL DEFAULT 'submitted' CHECK (status IN ('submitted', 'in_review', 'in_progress', 'resolved', 'closed')),
  public_summary TEXT,
  assigned_to TEXT,
  first_response_at DATETIME,
  resolved_at DATETIME,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_issues_tracking_code ON issues(tracking_code);
CREATE INDEX IF NOT EXISTS idx_issues_status ON issues(status);
CREATE INDEX IF NOT EXISTS idx_issues_category ON issues(category);
CREATE INDEX IF NOT EXISTS idx_issues_category_distress_type ON issues(category, distress_type);
CREATE INDEX IF NOT EXISTS idx_issues_category_scene_tag ON issues(category, scene_tag);
CREATE INDEX IF NOT EXISTS idx_issues_created_at ON issues(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_issues_updated_at ON issues(updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_issues_is_public ON issues(is_public);
CREATE INDEX IF NOT EXISTS idx_issues_public_counseling_created_at ON issues(created_at DESC)
  WHERE is_public = 1 AND category = 'counseling';
CREATE INDEX IF NOT EXISTS idx_issues_public_counseling_scene_created_at ON issues(scene_tag, created_at DESC)
  WHERE is_public = 1 AND category = 'counseling' AND scene_tag IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_issues_public_counseling_distress_created_at ON issues(distress_type, created_at DESC)
  WHERE is_public = 1 AND category = 'counseling' AND distress_type IS NOT NULL;

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

CREATE TABLE IF NOT EXISTS issue_updates (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  issue_id INTEGER NOT NULL,
  update_type TEXT NOT NULL CHECK (update_type IN ('status_change', 'public_reply')),
  old_value TEXT,
  new_value TEXT,
  content TEXT,
  is_public INTEGER NOT NULL DEFAULT 0,
  created_by TEXT NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (issue_id) REFERENCES issues(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_issue_updates_issue_id ON issue_updates(issue_id);
CREATE INDEX IF NOT EXISTS idx_issue_updates_created_at ON issue_updates(created_at DESC);

CREATE TABLE IF NOT EXISTS issue_internal_notes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  issue_id INTEGER NOT NULL,
  content TEXT NOT NULL,
  created_by TEXT NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (issue_id) REFERENCES issues(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_internal_notes_issue_id ON issue_internal_notes(issue_id);

CREATE TABLE IF NOT EXISTS admin_actions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  action_type TEXT NOT NULL,
  target_type TEXT,
  target_id INTEGER,
  details TEXT,
  performed_by TEXT NOT NULL,
  performed_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  ip_address TEXT
);

CREATE INDEX IF NOT EXISTS idx_admin_actions_performed_at ON admin_actions(performed_at DESC);
CREATE INDEX IF NOT EXISTS idx_admin_actions_type ON admin_actions(action_type);
CREATE INDEX IF NOT EXISTS idx_admin_actions_target ON admin_actions(target_type, target_id);

CREATE TABLE IF NOT EXISTS rate_limit_state (
  endpoint TEXT NOT NULL,
  client_ip TEXT NOT NULL,
  window_started_at INTEGER NOT NULL,
  request_count INTEGER NOT NULL DEFAULT 0,
  blocked_until INTEGER,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (endpoint, client_ip)
);

CREATE INDEX IF NOT EXISTS idx_rate_limit_state_updated_at ON rate_limit_state(updated_at DESC);

CREATE TABLE IF NOT EXISTS request_observations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  bucket_timestamp INTEGER NOT NULL,
  observed_at INTEGER NOT NULL,
  path TEXT NOT NULL,
  method TEXT NOT NULL,
  status INTEGER NOT NULL,
  duration_ms INTEGER NOT NULL,
  sanitized_message TEXT,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_request_observations_bucket ON request_observations(bucket_timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_request_observations_observed_at ON request_observations(observed_at DESC);
CREATE INDEX IF NOT EXISTS idx_request_observations_status_observed_at ON request_observations(status, observed_at DESC);
