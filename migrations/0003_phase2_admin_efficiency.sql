CREATE INDEX IF NOT EXISTS idx_issues_status_created_at
ON issues(status, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_issues_category_priority
ON issues(category, priority);

CREATE INDEX IF NOT EXISTS idx_issues_assigned_to
ON issues(assigned_to);

CREATE INDEX IF NOT EXISTS idx_issue_updates_issue_reply
ON issue_updates(issue_id, update_type, created_at DESC);
