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
