import { customAlphabet } from 'nanoid';

const TRACKING_CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const TRACKING_CODE_LENGTH = 8;
const createTrackingCode = customAlphabet(TRACKING_CODE_ALPHABET, TRACKING_CODE_LENGTH);

export function generateTrackingCode() {
  return createTrackingCode();
}

export function isTrackingCodeConflictError(error) {
  const messages = [];

  if (typeof error === 'string') {
    messages.push(error);
  }

  if (error?.message) {
    messages.push(error.message);
  }

  if (error?.cause?.message) {
    messages.push(error.cause.message);
  }

  return messages.some((value) => {
    const message = String(value).toLowerCase();
    return message.includes('tracking_code') && (message.includes('unique') || message.includes('constraint'));
  });
}

export async function generateUniqueTrackingCode(exists, { maxAttempts = 8, codeFactory = generateTrackingCode } = {}) {
  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    const code = codeFactory();
    const isTaken = await exists(code);

    if (!isTaken) {
      return code;
    }
  }

  throw new Error('追踪编号生成失败，请稍后重试');
}

export async function insertWithUniqueTrackingCode(insert, { maxAttempts = 8, codeFactory = generateTrackingCode } = {}) {
  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    const trackingCode = codeFactory();

    try {
      const result = await insert(trackingCode);
      return { trackingCode, result };
    } catch (error) {
      if (!isTrackingCodeConflictError(error)) {
        throw error;
      }
    }
  }

  throw new Error('追踪编号生成失败，请稍后重试');
}

export async function generateUniqueTrackingCodeForDb(db, options = {}) {
  return generateUniqueTrackingCode(async (code) => {
    const row = await db.prepare('SELECT id FROM issues WHERE tracking_code = ? LIMIT 1').bind(code).first();
    return Boolean(row?.id);
  }, options);
}
