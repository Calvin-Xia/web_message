DROP INDEX IF EXISTS idx_issues_distress_type;
DROP INDEX IF EXISTS idx_issues_scene_tag;

CREATE INDEX IF NOT EXISTS idx_issues_category_distress_type
ON issues(category, distress_type);

CREATE INDEX IF NOT EXISTS idx_issues_category_scene_tag
ON issues(category, scene_tag);
