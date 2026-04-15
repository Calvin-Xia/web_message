ALTER TABLE issues
ADD COLUMN distress_type TEXT CHECK (distress_type IS NULL OR distress_type IN ('academic_pressure', 'relationship', 'adaptation', 'mood', 'sleep', 'other'));

ALTER TABLE issues
ADD COLUMN scene_tag TEXT CHECK (scene_tag IS NULL OR scene_tag IN ('dormitory', 'classroom', 'library', 'self_study', 'cafeteria', 'playground', 'other'));

CREATE INDEX IF NOT EXISTS idx_issues_category_distress_type
ON issues(category, distress_type);

CREATE INDEX IF NOT EXISTS idx_issues_category_scene_tag
ON issues(category, scene_tag);
