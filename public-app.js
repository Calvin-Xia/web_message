import { distressTypeLabels, sceneTagLabels } from './src/shared/labels.js';
import { normalizeSceneHeat } from './src/shared/campusMapHeat.js';
import { formatSvgNumber, geometryToPath, geometryToPoint } from './src/shared/campusMapGeometry.js';
import { CAMPUS_MAP_VIEWBOX, createCampusProjector } from './src/shared/campusMapProjection.js';
import { CAMPUS_MAP_DATA_ERROR_MESSAGE, readCampusMapResponse } from './src/shared/campusMapResponse.js';

const API_BASE = '/api';
const CAMPUS_MAP_URL = '/storage/campus-care-map.json';
const REQUEST_TIMEOUT = 12000;
const SEARCH_HISTORY_KEY = 'public-search-history';
const MAX_HISTORY_ITEMS = 8;
const PUBLIC_LIST_PAGE_SIZE = 5;
const CAMPUS_MAP_WIDTH = CAMPUS_MAP_VIEWBOX.width;
const CAMPUS_MAP_HEIGHT = CAMPUS_MAP_VIEWBOX.height;
const CAMPUS_MAP_PADDING = CAMPUS_MAP_VIEWBOX.padding;
const CAMPUS_MAP_NOTE = '公开聚合，不代表该地点发生个案。';
const EMAIL_INVALID_MESSAGE = '请输入格式正确的邮箱地址。';
const EMAIL_SUBMIT_BLOCK_MESSAGE = '请先填写格式正确的邮箱地址，或清空邮箱后再提交。';
const STUDENT_ID_PATTERN = /^\d{4}$|^\d{5}$|^\d{13}$/;
const CONTENT_MIN_LENGTH = 10;
const CONTENT_MAX_LENGTH = 2000;
const CLEARABLE_FILTER_KEYS = new Set(['q', 'status', 'category', 'startDate', 'endDate', 'sort']);
const statusLabels = {
  submitted: '已提交',
  in_review: '审核中',
  in_progress: '处理中',
  resolved: '已解决',
  closed: '已关闭',
};
const categoryLabels = {
  academic: '学业相关',
  facility: '设施问题',
  service: '服务咨询',
  complaint: '投诉建议',
  counseling: '心理咨询',
  other: '其他',
};
const priorityLabels = {
  low: '低',
  normal: '普通',
  high: '高',
  urgent: '紧急',
};
const state = {
  page: 1,
  pageSize: PUBLIC_LIST_PAGE_SIZE,
  searchHistory: loadStorageArray(SEARCH_HISTORY_KEY),
  items: [],
  knowledgeItems: [],
  knowledgeStatus: 'idle',
  knowledgeError: '',
  insights: null,
  campusHeat: normalizeSceneHeat([]),
  campusMap: null,
  campusMapStatus: 'idle',
};
let debounceTimer = 0;

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

function prefersReducedMotion() {
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
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

async function fetchWithTimeout(url, options = {}, timeout = REQUEST_TIMEOUT) {
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), timeout);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

function showNotification(message, type = 'error') {
  const target = document.getElementById('submitNotification');
  target.innerHTML = renderFeedbackBox(message, type);
}

function clearNotification() {
  document.getElementById('submitNotification').innerHTML = '';
}

function setFieldError(fieldId, message = '') {
  const field = document.getElementById(fieldId);
  const messageNode = document.getElementById(`${fieldId}ValidationMessage`);
  if (!field || !messageNode) {
    return;
  }

  if (message) {
    field.setAttribute('aria-invalid', 'true');
    messageNode.textContent = message;
    messageNode.hidden = false;
    return;
  }

  field.removeAttribute('aria-invalid');
  messageNode.textContent = '';
  messageNode.hidden = true;
}

function clearIssueFieldErrors() {
  ['name', 'studentId', 'category', 'content'].forEach((fieldId) => setFieldError(fieldId));
}

function getFieldValue(fieldId, { trim = false } = {}) {
  const field = document.getElementById(fieldId);
  const value = field && 'value' in field ? String(field.value) : '';
  return trim ? value.trim() : value;
}

function getNormalizedEmailValue() {
  return document.getElementById('email').value.trim();
}

function isCounselingSelected() {
  return document.getElementById('category').value === 'counseling';
}

function syncCounselingFields() {
  const enabled = isCounselingSelected();
  const wrapper = document.getElementById('counselingFields');
  const distressType = document.getElementById('distressType');
  const sceneTag = document.getElementById('sceneTag');
  wrapper.hidden = !enabled;
  distressType.disabled = !enabled;
  sceneTag.disabled = !enabled;

  if (!enabled) {
    distressType.value = '';
    sceneTag.value = '';
  }

  renderKnowledgeBase();
}

function isValidEmailAddress(value) {
  const validator = document.createElement('input');
  validator.type = 'email';
  validator.value = value;
  return validator.checkValidity();
}

function getEmailFieldState() {
  const value = getNormalizedEmailValue();
  if (!value) {
    return {
      status: 'empty',
      value: '',
      message: '',
    };
  }

  if (!isValidEmailAddress(value)) {
    return {
      status: 'invalid',
      value,
      message: EMAIL_INVALID_MESSAGE,
    };
  }

  return {
    status: 'valid',
    value,
    message: '',
  };
}

