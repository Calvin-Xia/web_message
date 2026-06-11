import { readFileSync } from 'fs';
import { describe, expect, it } from 'vitest';

describe('admin auth database schema', () => {
  it('defines admin user and password reset storage in schema and migration', () => {
    const schema = readFileSync('schema.sql', 'utf-8');
    const migration = readFileSync('migrations/0010_add_admin_auth.sql', 'utf-8');
    const sql = `${schema}\n${migration}`;

    expect(sql).toContain('CREATE TABLE IF NOT EXISTS admin_users');
    expect(sql).toContain('username TEXT NOT NULL UNIQUE');
    expect(sql).toContain('password_hash TEXT NOT NULL');
    expect(sql).toContain("role TEXT NOT NULL CHECK (role IN ('handler', 'admin'))");
    expect(sql).toContain('is_enabled INTEGER NOT NULL DEFAULT 1');
    expect(sql).toContain('last_login_at DATETIME');
    expect(sql).toContain('CREATE INDEX IF NOT EXISTS idx_admin_users_username');
    expect(sql).toContain('CREATE INDEX IF NOT EXISTS idx_admin_users_role');
    expect(sql).toContain('CREATE TABLE IF NOT EXISTS admin_password_reset_tokens');
    expect(sql).toContain("SELECT 'admin',");
  });
});
