-- 创建问题表
CREATE TABLE IF NOT EXISTS issues (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    issue TEXT NOT NULL,
    isInformationPublic TEXT NOT NULL,
    name TEXT NOT NULL,
    student_id TEXT NOT NULL,
    isReport TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- 创建索引以提高查询性能
CREATE INDEX IF NOT EXISTS idx_created_at ON issues(created_at DESC);
