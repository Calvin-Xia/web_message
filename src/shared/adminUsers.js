import { createTokenHash } from './jwt.js';
import { toBoolean } from './issueData.js';

const PASSWORD_RESET_TTL_SECONDS = 60 * 60;

function createSecureToken() {
  return `${crypto.randomUUID()}${crypto.randomUUID()}`.replaceAll('-', '');
}

function addSeconds(date, seconds) {
  return new Date(date.getTime() + (seconds * 1000));
}

export function mapAdminUser(row) {
  return {
    id: row.id,
    username: row.username,
    displayName: row.display_name,
    role: row.role,
    isEnabled: toBoolean(row.is_enabled),
    lastLoginAt: row.last_login_at ?? null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export async function getAdminUserByUsername(db, username) {
  return db.prepare('SELECT * FROM admin_users WHERE username = ? LIMIT 1')
    .bind(username)
    .first();
}

export async function getAdminUserById(db, userId) {
  return db.prepare('SELECT * FROM admin_users WHERE id = ? LIMIT 1')
    .bind(userId)
    .first();
}

export async function createPasswordResetToken(db, userId, { now = new Date() } = {}) {
  const token = createSecureToken();
  const tokenHash = await createTokenHash(token);
  const expiresAt = addSeconds(now, PASSWORD_RESET_TTL_SECONDS).toISOString();
  const createdAt = now.toISOString();

  await db.prepare(`
    INSERT INTO admin_password_reset_tokens (token_hash, user_id, expires_at, created_at, used_at)
    VALUES (?, ?, ?, ?, NULL)
  `)
    .bind(tokenHash, userId, expiresAt, createdAt)
    .run();

  return { token, tokenHash, expiresAt };
}

export async function getValidPasswordResetToken(db, token, { now = new Date() } = {}) {
  const tokenHash = await createTokenHash(token);
  const row = await db.prepare(`
    SELECT *
    FROM admin_password_reset_tokens
    WHERE token_hash = ? AND used_at IS NULL
    LIMIT 1
  `)
    .bind(tokenHash)
    .first();

  if (!row || Date.parse(row.expires_at) <= now.getTime()) {
    return null;
  }

  return row;
}

export async function markPasswordResetTokenUsed(db, tokenHash, usedAt) {
  await db.prepare(`
    UPDATE admin_password_reset_tokens
    SET used_at = ?
    WHERE token_hash = ? AND used_at IS NULL
  `)
    .bind(usedAt, tokenHash)
    .run();
}

export {
  PASSWORD_RESET_TTL_SECONDS,
};