function syncEmailValidationMessage(emailState) {
  const emailInput = document.getElementById('email');
  const validationMessage = document.getElementById('emailValidationMessage');

  if (emailState.status === 'invalid') {
    emailInput.setAttribute('aria-invalid', 'true');
    validationMessage.textContent = emailState.message;
    validationMessage.hidden = false;
    return;
  }

  emailInput.removeAttribute('aria-invalid');
  validationMessage.textContent = '';
  validationMessage.hidden = true;
}

function syncContentCounter() {
  const content = document.getElementById('content');
  const counter = document.getElementById('contentCounter');
  if (!content || !counter) {
    return;
  }

  counter.textContent = `${content.value.trim().length} / ${CONTENT_MAX_LENGTH}`;
}

function validateIssueForm() {
  clearIssueFieldErrors();
  const firstInvalidFields = [];
  const name = getFieldValue('name', { trim: true });
  const studentId = getFieldValue('studentId', { trim: true });
  const category = getFieldValue('category');
  const content = getFieldValue('content', { trim: true });

  if (!name) {
    setFieldError('name', '请输入姓名。');
    firstInvalidFields.push('name');
  }

  if (!STUDENT_ID_PATTERN.test(studentId)) {
    setFieldError('studentId', '学号必须为4位、5位或13位数字。');
    firstInvalidFields.push('studentId');
  }

  if (!category) {
    setFieldError('category', '请选择分类。');
    firstInvalidFields.push('category');
  }

  if (content.length < CONTENT_MIN_LENGTH) {
    setFieldError('content', '问题内容至少需要10个字符。');
    firstInvalidFields.push('content');
  } else if (content.length > CONTENT_MAX_LENGTH) {
    setFieldError('content', '问题内容不能超过2000个字符。');
    firstInvalidFields.push('content');
  }

  return {
    valid: firstInvalidFields.length === 0,
    firstInvalidFieldId: firstInvalidFields[0] || '',
  };
}

function getFilters() {
  return {
    q: document.getElementById('searchInput').value.trim(),
    status: document.getElementById('statusFilter').value,
    category: document.getElementById('categoryFilter').value,
    startDate: document.getElementById('startDateFilter').value,
    endDate: document.getElementById('endDateFilter').value,
    sortField: document.getElementById('sortFieldFilter').value,
    sortOrder: document.getElementById('sortOrderFilter').value,
  };
}

function appendFilterValue(params, key, value) {
  if (value) {
    params.set(key, value);
  }
}

function buildQuery(page = 1) {
  const filters = getFilters();
  const params = new URLSearchParams();
  params.set('page', String(page));
  params.set('pageSize', String(state.pageSize));
  appendFilterValue(params, 'q', filters.q);
  appendFilterValue(params, 'status', filters.status);
  appendFilterValue(params, 'category', filters.category);
  appendFilterValue(params, 'startDate', filters.startDate);
  appendFilterValue(params, 'endDate', filters.endDate);
  appendFilterValue(params, 'sortField', filters.sortField);
  appendFilterValue(params, 'sortOrder', filters.sortOrder);
  return params.toString();
}

function syncUrl(page = state.page) {
  const filters = getFilters();
  const params = new URLSearchParams();
  params.set('page', String(page));
  appendFilterValue(params, 'q', filters.q);
  appendFilterValue(params, 'status', filters.status);
  appendFilterValue(params, 'category', filters.category);
  appendFilterValue(params, 'startDate', filters.startDate);
  appendFilterValue(params, 'endDate', filters.endDate);
  appendFilterValue(params, 'sortField', filters.sortField);
  appendFilterValue(params, 'sortOrder', filters.sortOrder);
  const next = params.toString();
  const target = next ? `${window.location.pathname}?${next}` : window.location.pathname;
  window.history.replaceState(null, '', target);
}

