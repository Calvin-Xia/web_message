import { toBoolean } from './issueData.js';

const DEFAULT_PUBLIC_BASE_URL = 'https://issue.calvin-xia.cn';
const RESEND_API_URL = 'https://api.resend.com/emails';
const SUPPORT_EMAIL = 'support@calvin-xia.cn';
const STATUS_LABELS = {
  submitted: '已提交',
  in_review: '审核中',
  in_progress: '处理中',
  resolved: '已解决',
  closed: '已关闭',
};
const NOTIFIABLE_STATUSES = new Set(['in_progress', 'resolved', 'closed']);
const RETRYABLE_STATUS_CODES = new Set([429, 500]);
const RETRY_DELAYS_MS = [200, 400];

function hasValidResendApiKey(apiKey) {
  const normalized = String(apiKey || '').trim();
  return normalized.startsWith('re_');
}

function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function normalizeBaseUrl(value) {
  if (value === null || value === undefined) {
    return '';
  }

  return String(value).trim().replace(/\/+$/, '');
}

function summarizeText(value, maxLength = 280) {
  const normalized = String(value || '').trim().replace(/\s+/g, ' ');
  if (normalized.length <= maxLength) {
    return normalized;
  }

  return `${normalized.slice(0, maxLength - 1)}…`;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function resolvePublicBaseUrl(requestUrl, env) {
  const explicitBaseUrl = normalizeBaseUrl(env.PUBLIC_BASE_URL);
  if (explicitBaseUrl) {
    return explicitBaseUrl;
  }

  if (env.ENVIRONMENT === 'production') {
    return DEFAULT_PUBLIC_BASE_URL;
  }

  try {
    return normalizeBaseUrl(new URL(requestUrl).origin);
  } catch {
    return DEFAULT_PUBLIC_BASE_URL;
  }
}

function createStatusEmailContent(issue, statusLabel, trackingUrl) {
  const summary = summarizeText(issue.public_summary || '');
  const text = [
    `你的问题 ${issue.tracking_code} 有新的处理进展。`,
    `当前状态：${statusLabel}`,
    summary ? `处理说明：${summary}` : null,
    `查看追踪页：${trackingUrl}`,
    '',
    `如需补充说明，可直接回复此邮件联系 ${SUPPORT_EMAIL}。`,
    '',
    SUPPORT_EMAIL,
  ].filter(Boolean).join('\n');

  const html = `
    <div style="font-family:Arial,'PingFang SC','Microsoft YaHei',sans-serif;color:#172033;line-height:1.7;">
      <p>你的问题 <strong>${escapeHtml(issue.tracking_code)}</strong> 有新的处理进展。</p>
      <p><strong>当前状态：</strong>${escapeHtml(statusLabel)}</p>
      ${summary ? `<p><strong>处理说明：</strong>${escapeHtml(summary)}</p>` : ''}
      <p><a href="${escapeHtml(trackingUrl)}">点击查看追踪页</a></p>
      <p>如需补充说明，可直接回复此邮件联系 ${escapeHtml(SUPPORT_EMAIL)}。</p>
      <p>${escapeHtml(SUPPORT_EMAIL)}</p>
    </div>
  `.trim();

  return { html, text };
}

function createReplyEmailContent(issue, replyContent, trackingUrl) {
  const summary = summarizeText(replyContent);
  const statusLabel = STATUS_LABELS[issue.status] || issue.status;
  const text = [
    `管理员已回复你的问题 ${issue.tracking_code}。`,
    `当前状态：${statusLabel}`,
    `回复内容：${summary}`,
    `查看追踪页：${trackingUrl}`,
    '',
    `如需补充说明，可直接回复此邮件联系 ${SUPPORT_EMAIL}。`,
    '',
    SUPPORT_EMAIL,
  ].join('\n');

  const html = `
    <div style="font-family:Arial,'PingFang SC','Microsoft YaHei',sans-serif;color:#172033;line-height:1.7;">
      <p>管理员已回复你的问题 <strong>${escapeHtml(issue.tracking_code)}</strong>。</p>
      <p><strong>当前状态：</strong>${escapeHtml(statusLabel)}</p>
      <p><strong>回复内容：</strong>${escapeHtml(summary)}</p>
      <p><a href="${escapeHtml(trackingUrl)}">点击查看追踪页</a></p>
      <p>如需补充说明，可直接回复此邮件联系 ${escapeHtml(SUPPORT_EMAIL)}。</p>
      <p>${escapeHtml(SUPPORT_EMAIL)}</p>
    </div>
  `.trim();

  return { html, text };
}

async function sendEmailRequest(env, payload, idempotencyKey) {
  if (!env.RESEND_API_KEY) {
    return {
      success: false,
      skipped: true,
      retryable: false,
      error: 'RESEND_API_KEY not configured',
    };
  }

  if (!hasValidResendApiKey(env.RESEND_API_KEY)) {
    return {
      success: false,
      retryable: false,
      error: 'RESEND_API_KEY has unexpected format',
    };
  }

  let response;
  try {
    response = await fetch(RESEND_API_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${env.RESEND_API_KEY}`,
        'Content-Type': 'application/json',
        'Idempotency-Key': idempotencyKey,
      },
      body: JSON.stringify(payload),
    });
  } catch (error) {
    return {
      success: false,
      retryable: true,
      error: error instanceof Error ? error.message : String(error),
    };
  }

  const rawBody = await response.text();
  let parsedBody = null;
  if (rawBody) {
    try {
      parsedBody = JSON.parse(rawBody);
    } catch {
      parsedBody = null;
    }
  }

  if (response.ok) {
    return {
      success: true,
      id: parsedBody?.id ?? null,
      status: response.status,
    };
  }

  return {
    success: false,
    retryable: RETRYABLE_STATUS_CODES.has(response.status),
    status: response.status,
    error: parsedBody?.message || parsedBody?.error || rawBody || `HTTP ${response.status}`,
  };
}

async function sendEmailWithRetry(env, payload, idempotencyKey) {
  for (let attempt = 0; attempt <= RETRY_DELAYS_MS.length; attempt += 1) {
    const result = await sendEmailRequest(env, payload, idempotencyKey);
    if (result.success || result.skipped || !result.retryable || attempt === RETRY_DELAYS_MS.length) {
      return result;
    }

    await sleep(RETRY_DELAYS_MS[attempt]);
  }

  return {
    success: false,
    retryable: true,
    error: '邮件发送在重试后仍失败',
  };
}

export function buildTrackingUrl(requestUrl, env, trackingCode) {
  const baseUrl = resolvePublicBaseUrl(requestUrl, env);
  return `${baseUrl}/tracking.html?code=${encodeURIComponent(trackingCode)}`;
}

export function createNotificationIdempotencyKey(issueId, eventType, eventRef) {
  const sanitize = (value) => String(value).replace(/[^a-zA-Z0-9_-]/g, '-');
  return `issue-notify/${sanitize(issueId)}/${sanitize(eventType)}/${sanitize(eventRef)}`;
}

export function isNotifiableStatus(status) {
  return NOTIFIABLE_STATUSES.has(status);
}

export function shouldNotifyIssue(issue) {
  return Boolean(String(issue?.email || '').trim()) && toBoolean(issue?.notify_by_email);
}

export async function sendIssueStatusNotification({ env, requestUrl, issue, status, idempotencyKey }) {
  const statusLabel = STATUS_LABELS[status] || status;
  const trackingUrl = buildTrackingUrl(requestUrl, env, issue.tracking_code);
  const content = createStatusEmailContent(issue, statusLabel, trackingUrl);

  return sendEmailWithRetry(env, {
    from: SUPPORT_EMAIL,
    to: [issue.email],
    subject: `问题处理进展更新：${statusLabel}（${issue.tracking_code}）`,
    html: content.html,
    text: content.text,
    reply_to: [SUPPORT_EMAIL],
  }, idempotencyKey);
}

export async function sendIssueReplyNotification({ env, requestUrl, issue, replyContent, idempotencyKey }) {
  const trackingUrl = buildTrackingUrl(requestUrl, env, issue.tracking_code);
  const content = createReplyEmailContent(issue, replyContent, trackingUrl);

  return sendEmailWithRetry(env, {
    from: SUPPORT_EMAIL,
    to: [issue.email],
    subject: `管理员已回复你的问题（${issue.tracking_code}）`,
    html: content.html,
    text: content.text,
    reply_to: [SUPPORT_EMAIL],
  }, idempotencyKey);
}

export {
  SUPPORT_EMAIL,
};
