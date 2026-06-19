import { closeSideNav } from './side-nav.js';
import { distressTypeLabels, sceneTagLabels } from './src/shared/labels.js';
import { renderSkeleton, retryFetch } from './frontend-ux.js';

const API_BASE = '/v1/api';
const REQUEST_TIMEOUT = 15000;
const ADMIN_TOKEN_KEY = 'admin_token';
const ADMIN_USER_KEY = 'admin_user';
const ADMIN_EXPIRES_AT_KEY = 'admin_expires_at';
const SHARED_SECRET_KEY = 'issue-admin-secret';
const SEARCH_HISTORY_KEY = 'issue-admin-search-history';
const EXPORT_HISTORY_KEY = 'issue-admin-export-history';
const MAX_HISTORY_ITEMS = 8;
const statusLabels = { submitted: '已提交', in_review: '审核中', in_progress: '处理中', resolved: '已解决', closed: '已关闭' };
const categoryLabels = { academic: '学业相关', facility: '设施问题', service: '服务咨询', complaint: '投诉建议', counseling: '心理咨询', other: '其他' };
const priorityLabels = { low: '低', normal: '普通', high: '高', urgent: '紧急' };
const slaStatusLabels = { normal: '正常', warning: '即将超时', violated: '已超时' };
const statusTransitions = {
  submitted: ['submitted', 'in_review', 'closed'],
  in_review: ['in_review', 'in_progress', 'closed'],
  in_progress: ['in_progress', 'resolved', 'closed'],
  resolved: ['resolved', 'closed', 'in_progress'],
  closed: ['closed'],
};
const statusColors = {
  submitted: '#2457d6',
  in_review: '#d98a17',
  in_progress: '#5f57c6',
  resolved: '#13795b',
  closed: '#64748b',
};
const slaStatusColors = {
  normal: '#13795b',
  warning: '#d98a17',
  violated: '#b23a32',
};
const exportFormatLabels = { csv: 'CSV', json: 'JSON' };
const CLEARABLE_FILTER_KEYS = new Set([
  'q',
  'status',
  'category',
  'priority',
  'distressType',
  'sceneTag',
  'assignedTo',
  'startDate',
  'endDate',
  'updatedAfter',
  'hasNotes',
  'hasReplies',
  'isAssigned',
  'slaStatus',
  'sort',
]);
const DRAWER_FOCUS_SELECTOR = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(',');
const state = {
  token: null,
  user: loadStoredUser(),
  page: 1,
  pageSize: 20,
  metricsPeriod: 'week',
  assignStatsPeriod: 'week',
  activeIssueId: null,
  activeIssue: null,
  availableAssignees: [],
  metrics: null,
  issues: [],
  selectedIssueIds: new Set(),
  slaRules: [],
  assignRules: [],
  knowledgeItems: [],
  users: [],
  editingKnowledgeId: null,
  editingUserId: null,
  editingSlaRuleId: null,
  editingAssignRuleId: null,
  pendingBatchPayload: null,
  searchHistory: loadStorageArray(SEARCH_HISTORY_KEY),
  exportHistory: loadStorageArray(EXPORT_HISTORY_KEY),
};
let copyHintTimer = null;
let lastDrawerTrigger = null;