function restoreFiltersFromUrl() {
  const params = new URLSearchParams(window.location.search);
  state.page = Math.max(1, Number(params.get('page')) || 1);
  document.getElementById('searchInput').value = params.get('q') || '';
  document.getElementById('statusFilter').value = params.get('status') || '';
  document.getElementById('categoryFilter').value = params.get('category') || '';
  document.getElementById('startDateFilter').value = params.get('startDate') || '';
  document.getElementById('endDateFilter').value = params.get('endDate') || '';
  document.getElementById('sortFieldFilter').value = params.get('sortField') || 'updatedAt';
  document.getElementById('sortOrderFilter').value = params.get('sortOrder') || 'desc';
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

function updateSearchSuggestions() {
  const datalist = document.getElementById('publicSearchSuggestions');
  const dynamicValues = state.items.slice(0, 10).map((item) => item.trackingCode);
  const options = Array.from(new Set([...state.searchHistory, ...dynamicValues])).slice(0, 12);
  datalist.innerHTML = options.map((value) => `<option value="${escapeHtml(value)}"></option>`).join('');
}

function renderSearchHistory() {
  const container = document.getElementById('searchHistory');
  if (state.searchHistory.length === 0) {
    container.innerHTML = '';
    updateSearchSuggestions();
    return;
  }

  container.innerHTML = state.searchHistory.map((item) => `<button class="history-chip rounded-full px-3 py-2 text-xs font-semibold transition hover:bg-white" type="button" data-history-term="${escapeHtml(item)}">${escapeHtml(item)}</button>`).join('');
  container.querySelectorAll('[data-history-term]').forEach((button) => {
    button.addEventListener('click', () => {
      document.getElementById('searchInput').value = button.dataset.historyTerm || '';
      loadPublicList(1);
    });
  });
  updateSearchSuggestions();
}

function renderActiveFilterChips(filters) {
  const chips = [];
  if (filters.q) chips.push({ key: 'q', label: `关键词: ${filters.q}` });
  if (filters.status) chips.push({ key: 'status', label: `状态: ${statusLabels[filters.status] || filters.status}` });
  if (filters.category) chips.push({ key: 'category', label: `分类: ${categoryLabels[filters.category] || filters.category}` });
  if (filters.startDate) chips.push({ key: 'startDate', label: `开始: ${filters.startDate}` });
  if (filters.endDate) chips.push({ key: 'endDate', label: `结束: ${filters.endDate}` });
  if (filters.sortField !== 'updatedAt' || filters.sortOrder !== 'desc') {
    chips.push({
      key: 'sort',
      label: `排序: ${filters.sortField === 'status' ? '状态顺序' : filters.sortField === 'createdAt' ? '提交时间' : '最近更新'} ${filters.sortOrder === 'asc' ? '升序' : '降序'}`,
    });
  }

  const container = document.getElementById('activeFilterChips');
  container.innerHTML = chips.map((chip) => `
    <span class="filter-chip">
      ${escapeHtml(chip.label)}
      <button class="filter-chip__remove" type="button" data-clear-filter="${escapeHtml(chip.key)}" aria-label="移除筛选 ${escapeHtml(chip.label)}">×</button>
    </span>
  `).join('');

}

function clearFilter(key) {
  if (!CLEARABLE_FILTER_KEYS.has(key)) {
    return;
  }

  const resetMap = {
    q: () => { document.getElementById('searchInput').value = ''; },
    status: () => { document.getElementById('statusFilter').value = ''; },
    category: () => { document.getElementById('categoryFilter').value = ''; },
    startDate: () => { document.getElementById('startDateFilter').value = ''; },
    endDate: () => { document.getElementById('endDateFilter').value = ''; },
    sort: () => {
      document.getElementById('sortFieldFilter').value = 'updatedAt';
      document.getElementById('sortOrderFilter').value = 'desc';
    },
  };

  resetMap[key]?.();
  syncAdvancedPublicFiltersState();
}

function renderPagination(container, pagination, onChange) {
  if (!pagination || pagination.totalPages <= 1) {
    container.innerHTML = '';
    return;
  }

  const { page, totalPages } = pagination;
  const buttons = [];
  const start = Math.max(1, page - 2);
  const end = Math.min(totalPages, start + 4);

  buttons.push(`<button class="ghost-button rounded-full px-4 py-2 text-sm font-medium disabled:cursor-not-allowed disabled:opacity-40" data-page="${page - 1}" aria-label="上一页" ${page === 1 ? 'disabled' : ''}>上一页</button>`);
  for (let current = start; current <= end; current += 1) {
    const active = current === page;
    buttons.push(`<button class="rounded-full px-4 py-2 text-sm font-semibold ${active ? 'bg-[#172033] text-white' : 'ghost-button text-[#172033]'}" data-page="${current}" aria-label="第 ${current} 页" ${active ? 'aria-current="page" disabled' : ''}>${current}</button>`);
  }
  buttons.push(`<button class="ghost-button rounded-full px-4 py-2 text-sm font-medium disabled:cursor-not-allowed disabled:opacity-40" data-page="${page + 1}" aria-label="下一页" ${page === totalPages ? 'disabled' : ''}>下一页</button>`);
  container.innerHTML = `<nav class="flex flex-wrap items-center justify-center gap-2" aria-label="公开列表分页">${buttons.join('')}</nav>`;

  container.querySelectorAll('button[data-page]').forEach((button) => {
    button.addEventListener('click', () => {
      const nextPage = Number(button.dataset.page);
      if (Number.isFinite(nextPage) && nextPage >= 1 && nextPage <= totalPages && nextPage !== page) {
        onChange(nextPage);
      }
    });
  });
}

function renderSummary(pagination, filters) {
  const headline = filters.q ? `找到 ${pagination.total} 条公开同步` : `共 ${pagination.total} 条公开同步`;
  const scope = filters.q ? `关键词 ${filters.q}` : '默认按最近更新浏览';
  document.getElementById('publicSummary').textContent = `${headline} · 第 ${pagination.page} / ${Math.max(pagination.totalPages, 1)} 页 · ${scope}`;
}

function syncAdvancedPublicFiltersState() {
  const details = document.getElementById('advancedPublicFilters');
  if (!(details instanceof HTMLDetailsElement)) {
    return;
  }

  const hasAdvancedFilters = Boolean(
    document.getElementById('startDateFilter').value
    || document.getElementById('endDateFilter').value
    || document.getElementById('sortFieldFilter').value !== 'updatedAt'
    || document.getElementById('sortOrderFilter').value !== 'desc',
  );

  details.open = hasAdvancedFilters;
}

function renderPublicList(items, pagination) {
  const list = document.getElementById('publicList');
  const paginationContainer = document.getElementById('publicPagination');
  const filters = getFilters();
  state.items = items;
  updateSearchSuggestions();
  renderActiveFilterChips(filters);
  renderSummary(pagination, filters);

  if (!items || items.length === 0) {
    list.innerHTML = `
      <div class="empty-state text-center">
        <div>当前筛选条件下没有公开问题。</div>
        <button class="ghost-button mt-4 px-4 py-2 text-sm font-semibold" type="button" data-empty-reset>清空筛选</button>
      </div>
    `;
    list.querySelector('[data-empty-reset]')?.addEventListener('click', () => {
      document.getElementById('filterForm').reset();
      syncAdvancedPublicFiltersState();
      loadPublicList(1);
    });
    paginationContainer.innerHTML = '';
    return;
  }

  list.innerHTML = items.map((item) => {
    const summary = item.publicSummary || item.content;
    const trackingHref = `/tracking.html?code=${encodeURIComponent(item.trackingCode)}`;
    return `
      <article class="public-card interactive-card rounded-[1.6rem] p-5 md:p-6">
        <div class="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
          <div class="space-y-4">
            <div class="flex flex-wrap items-center gap-2">
              <span class="status-token" data-status="${escapeHtml(item.status)}">${escapeHtml(statusLabels[item.status] || item.status)}</span>
              <span class="category-token">${escapeHtml(categoryLabels[item.category] || item.category)}</span>
              ${item.category === 'counseling' && item.distressType ? `<span class="mini-token">${escapeHtml(distressTypeLabels[item.distressType] || item.distressType)}</span>` : ''}
              ${item.category === 'counseling' && item.sceneTag ? `<span class="mini-token">${escapeHtml(sceneTagLabels[item.sceneTag] || item.sceneTag)}</span>` : ''}
              <span class="priority-token" data-priority="${escapeHtml(item.priority)}">${escapeHtml(priorityLabels[item.priority] || item.priority)}</span>
            </div>
            <div>
              <div class="text-xs font-semibold uppercase tracking-[0.28em] text-[#72809a]">${escapeHtml(item.trackingCode)}</div>
              <p class="mt-2 text-lg leading-8 text-[#172033]">${highlightText(summary, filters.q)}</p>
            </div>
            <div class="flex flex-wrap gap-x-5 gap-y-2 text-sm leading-6 text-[#4c566b]">
              <span><strong class="text-[#172033]">提交：</strong>${escapeHtml(formatDate(item.createdAt))}</span>
              <span><strong class="text-[#172033]">更新：</strong>${escapeHtml(formatDate(item.updatedAt))}</span>
              <span><strong class="text-[#172033]">查看：</strong>追踪页查看完整进度</span>
            </div>
          </div>
          <div class="result-meta-card text-sm text-[#4c566b]">
            <div class="text-xs font-semibold uppercase tracking-[0.3em] text-[#72809a]">Tracking Code</div>
            <div class="mt-2 text-2xl font-black tracking-[0.18em] text-[#172033]">${escapeHtml(item.trackingCode)}</div>
            <a class="ghost-button mt-4 w-full rounded-full px-4 py-2 text-sm font-semibold text-[#172033] transition" href="${trackingHref}" aria-label="查看问题 ${escapeHtml(item.trackingCode)} 的处理进度">查看处理进度</a>
          </div>
        </div>
      </article>
    `;
  }).join('');

  renderPagination(paginationContainer, pagination, (nextPage) => {
    loadPublicList(nextPage);
  });
}

function renderKnowledgeBase() {
  const container = document.getElementById('knowledgeBase');
  if (!container) {
    return;
  }

  if (state.knowledgeStatus === 'loading') {
    container.innerHTML = `<div class="md:col-span-2 xl:col-span-3">${renderFeedbackBox('正在加载知识库', 'loading')}</div>`;
    return;
  }

  if (state.knowledgeStatus === 'error') {
    container.innerHTML = `<div class="md:col-span-2 xl:col-span-3">${renderFeedbackBox(state.knowledgeError || '知识库加载失败，请稍后再试。', 'error')}</div>`;
    return;
  }

  const category = document.getElementById('category')?.value || '';
  const distressType = document.getElementById('distressType')?.value || '';
  const visibleItems = category === 'counseling' && distressType
    ? state.knowledgeItems.filter((item) => item.tag === distressType)
    : state.knowledgeItems;

  if (visibleItems.length === 0) {
    const message = category === 'counseling' && distressType
      ? '暂时没有对应困扰类别的知识卡片。你仍然可以提交问题，后台会继续补充自助建议。'
      : '暂时没有可公开展示的知识卡片。';
    container.innerHTML = `<div class="empty-state rounded-[1.4rem] px-5 py-8 text-center text-sm leading-7 text-[#5f6b80] md:col-span-2 xl:col-span-3">${escapeHtml(message)}</div>`;
    return;
  }

  container.innerHTML = visibleItems.map((item) => `
    <article class="interactive-card rounded-[1.4rem] border border-[rgba(23,32,51,0.08)] bg-white/72 p-5">
      <div class="flex flex-wrap items-center gap-2">
        <span class="mini-token">${escapeHtml(distressTypeLabels[item.tag] || item.title)}</span>
      </div>
      <h4 class="display-font mt-4 text-2xl text-[#172033]">${escapeHtml(item.title)}</h4>
      <p class="mt-3 text-sm leading-7 text-[#4c566b]">${escapeHtml(item.content)}</p>
    </article>
  `).join('');
}

async function loadKnowledgeBase() {
  state.knowledgeStatus = 'loading';
  state.knowledgeError = '';
  renderKnowledgeBase();

  try {
    const response = await fetchWithTimeout(`${API_BASE}/knowledge`);
    const result = await response.json();
    if (!response.ok || !result.success) {
      throw new Error(result.error || '知识库加载失败');
    }

    state.knowledgeItems = result.data?.items || [];
    state.knowledgeStatus = 'ready';
  } catch (error) {
    state.knowledgeStatus = 'error';
    state.knowledgeError = error.name === 'AbortError' ? '知识库加载超时，请稍后再试。' : error.message;
  } finally {
    renderKnowledgeBase();
  }
}

function getCampusFeatureStats(scene, heat = state.campusHeat) {
  return heat.byScene[scene] || {
    scene,
    total: 0,
    pending: 0,
    heatLevel: 0,
  };
}

function buildCampusFeatureLabel(feature, stats) {
  const sceneLabel = sceneTagLabels[feature.scene] || feature.scene || '校园空间';
  const placeName = feature.name || sceneLabel;
  return `${placeName}，${sceneLabel}，公开反馈 ${stats.total} 条，待跟进 ${stats.pending} 条。${CAMPUS_MAP_NOTE}`;
}

function renderCampusFeatureElement(feature, project, stats) {
  const label = buildCampusFeatureLabel(feature, stats);
  const attributes = [
    `data-campus-feature-id="${escapeHtml(feature.id)}"`,
    `data-scene="${escapeHtml(feature.scene)}"`,
    `data-heat="${escapeHtml(String(stats.heatLevel))}"`,
    `tabindex="0"`,
    `role="listitem"`,
    `aria-label="${escapeHtml(label)}"`,
  ].join(' ');

  if (feature.kind === 'point') {
    const point = geometryToPoint(feature.geometry, project);
    if (!point) {
      return '';
    }

    return `<circle class="campus-map-point" ${attributes} cx="${formatSvgNumber(point.x)}" cy="${formatSvgNumber(point.y)}" r="6"><title>${escapeHtml(label)}</title></circle>`;
  }

  const path = geometryToPath(feature.geometry, project);
  if (!path) {
    return '';
  }

  // geometryToPath emits commands from validated numeric coordinates; this escape is a final HTML attribute guard.
  return `<path class="campus-map-shape campus-map-shape--${escapeHtml(feature.kind || 'geometry')}" ${attributes} d="${escapeHtml(path)}"><title>${escapeHtml(label)}</title></path>`;
}

function renderCampusDefaultDetail(heat) {
  const total = Object.values(heat.byScene).reduce((sum, item) => sum + item.total, 0);
  const pending = Object.values(heat.byScene).reduce((sum, item) => sum + item.pending, 0);
  return `
    <div class="campus-map-detail__label">Hover Detail</div>
    <div class="campus-map-detail__title">悬停地图区域查看聚合热度</div>
    <div class="campus-map-detail__meta">当前公开心理反馈 ${total} 条，待跟进 ${pending} 条。</div>
    <div class="campus-map-detail__note">${CAMPUS_MAP_NOTE}</div>
  `;
}

function renderCampusFeatureDetail(feature, stats) {
  const sceneLabel = sceneTagLabels[feature.scene] || feature.scene || '校园空间';
  return `
    <div class="campus-map-detail__label">${escapeHtml(sceneLabel)}</div>
    <div class="campus-map-detail__title">${escapeHtml(feature.name || sceneLabel)}</div>
    <div class="campus-map-detail__meta">公开反馈 ${stats.total} 条 · 待跟进 ${stats.pending} 条</div>
    <div class="campus-map-detail__note">${CAMPUS_MAP_NOTE}</div>
  `;
}

function setCampusFeatureDetail(feature) {
  const detail = document.getElementById('campusMapDetail');
  if (!detail) {
    return;
  }

  const heat = state.campusHeat;
  if (!feature) {
    detail.innerHTML = renderCampusDefaultDetail(heat);
    return;
  }

  detail.innerHTML = renderCampusFeatureDetail(feature, getCampusFeatureStats(feature.scene, heat));
}

function renderCampusLegend(heat) {
  return Object.entries(sceneTagLabels).map(([scene, label]) => {
    const stats = getCampusFeatureStats(scene, heat);
    return `
      <div class="campus-map-legend__item" data-scene="${escapeHtml(scene)}">
        <span class="campus-map-legend__swatch" aria-hidden="true"></span>
        <span>${escapeHtml(label)}</span>
        <strong>${stats.total}</strong>
      </div>
    `;
  }).join('');
}

function renderCampusMapFeedback(message, type = 'info') {
  const viewport = document.getElementById('campusMapViewport');
  if (!viewport) {
    return;
  }

  viewport.innerHTML = renderFeedbackBox(message, type);
}

function renderCampusMap() {
  const viewport = document.getElementById('campusMapViewport');
  if (!viewport || state.campusMapStatus !== 'loaded' || !state.campusMap) {
    return;
  }

  const features = Array.isArray(state.campusMap.features) ? state.campusMap.features : [];
  if (!features.length) {
    renderCampusMapFeedback('校园地图暂无可展示的场景要素。');
    return;
  }

  const heat = state.campusHeat;
  const project = createCampusProjector(state.campusMap.bbox, {
    width: CAMPUS_MAP_WIDTH,
    height: CAMPUS_MAP_HEIGHT,
    padding: CAMPUS_MAP_PADDING,
  });
  const featureElements = features
    .map((feature) => renderCampusFeatureElement(feature, project, getCampusFeatureStats(feature.scene, heat)))
    .filter(Boolean)
    .join('');

  viewport.innerHTML = `
    <div class="campus-map-grid">
      <div class="campus-map-canvas">
        <svg class="campus-map-svg" viewBox="0 0 ${CAMPUS_MAP_WIDTH} ${CAMPUS_MAP_HEIGHT}" role="img" aria-labelledby="campusMapTitle campusMapDesc">
          <title id="campusMapTitle">校园心理压力热区地图</title>
          <desc id="campusMapDesc">按公开心理咨询反馈场景聚合热度，不展示个人身份或精确位置。</desc>
          <g role="list">
            ${featureElements}
          </g>
        </svg>
      </div>
      <aside>
        <div id="campusMapDetail" class="campus-map-detail" aria-live="polite"></div>
        <div class="campus-map-legend" aria-label="地图图例">
          ${renderCampusLegend(heat)}
        </div>
      </aside>
    </div>
  `;
  setCampusFeatureDetail(null);
}

async function loadCampusMap() {
  if (state.campusMapStatus === 'loaded') {
    renderCampusMap();
    return;
  }

  if (state.campusMapStatus === 'loading') {
    return;
  }

  state.campusMapStatus = 'loading';
  renderCampusMapFeedback('正在加载校园地图', 'loading');

  try {
    const response = await fetchWithTimeout(CAMPUS_MAP_URL, { cache: 'force-cache' });
    const campusMap = await readCampusMapResponse(response);
    state.campusMap = campusMap;
    state.campusMapStatus = 'loaded';
    renderCampusMap();
  } catch (error) {
    state.campusMapStatus = 'error';
    const message = error.name === 'AbortError'
      ? '校园地图加载超时'
      : error.message === CAMPUS_MAP_DATA_ERROR_MESSAGE ? CAMPUS_MAP_DATA_ERROR_MESSAGE : '校园地图暂不可用';
    renderCampusMapFeedback(message, 'error');
  }
}

function findCampusFeatureFromEvent(event) {
  const target = event.target;
  if (!(target instanceof Element)) {
    return null;
  }

  const shape = target.closest('[data-campus-feature-id]');
  if (!(shape instanceof HTMLElement) && !(shape instanceof SVGElement)) {
    return null;
  }

  const featureId = shape.getAttribute('data-campus-feature-id');
  return state.campusMap?.features?.find((feature) => feature.id === featureId) || null;
}

function handleCampusMapInteraction(event) {
  const feature = findCampusFeatureFromEvent(event);
  if (feature) {
    setCampusFeatureDetail(feature);
  }
}

function renderSceneHotspots(data) {
  const container = document.getElementById('sceneHotspots');
  const summary = document.getElementById('insightsSummary');
  state.insights = data;
  state.campusHeat = normalizeSceneHeat(data.sceneHotspots || []);
  renderCampusMap();
  const hotspots = data.sceneHotspots || [];
  const publicCounselingIssues = Number(data.overview?.publicCounselingIssues) || 0;
  const rangeLabel = data.range?.days ? `近 ${data.range.days} 天` : '公开';
  summary.textContent = `${rangeLabel}心理反馈 ${publicCounselingIssues} 条 · 场景热区 ${hotspots.length} 个`;

  if (!hotspots.length) {
    container.innerHTML = '<div class="empty-state rounded-[1.4rem] px-5 py-8 text-center text-sm leading-7 text-[#5f6b80] md:col-span-2 xl:col-span-3">还没有可公开展示的心理咨询场景数据。</div>';
    return;
  }

  const maxValue = Math.max(1, ...hotspots.map((item) => Number(item.total) || 0));
  container.innerHTML = hotspots.map((item, index) => {
    const total = Number(item.total) || 0;
    const pending = Number(item.pending) || 0;
    const percentage = Math.max(8, Math.round((total / maxValue) * 100));
    return `
      <article class="interactive-card rounded-[1.5rem] border border-[rgba(23,32,51,0.08)] bg-white/76 p-5">
        <div class="flex items-start justify-between gap-3">
          <div>
            <div class="text-xs font-semibold uppercase tracking-[0.24em] text-[#72809a]">Hotspot ${index + 1}</div>
            <h4 class="display-font mt-2 text-2xl text-[#172033]">${escapeHtml(sceneTagLabels[item.scene] || item.scene)}</h4>
          </div>
          <strong class="text-3xl text-[#172033]">${total}</strong>
        </div>
        <div class="mt-4 bar-track"><div class="bar-fill" data-tone="${pending > 0 ? 'warm' : 'mint'}" style="width:${percentage}%"></div></div>
        <div class="mt-3 flex flex-wrap gap-2 text-xs leading-5 text-[#5f6b80]">
          <span class="mini-token">待跟进 ${pending}</span>
          <span class="mini-token">公开聚合</span>
        </div>
      </article>
    `;
  }).join('');
}

async function loadInsights() {
  const container = document.getElementById('sceneHotspots');
  const summary = document.getElementById('insightsSummary');
  container.innerHTML = renderFeedbackBox('正在加载热区', 'loading');

  try {
    const response = await fetchWithTimeout(`${API_BASE}/insights`, { cache: 'no-store' });
    const result = await response.json();
    if (!response.ok || !result.success) {
      throw new Error(result.error || '热区加载失败');
    }

    renderSceneHotspots(result.data || {});
  } catch (error) {
    summary.textContent = '热区暂不可用';
    container.innerHTML = renderFeedbackBox(error.name === 'AbortError' ? '热区加载超时' : error.message, 'error');
  }
}

async function loadPublicList(page = 1) {
  const list = document.getElementById('publicList');
  const filters = getFilters();
  state.page = page;
  syncUrl(page);
  if (filters.q) {
    pushSearchHistory(filters.q);
  }
  list.setAttribute('aria-busy', 'true');
  list.innerHTML = renderFeedbackBox('正在加载公开列表', 'loading');

  try {
    const response = await fetchWithTimeout(`${API_BASE}/issues?${buildQuery(page)}`);
    const result = await response.json();

    if (!response.ok || !result.success) {
      throw new Error(result.error || '公开列表加载失败');
    }

    renderPublicList(result.data.items || [], result.data.pagination);
  } catch (error) {
    const message = error.name === 'AbortError' ? '公开列表加载超时' : error.message;
    list.innerHTML = renderFeedbackBox(message, 'error');
    document.getElementById('publicPagination').innerHTML = '';
  } finally {
    list.setAttribute('aria-busy', 'false');
  }
}

function schedulePublicReload() {
  window.clearTimeout(debounceTimer);
  debounceTimer = window.setTimeout(() => {
    loadPublicList(1);
  }, 320);
}

function syncNotificationPreference() {
  const notifyCheckbox = document.getElementById('notifyByEmail');
  const emailState = getEmailFieldState();
  const canNotify = emailState.status === 'valid';

  syncEmailValidationMessage(emailState);
  notifyCheckbox.disabled = !canNotify;
  notifyCheckbox.setAttribute('aria-disabled', String(!canNotify));
  if (!canNotify) {
    notifyCheckbox.checked = false;
  }

  return emailState;
}

function handleEmailBlur() {
  const emailInput = document.getElementById('email');
  const trimmed = emailInput.value.trim();

  if (emailInput.value !== trimmed) {
    emailInput.value = trimmed;
  }

  syncNotificationPreference();
}

async function handleSubmit(event) {
  event.preventDefault();
  clearNotification();
  clearIssueFieldErrors();

  const emailInput = document.getElementById('email');
  const notifyCheckbox = document.getElementById('notifyByEmail');
  const trimmedEmail = emailInput.value.trim();
  if (emailInput.value !== trimmedEmail) {
    emailInput.value = trimmedEmail;
  }

  const emailState = syncNotificationPreference();
  if (emailState.status === 'invalid') {
    showNotification(EMAIL_SUBMIT_BLOCK_MESSAGE, 'error');
    emailInput.focus();
    return;
  }

  const validation = validateIssueForm();
  if (!validation.valid) {
    showNotification('请先修正标记的字段。', 'error');
    document.getElementById(validation.firstInvalidFieldId)?.focus();
    return;
  }

  const button = document.getElementById('submitButton');
  const category = document.getElementById('category').value;
  const payload = {
    name: document.getElementById('name').value.trim(),
    studentId: document.getElementById('studentId').value.trim(),
    email: emailState.value,
    notifyByEmail: emailState.status === 'valid' && notifyCheckbox.checked,
    category,
    content: document.getElementById('content').value.trim(),
    isPublic: document.getElementById('isPublic').checked,
    isReported: document.getElementById('isReported').checked,
  };
  if (category === 'counseling') {
    const distressType = document.getElementById('distressType').value;
    const sceneTag = document.getElementById('sceneTag').value;
    if (distressType) {
      payload.distressType = distressType;
    }
    if (sceneTag) {
      payload.sceneTag = sceneTag;
    }
  }

  setButtonBusy(button, true, '提交中...');

  try {
    const response = await fetchWithTimeout(`${API_BASE}/issues`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    });
    const result = await response.json();

    if (!response.ok || !result.success) {
      throw new Error(result.error || '提交失败');
    }

    const data = result.data;
    const trackingLink = `/tracking.html?code=${encodeURIComponent(data.trackingCode)}`;
    document.getElementById('trackingCodeValue').textContent = data.trackingCode;
    document.getElementById('trackingLink').href = trackingLink;
    document.getElementById('trackingReceipt').hidden = false;
    document.getElementById('trackingReceipt').setAttribute('tabindex', '-1');
    document.getElementById('trackingReceipt').scrollIntoView({
      behavior: prefersReducedMotion() ? 'auto' : 'smooth',
      block: 'start',
    });
    document.getElementById('trackingReceipt').focus({ preventScroll: true });
    document.getElementById('issueForm').reset();
    clearIssueFieldErrors();
    syncContentCounter();
    syncNotificationPreference();
    syncCounselingFields();
    showNotification('提交成功，追踪编号已生成。', 'success');
    await Promise.all([loadPublicList(1), loadInsights()]);
  } catch (error) {
    const message = error.name === 'AbortError' ? '请求超时，请重试' : error.message;
    showNotification(message, 'error');
  } finally {
    setButtonBusy(button, false, '', '提交并生成追踪编号');
  }
}

