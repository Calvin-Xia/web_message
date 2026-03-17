const API_BASE = '/api';
const REQUEST_TIMEOUT = 15000;
const STORAGE_KEY = 'issue-admin-secret';
const SEARCH_HISTORY_KEY = 'issue-admin-search-history';
const EXPORT_HISTORY_KEY = 'issue-admin-export-history';
const MAX_HISTORY_ITEMS = 8;
const statusLabels = { submitted: '已提交', in_review: '审核中', in_progress: '处理中', resolved: '已解决', closed: '已关闭' };
const categoryLabels = { academic: '学业相关', facility: '设施问题', service: '服务咨询', complaint: '投诉建议', counseling: '心理咨询', other: '其他' };
const priorityLabels = { low: '低', normal: '普通', high: '高', urgent: '紧急' };
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
const state = {
  token: null,
  page: 1,
  pageSize: 20,
  metricsPeriod: 'week',
  activeIssueId: null,
  activeIssue: null,
  availableAssignees: [],
  metrics: null,
  issues: [],
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

function summarizeFilters(filters) {
  const summary = [];
  if (filters.q) summary.push(`关键词: ${filters.q}`);
  if (filters.status.length) summary.push(`状态 ${filters.status.length} 项`);
  if (filters.category.length) summary.push(`分类 ${filters.category.length} 项`);
  if (filters.priority.length) summary.push(`优先级 ${filters.priority.length} 项`);
  if (filters.startDate || filters.endDate) summary.push(`时间 ${filters.startDate || '最早'} - ${filters.endDate || '最新'}`);
  if (filters.assignedTo) summary.push(`指派 ${filters.assignedTo}`);
  return summary.length ? summary.join(' · ') : '全部数据';
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
      ...(options.headers || {}),
      Authorization: `Bearer ${state.token}`,
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

function getBooleanValue(id) {
  const value = document.getElementById(id).value;
  return value === '' ? '' : value;
}

function getFilters() {
  return {
    q: document.getElementById('searchInput').value.trim(),
    status: getMultiFilterValues('status'),
    category: getMultiFilterValues('category'),
    priority: getMultiFilterValues('priority'),
    assignedTo: document.getElementById('assignedToFilter').value.trim(),
    startDate: document.getElementById('startDateFilter').value,
    endDate: document.getElementById('endDateFilter').value,
    updatedAfter: document.getElementById('updatedAfterFilter').value,
    hasNotes: getBooleanValue('hasNotesFilter'),
    hasReplies: getBooleanValue('hasRepliesFilter'),
    isAssigned: getBooleanValue('isAssignedFilter'),
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
  appendFilterValue(params, 'assignedTo', filters.assignedTo);
  appendFilterValue(params, 'startDate', filters.startDate);
  appendFilterValue(params, 'endDate', filters.endDate);
  appendFilterValue(params, 'updatedAfter', filters.updatedAfter);
  appendFilterValue(params, 'hasNotes', filters.hasNotes);
  appendFilterValue(params, 'hasReplies', filters.hasReplies);
  appendFilterValue(params, 'isAssigned', filters.isAssigned);
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

function buildExportQuery() {
  const filters = getFilters();
  const params = new URLSearchParams();
  params.set('format', 'csv');
  appendFilterValue(params, 'q', filters.q);
  appendFilterValue(params, 'status', filters.status);
  appendFilterValue(params, 'category', filters.category);
  appendFilterValue(params, 'priority', filters.priority);
  appendFilterValue(params, 'assignedTo', filters.assignedTo);
  appendFilterValue(params, 'startDate', filters.startDate);
  appendFilterValue(params, 'endDate', filters.endDate);
  appendFilterValue(params, 'updatedAfter', filters.updatedAfter);
  appendFilterValue(params, 'hasNotes', filters.hasNotes);
  appendFilterValue(params, 'hasReplies', filters.hasReplies);
  appendFilterValue(params, 'isAssigned', filters.isAssigned);
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
  appendFilterValue(params, 'assignedTo', filters.assignedTo);
  appendFilterValue(params, 'startDate', filters.startDate);
  appendFilterValue(params, 'endDate', filters.endDate);
  appendFilterValue(params, 'updatedAfter', filters.updatedAfter);
  appendFilterValue(params, 'hasNotes', filters.hasNotes);
  appendFilterValue(params, 'hasReplies', filters.hasReplies);
  appendFilterValue(params, 'isAssigned', filters.isAssigned);
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
  document.getElementById('sortFieldFilter').value = params.get('sortField') || 'createdAt';
  document.getElementById('sortOrderFilter').value = params.get('sortOrder') || 'desc';
  setMultiFilterValues('status', (params.get('status') || '').split(',').filter(Boolean));
  setMultiFilterValues('category', (params.get('category') || '').split(',').filter(Boolean));
  setMultiFilterValues('priority', (params.get('priority') || '').split(',').filter(Boolean));
  document.querySelectorAll('[data-period-button]').forEach((button) => {
    button.dataset.active = button.dataset.periodButton === state.metricsPeriod ? 'true' : 'false';
  });
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
    container.innerHTML = '<div class="empty-state rounded-[1.3rem] px-4 py-5 text-sm leading-7 text-[#5f6b80]">还没有导出记录。点击上方“导出 CSV”后，这里会保留最近的导出时间和筛选摘要。</div>';
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
  if (filters.q) chips.push(`关键词: ${filters.q}`);
  filters.status.forEach((value) => chips.push(`状态: ${statusLabels[value] || value}`));
  filters.category.forEach((value) => chips.push(`分类: ${categoryLabels[value] || value}`));
  filters.priority.forEach((value) => chips.push(`优先级: ${priorityLabels[value] || value}`));
  if (filters.assignedTo) chips.push(`指派: ${filters.assignedTo}`);
  if (filters.startDate) chips.push(`开始: ${filters.startDate}`);
  if (filters.endDate) chips.push(`结束: ${filters.endDate}`);
  if (filters.updatedAfter) chips.push(`更新晚于: ${filters.updatedAfter}`);
  if (filters.hasNotes) chips.push(filters.hasNotes === 'true' ? '有备注' : '无备注');
  if (filters.hasReplies) chips.push(filters.hasReplies === 'true' ? '有回复' : '无回复');
  if (filters.isAssigned) chips.push(filters.isAssigned === 'true' ? '已分配' : '未分配');
  chips.push(`排序: ${filters.sortField === 'updatedAt' ? '更新时间' : filters.sortField === 'priority' ? '优先级' : '提交时间'} ${filters.sortOrder === 'asc' ? '升序' : '降序'}`);
  const container = document.getElementById('activeFilterChips');
  container.innerHTML = chips.map((chip) => `<span class="filter-chip">${escapeHtml(chip)}</span>`).join('');
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
  const buttons = [`<button class="ghost-button rounded-full px-4 py-2 text-sm font-medium disabled:cursor-not-allowed disabled:opacity-40" data-page="${page - 1}" ${page === 1 ? 'disabled' : ''}>上一页</button>`];
  for (let current = start; current <= end; current += 1) {
    const active = current === page;
    buttons.push(`<button class="rounded-full px-4 py-2 text-sm font-semibold ${active ? 'bg-[#172033] text-white' : 'ghost-button text-[#172033]'}" data-page="${current}" ${active ? 'disabled' : ''}>${current}</button>`);
  }
  buttons.push(`<button class="ghost-button rounded-full px-4 py-2 text-sm font-medium disabled:cursor-not-allowed disabled:opacity-40" data-page="${page + 1}" ${page === totalPages ? 'disabled' : ''}>下一页</button>`);
  container.innerHTML = `<div class="flex flex-wrap items-center justify-center gap-2">${buttons.join('')}</div>`;
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
  container.innerHTML = `
    <svg viewBox="0 0 ${width} ${height}" class="h-[260px] w-full" aria-label="处理趋势图表">
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
  `;
}
function renderIssueList(items, pagination) {
  const filters = getFilters();
  const container = document.getElementById('issuesList');
  state.issues = items;
  updateSearchSuggestions();
  renderActiveFilterChips(filters);
  renderQueueSummary(pagination, filters);

  if (!items.length) {
    container.innerHTML = '<div class="empty-state text-center">当前筛选条件下没有问题，尝试放宽日期或布尔筛选。</div>';
    document.getElementById('paginationContainer').innerHTML = '';
    return;
  }

  container.innerHTML = items.map((item) => `
    <article class="issue-card interactive-card rounded-[1.7rem] p-5 md:p-6">
      <div class="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div class="space-y-3">
          <div class="flex flex-wrap items-center gap-2">
            <span class="status-token" data-status="${escapeHtml(item.status)}">${escapeHtml(statusLabels[item.status] || item.status)}</span>
            <span class="priority-token" data-priority="${escapeHtml(item.priority)}">${escapeHtml(priorityLabels[item.priority] || item.priority)}</span>
            <span class="category-token">${escapeHtml(categoryLabels[item.category] || item.category)}</span>
            ${item.hasNotes ? `<span class="mini-token">备注 ${item.noteCount}</span>` : ''}
            ${item.hasReplies ? `<span class="mini-token">回复 ${item.replyCount}</span>` : ''}
          </div>
          <div>
            <div class="text-xs font-semibold uppercase tracking-[0.28em] text-[#72809a]">${escapeHtml(item.trackingCode)}</div>
            <div class="mt-2 text-base leading-7 text-[#172033]">${highlightText(item.content, filters.q)}</div>
          </div>
          <div class="grid gap-2 text-sm text-[#4c566b] sm:grid-cols-2 lg:grid-cols-3">
            <div><strong class="text-[#172033]">姓名：</strong>${highlightText(item.name, filters.q)}</div>
            <div><strong class="text-[#172033]">学号：</strong>${highlightText(item.studentId, filters.q)}</div>
            <div><strong class="text-[#172033]">指派：</strong>${highlightText(item.assignedTo || '未指派', filters.q)}</div>
            <div><strong class="text-[#172033]">公开：</strong>${item.isPublic ? '是' : '否'}</div>
            <div><strong class="text-[#172033]">上报：</strong>${item.isReported ? '是' : '否'}</div>
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

  renderPagination(document.getElementById('paginationContainer'), pagination, (nextPage) => loadDashboard(nextPage, { refreshMetrics: false }).catch((error) => setNotification('adminNotification', error.message, 'error')));
}

async function loadIssues(page = 1) {
  state.page = page;
  const issuesList = document.getElementById('issuesList');
  issuesList.setAttribute('aria-busy', 'true');
  issuesList.innerHTML = renderFeedbackBox('正在加载问题列表', 'loading');
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
  const data = await apiFetch(`/admin/metrics?${buildMetricsQuery(refresh)}`);
  renderMetrics(data);
  return data;
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
  ]);
  setNotification('adminNotification', '');
  setNotification('metricsNotification', '');
  return issuesResult;
}

function openDrawerShell(trigger) {
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

  container.innerHTML = items.map((item) => `
    <article class="timeline-item">
      <div class="timeline-dot">${item.type === 'public_reply' ? '答' : '更'}</div>
      <div class="rounded-[1.2rem] border border-[rgba(23,32,51,0.08)] bg-white/70 p-4">
        <div class="flex flex-wrap items-center gap-2">
          <strong class="text-[#172033]">${item.type === 'public_reply' ? '公开回复' : `${escapeHtml(statusLabels[item.oldValue] || item.oldValue || '初始状态')} → ${escapeHtml(statusLabels[item.newValue] || item.newValue || '已更新')}`}</strong>
          <span class="text-xs uppercase tracking-[0.26em] text-[#72809a]">${escapeHtml(formatDate(item.createdAt))}</span>
        </div>
        <div class="mt-2 text-sm leading-7 text-[#4c566b]">${escapeHtml(item.content || '状态已更新。')}</div>
      </div>
    </article>
  `).join('');
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

  container.innerHTML = items.map((item) => `<article class="rounded-[1.2rem] border border-[rgba(23,32,51,0.08)] bg-white/70 p-4"><div class="flex flex-wrap items-center gap-2"><strong class="text-[#172033]">${escapeHtml(item.actionType)}</strong><span class="text-xs uppercase tracking-[0.26em] text-[#72809a]">${escapeHtml(item.performedBy)} · ${escapeHtml(formatDate(item.performedAt))}</span></div><div class="mt-2 text-sm leading-7 text-[#4c566b]">${escapeHtml(JSON.stringify(item.details || {}, null, 0))}</div></article>`).join('');
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
      </div>
      <div class="grid gap-3 text-sm text-[#4c566b] md:grid-cols-2">
        <div><strong class="text-[#172033]">姓名：</strong>${escapeHtml(detail.name)}</div>
        <div><strong class="text-[#172033]">学号：</strong>${escapeHtml(detail.studentId)}</div>
        <div><strong class="text-[#172033]">提交时间：</strong>${escapeHtml(formatDate(detail.createdAt))}</div>
        <div><strong class="text-[#172033]">首次响应：</strong>${escapeHtml(formatDate(detail.firstResponseAt))}</div>
        <div><strong class="text-[#172033]">解决时间：</strong>${escapeHtml(formatDate(detail.resolvedAt))}</div>
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
  document.getElementById('drawerContent').innerHTML = renderFeedbackBox('正在加载问题详情', 'loading');
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
  if (status !== state.activeIssue.status) patch.status = status;
  if (category !== state.activeIssue.category) patch.category = category;
  if (priority !== state.activeIssue.priority) patch.priority = priority;
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
  const summary = summarizeFilters(getFilters());
  setButtonBusy(button, true, '导出中...');
  setNotification('adminNotification', '正在生成导出文件...', 'info');

  try {
    const response = await fetchWithTimeout(`${API_BASE}/admin/export?${buildExportQuery()}`, {
      headers: {
        Authorization: `Bearer ${state.token}`,
      },
    }, 30000);

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
    const filename = disposition.match(/filename="?([^";]+)"?/)?.[1] || 'issues_export.csv';
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
      summary,
    });
    setNotification('adminNotification', '导出成功，文件已开始下载。', 'success');
  } catch (error) {
    setNotification('adminNotification', error.name === 'AbortError' ? '导出超时，请缩小筛选范围后重试。' : error.message, 'error');
  } finally {
    setButtonBusy(button, false, '', '导出 CSV');
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
  sessionStorage.setItem(STORAGE_KEY, secretKey);
  const button = document.getElementById('loginButton');
  setButtonBusy(button, true, '验证中...');
  setNotification('loginNotification', '正在验证并加载后台数据...', 'info');

  try {
    await loadDashboard(state.page, { refreshMetrics: false });
    document.getElementById('loginSection').hidden = true;
    document.getElementById('adminShell').hidden = false;
    setNotification('loginNotification', '');
    document.getElementById('searchInput')?.focus();
  } catch (error) {
    sessionStorage.removeItem(STORAGE_KEY);
    state.token = null;
    setNotification('loginNotification', error.message, 'error');
  } finally {
    setButtonBusy(button, false, '', '登录并加载后台');
  }
}

function logout() {
  state.token = null;
  state.activeIssue = null;
  state.activeIssueId = null;
  sessionStorage.removeItem(STORAGE_KEY);
  document.getElementById('secretKey').value = '';
  closeDrawer();
  document.getElementById('loginSection').hidden = false;
  document.getElementById('adminShell').hidden = true;
  document.getElementById('secretKey').focus();
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

  document.getElementById('filterForm').addEventListener('submit', (event) => {
    event.preventDefault();
    loadDashboard(1, { refreshMetrics: false }).catch((error) => setNotification('adminNotification', error.message, 'error'));
  });

  document.getElementById('resetFilters').addEventListener('click', () => {
    document.getElementById('filterForm').reset();
    setMultiFilterValues('status', []);
    setMultiFilterValues('category', []);
    setMultiFilterValues('priority', []);
    state.metricsPeriod = 'week';
    document.querySelectorAll('[data-period-button]').forEach((button) => {
      button.dataset.active = button.dataset.periodButton === 'week' ? 'true' : 'false';
    });
    loadDashboard(1, { refreshMetrics: true }).catch((error) => setNotification('adminNotification', error.message, 'error'));
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
    }
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
      document.querySelectorAll('[data-period-button]').forEach((target) => {
        target.dataset.active = target.dataset.periodButton === state.metricsPeriod ? 'true' : 'false';
      });
      loadMetrics(true).then(() => syncUrl(state.page)).catch((error) => setNotification('metricsNotification', error.message, 'error'));
    });
  });
}

restoreFiltersFromUrl();
renderSearchHistory();
renderExportHistory();
bindEvents();

const storedSecret = sessionStorage.getItem(STORAGE_KEY);
if (storedSecret) {
  document.getElementById('secretKey').value = storedSecret;
  login(storedSecret);
}



