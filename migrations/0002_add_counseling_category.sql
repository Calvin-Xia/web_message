PRAGMA foreign_keys = OFF;

CREATE TABLE issues_next (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tracking_code TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  student_id TEXT NOT NULL,
  content TEXT NOT NULL,
  is_public INTEGER NOT NULL DEFAULT 0,
  is_reported INTEGER NOT NULL DEFAULT 0,
  category TEXT NOT NULL DEFAULT 'other' CHECK (category IN ('academic', 'facility', 'service', 'complaint', 'counseling', 'other')),
  priority TEXT NOT NULL DEFAULT 'normal' CHECK (priority IN ('low', 'normal', 'high', 'urgent')),
  status TEXT NOT NULL DEFAULT 'submitted' CHECK (status IN ('submitted', 'in_review', 'in_progress', 'resolved', 'closed')),
  public_summary TEXT,
  assigned_to TEXT,
  first_response_at DATETIME,
  resolved_at DATETIME,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

INSERT INTO issues_next (
  id,
  tracking_code,
  name,
  student_id,
  content,
  is_public,
  is_reported,
  category,
  priority,
  status,
  public_summary,
  assigned_to,
  first_response_at,
  resolved_at,
  created_at,
  updated_at
)
SELECT
  id,
  tracking_code,
  name,
  student_id,
  content,
  is_public,
  is_reported,
  category,
  priority,
  status,
  public_summary,
  assigned_to,
  first_response_at,
  resolved_at,
  created_at,
  updated_at
FROM issues;

DROP TABLE issues;
ALTER TABLE issues_next RENAME TO issues;

CREATE INDEX IF NOT EXISTS idx_issues_tracking_code ON issues(tracking_code);
CREATE INDEX IF NOT EXISTS idx_issues_status ON issues(status);
CREATE INDEX IF NOT EXISTS idx_issues_category ON issues(category);
CREATE INDEX IF NOT EXISTS idx_issues_created_at ON issues(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_issues_updated_at ON issues(updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_issues_is_public ON issues(is_public);

PRAGMA foreign_keys = ON;