async function copyTrackingCode() {
  const value = document.getElementById('trackingCodeValue').textContent.trim();
  if (!value) {
    return;
  }

  try {
    await navigator.clipboard.writeText(value);
    showNotification('追踪编号已复制到剪贴板。', 'success');
  } catch {
    showNotification('复制失败，请手动记录追踪编号。');
  }
}

function bindEvents() {
  document.getElementById('issueForm').addEventListener('submit', handleSubmit);
  document.getElementById('category').addEventListener('change', syncCounselingFields);
  document.getElementById('distressType').addEventListener('change', renderKnowledgeBase);
  document.getElementById('email').addEventListener('input', syncNotificationPreference);
  document.getElementById('email').addEventListener('blur', handleEmailBlur);
  document.getElementById('content').addEventListener('input', () => {
    syncContentCounter();
    setFieldError('content');
  });
  ['name', 'studentId', 'category'].forEach((id) => {
    document.getElementById(id).addEventListener('input', () => setFieldError(id));
    document.getElementById(id).addEventListener('change', () => setFieldError(id));
  });
  document.getElementById('filterForm').addEventListener('submit', (event) => {
    event.preventDefault();
    loadPublicList(1);
  });
  document.getElementById('resetFilters').addEventListener('click', () => {
    document.getElementById('filterForm').reset();
    const advancedFilters = document.getElementById('advancedPublicFilters');
    if (advancedFilters instanceof HTMLDetailsElement) {
      advancedFilters.open = false;
    }
    syncUrl(1);
    loadPublicList(1);
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

    clearFilter(button.dataset.clearFilter || '');
    loadPublicList(1);
  });
  document.getElementById('copyTrackingCode').addEventListener('click', copyTrackingCode);

  const campusMapPanel = document.getElementById('campusMapPanel');
  const campusMapViewport = document.getElementById('campusMapViewport');
  campusMapPanel?.addEventListener('toggle', () => {
    if (campusMapPanel.open) {
      loadCampusMap();
    }
  });
  campusMapViewport?.addEventListener('mouseover', handleCampusMapInteraction);
  campusMapViewport?.addEventListener('focusin', handleCampusMapInteraction);
  campusMapViewport?.addEventListener('click', handleCampusMapInteraction);
  // Pointer reset only fires after leaving the viewport; keyboard focus can move within the map subtree.
  campusMapViewport?.addEventListener('mouseleave', () => setCampusFeatureDetail(null));
  campusMapViewport?.addEventListener('focusout', (event) => {
    if (!(event.relatedTarget instanceof Node) || !campusMapViewport.contains(event.relatedTarget)) {
      setCampusFeatureDetail(null);
    }
  });

  ['searchInput', 'statusFilter', 'categoryFilter', 'startDateFilter', 'endDateFilter', 'sortFieldFilter', 'sortOrderFilter'].forEach((id) => {
    const element = document.getElementById(id);
    const eventName = id === 'searchInput' ? 'input' : 'change';
    element.addEventListener(eventName, schedulePublicReload);
  });

  ['startDateFilter', 'endDateFilter', 'sortFieldFilter', 'sortOrderFilter'].forEach((id) => {
    document.getElementById(id).addEventListener('change', syncAdvancedPublicFiltersState);
  });
}

restoreFiltersFromUrl();
syncAdvancedPublicFiltersState();
renderSearchHistory();
bindEvents();
syncNotificationPreference();
syncCounselingFields();
syncContentCounter();


loadKnowledgeBase();
loadPublicList(state.page);
loadInsights();

