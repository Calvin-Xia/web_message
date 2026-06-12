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
  assigned_at DATETIME,
  first_response_at DATETIME,
  resolved_at DATETIME,
  sla_response_deadline DATETIME,
  sla_resolution_deadline DATETIME,
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
CREATE INDEX IF NOT EXISTS idx_issues_assigned_to ON issues(assigned_to);
CREATE INDEX IF NOT EXISTS idx_issues_assigned_at ON issues(assigned_at DESC);
CREATE INDEX IF NOT EXISTS idx_issues_sla_response_deadline ON issues(sla_response_deadline);
CREATE INDEX IF NOT EXISTS idx_issues_sla_resolution_deadline ON issues(sla_resolution_deadline);
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

CREATE TABLE IF NOT EXISTS admin_users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  display_name TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('handler', 'admin')),
  is_enabled INTEGER NOT NULL DEFAULT 1,
  last_login_at DATETIME,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_admin_users_username ON admin_users(username);
CREATE INDEX IF NOT EXISTS idx_admin_users_role ON admin_users(role);

INSERT INTO admin_users (username, password_hash, display_name, role, is_enabled)
SELECT 'admin', '$2b$12$7F0trh841nSTdnrnuehgt.h8aM5TfxirX05TnEE0/p7JgGnYiE5p6', '管理员', 'admin', 1
WHERE NOT EXISTS (
  SELECT 1 FROM admin_users WHERE username = 'admin'
);

CREATE TABLE IF NOT EXISTS admin_password_reset_tokens (
  token_hash TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL,
  expires_at DATETIME NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  used_at DATETIME,
  FOREIGN KEY (user_id) REFERENCES admin_users(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_admin_password_reset_tokens_user
ON admin_password_reset_tokens(user_id);

CREATE INDEX IF NOT EXISTS idx_admin_password_reset_tokens_expires
ON admin_password_reset_tokens(expires_at);

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

CREATE TABLE IF NOT EXISTS sla_rules (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  priority TEXT NOT NULL UNIQUE,
  response_hours INTEGER NOT NULL,
  resolution_hours INTEGER NOT NULL,
  is_enabled INTEGER NOT NULL DEFAULT 1,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CHECK (priority IN ('low', 'normal', 'high', 'urgent'))
);

CREATE INDEX IF NOT EXISTS idx_sla_rules_priority ON sla_rules(priority);

INSERT INTO sla_rules (name, priority, response_hours, resolution_hours, is_enabled)
SELECT '紧急问题 4 小时响应', 'urgent', 4, 24, 1
WHERE NOT EXISTS (SELECT 1 FROM sla_rules WHERE priority = 'urgent');

INSERT INTO sla_rules (name, priority, response_hours, resolution_hours, is_enabled)
SELECT '高优先级问题 8 小时响应', 'high', 8, 48, 1
WHERE NOT EXISTS (SELECT 1 FROM sla_rules WHERE priority = 'high');

INSERT INTO sla_rules (name, priority, response_hours, resolution_hours, is_enabled)
SELECT '普通问题 24 小时响应', 'normal', 24, 72, 1
WHERE NOT EXISTS (SELECT 1 FROM sla_rules WHERE priority = 'normal');

INSERT INTO sla_rules (name, priority, response_hours, resolution_hours, is_enabled)
SELECT '低优先级问题 48 小时响应', 'low', 48, 120, 1
WHERE NOT EXISTS (SELECT 1 FROM sla_rules WHERE priority = 'low');

CREATE TABLE IF NOT EXISTS assign_rules (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  category TEXT CHECK (category IS NULL OR category IN ('academic', 'facility', 'service', 'complaint', 'counseling', 'other')),
  keywords TEXT,
  assign_to TEXT NOT NULL,
  priority INTEGER NOT NULL DEFAULT 0,
  is_enabled INTEGER NOT NULL DEFAULT 1,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_assign_rules_enabled ON assign_rules(is_enabled);
CREATE INDEX IF NOT EXISTS idx_assign_rules_priority ON assign_rules(priority DESC);

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
