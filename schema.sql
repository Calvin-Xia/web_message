-- 创建问题表
-- 字段约束说明:
--   issue: 最大1000字符
--   name: 最大20字符
--   student_id: 必须为4位、5位或13位数字
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
