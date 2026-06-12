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

ALTER TABLE issues ADD COLUMN assigned_at DATETIME;
ALTER TABLE issues ADD COLUMN sla_response_deadline DATETIME;
ALTER TABLE issues ADD COLUMN sla_resolution_deadline DATETIME;

CREATE INDEX IF NOT EXISTS idx_issues_assigned_at ON issues(assigned_at DESC);
CREATE INDEX IF NOT EXISTS idx_issues_sla_response_deadline ON issues(sla_response_deadline);
CREATE INDEX IF NOT EXISTS idx_issues_sla_resolution_deadline ON issues(sla_resolution_deadline);
