const API_BASE = '/v1/api';
const REQUEST_TIMEOUT = 15000;
const ADMIN_TOKEN_KEY = 'admin_token';
const ADMIN_USER_KEY = 'admin_user';
const ADMIN_EXPIRES_AT_KEY = 'admin_expires_at';
const SHARED_SECRET_KEY = 'issue-admin-secret';

function escapeHtml(value) {
  const div = document.createElement('div');
  div.textContent = value ?? '';
  return div.innerHTML;
}

function renderFeedbackBox(message, type = 'info') {
  const tone = {
    success: 'feedback-box--success',
    error: 'feedback-box--error',
    info: 'feedback-box--info',
    loading: 'feedback-box--loading',
  };
  const role = type === 'error' ? 'alert' : 'status';
  return `<div class="feedback-box ${tone[type] || tone.info}" role="${role}">${escapeHtml(message)}</div>`;
}

function setNotification(message = '', type = 'info') {
  const target = document.getElementById('loginNotification');
  target.innerHTML = message ? renderFeedbackBox(message, type) : '';
}

async function fetchWithTimeout(url, options = {}, timeout = REQUEST_TIMEOUT) {
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), timeout);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

async function apiFetch(path, options = {}) {
  const response = await fetchWithTimeout(`${API_BASE}${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(options.headers || {}),
    },
  });
  let payload = null;
  try {
    payload = await response.json();
  } catch {
    payload = null;
  }

  if (!response.ok || !payload?.success) {
    throw new Error(payload?.error || '请求失败');
  }

  return payload.data;
}

function setButtonBusy(button, busy, loadingText, idleText = button.dataset.originalText || button.textContent.trim()) {
  if (busy) {
    button.dataset.originalText = idleText;
    button.disabled = true;
    button.textContent = loadingText;
    return;
  }

  button.disabled = false;
  button.textContent = idleText;
}

async function submitPasswordLogin(event) {
  event.preventDefault();
  const button = document.getElementById('loginButton');
  const username = document.getElementById('username').value.trim();
  const password = document.getElementById('password').value;
  const rememberMe = document.getElementById('rememberMe').checked;

  if (!username || !password) {
    setNotification('请输入用户名和密码。', 'error');
    return;
  }

  try {
    setButtonBusy(button, true, '登录中...');
    setNotification('正在验证账号...', 'loading');
    const data = await apiFetch('/admin/auth/login', {
      method: 'POST',
      body: JSON.stringify({ username, password, rememberMe }),
    });
    window.localStorage.setItem(ADMIN_TOKEN_KEY, data.token);
    window.localStorage.setItem(ADMIN_USER_KEY, JSON.stringify(data.user));
    window.localStorage.setItem(ADMIN_EXPIRES_AT_KEY, data.expiresAt);
    window.sessionStorage.removeItem(SHARED_SECRET_KEY);
    window.location.assign('/admin.html');
  } catch (error) {
    setNotification(error.name === 'AbortError' ? '登录超时，请稍后重试。' : error.message, 'error');
  } finally {
    setButtonBusy(button, false, '', '登录');
  }
}

async function submitForgotPassword(event) {
  event.preventDefault();
  const button = document.getElementById('forgotSubmitButton');
  const username = document.getElementById('forgotUsername').value.trim();
  if (!username) {
    setNotification('请输入用户名。', 'error');
    return;
  }

  try {
    setButtonBusy(button, true, '发送中...');
    const data = await apiFetch('/admin/auth/forgot-password', {
      method: 'POST',
      body: JSON.stringify({ username }),
    });
    setNotification(data.message, 'success');
  } catch (error) {
    setNotification(error.message, 'error');
  } finally {
    setButtonBusy(button, false, '', '发送重置邮件');
  }
}

async function submitResetPassword(event) {
  event.preventDefault();
  const button = document.getElementById('resetSubmitButton');
  const token = new URL(window.location.href).searchParams.get('token') || '';
  const newPassword = document.getElementById('newPassword').value;
  if (!token || !newPassword) {
    setNotification('请输入新密码。', 'error');
    return;
  }

  try {
    setButtonBusy(button, true, '重置中...');
    const data = await apiFetch('/admin/auth/reset-password', {
      method: 'POST',
      body: JSON.stringify({ token, newPassword }),
    });
    setNotification(data.message, 'success');
    document.getElementById('resetPasswordForm').classList.add('hidden');
  } catch (error) {
    setNotification(error.message, 'error');
  } finally {
    setButtonBusy(button, false, '', '重置密码');
  }
}

function submitSharedKeyLogin(event) {
  event.preventDefault();
  const sharedKey = document.getElementById('sharedKey').value.trim();
  if (!sharedKey) {
    setNotification('请输入共享密钥。', 'error');
    return;
  }

  window.localStorage.removeItem(ADMIN_TOKEN_KEY);
  window.localStorage.removeItem(ADMIN_USER_KEY);
  window.localStorage.removeItem(ADMIN_EXPIRES_AT_KEY);
  window.sessionStorage.setItem(SHARED_SECRET_KEY, sharedKey);
  window.location.assign('/admin.html');
}

function bindEvents() {
  document.getElementById('passwordLoginForm').addEventListener('submit', submitPasswordLogin);
  document.getElementById('forgotPasswordForm').addEventListener('submit', submitForgotPassword);
  document.getElementById('resetPasswordForm').addEventListener('submit', submitResetPassword);
  document.getElementById('sharedKeyLoginForm').addEventListener('submit', submitSharedKeyLogin);
  document.getElementById('forgotPasswordButton').addEventListener('click', () => {
    document.getElementById('forgotPasswordForm').classList.toggle('hidden');
    document.getElementById('forgotUsername').focus();
  });
  document.getElementById('sharedKeyToggle').addEventListener('click', () => {
    document.getElementById('sharedKeyLoginForm').classList.toggle('hidden');
    document.getElementById('sharedKey').focus();
  });
}

bindEvents();

const resetToken = new URL(window.location.href).searchParams.get('token');
if (resetToken) {
  document.getElementById('resetPasswordForm').classList.remove('hidden');
  document.getElementById('newPassword').focus();
}
