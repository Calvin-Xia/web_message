CREATE INDEX IF NOT EXISTS idx_issues_public_counseling_created_at
ON issues(created_at DESC)
WHERE is_public = 1 AND category = 'counseling';

CREATE INDEX IF NOT EXISTS idx_issues_public_counseling_scene_created_at
ON issues(scene_tag, created_at DESC)
WHERE is_public = 1 AND category = 'counseling' AND scene_tag IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_issues_public_counseling_distress_created_at
ON issues(distress_type, created_at DESC)
WHERE is_public = 1 AND category = 'counseling' AND distress_type IS NOT NULL;