function loadStorageArray(key) {
  try {
    const value = window.localStorage.getItem(key);
    const parsed = value ? JSON.parse(value) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function loadStoredUser() {
  try {
    const value = window.localStorage.getItem(ADMIN_USER_KEY);
    return value ? JSON.parse(value) : null;
  } catch {
    return null;
  }
}

function saveStorageArray(key, value) {
  window.localStorage.setItem(key, JSON.stringify(value));
}

function escapeHtml(value) {
  const div = document.createElement('div');
  div.textContent = value ?? '';
  return div.innerHTML;
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function renderFeedbackBox(message, type = 'info') {
  const tone = {
    success: 'feedback-box--success',
    error: 'feedback-box--error',
    info: 'feedback-box--info',
    loading: 'feedback-box--loading',
  };
  const role = type === 'error' ? 'alert' : 'status';
  const content = type === 'loading'
    ? `<span class="loading-dots">${escapeHtml(message)}</span>`
    : escapeHtml(message);
  return `<div class="feedback-box ${tone[type] || tone.info}" role="${role}">${content}</div>`;
}

function setButtonBusy(button, busy, loadingText, idleText = button.dataset.originalText || button.textContent.trim()) {
  if (!(button instanceof HTMLElement)) {
    return;
  }

  if (busy) {
    const width = Math.ceil(button.getBoundingClientRect().width);
    if (width > 0) {
      button.style.width = `${width}px`;
    }
    button.dataset.originalText = idleText;
    button.disabled = true;
    button.classList.add('button-busy');
    button.setAttribute('aria-busy', 'true');
    button.textContent = loadingText;
    return;
  }

  button.disabled = false;
  button.classList.remove('button-busy');
  button.removeAttribute('aria-busy');
  button.style.width = '';
  button.textContent = idleText;
}

function highlightText(value, query) {
  const safeValue = escapeHtml(value ?? '');
  const normalized = String(query || '').trim();
  if (!normalized) {
    return safeValue;
  }

  const tokens = Array.from(new Set(normalized.split(/\s+/).filter(Boolean).map(escapeRegExp)));
  if (tokens.length === 0) {
    return safeValue;
  }

  return safeValue.replace(new RegExp(`(${tokens.join('|')})`, 'ig'), '<mark class="highlight-mark">$1</mark>');
}

function formatDate(value) {
  if (!value) {
    return '-';
  }

  return new Date(value).toLocaleString('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  });
}

function formatDuration(seconds) {
  const totalSeconds = Number(seconds) || 0;
  if (totalSeconds <= 0) {
    return '0m';
  }

  const days = Math.floor(totalSeconds / 86400);
  const hours = Math.floor((totalSeconds % 86400) / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);

  if (days > 0) {
    return `${days}d ${hours}h`;
  }

  if (hours > 0) {
    return `${hours}h ${minutes}m`;
  }

  return `${Math.max(1, minutes)}m`;
}

function formatHours(value) {
  const numeric = Number(value) || 0;
  return `${numeric.toFixed(numeric % 1 === 0 ? 0 : 1)}h`;
}

function formatSlaCountdown(item) {
  const candidates = [item.slaResponseDeadline, item.slaResolutionDeadline].filter(Boolean);
  if (!candidates.length) {
    return '未设置';
  }

  const now = Date.now();
  const nextDeadline = candidates
    .map((value) => Date.parse(value))
    .filter((value) => !Number.isNaN(value))
    .sort((left, right) => left - right)[0];
  if (!nextDeadline) {
    return '未设置';
  }

  const diff = nextDeadline - now;
  if (diff < 0) {
    return `超时 ${formatDuration(Math.abs(diff) / 1000)}`;
  }

  return `剩余 ${formatDuration(diff / 1000)}`;
}

function renderSlaStatusBadge(status, countdown = '') {
  const safeStatus = status in slaStatusLabels ? status : 'normal';
  return `<span class="rounded-full px-3 py-1 text-xs font-semibold" style="background:${slaStatusColors[safeStatus]}1f;color:${slaStatusColors[safeStatus]}">${escapeHtml(slaStatusLabels[safeStatus])}${countdown ? ` · ${escapeHtml(countdown)}` : ''}</span>`;
}

function summarizeFilters(filters) {
  const summary = [];
  if (filters.q) summary.push(`关键词: ${filters.q}`);
  if (filters.status.length) summary.push(`状态 ${filters.status.length} 项`);
  if (filters.category.length) summary.push(`分类 ${filters.category.length} 项`);
  if (filters.priority.length) summary.push(`优先级 ${filters.priority.length} 项`);
  if (filters.distressType.length) summary.push(`困扰 ${filters.distressType.length} 项`);
  if (filters.sceneTag.length) summary.push(`场景 ${filters.sceneTag.length} 项`);
  if (filters.startDate || filters.endDate) summary.push(`时间 ${filters.startDate || '最早'} - ${filters.endDate || '最新'}`);
  if (filters.assignedTo) summary.push(`指派 ${filters.assignedTo}`);
  if (filters.slaStatus) summary.push(`SLA ${slaStatusLabels[filters.slaStatus] || filters.slaStatus}`);
  return summary.length ? summary.join(' · ') : '全部数据';
}

async function fetchWithTimeout(url, options = {}, timeout = REQUEST_TIMEOUT) {
  const request = async () => {
    const controller = new AbortController();
    const timer = window.setTimeout(() => controller.abort(), timeout);
    try {
      return await fetch(url, { ...options, signal: controller.signal });
    } finally {
      clearTimeout(timer);
    }
  };
  const method = String(options.method || 'GET').toUpperCase();
  return method === 'GET' ? retryFetch(request) : request();
}

async function apiFetch(path, options = {}) {
  const headers = {
    ...(options.headers || {}),
  };
  if (state.token) {
    headers.Authorization = `Bearer ${state.token}`;
  }

  const response = await fetchWithTimeout(`${API_BASE}${path}`, {
    ...options,
    headers,
  });
  let payload = null;
  try {
    payload = await response.json();
  } catch {
    payload = null;
  }

  if (response.status === 401) {
    clearAuthState();
    window.location.assign('/login.html');
    throw new Error(payload?.error || '登录已过期，请重新登录');
  }

  if (!response.ok || !payload?.success) {
    throw new Error(payload?.error || '请求失败');
  }

  return payload.data;
}

function clearAuthState() {
  state.token = null;
  state.user = null;
  window.localStorage.removeItem(ADMIN_TOKEN_KEY);
  window.localStorage.removeItem(ADMIN_USER_KEY);
  window.localStorage.removeItem(ADMIN_EXPIRES_AT_KEY);
  window.sessionStorage.removeItem(SHARED_SECRET_KEY);
}

function updateCurrentUserBadge() {
  const badge = document.getElementById('currentUserBadge');
  if (!badge) {
    return;
  }

  if (!state.user) {
    badge.textContent = '共享密钥';
    return;
  }

  const roleLabel = state.user.role === 'admin' ? '管理员' : '处理者';
  badge.textContent = `${state.user.displayName || state.user.username} · ${roleLabel}`;
}

function showAuthenticatedShell() {
  document.getElementById('loginSection').hidden = true;
  document.getElementById('adminShell').hidden = false;
  document.body.dataset.adminAuthenticated = 'true';
  updateCurrentUserBadge();
}

function setNotification(targetId, message = '', type = 'info') {
  const target = document.getElementById(targetId);
  if (!target) {
    return;
  }

  if (!message) {
    target.innerHTML = '';
    return;
  }

  target.innerHTML = renderFeedbackBox(message, type);
}

function showButtonHint(targetId, message, type = 'success') {
  const target = document.getElementById(targetId);
  if (!target) {
    return;
  }

  target.textContent = message;
  target.dataset.type = type;
  target.dataset.visible = 'true';
  window.clearTimeout(copyHintTimer);
  copyHintTimer = window.setTimeout(() => {
    target.dataset.visible = 'false';
  }, 1600);
}

function getMultiFilterValues(key) {
  return Array.from(document.querySelectorAll(`[data-multi-filter="${key}"] input:checked`)).map((input) => input.value);
}

function setMultiFilterValues(key, values) {
  const selected = new Set(values);
  document.querySelectorAll(`[data-multi-filter="${key}"] input`).forEach((input) => {
    input.checked = selected.has(input.value);
  });
  updateMultiFilterSummary(key);
}

function updateMultiFilterSummary(key) {
  const summaryNode = document.querySelector(`[data-filter-summary="${key}"]`);
  if (!summaryNode) {
    return;
  }

  const selected = getMultiFilterValues(key);
  summaryNode.textContent = selected.length === 0 ? '全部' : `已选 ${selected.length}`;
}

function updatePeriodButtons() {
  document.querySelectorAll('[data-period-button]').forEach((button) => {
    const active = button.dataset.periodButton === state.metricsPeriod;
    button.dataset.active = active ? 'true' : 'false';
    button.setAttribute('aria-pressed', String(active));
  });
}

function updateAssignPeriodButtons() {
  document.querySelectorAll('[data-assign-period-button]').forEach((button) => {
    const active = button.dataset.assignPeriodButton === state.assignStatsPeriod;
    button.dataset.active = active ? 'true' : 'false';
    button.setAttribute('aria-pressed', String(active));
  });
}

function getTriStateFilterValue(id) {
  const value = document.getElementById(id).value;
  return value === '' ? '' : value;
}

function getExportFormat() {
  const value = document.getElementById('exportFormatFilter')?.value;
  return value === 'json' ? 'json' : 'csv';
}

function getFilters() {
  return {
    q: document.getElementById('searchInput').value.trim(),
    status: getMultiFilterValues('status'),
    category: getMultiFilterValues('category'),
    priority: getMultiFilterValues('priority'),
    distressType: getMultiFilterValues('distressType'),
    sceneTag: getMultiFilterValues('sceneTag'),
    assignedTo: document.getElementById('assignedToFilter').value.trim(),
    startDate: document.getElementById('startDateFilter').value,
    endDate: document.getElementById('endDateFilter').value,
    updatedAfter: document.getElementById('updatedAfterFilter').value,
    hasNotes: getTriStateFilterValue('hasNotesFilter'),
    hasReplies: getTriStateFilterValue('hasRepliesFilter'),
    isAssigned: getTriStateFilterValue('isAssignedFilter'),
    slaStatus: getTriStateFilterValue('slaStatusFilter'),
    sortField: document.getElementById('sortFieldFilter').value,
    sortOrder: document.getElementById('sortOrderFilter').value,
  };
}

function appendFilterValue(params, key, value) {
  if (Array.isArray(value)) {
    if (value.length > 0) {
      params.set(key, value.join(','));
    }
    return;
  }

  if (value) {
    params.set(key, value);
  }
}

function buildListQuery(page = 1) {
  const filters = getFilters();
  const params = new URLSearchParams();
  params.set('page', String(page));
  params.set('pageSize', String(state.pageSize));
  appendFilterValue(params, 'q', filters.q);
  appendFilterValue(params, 'status', filters.status);
  appendFilterValue(params, 'category', filters.category);
  appendFilterValue(params, 'priority', filters.priority);
  appendFilterValue(params, 'distressType', filters.distressType);
  appendFilterValue(params, 'sceneTag', filters.sceneTag);
  appendFilterValue(params, 'assignedTo', filters.assignedTo);
  appendFilterValue(params, 'startDate', filters.startDate);
  appendFilterValue(params, 'endDate', filters.endDate);
  appendFilterValue(params, 'updatedAfter', filters.updatedAfter);
  appendFilterValue(params, 'hasNotes', filters.hasNotes);
  appendFilterValue(params, 'hasReplies', filters.hasReplies);
  appendFilterValue(params, 'isAssigned', filters.isAssigned);
  appendFilterValue(params, 'slaStatus', filters.slaStatus);
  appendFilterValue(params, 'sortField', filters.sortField);
  appendFilterValue(params, 'sortOrder', filters.sortOrder);
  return params.toString();
}

function buildMetricsQuery(refresh = false) {
  const filters = getFilters();
  const params = new URLSearchParams();
  appendFilterValue(params, 'startDate', filters.startDate);
  appendFilterValue(params, 'endDate', filters.endDate);
  appendFilterValue(params, 'period', state.metricsPeriod);
  if (refresh) {
    params.set('refresh', 'true');
  }
  return params.toString();
}

function buildExportQuery(format = getExportFormat()) {
  const filters = getFilters();
  const params = new URLSearchParams();
  params.set('format', format);
  appendFilterValue(params, 'q', filters.q);
  appendFilterValue(params, 'status', filters.status);
  appendFilterValue(params, 'category', filters.category);
  appendFilterValue(params, 'priority', filters.priority);
  appendFilterValue(params, 'distressType', filters.distressType);
  appendFilterValue(params, 'sceneTag', filters.sceneTag);
  appendFilterValue(params, 'assignedTo', filters.assignedTo);
  appendFilterValue(params, 'startDate', filters.startDate);
  appendFilterValue(params, 'endDate', filters.endDate);
  appendFilterValue(params, 'updatedAfter', filters.updatedAfter);
  appendFilterValue(params, 'hasNotes', filters.hasNotes);
  appendFilterValue(params, 'hasReplies', filters.hasReplies);
  appendFilterValue(params, 'isAssigned', filters.isAssigned);
  appendFilterValue(params, 'slaStatus', filters.slaStatus);
  return params.toString();
}

function syncUrl(page = state.page) {
  const filters = getFilters();
  const params = new URLSearchParams();
  params.set('page', String(page));
  params.set('period', state.metricsPeriod);
  appendFilterValue(params, 'q', filters.q);
  appendFilterValue(params, 'status', filters.status);
  appendFilterValue(params, 'category', filters.category);
  appendFilterValue(params, 'priority', filters.priority);
  appendFilterValue(params, 'distressType', filters.distressType);
  appendFilterValue(params, 'sceneTag', filters.sceneTag);
  appendFilterValue(params, 'assignedTo', filters.assignedTo);
  appendFilterValue(params, 'startDate', filters.startDate);
  appendFilterValue(params, 'endDate', filters.endDate);
  appendFilterValue(params, 'updatedAfter', filters.updatedAfter);
  appendFilterValue(params, 'hasNotes', filters.hasNotes);
  appendFilterValue(params, 'hasReplies', filters.hasReplies);
  appendFilterValue(params, 'isAssigned', filters.isAssigned);
  appendFilterValue(params, 'slaStatus', filters.slaStatus);
  appendFilterValue(params, 'sortField', filters.sortField);
  appendFilterValue(params, 'sortOrder', filters.sortOrder);
  const next = params.toString();
  const target = next ? `${window.location.pathname}?${next}` : window.location.pathname;
  window.history.replaceState(null, '', target);
}
function restoreFiltersFromUrl() {
  const params = new URLSearchParams(window.location.search);
  state.page = Math.max(1, Number(params.get('page')) || 1);
  state.metricsPeriod = params.get('period') || 'week';
  document.getElementById('searchInput').value = params.get('q') || '';
  document.getElementById('assignedToFilter').value = params.get('assignedTo') || '';
  document.getElementById('startDateFilter').value = params.get('startDate') || '';
  document.getElementById('endDateFilter').value = params.get('endDate') || '';
  document.getElementById('updatedAfterFilter').value = params.get('updatedAfter') || '';
  document.getElementById('hasNotesFilter').value = params.get('hasNotes') || '';
  document.getElementById('hasRepliesFilter').value = params.get('hasReplies') || '';
  document.getElementById('isAssignedFilter').value = params.get('isAssigned') || '';
  document.getElementById('slaStatusFilter').value = params.get('slaStatus') || '';
  document.getElementById('sortFieldFilter').value = params.get('sortField') || 'createdAt';
  document.getElementById('sortOrderFilter').value = params.get('sortOrder') || 'desc';
  setMultiFilterValues('status', (params.get('status') || '').split(',').filter(Boolean));
  setMultiFilterValues('category', (params.get('category') || '').split(',').filter(Boolean));
  setMultiFilterValues('priority', (params.get('priority') || '').split(',').filter(Boolean));
  setMultiFilterValues('distressType', (params.get('distressType') || '').split(',').filter(Boolean));
  setMultiFilterValues('sceneTag', (params.get('sceneTag') || '').split(',').filter(Boolean));
  updatePeriodButtons();
}

function syncAdvancedAdminFiltersState() {
  const details = document.getElementById('advancedAdminFilters');
  if (!(details instanceof HTMLDetailsElement)) {
    return;
  }

  const hasAdvancedFilters = Boolean(
    document.getElementById('assignedToFilter').value.trim()
    || document.getElementById('updatedAfterFilter').value
    || document.getElementById('hasNotesFilter').value
    || document.getElementById('hasRepliesFilter').value
    || document.getElementById('isAssignedFilter').value
    || document.getElementById('slaStatusFilter').value
    || getMultiFilterValues('distressType').length > 0
    || getMultiFilterValues('sceneTag').length > 0
    || document.getElementById('sortFieldFilter').value !== 'createdAt'
    || document.getElementById('sortOrderFilter').value !== 'desc',
  );

  details.open = hasAdvancedFilters;
}

function pushSearchHistory(term) {
  const normalized = term.trim();
  if (!normalized) {
    return;
  }

  state.searchHistory = [normalized, ...state.searchHistory.filter((item) => item !== normalized)].slice(0, MAX_HISTORY_ITEMS);
  saveStorageArray(SEARCH_HISTORY_KEY, state.searchHistory);
  renderSearchHistory();
}

function pushExportHistory(entry) {
  state.exportHistory = [entry, ...state.exportHistory].slice(0, MAX_HISTORY_ITEMS);
  saveStorageArray(EXPORT_HISTORY_KEY, state.exportHistory);
  renderExportHistory();
}

function renderSearchHistory() {
  const container = document.getElementById('adminSearchHistory');
  if (state.searchHistory.length === 0) {
    container.innerHTML = '';
    updateSearchSuggestions();
    return;
  }

  container.innerHTML = state.searchHistory.map((item) => `
    <button class="history-chip rounded-full px-3 py-2 text-xs font-semibold transition hover:bg-white" type="button" data-history-term="${escapeHtml(item)}">${escapeHtml(item)}</button>
  `).join('');

  container.querySelectorAll('[data-history-term]').forEach((button) => {
    button.addEventListener('click', () => {
      document.getElementById('searchInput').value = button.dataset.historyTerm || '';
      loadDashboard(1, { refreshMetrics: false }).catch((error) => setNotification('adminNotification', error.message, 'error'));
    });
  });

  updateSearchSuggestions();
}

function updateSearchSuggestions() {
  const datalist = document.getElementById('adminSearchSuggestions');
  const dynamicValues = state.issues.slice(0, 10).flatMap((item) => [item.trackingCode, item.assignedTo]).filter(Boolean);
  const options = Array.from(new Set([...state.searchHistory, ...dynamicValues])).slice(0, 12);
  datalist.innerHTML = options.map((value) => `<option value="${escapeHtml(value)}"></option>`).join('');
}

function renderExportHistory() {
  const container = document.getElementById('exportHistoryList');
  if (state.exportHistory.length === 0) {
    container.innerHTML = '<div class="empty-state rounded-[1.3rem] px-4 py-5 text-sm leading-7 text-[#5f6b80]">还没有导出记录。点击上方“导出文件”后，这里会保留最近的导出时间和筛选摘要。</div>';
    return;
  }

  container.innerHTML = state.exportHistory.map((entry) => `
    <article class="rounded-[1.3rem] border border-[rgba(23,32,51,0.08)] bg-white/72 p-4">
      <div class="text-sm font-semibold text-[#172033]">${escapeHtml(entry.filename)}</div>
      <div class="mt-2 text-xs uppercase tracking-[0.24em] text-[#72809a]">${escapeHtml(formatDate(entry.createdAt))}</div>
      <div class="mt-3 text-sm leading-6 text-[#4c566b]">${escapeHtml(entry.summary)}</div>
    </article>
  `).join('');
}

function renderActiveFilterChips(filters) {
  const chips = [];
  if (filters.q) chips.push({ key: 'q', label: `关键词: ${filters.q}` });
  filters.status.forEach((value) => chips.push({ key: 'status', value, label: `状态: ${statusLabels[value] || value}` }));
  filters.category.forEach((value) => chips.push({ key: 'category', value, label: `分类: ${categoryLabels[value] || value}` }));
  filters.priority.forEach((value) => chips.push({ key: 'priority', value, label: `优先级: ${priorityLabels[value] || value}` }));
  filters.distressType.forEach((value) => chips.push({ key: 'distressType', value, label: `困扰: ${distressTypeLabels[value] || value}` }));
  filters.sceneTag.forEach((value) => chips.push({ key: 'sceneTag', value, label: `场景: ${sceneTagLabels[value] || value}` }));
  if (filters.assignedTo) chips.push({ key: 'assignedTo', label: `指派: ${filters.assignedTo}` });
  if (filters.startDate) chips.push({ key: 'startDate', label: `开始: ${filters.startDate}` });
  if (filters.endDate) chips.push({ key: 'endDate', label: `结束: ${filters.endDate}` });
  if (filters.updatedAfter) chips.push({ key: 'updatedAfter', label: `更新晚于: ${filters.updatedAfter}` });
  if (filters.hasNotes) chips.push({ key: 'hasNotes', label: filters.hasNotes === 'true' ? '有备注' : '无备注' });
  if (filters.hasReplies) chips.push({ key: 'hasReplies', label: filters.hasReplies === 'true' ? '有回复' : '无回复' });
  if (filters.isAssigned) chips.push({ key: 'isAssigned', label: filters.isAssigned === 'true' ? '已分配' : '未分配' });
  if (filters.slaStatus) chips.push({ key: 'slaStatus', label: `SLA: ${slaStatusLabels[filters.slaStatus] || filters.slaStatus}` });
  if (filters.sortField !== 'createdAt' || filters.sortOrder !== 'desc') {
    chips.push({
      key: 'sort',
      label: `排序: ${filters.sortField === 'updatedAt' ? '更新时间' : filters.sortField === 'priority' ? '优先级' : '提交时间'} ${filters.sortOrder === 'asc' ? '升序' : '降序'}`,
    });
  }
  const container = document.getElementById('activeFilterChips');
  container.innerHTML = chips.map((chip) => `
    <span class="filter-chip">
      ${escapeHtml(chip.label)}
      <button class="filter-chip__remove" type="button" data-clear-filter="${escapeHtml(chip.key)}" data-clear-value="${escapeHtml(chip.value || '')}" aria-label="移除筛选 ${escapeHtml(chip.label)}">×</button>
    </span>
  `).join('');

}

function clearFilter(key, value = '') {
  if (!CLEARABLE_FILTER_KEYS.has(key)) {
    return;
  }

  const multiKeys = ['status', 'category', 'priority', 'distressType', 'sceneTag'];
  if (multiKeys.includes(key)) {
    setMultiFilterValues(key, getMultiFilterValues(key).filter((item) => item !== value));
    if (key === 'distressType' || key === 'sceneTag') {
      syncAdvancedAdminFiltersState();
    }
    return;
  }

  const resetMap = {
    q: () => { document.getElementById('searchInput').value = ''; },
    assignedTo: () => { document.getElementById('assignedToFilter').value = ''; },
    startDate: () => { document.getElementById('startDateFilter').value = ''; },
    endDate: () => { document.getElementById('endDateFilter').value = ''; },
    updatedAfter: () => { document.getElementById('updatedAfterFilter').value = ''; },
    hasNotes: () => { document.getElementById('hasNotesFilter').value = ''; },
    hasReplies: () => { document.getElementById('hasRepliesFilter').value = ''; },
    isAssigned: () => { document.getElementById('isAssignedFilter').value = ''; },
    slaStatus: () => { document.getElementById('slaStatusFilter').value = ''; },
    sort: () => {
      document.getElementById('sortFieldFilter').value = 'createdAt';
      document.getElementById('sortOrderFilter').value = 'desc';
    },
  };

  resetMap[key]?.();
  syncAdvancedAdminFiltersState();
}

function renderQueueSummary(pagination, filters) {
  document.getElementById('queueSummary').textContent = `共 ${pagination.total} 条 · 第 ${pagination.page} / ${Math.max(pagination.totalPages, 1)} 页 · ${summarizeFilters(filters)}`;
}

function renderPagination(container, pagination, onChange) {
  if (!pagination || pagination.totalPages <= 1) {
    container.innerHTML = '';
    return;
  }

  const { page, totalPages } = pagination;
  const start = Math.max(1, page - 2);
  const end = Math.min(totalPages, start + 4);
  const buttons = [`<button class="ghost-button rounded-full px-4 py-2 text-sm font-medium disabled:cursor-not-allowed disabled:opacity-40" data-page="${page - 1}" aria-label="上一页" ${page === 1 ? 'disabled' : ''}>上一页</button>`];
  for (let current = start; current <= end; current += 1) {
    const active = current === page;
    buttons.push(`<button class="rounded-full px-4 py-2 text-sm font-semibold ${active ? 'bg-[#172033] text-white' : 'ghost-button text-[#172033]'}" data-page="${current}" aria-label="第 ${current} 页" ${active ? 'aria-current="page" disabled' : ''}>${current}</button>`);
  }
  buttons.push(`<button class="ghost-button rounded-full px-4 py-2 text-sm font-medium disabled:cursor-not-allowed disabled:opacity-40" data-page="${page + 1}" aria-label="下一页" ${page === totalPages ? 'disabled' : ''}>下一页</button>`);
  container.innerHTML = `<nav class="flex flex-wrap items-center justify-center gap-2" aria-label="后台问题分页">${buttons.join('')}</nav>`;
  container.querySelectorAll('button[data-page]').forEach((button) => {
    button.addEventListener('click', () => {
      const nextPage = Number(button.dataset.page);
      if (Number.isFinite(nextPage) && nextPage >= 1 && nextPage <= totalPages && nextPage !== page) {
        onChange(nextPage);
      }
    });
  });
}

function renderMetrics(metrics) {
  state.metrics = metrics;
  const overview = metrics.overview || {};
  document.getElementById('metricTotalIssues').textContent = overview.totalIssues || 0;
  document.getElementById('metricPendingIssues').textContent = overview.pendingIssues || 0;
  document.getElementById('metricCreatedThisPeriod').textContent = overview.createdThisPeriod || 0;
  document.getElementById('metricResolvedThisPeriod').textContent = overview.resolvedThisPeriod || 0;
  document.getElementById('metricAvgFirstResponse').textContent = formatDuration(overview.avgFirstResponseTime);
  document.getElementById('metricAvgResolution').textContent = formatDuration(overview.avgResolutionTime);
  document.getElementById('metricResolutionRate').textContent = `解决率 ${Number(overview.resolutionRate || 0).toFixed(2)}%`;

  const rangeText = metrics.range?.startDate || metrics.range?.endDate
    ? `${metrics.range.startDate || '最早'} 至 ${metrics.range.endDate || '最新'} · ${state.metricsPeriod === 'day' ? '日趋势' : state.metricsPeriod === 'month' ? '月趋势' : '周趋势'}`
    : `全部数据 · ${state.metricsPeriod === 'day' ? '日趋势' : state.metricsPeriod === 'month' ? '月趋势' : '周趋势'}`;
  document.getElementById('metricsRangeLabel').textContent = rangeText;
  renderStatusDonut(metrics.byStatus || {}, overview.totalIssues || 0);
  renderCategoryBars(metrics.byCategory || {});
  renderDistressBars(metrics.byDistressType || {});
  renderSceneBars(metrics.bySceneTag || {});
  renderPriorityBars(metrics.byPriority || {});
  renderPerformance(metrics.performance || {});
  renderTrendChart(metrics.trends || {});
}

function renderStatusDonut(byStatus, total) {
  const donut = document.getElementById('statusDonut');
  const legend = document.getElementById('statusLegend');
  const center = document.getElementById('statusDonutCenter');
  const segments = [];
  let offset = 0;
  for (const status of Object.keys(statusLabels)) {
    const count = Number(byStatus[status]) || 0;
    const ratio = total > 0 ? count / total : 0;
    const start = offset * 360;
    const end = (offset + ratio) * 360;
    segments.push(`${statusColors[status]} ${start}deg ${end}deg`);
    offset += ratio;
  }
  donut.style.background = total > 0 ? `conic-gradient(${segments.join(', ')})` : 'conic-gradient(rgba(23,32,51,0.08) 0deg 360deg)';
  const topStatus = Object.keys(statusLabels)
    .map((status) => ({ status, count: Number(byStatus[status] || 0) }))
    .sort((left, right) => right.count - left.count)[0];
  donut.setAttribute('role', 'img');
  donut.setAttribute('aria-label', total > 0 ? `状态分布，总计 ${total} 条，最多为 ${statusLabels[topStatus.status]} ${topStatus.count} 条。` : '状态分布暂无数据。');
  center.innerHTML = `<div class="text-xs uppercase tracking-[0.24em] text-[#72809a]">样本量</div><div class="mt-1 text-2xl font-black text-[#172033]">${total}</div>`;
  legend.innerHTML = Object.keys(statusLabels).map((status) => `
    <div class="flex items-center justify-between gap-4 rounded-[1.2rem] border border-[rgba(23,32,51,0.08)] bg-white/68 px-4 py-3">
      <div class="inline-flex items-center gap-3 text-sm text-[#172033]"><span class="h-3 w-3 rounded-full" style="background:${statusColors[status]}"></span>${escapeHtml(statusLabels[status])}</div>
      <div class="text-sm font-semibold text-[#4c566b]">${Number(byStatus[status] || 0)}</div>
    </div>
  `).join('');
}

function renderLinearBars(targetId, entries, toneResolver) {
  const container = document.getElementById(targetId);
  const maxValue = Math.max(1, ...entries.map(([, count]) => Number(count) || 0));
  container.innerHTML = entries.map(([label, count]) => {
    const numeric = Number(count) || 0;
    const percentage = Math.round((numeric / maxValue) * 100);
    return `
      <div>
        <div class="mb-2 flex items-center justify-between gap-4 text-sm text-[#25314a]">
          <span>${escapeHtml(label)}</span>
          <strong>${numeric}</strong>
        </div>
        <div class="bar-track"><div class="bar-fill" data-tone="${toneResolver(label)}" style="width:${percentage}%"></div></div>
      </div>
    `;
  }).join('');
}

function renderCategoryBars(byCategory) {
  renderLinearBars('categoryBars', Object.entries(categoryLabels).map(([value, label]) => [label, byCategory[value] || 0]), () => 'warm');
}

function renderDistressBars(byDistressType) {
  const rows = Object.entries(distressTypeLabels).map(([value, label]) => [
    label,
    byDistressType[value] || 0,
  ]);
  renderLinearBars('distressBars', rows, () => 'ink');
}

function renderSceneBars(bySceneTag) {
  const rows = Object.entries(sceneTagLabels).map(([value, label]) => [
    label,
    bySceneTag[value] || 0,
  ]);
  renderLinearBars('sceneBars', rows, () => 'mint');
}

function renderPriorityBars(byPriority) {
  renderLinearBars('priorityBars', [
    ['紧急', byPriority.urgent || 0],
    ['高', byPriority.high || 0],
    ['普通', byPriority.normal || 0],
    ['低', byPriority.low || 0],
  ], (label) => (label === '紧急' ? 'ink' : label === '高' ? 'warm' : label === '低' ? 'mint' : ''));
}

function renderPerformance(performance) {
  const container = document.getElementById('performanceBlocks');
  const first = performance.firstResponseTime || { p50: 0, p75: 0, p95: 0 };
  const resolution = performance.resolutionTime || { p50: 0, p75: 0, p95: 0 };
  container.innerHTML = [
    ['首次响应分位', first],
    ['解决时长分位', resolution],
  ].map(([title, values]) => `
    <article class="rounded-[1.3rem] border border-[rgba(23,32,51,0.08)] bg-white/72 p-4">
      <div class="text-sm font-semibold text-[#172033]">${title}</div>
      <div class="mt-3 grid gap-2 text-sm text-[#4c566b]">
        <div class="flex items-center justify-between"><span>P50</span><strong>${formatDuration(values.p50)}</strong></div>
        <div class="flex items-center justify-between"><span>P75</span><strong>${formatDuration(values.p75)}</strong></div>
        <div class="flex items-center justify-between"><span>P95</span><strong>${formatDuration(values.p95)}</strong></div>
      </div>
    </article>
  `).join('');
}

function renderTrendChart(trends) {
  const container = document.getElementById('trendChart');
  const data = state.metricsPeriod === 'day' ? trends.daily || [] : state.metricsPeriod === 'month' ? trends.monthly || [] : trends.weekly || [];
  if (!data.length) {
    container.innerHTML = '<div class="empty-state rounded-[1.4rem] px-5 py-10 text-center text-sm leading-7 text-[#5f6b80]">当前统计范围内没有趋势数据。</div>';
    return;
  }

  const width = 640;
  const height = 260;
  const padding = 28;
  const chartWidth = width - padding * 2;
  const chartHeight = height - padding * 2;
  const maxValue = Math.max(1, ...data.flatMap((item) => [Number(item.created) || 0, Number(item.resolved) || 0]));
  const labelKey = state.metricsPeriod === 'day' ? 'date' : state.metricsPeriod === 'month' ? 'month' : 'week';
  const xStep = data.length > 1 ? chartWidth / (data.length - 1) : 0;
  const getX = (index) => (data.length === 1 ? width / 2 : padding + index * xStep);
  const getY = (value) => height - padding - (value / maxValue) * chartHeight;
  const toPoint = (index, value) => `${getX(index)},${getY(value)}`;
  const createdPoints = data.map((item, index) => toPoint(index, Number(item.created) || 0)).join(' ');
  const resolvedPoints = data.map((item, index) => toPoint(index, Number(item.resolved) || 0)).join(' ');
  const grid = Array.from({ length: 4 }, (_, index) => {
    const y = padding + (chartHeight / 3) * index;
    return `<line x1="${padding}" y1="${y}" x2="${width - padding}" y2="${y}" stroke="rgba(23,32,51,0.08)" stroke-width="1" />`;
  }).join('');
  const markerGuides = data.length === 1
    ? `<line x1="${width / 2}" y1="${padding}" x2="${width / 2}" y2="${height - padding}" stroke="rgba(23,32,51,0.1)" stroke-width="1" stroke-dasharray="4 4" />`
    : '';
  const createdMarkers = data.map((item, index) => {
    const x = getX(index);
    const y = getY(Number(item.created) || 0);
    return `<circle cx="${x}" cy="${y}" r="5.5" fill="#2457d6" stroke="rgba(255,255,255,0.92)" stroke-width="2.5"></circle>`;
  }).join('');
  const resolvedMarkers = data.map((item, index) => {
    const x = getX(index);
    const y = getY(Number(item.resolved) || 0);
    return `<circle cx="${x}" cy="${y}" r="4" fill="#13795b" stroke="rgba(255,255,255,0.92)" stroke-width="2"></circle>`;
  }).join('');
  const labels = data.filter((_, index) => index === 0 || index === data.length - 1 || index % Math.max(1, Math.floor(data.length / 4)) === 0).map((item) => item[labelKey]);
  const totalCreated = data.reduce((sum, item) => sum + (Number(item.created) || 0), 0);
  const totalResolved = data.reduce((sum, item) => sum + (Number(item.resolved) || 0), 0);
  const summary = `${state.metricsPeriod === 'day' ? '日' : state.metricsPeriod === 'month' ? '月' : '周'}趋势：新增 ${totalCreated} 条，解决 ${totalResolved} 条。`;
  container.innerHTML = `
    <svg viewBox="0 0 ${width} ${height}" class="h-[260px] w-full" role="img" aria-labelledby="adminTrendTitle adminTrendDesc">
      <title id="adminTrendTitle">处理趋势图表</title>
      <desc id="adminTrendDesc">${escapeHtml(summary)}</desc>
      ${grid}
      ${markerGuides}
      <polyline fill="none" stroke="#2457d6" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" points="${createdPoints}"></polyline>
      <polyline fill="none" stroke="#13795b" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" points="${resolvedPoints}"></polyline>
      ${createdMarkers}
      ${resolvedMarkers}
    </svg>
    <div class="mt-4 flex flex-wrap gap-2 text-xs uppercase tracking-[0.18em] text-[#72809a]">
      ${labels.map((label) => `<span class="rounded-full bg-[rgba(23,32,51,0.06)] px-3 py-1">${escapeHtml(label)}</span>`).join('')}
    </div>
    <div class="chart-summary">${escapeHtml(summary)}</div>
  `;
}

function getSelectedIssueIds() {
  return Array.from(state.selectedIssueIds);
}

function syncBatchToolbar() {
  const toolbar = document.getElementById('batchToolbar');
  const count = state.selectedIssueIds.size;
  if (!toolbar) {
    return;
  }

  toolbar.hidden = state.issues.length === 0;
  document.getElementById('batchSelectionCount').textContent = `已选择 ${count} 条`;
  document.getElementById('executeBatchButton').disabled = count === 0;
  const selectAll = document.getElementById('selectAllIssues');
  selectAll.checked = state.issues.length > 0 && state.issues.every((item) => state.selectedIssueIds.has(item.id));
  selectAll.indeterminate = count > 0 && !selectAll.checked;
  document.querySelectorAll('[data-issue-select]').forEach((input) => {
    input.checked = state.selectedIssueIds.has(Number(input.value));
  });
}

function buildBatchPayload() {
  const updates = {};
  const status = document.getElementById('batchStatus').value;
  const priority = document.getElementById('batchPriority').value;
  const assignedTo = document.getElementById('batchAssignedTo').value.trim();

  if (status) updates.status = status;
  if (priority) updates.priority = priority;
  if (assignedTo) updates.assignedTo = assignedTo;

  const selectedIds = getSelectedIssueIds();
  const selectedIssues = state.issues.filter((item) => selectedIds.includes(item.id));
  const updatedAt = selectedIssues.reduce((latest, item) => (item.updatedAt > latest ? item.updatedAt : latest), '');

  return {
    issueIds: selectedIds,
    updates,
    updatedAt,
  };
}

function summarizeBatchPayload(payload) {
  const parts = [];
  if (payload.updates.status) parts.push(`状态改为 ${statusLabels[payload.updates.status] || payload.updates.status}`);
  if (payload.updates.priority) parts.push(`优先级改为 ${priorityLabels[payload.updates.priority] || payload.updates.priority}`);
  if (payload.updates.assignedTo) parts.push(`指派给 ${payload.updates.assignedTo}`);
  return `将对 ${payload.issueIds.length} 条问题执行：${parts.join('、')}`;
}

function openBatchConfirm() {
  const payload = buildBatchPayload();
  if (payload.issueIds.length === 0) {
    setNotification('batchNotification', '请先选择至少一个问题。', 'error');
    return;
  }

  if (Object.keys(payload.updates).length === 0) {
    setNotification('batchNotification', '请选择至少一种批量更新内容。', 'error');
    return;
  }

  state.pendingBatchPayload = payload;
  document.getElementById('batchConfirmSummary').textContent = summarizeBatchPayload(payload);
  document.getElementById('batchConfirmModal').hidden = false;
}

function closeBatchConfirm() {
  state.pendingBatchPayload = null;
  document.getElementById('batchConfirmModal').hidden = true;
}

async function executeBatchUpdate() {
  if (!state.pendingBatchPayload) {
    return;
  }

  const button = document.getElementById('batchConfirmButton');
  const payload = state.pendingBatchPayload;
  try {
    setButtonBusy(button, true, '执行中...');
    setNotification('batchNotification', '正在执行批量操作...', 'loading');
    const result = await apiFetch('/admin/issues/batch', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    closeBatchConfirm();
    state.selectedIssueIds.clear();
    document.getElementById('batchStatus').value = '';
    document.getElementById('batchPriority').value = '';
    document.getElementById('batchAssignedTo').value = '';
    await loadDashboard(state.page, { refreshMetrics: true });
    const failedText = result.failedIds?.length ? `，失败 ${result.failedIds.length} 条` : '';
    setNotification('batchNotification', `批量操作完成：成功 ${result.updatedCount} 条${failedText}。`, result.failedIds?.length ? 'info' : 'success');
  } catch (error) {
    setNotification('batchNotification', error.message, 'error');
  } finally {
    setButtonBusy(button, false, '', '确认执行');
  }
}

function renderIssueList(items, pagination) {
  const filters = getFilters();
  const container = document.getElementById('issuesList');
  state.issues = items;
  state.selectedIssueIds = new Set([...state.selectedIssueIds].filter((id) => items.some((item) => item.id === id)));
  updateSearchSuggestions();
  renderActiveFilterChips(filters);
  renderQueueSummary(pagination, filters);
  syncBatchToolbar();

  if (!items.length) {
    container.innerHTML = `
      <div class="empty-state text-center">
        <div>当前筛选条件下没有问题。</div>
        <button class="ghost-button mt-4 px-4 py-2 text-sm font-semibold" type="button" data-empty-reset>清空筛选</button>
      </div>
    `;
    container.querySelector('[data-empty-reset]')?.addEventListener('click', () => {
      document.getElementById('resetFilters').click();
    });
    document.getElementById('paginationContainer').innerHTML = '';
    syncBatchToolbar();
    return;
  }

  container.innerHTML = items.map((item) => `
    <article role="listitem" class="issue-card interactive-card rounded-[1.7rem] p-5 md:p-6">
      <div class="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div class="space-y-3">
          <div class="flex flex-wrap items-center gap-2">
            <label class="inline-flex items-center gap-2 rounded-full bg-white/80 px-3 py-1 text-xs font-semibold text-[#172033]"><input data-issue-select type="checkbox" value="${item.id}" class="h-4 w-4 rounded border-[#b9c3d6] text-[#2457d6] focus:ring-[#2457d6]" ${state.selectedIssueIds.has(item.id) ? 'checked' : ''}>选择</label>
            <span class="status-token" data-status="${escapeHtml(item.status)}">${escapeHtml(statusLabels[item.status] || item.status)}</span>
            <span class="priority-token" data-priority="${escapeHtml(item.priority)}">${escapeHtml(priorityLabels[item.priority] || item.priority)}</span>
            <span class="category-token">${escapeHtml(categoryLabels[item.category] || item.category)}</span>
            ${renderSlaStatusBadge(item.slaStatus, formatSlaCountdown(item))}
            ${item.category === 'counseling' && item.distressType ? `<span class="mini-token">${escapeHtml(distressTypeLabels[item.distressType] || item.distressType)}</span>` : ''}
            ${item.category === 'counseling' && item.sceneTag ? `<span class="mini-token">${escapeHtml(sceneTagLabels[item.sceneTag] || item.sceneTag)}</span>` : ''}
            ${item.hasNotes ? `<span class="mini-token">备注 ${item.noteCount}</span>` : ''}
            ${item.hasReplies ? `<span class="mini-token">回复 ${item.replyCount}</span>` : ''}
          </div>
          <div>
            <div class="text-xs font-semibold uppercase tracking-[0.28em] text-[#72809a]">${escapeHtml(item.trackingCode)}</div>
            <div class="mt-2 text-base leading-7 text-[#172033]">${highlightText(item.content, filters.q)}</div>
          </div>
          <div class="grid gap-2 text-sm text-[#4c566b] sm:grid-cols-2 lg:grid-cols-3">
            <div><strong class="text-[#172033]">姓名：</strong>${escapeHtml(item.name)}</div>
            <div><strong class="text-[#172033]">学号：</strong>${escapeHtml(item.studentId)}</div>
            <div><strong class="text-[#172033]">指派：</strong>${highlightText(item.assignedTo || '未指派', filters.q)}</div>
            <div><strong class="text-[#172033]">分配：</strong>${escapeHtml(formatDate(item.assignedAt))}</div>
            <div><strong class="text-[#172033]">公开：</strong>${item.isPublic ? '是' : '否'}</div>
            <div><strong class="text-[#172033]">上报：</strong>${item.isReported ? '是' : '否'}</div>
            <div><strong class="text-[#172033]">困扰：</strong>${item.category === 'counseling' && item.distressType ? escapeHtml(distressTypeLabels[item.distressType] || item.distressType) : '无'}</div>
            <div><strong class="text-[#172033]">场景：</strong>${item.category === 'counseling' && item.sceneTag ? escapeHtml(sceneTagLabels[item.sceneTag] || item.sceneTag) : '无'}</div>
            <div><strong class="text-[#172033]">SLA 响应：</strong>${escapeHtml(formatDate(item.slaResponseDeadline))}</div>
            <div><strong class="text-[#172033]">SLA 解决：</strong>${escapeHtml(formatDate(item.slaResolutionDeadline))}</div>
            <div><strong class="text-[#172033]">更新：</strong>${escapeHtml(formatDate(item.updatedAt))}</div>
          </div>
        </div>
        <div class="flex flex-col gap-3 lg:min-w-[240px]">
          <div class="rounded-[1.3rem] border border-[rgba(23,32,51,0.08)] bg-white/75 px-4 py-3 text-sm text-[#4c566b]">
            <div><strong class="text-[#172033]">提交：</strong>${escapeHtml(formatDate(item.createdAt))}</div>
            <div class="mt-2"><strong class="text-[#172033]">摘要：</strong>${highlightText(item.publicSummary || '暂无', filters.q)}</div>
          </div>
          <button class="open-detail dark-button rounded-full px-4 py-3 text-sm font-semibold transition" type="button" data-id="${item.id}">查看详情</button>
        </div>
      </div>
    </article>
  `).join('');

  container.querySelectorAll('.open-detail').forEach((button) => {
    button.addEventListener('click', () => openDrawer(Number(button.dataset.id), button));
  });
  container.querySelectorAll('[data-issue-select]').forEach((input) => {
    input.addEventListener('change', () => {
      const issueId = Number(input.value);
      if (input.checked) {
        state.selectedIssueIds.add(issueId);
      } else {
        state.selectedIssueIds.delete(issueId);
      }
      syncBatchToolbar();
    });
  });

  renderPagination(document.getElementById('paginationContainer'), pagination, (nextPage) => loadDashboard(nextPage, { refreshMetrics: false }).catch((error) => setNotification('adminNotification', error.message, 'error')));
  syncBatchToolbar();
}

async function loadIssues(page = 1) {
  state.page = page;
  const issuesList = document.getElementById('issuesList');
  issuesList.setAttribute('aria-busy', 'true');
  issuesList.innerHTML = renderSkeleton('list', 4);
  try {
    const data = await apiFetch(`/admin/issues?${buildListQuery(page)}`);
    state.availableAssignees = data.meta?.availableAssignees || [];
    document.getElementById('assigneeSuggestions').innerHTML = state.availableAssignees.map((value) => `<option value="${escapeHtml(value)}"></option>`).join('');
    renderIssueList(data.items || [], data.pagination);
    return data;
  } finally {
    issuesList.setAttribute('aria-busy', 'false');
  }
}

async function loadMetrics(refresh = false) {
  const skeleton = document.getElementById('metricsSkeleton');
  const grid = document.getElementById('metricsGrid');
  skeleton.innerHTML = renderSkeleton('stats', 6);
  skeleton.hidden = false;
  grid.hidden = true;
  try {
    const data = await apiFetch(`/admin/metrics?${buildMetricsQuery(refresh)}`);
    renderMetrics(data);
    return data;
  } finally {
    skeleton.hidden = true;
    grid.hidden = false;
  }
}

async function loadDashboard(page = 1, { refreshMetrics = false } = {}) {
  syncUrl(page);
  const filters = getFilters();
  if (filters.q) {
    pushSearchHistory(filters.q);
  }
  const [issuesResult] = await Promise.all([
    loadIssues(page),
    loadMetrics(refreshMetrics),
    loadAssignStats(),
    loadSlaAlerts(),
  ]);
  setNotification('adminNotification', '');
  setNotification('metricsNotification', '');
  return issuesResult;
}

function getActiveKnowledgeItem() {
  if (!state.editingKnowledgeId) {
    return null;
  }

  return state.knowledgeItems.find((item) => item.id === state.editingKnowledgeId) || null;
}

function resetKnowledgeForm() {
  state.editingKnowledgeId = null;
  document.getElementById('knowledgeForm').reset();
  document.getElementById('knowledgeSortOrder').value = '0';
  document.getElementById('knowledgeIsEnabled').checked = true;
  document.getElementById('knowledgeFormTitle').textContent = '新增知识条目';
  document.getElementById('knowledgeSaveButton').textContent = '保存条目';
  document.getElementById('knowledgeCancelEdit').hidden = true;
}

function renderKnowledgeList() {
  const container = document.getElementById('knowledgeList');
  const summary = document.getElementById('knowledgeSummary');
  const enabledCount = state.knowledgeItems.filter((item) => item.isEnabled).length;
  summary.textContent = `共 ${state.knowledgeItems.length} 条，启用 ${enabledCount} 条。`;

  if (state.knowledgeItems.length === 0) {
    container.innerHTML = '<div class="empty-state rounded-[1.4rem] px-5 py-8 text-center text-sm leading-7 text-[#5f6b80]">还没有知识条目。使用左侧表单新增第一条公开建议。</div>';
    return;
  }

  container.innerHTML = state.knowledgeItems.map((item) => `
    <article class="interactive-card rounded-[1.4rem] border border-[rgba(23,32,51,0.08)] bg-white/72 p-5">
      <div class="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div class="min-w-0">
          <div class="flex flex-wrap items-center gap-2">
            <span class="mini-token">${escapeHtml(distressTypeLabels[item.tag] || item.tag)}</span>
            <span class="rounded-full px-3 py-1 text-xs font-semibold ${item.isEnabled ? 'bg-[rgba(19,121,91,0.12)] text-[#13795b]' : 'bg-[rgba(23,32,51,0.08)] text-[#4c566b]'}">${item.isEnabled ? '已启用' : '已禁用'}</span>
            <span class="text-xs uppercase tracking-[0.22em] text-[#72809a]">排序 ${escapeHtml(String(item.sortOrder))}</span>
          </div>
          <h4 class="display-font mt-3 break-anywhere text-2xl text-[#172033]">${escapeHtml(item.title)}</h4>
          <p class="mt-3 break-anywhere text-sm leading-7 text-[#4c566b]">${escapeHtml(item.content)}</p>
          <div class="mt-3 text-xs uppercase tracking-[0.22em] text-[#72809a]">更新 ${escapeHtml(formatDate(item.updatedAt))}</div>
        </div>
        <div class="flex flex-wrap gap-2 lg:flex-col">
          <button class="knowledge-edit ghost-button rounded-full px-4 py-2 text-sm font-semibold text-[#172033] transition" type="button" data-id="${item.id}">编辑</button>
          <button class="knowledge-delete rounded-full border border-[rgba(180,35,24,0.22)] bg-white/80 px-4 py-2 text-sm font-semibold text-[#b42318] transition hover:bg-[rgba(180,35,24,0.08)]" type="button" data-id="${item.id}">删除</button>
        </div>
      </div>
    </article>
  `).join('');

  container.querySelectorAll('.knowledge-edit').forEach((button) => {
    button.addEventListener('click', () => startKnowledgeEdit(Number(button.dataset.id)));
  });
  container.querySelectorAll('.knowledge-delete').forEach((button) => {
    button.addEventListener('click', () => deleteKnowledgeItem(Number(button.dataset.id)));
  });
}

async function loadKnowledgeItems() {
  const container = document.getElementById('knowledgeList');
  container.setAttribute('aria-busy', 'true');
  container.innerHTML = renderSkeleton('list', 3);
  try {
    const data = await apiFetch('/admin/knowledge');
    state.knowledgeItems = data.items || [];
    renderKnowledgeList();
    setNotification('knowledgeNotification', '');
    return data;
  } finally {
    container.setAttribute('aria-busy', 'false');
  }
}

function startKnowledgeEdit(itemId) {
  const item = state.knowledgeItems.find((entry) => entry.id === itemId);
  if (!item) {
    return;
  }

  state.editingKnowledgeId = item.id;
  document.getElementById('knowledgeTitle').value = item.title;
  document.getElementById('knowledgeTag').value = item.tag;
  document.getElementById('knowledgeSortOrder').value = String(item.sortOrder);
  document.getElementById('knowledgeContent').value = item.content;
  document.getElementById('knowledgeIsEnabled').checked = item.isEnabled;
  document.getElementById('knowledgeFormTitle').textContent = '编辑知识条目';
  document.getElementById('knowledgeSaveButton').textContent = '保存修改';
  document.getElementById('knowledgeCancelEdit').hidden = false;
  document.getElementById('knowledgeTitle').focus();
}

function buildKnowledgePayload() {
  return {
    title: document.getElementById('knowledgeTitle').value.trim(),
    tag: document.getElementById('knowledgeTag').value,
    content: document.getElementById('knowledgeContent').value.trim(),
    sortOrder: Number(document.getElementById('knowledgeSortOrder').value) || 0,
    isEnabled: document.getElementById('knowledgeIsEnabled').checked,
  };
}

async function submitKnowledgeForm(event) {
  event.preventDefault();
  const button = document.getElementById('knowledgeSaveButton');
  const activeItem = getActiveKnowledgeItem();
  const payload = buildKnowledgePayload();

  if (!payload.title || !payload.content) {
    setNotification('knowledgeNotification', '标题和内容不能为空。', 'error');
    return;
  }

  const path = activeItem ? `/admin/knowledge/${activeItem.id}` : '/admin/knowledge';
  const method = activeItem ? 'PATCH' : 'POST';
  if (activeItem) {
    payload.updatedAt = activeItem.updatedAt;
  }

  try {
    setButtonBusy(button, true, activeItem ? '保存中...' : '新增中...');
    await apiFetch(path, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    resetKnowledgeForm();
    await loadKnowledgeItems();
    setNotification('knowledgeNotification', activeItem ? '知识条目已更新。' : '知识条目已新增。', 'success');
  } catch (error) {
    setNotification('knowledgeNotification', error.message, 'error');
  } finally {
    setButtonBusy(button, false, '', state.editingKnowledgeId ? '保存修改' : '保存条目');
  }
}

async function deleteKnowledgeItem(itemId) {
  const item = state.knowledgeItems.find((entry) => entry.id === itemId);
  if (!item) {
    return;
  }

  if (!window.confirm(`确定删除「${item.title}」吗？删除后首页不会再展示该条目。`)) {
    return;
  }

  try {
    await apiFetch(`/admin/knowledge/${item.id}`, {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ updatedAt: item.updatedAt }),
    });
    if (state.editingKnowledgeId === item.id) {
      resetKnowledgeForm();
    }
    await loadKnowledgeItems();
    setNotification('knowledgeNotification', '知识条目已删除。', 'success');
  } catch (error) {
    setNotification('knowledgeNotification', error.message, 'error');
  }
}

function getRoleLabel(role) {
  return role === 'admin' ? '管理员' : '处理者';
}

function renderUsers() {
  const container = document.getElementById('userList');
  if (!container) {
    return;
  }

  if (state.users.length === 0) {
    container.innerHTML = '<div class="empty-state rounded-[1.4rem] px-5 py-8 text-center text-sm leading-7 text-[#5f6b80]">暂无用户，或当前账号没有用户管理权限。</div>';
    return;
  }

  container.innerHTML = `
    <table class="w-full min-w-[760px] border-separate border-spacing-y-2 text-left text-sm">
      <thead class="text-xs uppercase tracking-[0.2em] text-[#72809a]">
        <tr>
          <th class="px-4 py-2">用户名</th>
          <th class="px-4 py-2">显示名</th>
          <th class="px-4 py-2">角色</th>
          <th class="px-4 py-2">状态</th>
          <th class="px-4 py-2">最后登录</th>
          <th class="px-4 py-2 text-right">操作</th>
        </tr>
      </thead>
      <tbody>
        ${state.users.map((user) => `
          <tr class="bg-white/72 align-middle">
            <td class="rounded-l-[1rem] px-4 py-3 font-semibold text-[#172033]">${escapeHtml(user.username)}</td>
            <td class="px-4 py-3 text-[#445069]">${escapeHtml(user.displayName)}</td>
            <td class="px-4 py-3"><span class="mini-token">${escapeHtml(getRoleLabel(user.role))}</span></td>
            <td class="px-4 py-3">
              <span class="rounded-full px-3 py-1 text-xs font-semibold ${user.isEnabled ? 'bg-[rgba(19,121,91,0.12)] text-[#13795b]' : 'bg-[rgba(178,58,50,0.12)] text-[#b23a32]'}">${user.isEnabled ? '启用' : '禁用'}</span>
            </td>
            <td class="px-4 py-3 text-[#5f6b80]">${escapeHtml(formatDate(user.lastLoginAt))}</td>
            <td class="rounded-r-[1rem] px-4 py-3 text-right">
              <button class="ghost-button rounded-full px-3 py-2 text-xs font-semibold text-[#172033]" type="button" data-user-action="edit" data-user-id="${user.id}">编辑</button>
              ${user.isEnabled
                ? `<button class="ghost-button rounded-full px-3 py-2 text-xs font-semibold text-[#b23a32]" type="button" data-user-action="disable" data-user-id="${user.id}">禁用</button>`
                : `<button class="ghost-button rounded-full px-3 py-2 text-xs font-semibold text-[#13795b]" type="button" data-user-action="enable" data-user-id="${user.id}">启用</button>`
              }
            </td>
          </tr>
        `).join('')}
      </tbody>
    </table>
  `;
}

async function loadUsers() {
  const container = document.getElementById('userList');
  if (!container) {
    return null;
  }

  container.setAttribute('aria-busy', 'true');
  container.innerHTML = renderFeedbackBox('正在加载用户列表', 'loading');
  try {
    const data = await apiFetch('/admin/users');
    state.users = data.items || [];
    renderUsers();
    setNotification('userNotification', '');
    return data;
  } catch (error) {
    state.users = [];
    renderUsers();
    setNotification('userNotification', error.message, error.message === '权限不足' ? 'info' : 'error');
    return null;
  } finally {
    container.setAttribute('aria-busy', 'false');
  }
}

function closeUserModal() {
  document.getElementById('userModal').hidden = true;
  state.editingUserId = null;
  document.getElementById('userForm').reset();
}

function openUserModal(user = null) {
  state.editingUserId = user?.id ?? null;
  document.getElementById('userModalTitle').textContent = user ? '编辑用户' : '创建用户';
  document.getElementById('usernameField').hidden = Boolean(user);
  document.getElementById('passwordField').hidden = Boolean(user);
  document.getElementById('userEnabledField').hidden = !user;
  document.getElementById('userUsername').value = user?.username || '';
  document.getElementById('userPassword').value = '';
  document.getElementById('userDisplayName').value = user?.displayName || '';
  document.getElementById('userRole').value = user?.role || 'handler';
  document.getElementById('userIsEnabled').checked = user?.isEnabled ?? true;
  document.getElementById('userModal').hidden = false;
  window.requestAnimationFrame(() => {
    document.getElementById(user ? 'userDisplayName' : 'userUsername')?.focus();
  });
}

async function submitUserForm(event) {
  event.preventDefault();
  const button = document.getElementById('userSaveButton');
  const isEditing = state.editingUserId != null;
  const payload = {
    displayName: document.getElementById('userDisplayName').value.trim(),
    role: document.getElementById('userRole').value,
  };

  if (isEditing) {
    payload.isEnabled = document.getElementById('userIsEnabled').checked;
  } else {
    payload.username = document.getElementById('userUsername').value.trim();
    payload.password = document.getElementById('userPassword').value;
  }

  try {
    setButtonBusy(button, true, '保存中...');
    await apiFetch(isEditing ? `/admin/users/${state.editingUserId}` : '/admin/users', {
      method: isEditing ? 'PATCH' : 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    closeUserModal();
    await loadUsers();
    setNotification('userNotification', isEditing ? '用户已更新。' : '用户已创建。', 'success');
  } catch (error) {
    setNotification('userNotification', error.message, 'error');
  } finally {
    setButtonBusy(button, false, '', '保存用户');
  }
}

async function disableUser(userId) {
  const user = state.users.find((item) => item.id === userId);
  if (!user || !window.confirm(`确定禁用用户「${user.username}」吗？`)) {
    return;
  }

  try {
    await apiFetch(`/admin/users/${userId}`, { method: 'DELETE' });
    await loadUsers();
    setNotification('userNotification', '用户已禁用。', 'success');
  } catch (error) {
    setNotification('userNotification', error.message, 'error');
  }
}

async function enableUser(userId) {
  const user = state.users.find((item) => item.id === userId);
  if (!user) {
    return;
  }

  try {
    await apiFetch(`/admin/users/${userId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ isEnabled: true }),
    });
    await loadUsers();
    setNotification('userNotification', '用户已启用。', 'success');
  } catch (error) {
    setNotification('userNotification', error.message, 'error');
  }
}

function handleUserListClick(event) {
  const button = event.target instanceof Element
    ? event.target.closest('[data-user-action]')
    : null;
  if (!(button instanceof HTMLElement)) {
    return;
  }

  const userId = Number(button.dataset.userId);
  const user = state.users.find((item) => item.id === userId);
  if (button.dataset.userAction === 'edit') {
    openUserModal(user);
    return;
  }

  if (button.dataset.userAction === 'disable') {
    disableUser(userId);
    return;
  }

  if (button.dataset.userAction === 'enable') {
    enableUser(userId);
  }
}

function getActiveSlaRule() {
  return state.slaRules.find((item) => item.id === state.editingSlaRuleId) || null;
}

function renderSlaRules() {
  const container = document.getElementById('slaRulesList');
  if (!container) {
    return;
  }

  if (state.slaRules.length === 0) {
    container.innerHTML = '<div class="empty-state rounded-[1.4rem] px-5 py-8 text-center text-sm leading-7 text-[#5f6b80]">暂无 SLA 规则。</div>';
    return;
  }

  container.innerHTML = `
    <table class="w-full min-w-[720px] border-separate border-spacing-y-2 text-left text-sm">
      <thead class="text-xs uppercase tracking-[0.2em] text-[#72809a]"><tr><th class="px-4 py-2">规则</th><th class="px-4 py-2">优先级</th><th class="px-4 py-2">响应</th><th class="px-4 py-2">解决</th><th class="px-4 py-2">状态</th><th class="px-4 py-2 text-right">操作</th></tr></thead>
      <tbody>
        ${state.slaRules.map((rule) => `
          <tr class="bg-white/72 align-middle">
            <td class="rounded-l-[1rem] px-4 py-3 font-semibold text-[#172033]">${escapeHtml(rule.name)}</td>
            <td class="px-4 py-3"><span class="priority-token" data-priority="${escapeHtml(rule.priority)}">${escapeHtml(priorityLabels[rule.priority] || rule.priority)}</span></td>
            <td class="px-4 py-3 text-[#445069]">${escapeHtml(String(rule.responseHours))} 小时</td>
            <td class="px-4 py-3 text-[#445069]">${escapeHtml(String(rule.resolutionHours))} 小时</td>
            <td class="px-4 py-3"><span class="rounded-full px-3 py-1 text-xs font-semibold ${rule.isEnabled ? 'bg-[rgba(19,121,91,0.12)] text-[#13795b]' : 'bg-[rgba(23,32,51,0.08)] text-[#4c566b]'}">${rule.isEnabled ? '启用' : '禁用'}</span></td>
            <td class="rounded-r-[1rem] px-4 py-3 text-right"><button class="ghost-button rounded-full px-3 py-2 text-xs font-semibold text-[#172033]" type="button" data-sla-edit="${rule.id}">编辑</button></td>
          </tr>
        `).join('')}
      </tbody>
    </table>
  `;

  container.querySelectorAll('[data-sla-edit]').forEach((button) => {
    button.addEventListener('click', () => openSlaRuleModal(Number(button.dataset.slaEdit)));
  });
}

async function loadSlaAlerts() {
  const badge = document.getElementById('slaAlertBadge');
  const summary = document.getElementById('slaSummary');
  try {
    const [warningData, violatedData] = await Promise.all([
      apiFetch('/admin/sla/violations?status=warning'),
      apiFetch('/admin/sla/violations?status=violated'),
    ]);
    const warningCount = warningData.items?.length || 0;
    const violatedCount = violatedData.items?.length || 0;
    badge.textContent = `SLA ${warningCount} / ${violatedCount}`;
    badge.style.color = violatedCount > 0 ? '#b23a32' : warningCount > 0 ? '#d98a17' : '#13795b';
    summary.textContent = `即将超时 ${warningCount} 条 · 已超时 ${violatedCount} 条`;
  } catch (error) {
    badge.textContent = 'SLA - / -';
    summary.textContent = error.message;
  }
}

async function loadSlaRules() {
  const container = document.getElementById('slaRulesList');
  if (!container) {
    return null;
  }

  container.setAttribute('aria-busy', 'true');
  container.innerHTML = renderFeedbackBox('正在加载 SLA 规则', 'loading');
  try {
    const data = await apiFetch('/admin/sla/rules');
    state.slaRules = data.items || [];
    renderSlaRules();
    setNotification('slaNotification', '');
    await loadSlaAlerts();
    return data;
  } catch (error) {
    state.slaRules = [];
    renderSlaRules();
    setNotification('slaNotification', error.message, error.message === '权限不足' ? 'info' : 'error');
    return null;
  } finally {
    container.setAttribute('aria-busy', 'false');
  }
}

function openSlaRuleModal(ruleId) {
  const rule = state.slaRules.find((item) => item.id === ruleId);
  if (!rule) {
    return;
  }

  state.editingSlaRuleId = rule.id;
  document.getElementById('slaRuleName').value = rule.name;
  document.getElementById('slaRulePriorityLabel').value = priorityLabels[rule.priority] || rule.priority;
  document.getElementById('slaResponseHours').value = String(rule.responseHours);
  document.getElementById('slaResolutionHours').value = String(rule.resolutionHours);
  document.getElementById('slaRuleIsEnabled').checked = rule.isEnabled;
  document.getElementById('slaRuleModal').hidden = false;
  window.requestAnimationFrame(() => document.getElementById('slaRuleName')?.focus());
}

function closeSlaRuleModal() {
  state.editingSlaRuleId = null;
  document.getElementById('slaRuleModal').hidden = true;
  document.getElementById('slaRuleForm').reset();
}

async function submitSlaRuleForm(event) {
  event.preventDefault();
  const rule = getActiveSlaRule();
  if (!rule) {
    return;
  }

  const button = document.getElementById('slaRuleSaveButton');
  const payload = {
    updatedAt: rule.updatedAt,
    name: document.getElementById('slaRuleName').value.trim(),
    responseHours: Number(document.getElementById('slaResponseHours').value),
    resolutionHours: Number(document.getElementById('slaResolutionHours').value),
    isEnabled: document.getElementById('slaRuleIsEnabled').checked,
  };

  try {
    setButtonBusy(button, true, '保存中...');
    await apiFetch(`/admin/sla/rules/${rule.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    closeSlaRuleModal();
    await loadSlaRules();
    setNotification('slaNotification', 'SLA 规则已更新。', 'success');
  } catch (error) {
    setNotification('slaNotification', error.message, 'error');
  } finally {
    setButtonBusy(button, false, '', '保存 SLA');
  }
}

function renderAssignRules() {
  const container = document.getElementById('assignRulesList');
  if (!container) {
    return;
  }

  if (state.assignRules.length === 0) {
    container.innerHTML = '<div class="empty-state rounded-[1.4rem] px-5 py-8 text-center text-sm leading-7 text-[#5f6b80]">暂无自动分配规则。</div>';
    return;
  }

  container.innerHTML = `
    <table class="w-full min-w-[860px] border-separate border-spacing-y-2 text-left text-sm">
      <thead class="text-xs uppercase tracking-[0.2em] text-[#72809a]"><tr><th class="px-4 py-2">规则</th><th class="px-4 py-2">分类</th><th class="px-4 py-2">关键词</th><th class="px-4 py-2">处理人</th><th class="px-4 py-2">优先级</th><th class="px-4 py-2">状态</th><th class="px-4 py-2 text-right">操作</th></tr></thead>
      <tbody>
        ${state.assignRules.map((rule) => `
          <tr class="bg-white/72 align-middle">
            <td class="rounded-l-[1rem] px-4 py-3 font-semibold text-[#172033]">${escapeHtml(rule.name)}</td>
            <td class="px-4 py-3 text-[#445069]">${escapeHtml(rule.category ? categoryLabels[rule.category] || rule.category : '全部')}</td>
            <td class="px-4 py-3 text-[#445069]">${escapeHtml((rule.keywords || []).join('、') || '无')}</td>
            <td class="px-4 py-3 font-semibold text-[#172033]">${escapeHtml(rule.assignTo)}</td>
            <td class="px-4 py-3 text-[#445069]">${escapeHtml(String(rule.priority))}</td>
            <td class="px-4 py-3"><span class="rounded-full px-3 py-1 text-xs font-semibold ${rule.isEnabled ? 'bg-[rgba(19,121,91,0.12)] text-[#13795b]' : 'bg-[rgba(23,32,51,0.08)] text-[#4c566b]'}">${rule.isEnabled ? '启用' : '禁用'}</span></td>
            <td class="rounded-r-[1rem] px-4 py-3 text-right">
              <button class="ghost-button rounded-full px-3 py-2 text-xs font-semibold text-[#172033]" type="button" data-assign-edit="${rule.id}">编辑</button>
              <button class="ghost-button rounded-full px-3 py-2 text-xs font-semibold text-[#b23a32]" type="button" data-assign-delete="${rule.id}">删除</button>
            </td>
          </tr>
        `).join('')}
      </tbody>
    </table>
  `;

  container.querySelectorAll('[data-assign-edit]').forEach((button) => {
    button.addEventListener('click', () => openAssignRuleModal(Number(button.dataset.assignEdit)));
  });
  container.querySelectorAll('[data-assign-delete]').forEach((button) => {
    button.addEventListener('click', () => deleteAssignRule(Number(button.dataset.assignDelete)));
  });
}

async function loadAssignRules() {
  const container = document.getElementById('assignRulesList');
  if (!container) {
    return null;
  }

  container.setAttribute('aria-busy', 'true');
  container.innerHTML = renderFeedbackBox('正在加载分配规则', 'loading');
  try {
    const data = await apiFetch('/admin/assign-rules');
    state.assignRules = data.items || [];
    renderAssignRules();
    setNotification('assignRuleNotification', '');
    return data;
  } catch (error) {
    state.assignRules = [];
    renderAssignRules();
    setNotification('assignRuleNotification', error.message, error.message === '权限不足' ? 'info' : 'error');
    return null;
  } finally {
    container.setAttribute('aria-busy', 'false');
  }
}

function openAssignRuleModal(ruleId = null) {
  const rule = ruleId ? state.assignRules.find((item) => item.id === ruleId) : null;
  state.editingAssignRuleId = rule?.id ?? null;
  document.getElementById('assignRuleModalTitle').textContent = rule ? '编辑规则' : '创建规则';
  document.getElementById('assignRuleName').value = rule?.name || '';
  document.getElementById('assignRuleCategory').value = rule?.category || '';
  document.getElementById('assignRuleKeywords').value = (rule?.keywords || []).join(', ');
  document.getElementById('assignRuleAssignTo').value = rule?.assignTo || '';
  document.getElementById('assignRulePriority').value = String(rule?.priority ?? 0);
  document.getElementById('assignRuleIsEnabled').checked = rule?.isEnabled ?? true;
  document.getElementById('assignRuleModal').hidden = false;
  window.requestAnimationFrame(() => document.getElementById('assignRuleName')?.focus());
}

function closeAssignRuleModal() {
  state.editingAssignRuleId = null;
  document.getElementById('assignRuleModal').hidden = true;
  document.getElementById('assignRuleForm').reset();
}

function getAssignRulePayload() {
  return {
    name: document.getElementById('assignRuleName').value.trim(),
    category: document.getElementById('assignRuleCategory').value || null,
    keywords: document.getElementById('assignRuleKeywords').value.split(/[,，]/).map((item) => item.trim()).filter(Boolean),
    assignTo: document.getElementById('assignRuleAssignTo').value.trim(),
    priority: Number(document.getElementById('assignRulePriority').value) || 0,
    isEnabled: document.getElementById('assignRuleIsEnabled').checked,
  };
}

async function submitAssignRuleForm(event) {
  event.preventDefault();
  const button = document.getElementById('assignRuleSaveButton');
  const activeRule = state.assignRules.find((item) => item.id === state.editingAssignRuleId);
  const payload = getAssignRulePayload();
  if (activeRule) {
    payload.updatedAt = activeRule.updatedAt;
  }

  try {
    setButtonBusy(button, true, '保存中...');
    await apiFetch(activeRule ? `/admin/assign-rules/${activeRule.id}` : '/admin/assign-rules', {
      method: activeRule ? 'PATCH' : 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    closeAssignRuleModal();
    await loadAssignRules();
    setNotification('assignRuleNotification', activeRule ? '分配规则已更新。' : '分配规则已创建。', 'success');
  } catch (error) {
    setNotification('assignRuleNotification', error.message, 'error');
  } finally {
    setButtonBusy(button, false, '', '保存规则');
  }
}

async function deleteAssignRule(ruleId) {
  const rule = state.assignRules.find((item) => item.id === ruleId);
  if (!rule || !window.confirm(`确定删除「${rule.name}」吗？`)) {
    return;
  }

  try {
    await apiFetch(`/admin/assign-rules/${rule.id}`, { method: 'DELETE' });
    await loadAssignRules();
    setNotification('assignRuleNotification', '分配规则已删除。', 'success');
  } catch (error) {
    setNotification('assignRuleNotification', error.message, 'error');
  }
}

function renderAssignTrend(items) {
  const container = document.getElementById('assignTrendChart');
  if (!items || items.length === 0) {
    container.innerHTML = '<div class="empty-state rounded-[1.4rem] px-5 py-8 text-center text-sm leading-7 text-[#5f6b80]">暂无趋势数据。</div>';
    return;
  }

  const maxValue = Math.max(1, ...items.flatMap((item) => [item.created || 0, item.resolved || 0]));
  container.innerHTML = `
    <div class="text-xs font-semibold uppercase tracking-[0.28em] text-[#72809a]">Trend</div>
    <h3 class="display-font mt-2 text-2xl">分配处理趋势</h3>
    <div class="mt-5 space-y-4">
      ${items.map((item) => `
        <div>
          <div class="mb-2 flex items-center justify-between text-sm text-[#25314a]"><span>${escapeHtml(item.period)}</span><span>新增 ${Number(item.created) || 0} · 解决 ${Number(item.resolved) || 0}</span></div>
          <div class="grid gap-1">
            <div class="bar-track"><div class="bar-fill" style="width:${Math.round(((Number(item.created) || 0) / maxValue) * 100)}%"></div></div>
            <div class="bar-track"><div class="bar-fill" data-tone="mint" style="width:${Math.round(((Number(item.resolved) || 0) / maxValue) * 100)}%"></div></div>
          </div>
        </div>
      `).join('')}
    </div>
  `;
}

function renderAssignStats(data) {
  const summary = data.summary || {};
  document.getElementById('assignTotalIssues').textContent = summary.totalIssues || 0;
  document.getElementById('assignPendingIssues').textContent = summary.pending || 0;
  document.getElementById('assignInProgressIssues').textContent = summary.inProgress || 0;
  document.getElementById('assignResolvedIssues').textContent = summary.resolved || 0;
  const handlers = data.handlers || [];
  document.getElementById('assignHandlerStats').innerHTML = handlers.length === 0
    ? '<div class="empty-state rounded-[1.4rem] px-5 py-8 text-center text-sm leading-7 text-[#5f6b80]">暂无处理人统计。</div>'
    : `
      <table class="w-full min-w-[760px] border-separate border-spacing-y-2 text-left text-sm">
        <thead class="text-xs uppercase tracking-[0.2em] text-[#72809a]"><tr><th class="px-4 py-2">处理人</th><th class="px-4 py-2">待处理</th><th class="px-4 py-2">处理中</th><th class="px-4 py-2">已解决</th><th class="px-4 py-2">平均响应</th><th class="px-4 py-2">平均解决</th></tr></thead>
        <tbody>
          ${handlers.map((handler) => `
            <tr class="bg-white/72 align-middle">
              <td class="rounded-l-[1rem] px-4 py-3 font-semibold text-[#172033]">${escapeHtml(handler.displayName || handler.username)}</td>
              <td class="px-4 py-3 text-[#445069]">${Number(handler.pending) || 0}</td>
              <td class="px-4 py-3 text-[#445069]">${Number(handler.inProgress) || 0}</td>
              <td class="px-4 py-3 text-[#445069]">${Number(handler.resolved) || 0}</td>
              <td class="px-4 py-3 text-[#445069]">${escapeHtml(formatHours(handler.avgResponseTime))}</td>
              <td class="rounded-r-[1rem] px-4 py-3 text-[#445069]">${escapeHtml(formatHours(handler.avgResolutionTime))}</td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    `;
  renderAssignTrend(data.trend || []);
}

function buildAssignStatsQuery() {
  const filters = getFilters();
  const params = new URLSearchParams();
  params.set('period', state.assignStatsPeriod);
  appendFilterValue(params, 'startDate', filters.startDate);
  appendFilterValue(params, 'endDate', filters.endDate);
  return params.toString();
}

async function loadAssignStats() {
  try {
    const data = await apiFetch(`/admin/assign-stats?${buildAssignStatsQuery()}`);
    renderAssignStats(data);
    updateAssignPeriodButtons();
    setNotification('assignStatsNotification', '');
    return data;
  } catch (error) {
    document.getElementById('assignHandlerStats').innerHTML = '';
    document.getElementById('assignTrendChart').innerHTML = '';
    setNotification('assignStatsNotification', error.message, error.message === '权限不足' ? 'info' : 'error');
    return null;
  }
}

async function loadPhase2AdminData() {
  await Promise.all([
    loadSlaRules(),
    loadAssignRules(),
    loadAssignStats(),
  ]);
}

function openDrawerShell(trigger) {
  closeSideNav();
  const drawer = document.getElementById('issueDrawer');
  lastDrawerTrigger = trigger instanceof HTMLElement
    ? trigger
    : document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null;
  document.getElementById('drawerBackdrop').hidden = false;
  drawer.hidden = false;
  drawer.setAttribute('aria-hidden', 'false');
  document.body.classList.add('overflow-hidden');
  document.getElementById('drawerTitle').focus();
}

function getDrawerFocusableElements() {
  const drawer = document.getElementById('issueDrawer');
  if (drawer.hidden) {
    return [];
  }

  return Array.from(drawer.querySelectorAll(DRAWER_FOCUS_SELECTOR))
    .filter((element) => element instanceof HTMLElement && isVisibleElement(element));
}

function isVisibleElement(element) {
  if (element.hidden) {
    return false;
  }

  const style = window.getComputedStyle(element);
  return style.display !== 'none'
    && style.visibility !== 'hidden'
    && (element.offsetWidth > 0 || element.offsetHeight > 0 || element.getClientRects().length > 0);
}

function trapDrawerFocus(event) {
  if (event.key !== 'Tab' || document.getElementById('issueDrawer').hidden) {
    return;
  }

  const focusable = getDrawerFocusableElements();
  if (focusable.length === 0) {
    event.preventDefault();
    document.getElementById('drawerTitle').focus();
    return;
  }

  const first = focusable[0];
  const last = focusable[focusable.length - 1];
  if (!focusable.includes(document.activeElement)) {
    event.preventDefault();
    (event.shiftKey ? last : first).focus();
    return;
  }

  if (event.shiftKey && document.activeElement === first) {
    event.preventDefault();
    last.focus();
    return;
  }

  if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault();
    first.focus();
  }
}

function closeDrawer() {
  const drawer = document.getElementById('issueDrawer');
  document.getElementById('drawerBackdrop').hidden = true;
  drawer.hidden = true;
  drawer.setAttribute('aria-hidden', 'true');
  document.body.classList.remove('overflow-hidden');
  state.activeIssueId = null;
  state.activeIssue = null;
  if (lastDrawerTrigger?.isConnected) {
    lastDrawerTrigger.focus();
  }
  lastDrawerTrigger = null;
}

function buildStatusOptions(current) {
  const allowed = statusTransitions[current] || [current];
  return allowed.map((status) => `<option value="${status}">${escapeHtml(statusLabels[status] || status)}</option>`).join('');
}

function renderUpdates(items) {
  const container = document.getElementById('updatesTimeline');
  if (!items || items.length === 0) {
    container.innerHTML = '<div class="empty-state rounded-[1.2rem] px-4 py-5 text-sm text-[#5f6b80]">还没有状态更新或公开回复。</div>';
    return;
  }

  container.innerHTML = `
    <div class="timeline-shell" data-timeline-shell data-can-scroll-backward="false" data-can-scroll-forward="true">
      <button class="timeline-control timeline-control--back" type="button" data-timeline-step="-1" aria-label="向左查看更多时间线">‹</button>
      <div class="timeline-scroll" data-timeline-scroll role="list" tabindex="0" aria-label="问题更新时间线，可使用左右方向键浏览">
        ${items.map((item) => `
          <details class="timeline-card" role="listitem">
            <summary>
              <span class="timeline-card__dot" aria-hidden="true">${item.type === 'public_reply' ? '答' : '更'}</span>
              <span>
                <span class="timeline-card__title">${item.type === 'public_reply' ? '公开回复' : `${escapeHtml(statusLabels[item.oldValue] || item.oldValue || '初始状态')} → ${escapeHtml(statusLabels[item.newValue] || item.newValue || '已更新')}`}</span>
                <span class="timeline-card__time">${escapeHtml(formatDate(item.createdAt))}</span>
              </span>
            </summary>
            <div class="timeline-card__content">${escapeHtml(item.content || '状态已更新。')}</div>
          </details>
        `).join('')}
      </div>
      <button class="timeline-control timeline-control--forward" type="button" data-timeline-step="1" aria-label="向右查看更多时间线">›</button>
    </div>
  `;
}

function renderNotes(items) {
  const container = document.getElementById('notesList');
  if (!items || items.length === 0) {
    container.innerHTML = '<div class="empty-state rounded-[1.2rem] px-4 py-5 text-sm text-[#5f6b80]">暂无内部备注。</div>';
    return;
  }

  container.innerHTML = items.map((item) => `<article class="rounded-[1.2rem] border border-[rgba(23,32,51,0.08)] bg-white/70 p-4"><div class="text-sm leading-7 text-[#172033]">${escapeHtml(item.content)}</div><div class="mt-2 text-xs uppercase tracking-[0.26em] text-[#72809a]">${escapeHtml(item.createdBy)} · ${escapeHtml(formatDate(item.createdAt))}</div></article>`).join('');
}

function renderReplies(items) {
  const container = document.getElementById('repliesList');
  if (!items || items.length === 0) {
    container.innerHTML = '<div class="empty-state rounded-[1.2rem] px-4 py-5 text-sm text-[#5f6b80]">暂无回复记录。</div>';
    return;
  }

  container.innerHTML = items.map((item) => `<article class="rounded-[1.2rem] border border-[rgba(23,32,51,0.08)] bg-white/70 p-4"><div class="flex flex-wrap items-center gap-2"><span class="rounded-full px-3 py-1 text-xs font-semibold ${item.isPublic ? 'bg-[rgba(19,121,91,0.12)] text-[#13795b]' : 'bg-[rgba(23,32,51,0.08)] text-[#4c566b]'}">${item.isPublic ? '公开' : '私有'}</span><span class="text-xs uppercase tracking-[0.26em] text-[#72809a]">${escapeHtml(formatDate(item.createdAt))}</span></div><div class="mt-2 text-sm leading-7 text-[#172033]">${escapeHtml(item.content || '')}</div></article>`).join('');
}

function renderHistory(items) {
  const container = document.getElementById('historyList');
  if (!items || items.length === 0) {
    container.innerHTML = '<div class="empty-state rounded-[1.2rem] px-4 py-5 text-sm text-[#5f6b80]">暂无操作历史。</div>';
    return;
  }

  container.innerHTML = items.map((item) => `
    <article class="audit-card rounded-[1.2rem] border border-[rgba(23,32,51,0.08)] bg-white/70 p-4">
      <div class="flex min-w-0 flex-wrap items-center gap-2">
        <strong class="break-anywhere text-[#172033]">${escapeHtml(item.actionType)}</strong>
        <span class="break-anywhere text-xs uppercase tracking-[0.26em] text-[#72809a]">${escapeHtml(item.performedBy)} · ${escapeHtml(formatDate(item.performedAt))}</span>
      </div>
      <pre class="audit-detail mt-3 rounded-[1rem] border border-[rgba(23,32,51,0.08)] bg-[rgba(23,32,51,0.03)] p-3 text-xs leading-6 text-[#4c566b]"><code>${escapeHtml(JSON.stringify(item.details || {}, null, 2))}</code></pre>
    </article>
  `).join('');
}

function buildNullableOptions(labels, current) {
  return [
    `<option value="" ${!current ? 'selected' : ''}>暂不选择</option>`,
    ...Object.entries(labels).map(([value, label]) => `<option value="${value}" ${current === value ? 'selected' : ''}>${escapeHtml(label)}</option>`),
  ].join('');
}

function syncDetailCounselingFields() {
  const category = document.getElementById('detailCategory')?.value;
  const wrapper = document.getElementById('detailCounselingFields');
  const distressType = document.getElementById('detailDistressType');
  const sceneTag = document.getElementById('detailSceneTag');
  if (!wrapper || !distressType || !sceneTag) {
    return;
  }

  const enabled = category === 'counseling';
  wrapper.hidden = !enabled;
  distressType.disabled = !enabled;
  sceneTag.disabled = !enabled;
  if (!enabled) {
    distressType.value = '';
    sceneTag.value = '';
  }
}

function renderDrawer(detail) {
  state.activeIssue = detail;
  document.getElementById('drawerTitle').textContent = detail.trackingCode;
  document.getElementById('drawerMeta').textContent = `${statusLabels[detail.status] || detail.status} · ${formatDate(detail.updatedAt)}`;
  document.getElementById('drawerContent').innerHTML = `
    <section class="space-y-4 rounded-[1.6rem] border border-[rgba(23,32,51,0.08)] bg-white/82 p-5">
      <div class="flex flex-wrap items-center gap-2">
        <span class="status-token" data-status="${escapeHtml(detail.status)}">${escapeHtml(statusLabels[detail.status] || detail.status)}</span>
        <span class="priority-token" data-priority="${escapeHtml(detail.priority)}">${escapeHtml(priorityLabels[detail.priority] || detail.priority)}</span>
        <span class="category-token">${escapeHtml(categoryLabels[detail.category] || detail.category)}</span>
        ${renderSlaStatusBadge(detail.slaStatus, formatSlaCountdown(detail))}
        ${detail.category === 'counseling' && detail.distressType ? `<span class="mini-token">${escapeHtml(distressTypeLabels[detail.distressType] || detail.distressType)}</span>` : ''}
        ${detail.category === 'counseling' && detail.sceneTag ? `<span class="mini-token">${escapeHtml(sceneTagLabels[detail.sceneTag] || detail.sceneTag)}</span>` : ''}
      </div>
      <div class="grid gap-3 text-sm text-[#4c566b] md:grid-cols-2">
        <div><strong class="text-[#172033]">姓名：</strong>${escapeHtml(detail.name)}</div>
        <div><strong class="text-[#172033]">学号：</strong>${escapeHtml(detail.studentId)}</div>
        <div><strong class="text-[#172033]">困扰类别：</strong>${detail.category === 'counseling' && detail.distressType ? escapeHtml(distressTypeLabels[detail.distressType] || detail.distressType) : '无'}</div>
        <div><strong class="text-[#172033]">主要场景：</strong>${detail.category === 'counseling' && detail.sceneTag ? escapeHtml(sceneTagLabels[detail.sceneTag] || detail.sceneTag) : '无'}</div>
        <div><strong class="text-[#172033]">提交时间：</strong>${escapeHtml(formatDate(detail.createdAt))}</div>
        <div><strong class="text-[#172033]">分配时间：</strong>${escapeHtml(formatDate(detail.assignedAt))}</div>
        <div><strong class="text-[#172033]">首次响应：</strong>${escapeHtml(formatDate(detail.firstResponseAt))}</div>
        <div><strong class="text-[#172033]">解决时间：</strong>${escapeHtml(formatDate(detail.resolvedAt))}</div>
        <div><strong class="text-[#172033]">SLA 响应：</strong>${escapeHtml(formatDate(detail.slaResponseDeadline))}</div>
        <div><strong class="text-[#172033]">SLA 解决：</strong>${escapeHtml(formatDate(detail.slaResolutionDeadline))}</div>
        <div><strong class="text-[#172033]">是否公开：</strong>${detail.isPublic ? '是' : '否'}</div>
      </div>
      <div class="rounded-[1.3rem] border border-[rgba(23,32,51,0.08)] bg-[rgba(36,87,214,0.05)] px-4 py-4 text-sm leading-7 text-[#172033]">${escapeHtml(detail.content)}</div>
    </section>

    <section class="space-y-4 rounded-[1.6rem] border border-[rgba(23,32,51,0.08)] bg-white/82 p-5">
      <div>
        <div class="text-xs font-semibold uppercase tracking-[0.3em] text-[#72809a]">Editable Fields</div>
        <h3 class="display-font mt-2 text-2xl">问题编辑</h3>
      </div>
      <div id="drawerNotification" aria-live="polite" aria-atomic="true"></div>
      <div class="grid gap-4 md:grid-cols-2">
        <label class="space-y-2 text-sm font-medium text-[#25314a]"><span>状态</span><select id="detailStatus" class="field-shell h-11 w-full rounded-2xl px-4 text-sm">${buildStatusOptions(detail.status)}</select><span class="block text-xs leading-6 text-[#72809a]">允许流转：${escapeHtml((statusTransitions[detail.status] || [detail.status]).map((status) => statusLabels[status] || status).join('、'))}</span></label>
        <label class="space-y-2 text-sm font-medium text-[#25314a]"><span>分类</span><select id="detailCategory" class="field-shell h-11 w-full rounded-2xl px-4 text-sm">${Object.entries(categoryLabels).map(([value, label]) => `<option value="${value}" ${detail.category === value ? 'selected' : ''}>${label}</option>`).join('')}</select></label>
        <label class="space-y-2 text-sm font-medium text-[#25314a]"><span>优先级</span><select id="detailPriority" class="field-shell h-11 w-full rounded-2xl px-4 text-sm">${Object.entries(priorityLabels).map(([value, label]) => `<option value="${value}" ${detail.priority === value ? 'selected' : ''}>${label}</option>`).join('')}</select></label>
        <label class="space-y-2 text-sm font-medium text-[#25314a]"><span>指派人</span><input id="detailAssignedTo" list="assigneeSuggestions" class="field-shell h-11 w-full rounded-2xl px-4 text-sm" value="${escapeHtml(detail.assignedTo || '')}" placeholder="可留空清除"></label>
      </div>
      <div id="detailCounselingFields" class="grid gap-4 md:grid-cols-2" ${detail.category === 'counseling' ? '' : 'hidden'}>
        <label class="space-y-2 text-sm font-medium text-[#25314a]"><span>困扰类别</span><select id="detailDistressType" class="field-shell h-11 w-full rounded-2xl px-4 text-sm">${buildNullableOptions(distressTypeLabels, detail.distressType)}</select></label>
        <label class="space-y-2 text-sm font-medium text-[#25314a]"><span>主要场景</span><select id="detailSceneTag" class="field-shell h-11 w-full rounded-2xl px-4 text-sm">${buildNullableOptions(sceneTagLabels, detail.sceneTag)}</select></label>
      </div>
      <label class="space-y-2 text-sm font-medium text-[#25314a]"><span>公开摘要</span><textarea id="detailPublicSummary" class="field-shell min-h-[120px] w-full rounded-[1.4rem] px-4 py-3 text-sm leading-7" maxlength="500" placeholder="可留空清除">${escapeHtml(detail.publicSummary || '')}</textarea></label>
      <div class="rounded-[1.4rem] border border-[rgba(23,32,51,0.08)] bg-white/70 px-4 py-3">
        <div class="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between sm:gap-4">
          <label class="flex items-start gap-3 text-sm leading-6 text-[#445069] sm:flex-1"><input id="detailIsPublic" type="checkbox" class="mt-1 h-4 w-4 rounded border-[#b9c3d6] text-[#2457d6] focus:ring-[#2457d6]" ${detail.isPublic ? 'checked' : ''}><span>允许该问题进入首页公开列表。</span></label>
          <button id="saveIssueButton" class="primary-button w-full rounded-full px-4 py-2 text-sm font-semibold transition sm:w-auto sm:min-w-[8rem]" type="button">保存修改</button>
        </div>
        <p class="mt-3 text-xs leading-6 text-[#72809a]">修改完状态、分类、优先级、指派、摘要或公开设置后，请在这里保存。</p>
      </div>
    </section>

    <section class="space-y-4 rounded-[1.6rem] border border-[rgba(23,32,51,0.08)] bg-white/82 p-5"><div class="text-xs font-semibold uppercase tracking-[0.3em] text-[#72809a]">Updates</div><h3 class="display-font text-2xl">处理时间线</h3><div id="updatesTimeline" class="space-y-5"></div></section>
    <section class="space-y-4 rounded-[1.6rem] border border-[rgba(23,32,51,0.08)] bg-white/82 p-5"><div class="text-xs font-semibold uppercase tracking-[0.3em] text-[#72809a]">Internal Notes</div><h3 class="display-font text-2xl">内部备注</h3><div id="notesList" class="space-y-3"></div><form id="noteForm" class="space-y-3"><textarea id="noteContent" class="field-shell min-h-[110px] w-full rounded-[1.4rem] px-4 py-3 text-sm leading-7" maxlength="1000" placeholder="记录内部跟进、外部沟通或处理建议"></textarea><button class="rounded-full bg-[#172033] px-4 py-2 text-sm font-semibold text-white transition hover:bg-[#0c1424]" type="submit">添加备注</button></form></section>
    <section class="space-y-4 rounded-[1.6rem] border border-[rgba(23,32,51,0.08)] bg-white/82 p-5"><div class="text-xs font-semibold uppercase tracking-[0.3em] text-[#72809a]">Replies</div><h3 class="display-font text-2xl">公开回复</h3><div id="repliesList" class="space-y-3"></div><form id="replyForm" class="space-y-3"><textarea id="replyContent" class="field-shell min-h-[110px] w-full rounded-[1.4rem] px-4 py-3 text-sm leading-7" maxlength="1000" placeholder="面向提交者和公开页面展示的回复内容"></textarea><label class="flex items-start gap-3 rounded-[1.2rem] border border-[rgba(23,32,51,0.08)] bg-white/70 px-4 py-3 text-sm leading-6 text-[#445069]"><input id="replyIsPublic" type="checkbox" class="mt-1 h-4 w-4 rounded border-[#b9c3d6] text-[#2457d6] focus:ring-[#2457d6]" checked><span>勾选后，这条回复会在追踪页对外可见。</span></label><button class="primary-button rounded-full px-4 py-2 text-sm font-semibold transition" type="submit">发送回复</button></form></section>
    <section class="space-y-4 rounded-[1.6rem] border border-[rgba(23,32,51,0.08)] bg-white/82 p-5"><div class="text-xs font-semibold uppercase tracking-[0.3em] text-[#72809a]">Audit Trail</div><h3 class="display-font text-2xl">操作历史</h3><div id="historyList" class="space-y-3"></div></section>
  `;

  document.getElementById('detailStatus').value = detail.status;
  document.getElementById('detailCategory').addEventListener('change', syncDetailCounselingFields);
  syncDetailCounselingFields();
  document.getElementById('saveIssueButton').addEventListener('click', saveIssueChanges);
  document.getElementById('noteForm').addEventListener('submit', submitNote);
  document.getElementById('replyForm').addEventListener('submit', submitReply);
  renderUpdates(detail.updates);
  renderNotes(detail.internalNotes);
  renderReplies((detail.updates || []).filter((item) => item.type === 'public_reply'));
  renderHistory(detail.history);
  window.requestAnimationFrame(() => {
    document.getElementById('detailStatus')?.focus();
  });
}

async function openDrawer(issueId, trigger = null) {
  state.activeIssueId = issueId;
  openDrawerShell(trigger);
  document.getElementById('drawerContent').innerHTML = renderSkeleton('detail');
  try {
    const detail = await apiFetch(`/admin/issues/${issueId}`);
    renderDrawer(detail);
  } catch (error) {
    document.getElementById('drawerContent').innerHTML = renderFeedbackBox(error.message, 'error');
  }
}

async function refreshActiveIssue() {
  if (!state.activeIssueId) {
    return;
  }

  const [detail] = await Promise.all([
    apiFetch(`/admin/issues/${state.activeIssueId}`),
    loadIssues(state.page),
    loadMetrics(true),
  ]);
  renderDrawer(detail);
}
async function saveIssueChanges() {
  if (!state.activeIssue) {
    return;
  }

  const patch = {};
  const status = document.getElementById('detailStatus').value;
  const category = document.getElementById('detailCategory').value;
  const priority = document.getElementById('detailPriority').value;
  const assignedTo = document.getElementById('detailAssignedTo').value.trim() || null;
  const publicSummary = document.getElementById('detailPublicSummary').value.trim() || null;
  const isPublic = document.getElementById('detailIsPublic').checked;
  const distressType = category === 'counseling' ? document.getElementById('detailDistressType').value || null : null;
  const sceneTag = category === 'counseling' ? document.getElementById('detailSceneTag').value || null : null;
  if (status !== state.activeIssue.status) patch.status = status;
  if (category !== state.activeIssue.category) patch.category = category;
  if (priority !== state.activeIssue.priority) patch.priority = priority;
  if (category === 'counseling' && distressType !== (state.activeIssue.distressType || null)) patch.distressType = distressType;
  if (category === 'counseling' && sceneTag !== (state.activeIssue.sceneTag || null)) patch.sceneTag = sceneTag;
  if (assignedTo !== (state.activeIssue.assignedTo || null)) patch.assignedTo = assignedTo;
  if (publicSummary !== (state.activeIssue.publicSummary || null)) patch.publicSummary = publicSummary;
  if (isPublic !== state.activeIssue.isPublic) patch.isPublic = isPublic;
  if (Object.keys(patch).length === 0) {
    setNotification('drawerNotification', '没有需要保存的字段变化。', 'info');
    return;
  }

  patch.updatedAt = state.activeIssue.updatedAt;
  const button = document.getElementById('saveIssueButton');

  try {
    setButtonBusy(button, true, '保存中...');
    await apiFetch(`/admin/issues/${state.activeIssueId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(patch),
    });
    setNotification('drawerNotification', '问题信息已更新。', 'success');
    await refreshActiveIssue();
  } catch (error) {
    setNotification('drawerNotification', error.message, 'error');
  } finally {
    setButtonBusy(button, false, '', '保存修改');
  }
}

async function submitNote(event) {
  event.preventDefault();
  const button = event.currentTarget.querySelector('button[type="submit"]');
  const content = document.getElementById('noteContent').value.trim();
  if (!content) {
    setNotification('drawerNotification', '备注内容不能为空。', 'error');
    return;
  }

  try {
    setButtonBusy(button, true, '保存中...');
    await apiFetch(`/admin/issues/${state.activeIssueId}/notes`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content }),
    });
    document.getElementById('noteContent').value = '';
    setNotification('drawerNotification', '内部备注已添加。', 'success');
    await refreshActiveIssue();
  } catch (error) {
    setNotification('drawerNotification', error.message, 'error');
  } finally {
    setButtonBusy(button, false, '', '添加备注');
  }
}

async function submitReply(event) {
  event.preventDefault();
  const button = event.currentTarget.querySelector('button[type="submit"]');
  const content = document.getElementById('replyContent').value.trim();
  const isPublic = document.getElementById('replyIsPublic').checked;
  if (!content) {
    setNotification('drawerNotification', '回复内容不能为空。', 'error');
    return;
  }

  try {
    setButtonBusy(button, true, '发送中...');
    await apiFetch(`/admin/issues/${state.activeIssueId}/replies`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content, isPublic }),
    });
    document.getElementById('replyContent').value = '';
    document.getElementById('replyIsPublic').checked = true;
    setNotification('drawerNotification', '回复已添加。', 'success');
    await refreshActiveIssue();
  } catch (error) {
    setNotification('drawerNotification', error.message, 'error');
  } finally {
    setButtonBusy(button, false, '', '发送回复');
  }
}

async function exportIssues() {
  const button = document.getElementById('exportButton');
  const format = getExportFormat();
  const formatLabel = exportFormatLabels[format] || 'CSV';
  const summary = summarizeFilters(getFilters());
  setButtonBusy(button, true, '导出中...');
  setNotification('adminNotification', `正在生成 ${formatLabel} 导出文件...`, 'info');

  try {
    const response = await fetchWithTimeout(`${API_BASE}/admin/export?${buildExportQuery(format)}`, {
      headers: {
        Authorization: `Bearer ${state.token}`,
      },
    }, 30000);

    if (response.status === 401) {
      clearAuthState();
      window.location.assign('/login.html');
      throw new Error('登录已过期，请重新登录');
    }

    if (!response.ok) {
      let payload = null;
      try {
        payload = await response.json();
      } catch {
        payload = null;
      }
      throw new Error(payload?.error || '导出失败');
    }

    const disposition = response.headers.get('Content-Disposition') || '';
    const filename = disposition.match(/filename="?([^";]+)"?/)?.[1] || `issues_export.${format}`;
    const blob = await response.blob();
    const blobUrl = window.URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = blobUrl;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    link.remove();
    window.URL.revokeObjectURL(blobUrl);

    pushExportHistory({
      filename,
      createdAt: new Date().toISOString(),
      summary: `${formatLabel} · ${summary}`,
    });
    setNotification('adminNotification', `${formatLabel} 导出成功，文件已开始下载。`, 'success');
  } catch (error) {
    setNotification('adminNotification', error.name === 'AbortError' ? '导出超时，请缩小筛选范围后重试。' : error.message, 'error');
  } finally {
    setButtonBusy(button, false, '', '导出文件');
  }
}

async function copyFilterLink() {
  const target = window.location.href;
  try {
    await navigator.clipboard.writeText(target);
    showButtonHint('copyLinkHint', '链接已复制', 'success');
    setNotification('adminNotification', '筛选链接已复制。', 'success');
  } catch {
    showButtonHint('copyLinkHint', '复制失败', 'error');
    setNotification('adminNotification', '复制失败，请手动复制地址栏。', 'error');
  }
}

async function login(secretKey) {
  state.token = secretKey;
  state.user = null;
  sessionStorage.setItem(SHARED_SECRET_KEY, secretKey);
  const button = document.getElementById('loginButton');
  setButtonBusy(button, true, '验证中...');
  setNotification('loginNotification', '正在验证并加载后台数据...', 'info');

  try {
    await Promise.all([
      loadDashboard(state.page, { refreshMetrics: false }),
      loadKnowledgeItems(),
      loadPhase2AdminData(),
    ]);
    showAuthenticatedShell();
    loadUsers();
    setNotification('loginNotification', '');
    document.getElementById('searchInput')?.focus();
  } catch (error) {
    sessionStorage.removeItem(SHARED_SECRET_KEY);
    state.token = null;
    setNotification('loginNotification', error.message, 'error');
  } finally {
    setButtonBusy(button, false, '', '登录并加载后台');
  }
}

async function logout() {
  try {
    if (state.token) {
      await apiFetch('/admin/auth/logout', { method: 'POST' });
    }
  } catch {
    // 本地状态仍然清理，避免登出失败时卡在旧凭据。
  }

  clearAuthState();
  state.activeIssue = null;
  state.activeIssueId = null;
  state.knowledgeItems = [];
  state.users = [];
  state.slaRules = [];
  state.assignRules = [];
  state.selectedIssueIds.clear();
  resetKnowledgeForm();
  document.getElementById('secretKey').value = '';
  closeDrawer();
  document.getElementById('loginSection').hidden = false;
  document.getElementById('adminShell').hidden = true;
  delete document.body.dataset.adminAuthenticated;
  window.location.assign('/login.html');
}

function bindEvents() {
  document.getElementById('loginForm').addEventListener('submit', (event) => {
    event.preventDefault();
    const secretKey = document.getElementById('secretKey').value.trim();
    if (!secretKey) {
      setNotification('loginNotification', '请输入管理密钥。', 'error');
      return;
    }
    login(secretKey);
  });
  document.getElementById('knowledgeForm').addEventListener('submit', submitKnowledgeForm);
  document.getElementById('knowledgeCancelEdit').addEventListener('click', () => {
    resetKnowledgeForm();
    setNotification('knowledgeNotification', '');
  });
  document.getElementById('createUserButton').addEventListener('click', () => openUserModal());
  document.getElementById('userList').addEventListener('click', handleUserListClick);
  document.getElementById('userForm').addEventListener('submit', submitUserForm);
  document.getElementById('userModalClose').addEventListener('click', closeUserModal);
  document.getElementById('userCancelButton').addEventListener('click', closeUserModal);
  document.getElementById('slaRuleForm').addEventListener('submit', submitSlaRuleForm);
  document.getElementById('slaRuleModalClose').addEventListener('click', closeSlaRuleModal);
  document.getElementById('slaRuleCancelButton').addEventListener('click', closeSlaRuleModal);
  document.getElementById('createAssignRuleButton').addEventListener('click', () => openAssignRuleModal());
  document.getElementById('assignRuleForm').addEventListener('submit', submitAssignRuleForm);
  document.getElementById('assignRuleModalClose').addEventListener('click', closeAssignRuleModal);
  document.getElementById('assignRuleCancelButton').addEventListener('click', closeAssignRuleModal);
  document.getElementById('executeBatchButton').addEventListener('click', openBatchConfirm);
  document.getElementById('batchConfirmButton').addEventListener('click', executeBatchUpdate);
  document.getElementById('batchCancelButton').addEventListener('click', closeBatchConfirm);
  document.getElementById('selectAllIssues').addEventListener('change', (event) => {
    if (event.target.checked) {
      state.issues.forEach((item) => state.selectedIssueIds.add(item.id));
    } else {
      state.issues.forEach((item) => state.selectedIssueIds.delete(item.id));
    }
    syncBatchToolbar();
  });

  document.getElementById('filterForm').addEventListener('submit', (event) => {
    event.preventDefault();
    loadDashboard(1, { refreshMetrics: false }).catch((error) => setNotification('adminNotification', error.message, 'error'));
  });

  document.getElementById('resetFilters').addEventListener('click', () => {
    document.getElementById('filterForm').reset();
    setMultiFilterValues('status', []);
    setMultiFilterValues('category', []);
    setMultiFilterValues('priority', []);
    setMultiFilterValues('distressType', []);
    setMultiFilterValues('sceneTag', []);
    const advancedFilters = document.getElementById('advancedAdminFilters');
    if (advancedFilters instanceof HTMLDetailsElement) {
      advancedFilters.open = false;
    }
    state.metricsPeriod = 'week';
    state.assignStatsPeriod = 'week';
    state.selectedIssueIds.clear();
    updatePeriodButtons();
    updateAssignPeriodButtons();
    loadDashboard(1, { refreshMetrics: true }).catch((error) => setNotification('adminNotification', error.message, 'error'));
  });
  document.getElementById('activeFilterChips').addEventListener('click', (event) => {
    const target = event.target;
    if (!(target instanceof Element)) {
      return;
    }

    const button = target.closest('[data-clear-filter]');
    if (!(button instanceof HTMLElement)) {
      return;
    }

    clearFilter(button.dataset.clearFilter || '', button.dataset.clearValue || '');
    loadDashboard(1, { refreshMetrics: false }).catch((error) => setNotification('adminNotification', error.message, 'error'));
  });

  document.getElementById('refreshButton').addEventListener('click', async () => {
    const button = document.getElementById('refreshButton');
    setButtonBusy(button, true, '同步中...');
    try {
      await loadDashboard(state.page, { refreshMetrics: true });
      setNotification('metricsNotification', '统计与问题列表已同步。', 'success');
    } catch (error) {
      setNotification('adminNotification', error.message, 'error');
    } finally {
      setButtonBusy(button, false, '', '刷新面板');
    }
  });
  document.getElementById('exportButton').addEventListener('click', exportIssues);
  document.getElementById('copyFilterLinkButton').addEventListener('click', copyFilterLink);
  document.getElementById('logoutButton').addEventListener('click', logout);
  document.getElementById('closeDrawer').addEventListener('click', closeDrawer);
  document.getElementById('drawerBackdrop').addEventListener('click', closeDrawer);
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && !document.getElementById('issueDrawer').hidden) {
      closeDrawer();
      return;
    }
    trapDrawerFocus(event);
  });

  document.querySelectorAll('[data-multi-filter]').forEach((wrapper) => {
    const key = wrapper.dataset.multiFilter;
    wrapper.querySelectorAll('input').forEach((input) => {
      input.addEventListener('change', () => updateMultiFilterSummary(key));
    });
  });

  document.querySelectorAll('[data-period-button]').forEach((button) => {
    button.addEventListener('click', () => {
      state.metricsPeriod = button.dataset.periodButton;
      updatePeriodButtons();
      loadMetrics(true).then(() => syncUrl(state.page)).catch((error) => setNotification('metricsNotification', error.message, 'error'));
    });
  });

  document.querySelectorAll('[data-assign-period-button]').forEach((button) => {
    button.addEventListener('click', () => {
      state.assignStatsPeriod = button.dataset.assignPeriodButton;
      updateAssignPeriodButtons();
      loadAssignStats().catch((error) => setNotification('assignStatsNotification', error.message, 'error'));
    });
  });

  ['assignedToFilter', 'updatedAfterFilter', 'hasNotesFilter', 'hasRepliesFilter', 'isAssignedFilter', 'slaStatusFilter', 'sortFieldFilter', 'sortOrderFilter'].forEach((id) => {
    document.getElementById(id).addEventListener('change', syncAdvancedAdminFiltersState);
  });

  ['distressType', 'sceneTag'].forEach((key) => {
    document.querySelectorAll(`[data-multi-filter="${key}"] input`).forEach((input) => {
      input.addEventListener('change', syncAdvancedAdminFiltersState);
    });
  });
}

restoreFiltersFromUrl();
syncAdvancedAdminFiltersState();
updateAssignPeriodButtons();
renderSearchHistory();
renderExportHistory();
bindEvents();

const storedToken = window.localStorage.getItem(ADMIN_TOKEN_KEY);
const storedSecret = window.sessionStorage.getItem(SHARED_SECRET_KEY);
if (storedToken) {
  state.token = storedToken;
  state.user = loadStoredUser();
  showAuthenticatedShell();
  Promise.all([
    loadDashboard(state.page, { refreshMetrics: false }),
    loadKnowledgeItems(),
    loadPhase2AdminData(),
  ])
    .then(() => loadUsers())
    .catch((error) => setNotification('adminNotification', error.message, 'error'));
} else if (storedSecret) {
  document.getElementById('secretKey').value = storedSecret;
  login(storedSecret);
} else {
  setNotification('loginNotification', '推荐使用账号密码登录，或在下方输入共享密钥。', 'info');
}

window.addEventListener('app:retry', () => {
  if (!state.token && !state.secret) {
    return;
  }
  loadDashboard(state.page).catch((error) => {
    setNotification('adminNotification', error.message, 'error');
  });
});



