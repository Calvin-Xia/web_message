const REQUEST_TIMEOUT = 12000;
const AUTO_REFRESH_MS = 30000;
const HEALTH_FAILURE_MESSAGE = '健康检查暂时不可用，请稍后重试。';
const HEALTH_TIMEOUT_MESSAGE = '健康检查请求超时，请稍后重试。';

const dom = {
  heroStatus: document.getElementById('heroStatus'),
  heroSummary: document.getElementById('heroSummary'),
  heroVersion: document.getElementById('heroVersion'),
  heroTimestamp: document.getElementById('heroTimestamp'),
  heroAlertCount: document.getElementById('heroAlertCount'),
  healthNotification: document.getElementById('healthNotification'),
  metricRequestCount: document.getElementById('metricRequestCount'),
  metricErrorRate: document.getElementById('metricErrorRate'),
  metricLatency: document.getElementById('metricLatency'),
  metricRateLimitHits: document.getElementById('metricRateLimitHits'),
  serviceChecks: document.getElementById('serviceChecks'),
  servicesGrid: document.getElementById('servicesGrid'),
  alertBadge: document.getElementById('alertBadge'),
  alertList: document.getElementById('alertList'),
  alertRules: document.getElementById('alertRules'),
  trendChart: document.getElementById('trendChart'),
  rateLimitChart: document.getElementById('rateLimitChart'),
  errorLogList: document.getElementById('errorLogList'),
  refreshButton: document.getElementById('refreshButton'),
  toggleAutoRefresh: document.getElementById('toggleAutoRefresh'),
};

let autoRefreshTimer = null;

function escapeHtml(value) {
  const div = document.createElement('div');
  div.textContent = value ?? '';
  return div.innerHTML;
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

function formatPercent(value) {
  return `${(Number(value || 0) * 100).toFixed(2)}%`;
}

function formatDuration(value) {
  const duration = Number(value) || 0;
  return `${duration} ms`;
}

function formatTrendLabel(value) {
  if (!value) {
    return '-';
  }

  const date = new Date(value);
  return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
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

function setNotification(message = '', type = 'info') {
  dom.healthNotification.innerHTML = message ? renderFeedbackBox(message, type) : '';
}

async function fetchWithTimeout(url, options = {}, timeout = REQUEST_TIMEOUT) {
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), timeout);

  try {
    return await fetch(url, {
      cache: 'no-store',
      ...options,
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timer);
  }
}

function setLoadingState() {
  const skeleton = '<div class="skeleton h-24"></div>';
  dom.servicesGrid.setAttribute('aria-busy', 'true');
  dom.alertList.setAttribute('aria-busy', 'true');
  dom.errorLogList.setAttribute('aria-busy', 'true');
  dom.servicesGrid.innerHTML = `${skeleton}${skeleton}`;
  dom.alertList.innerHTML = '<div class="skeleton h-20"></div>';
  dom.trendChart.innerHTML = '<div class="skeleton h-48"></div>';
  dom.rateLimitChart.innerHTML = '<div class="skeleton h-48"></div>';
  dom.errorLogList.innerHTML = '<div class="skeleton h-24"></div><div class="skeleton h-24"></div>';
}

function setHero(data) {
  const status = data.status || 'healthy';
  const alerts = data.alerts || [];
  const statusText = status === 'healthy' ? '系统健康' : status === 'degraded' ? '系统降级' : '系统异常';
  const summary = status === 'healthy'
    ? `关键依赖可用，当前${alerts.length > 0 ? `仍有 ${alerts.length} 条活动告警` : '没有活动告警'}。`
    : status === 'degraded'
      ? `部分依赖或性能指标触发预警，当前有 ${alerts.length} 条活动告警。`
      : `存在关键依赖故障或高风险告警，当前有 ${alerts.length} 条活动告警。`;

  document.body.dataset.healthStatus = status;
  dom.heroStatus.dataset.status = status;
  dom.heroStatus.textContent = statusText;
  dom.heroSummary.textContent = summary;
  dom.heroVersion.textContent = data.version || '-';
  dom.heroTimestamp.textContent = formatDate(data.timestamp);
  dom.heroAlertCount.textContent = String(alerts.length);
}

function renderMetrics(metrics) {
  dom.metricRequestCount.textContent = metrics.requestCount ?? 0;
  dom.metricErrorRate.textContent = formatPercent(metrics.errorRate);
  dom.metricLatency.textContent = formatDuration(metrics.avgResponseTime);
  dom.metricRateLimitHits.textContent = metrics.rateLimitHits ?? 0;
}

function renderChecks(checks) {
  const labels = {
    database: '数据库',
    cache: '缓存',
    rateLimiter: '限流器',
  };

  dom.serviceChecks.innerHTML = Object.entries(labels).map(([key, label]) => {
    const value = checks[key] || 'warn';
    const palette = value === 'pass'
      ? 'bg-[rgba(19,121,91,0.12)] text-[#13795b]'
      : value === 'fail'
        ? 'bg-[rgba(178,58,50,0.12)] text-[#b23a32]'
        : 'bg-[rgba(217,138,23,0.12)] text-[#966015]';
    return `<span class="rounded-full px-3 py-1 text-xs font-semibold ${palette}">${label} ${escapeHtml(value)}</span>`;
  }).join('');
}

function renderServices(services, checks) {
  const entries = [
    {
      title: 'D1 数据库',
      detail: checks.database,
      data: services.d1,
    },
    {
      title: 'KV / 限流缓存',
      detail: checks.cache,
      data: services.kv,
    },
  ];

  dom.servicesGrid.innerHTML = entries.map((entry) => {
    const data = entry.data || {};
    const note = data.status === 'connected'
      ? '服务可用'
      : data.status === 'not_configured'
        ? '当前环境未配置 KV，限流将回退为跳过检查'
        : data.error || '连接异常';
    return `
      <article class="service-card rounded-[1.5rem] p-5">
        <div class="flex items-center justify-between gap-3">
          <div class="flex items-center gap-3">
            <span class="service-dot" data-status="${escapeHtml(data.status || 'warning')}"></span>
            <div>
              <div class="text-sm font-semibold text-[#172033]">${escapeHtml(entry.title)}</div>
              <div class="service-meta mt-1 text-xs uppercase tracking-[0.24em]">${escapeHtml(data.status || 'unknown')}</div>
            </div>
          </div>
          <div class="rounded-full bg-[rgba(23,32,51,0.06)] px-3 py-1 text-xs font-semibold text-[#4c566b]">${escapeHtml(entry.detail)}</div>
        </div>
        <div class="mt-4 grid gap-3 text-sm text-[#4c566b] sm:grid-cols-2">
          <div class="rounded-[1.2rem] border border-[rgba(23,32,51,0.08)] bg-white/72 px-4 py-3">
            <div class="text-xs uppercase tracking-[0.24em] text-[#72809a]">延迟</div>
            <div class="mt-2 font-semibold text-[#172033]">${data.latency == null ? '-' : `${escapeHtml(String(data.latency))} ms`}</div>
          </div>
          <div class="rounded-[1.2rem] border border-[rgba(23,32,51,0.08)] bg-white/72 px-4 py-3">
            <div class="text-xs uppercase tracking-[0.24em] text-[#72809a]">检查时间</div>
            <div class="mt-2 font-semibold text-[#172033]">${escapeHtml(formatDate(data.lastChecked))}</div>
          </div>
        </div>
        <div class="mt-4 rounded-[1.2rem] border border-[rgba(23,32,51,0.08)] bg-[rgba(23,32,51,0.03)] px-4 py-3 text-sm leading-7 text-[#4c566b]">${escapeHtml(note)}</div>
      </article>
    `;
  }).join('');
}

function renderAlerts(alerts, alertRules) {
  dom.alertBadge.textContent = `${alerts.length} 条`;

  if (!alerts.length) {
    dom.alertList.innerHTML = '<div class="rounded-[1.3rem] border border-dashed border-[rgba(23,32,51,0.14)] bg-white/55 px-4 py-6 text-sm leading-7 text-[#5f6b80]">当前没有活动告警。</div>';
  } else {
    dom.alertList.innerHTML = alerts.map((alert) => `
      <article class="alert-item rounded-[1.3rem] px-4 py-4" data-severity="${escapeHtml(alert.severity || 'warning')}">
        <div class="flex flex-wrap items-center justify-between gap-3">
          <div class="text-sm font-semibold text-[#172033]">${escapeHtml(alert.message || alert.key || '告警')}</div>
          <div class="rounded-full bg-white/70 px-3 py-1 text-xs font-semibold text-[#4c566b]">${escapeHtml(alert.severity || 'warning')}</div>
        </div>
        <div class="mt-3 text-sm leading-7 text-[#4c566b]">当前值：${escapeHtml(String(alert.actual ?? '-'))}，阈值：${escapeHtml(String(alert.threshold ?? '-'))}</div>
      </article>
    `).join('');
  }

  dom.alertRules.innerHTML = Object.entries(alertRules || {}).map(([key, rule]) => `
    <div class="alert-rule rounded-[1.2rem] border border-[rgba(23,32,51,0.08)] bg-white/65 px-4 py-3 text-sm">
      <div class="font-semibold text-[#172033]">${escapeHtml(key)}</div>
      <div class="mt-1">阈值 ${escapeHtml(String(rule.threshold))} · 持续 ${escapeHtml(rule.duration)}</div>
    </div>
  `).join('');
}

function renderTrendChart(target, trends, mode) {
  if (!trends.length) {
    target.innerHTML = '<div class="rounded-[1.3rem] border border-dashed border-[rgba(23,32,51,0.14)] bg-white/55 px-4 py-8 text-center text-sm leading-7 text-[#5f6b80]">还没有足够的采样数据。</div>';
    return;
  }

  const requestMax = Math.max(...trends.map((item) => item.requestCount || 0), 1);
  const secondaryKey = mode === 'latency' ? 'avgResponseTime' : 'rateLimitHits';
  const secondaryMax = Math.max(...trends.map((item) => Number(item[secondaryKey]) || 0), 1);

  target.innerHTML = `
    <div class="chart-grid">
      ${trends.map((item) => {
        const requestHeight = Math.max(8, Math.round(((item.requestCount || 0) / requestMax) * 120));
        const secondaryValue = Number(item[secondaryKey]) || 0;
        const secondaryHeight = secondaryValue > 0 ? Math.max(8, Math.round((secondaryValue / secondaryMax) * 92)) : 6;
        const secondaryTitle = mode === 'latency'
          ? `响应时间 ${secondaryValue} ms`
          : `限流命中 ${secondaryValue}`;
        return `
          <div class="chart-bar">
            <div class="chart-bar__request" style="height:${requestHeight}px" title="请求量 ${item.requestCount || 0}"></div>
            <div class="chart-bar__latency" style="height:${secondaryHeight}px" title="${escapeHtml(secondaryTitle)}"></div>
            <div class="chart-bar__label">${escapeHtml(formatTrendLabel(item.timestamp))}</div>
          </div>
        `;
      }).join('')}
    </div>
    <div class="mt-4 grid gap-2 text-sm text-[#4c566b] sm:grid-cols-2">
      <div class="rounded-[1.2rem] border border-[rgba(23,32,51,0.08)] bg-white/65 px-4 py-3">最新请求量：<strong class="text-[#172033]">${escapeHtml(String(trends[trends.length - 1].requestCount || 0))}</strong></div>
      <div class="rounded-[1.2rem] border border-[rgba(23,32,51,0.08)] bg-white/65 px-4 py-3">最新${mode === 'latency' ? '响应时间' : '限流命中'}：<strong class="text-[#172033]">${mode === 'latency' ? `${escapeHtml(String(trends[trends.length - 1].avgResponseTime || 0))} ms` : escapeHtml(String(trends[trends.length - 1].rateLimitHits || 0))}</strong></div>
    </div>
  `;
}

function renderErrorLogs(items) {
  if (!items.length) {
    dom.errorLogList.innerHTML = '<div class="log-shell__empty rounded-[1.3rem] border border-dashed border-[rgba(23,32,51,0.14)] bg-white/55 px-4 py-8 text-center text-sm leading-7">最近没有错误日志。</div>';
    return;
  }

  dom.errorLogList.innerHTML = items.map((item) => {
    const tone = item.status >= 500 ? 'critical' : item.status === 429 ? 'warn' : 'success';
    return `
      <article class="log-item rounded-[1.3rem] border border-[rgba(23,32,51,0.08)] bg-white/72 px-4 py-4">
        <span class="log-dot" data-tone="${escapeHtml(tone)}"></span>
        <div class="flex flex-wrap items-center gap-3">
          <div class="text-sm font-semibold text-[#172033]">${escapeHtml(item.method || 'GET')} ${escapeHtml(item.path || '/api')}</div>
          <div class="rounded-full bg-[rgba(23,32,51,0.06)] px-3 py-1 text-xs font-semibold text-[#4c566b]">HTTP ${escapeHtml(String(item.status || 500))}</div>
          <div class="text-xs uppercase tracking-[0.24em] text-[#72809a]">${escapeHtml(formatDate(item.timestamp))}</div>
        </div>
        <div class="mt-2 text-sm leading-7 text-[#4c566b]">${escapeHtml(item.message || '请求失败')}</div>
      </article>
    `;
  }).join('');
}

function renderDashboard(data) {
  setHero(data);
  renderMetrics(data.metrics || {});
  renderChecks(data.checks || {});
  renderServices(data.services || {}, data.checks || {});
  renderAlerts(data.alerts || [], data.alertRules || {});
  renderTrendChart(dom.trendChart, data.trends || [], 'latency');
  renderTrendChart(dom.rateLimitChart, data.trends || [], 'rateLimit');
  renderErrorLogs(data.recentErrors || []);
  dom.servicesGrid.setAttribute('aria-busy', 'false');
  dom.alertList.setAttribute('aria-busy', 'false');
  dom.errorLogList.setAttribute('aria-busy', 'false');
}

function renderFailure(message) {
  document.body.dataset.healthStatus = 'unhealthy';
  dom.heroStatus.dataset.status = 'unhealthy';
  dom.heroStatus.textContent = '检查失败';
  dom.heroSummary.textContent = message;
  dom.servicesGrid.setAttribute('aria-busy', 'false');
  dom.alertList.setAttribute('aria-busy', 'false');
  dom.errorLogList.setAttribute('aria-busy', 'false');
  dom.errorLogList.innerHTML = renderFeedbackBox(message, 'error');
}

function createHealthLoadError(message, details) {
  const error = new Error(message);
  error.details = details;
  return error;
}

async function loadHealth() {
  setButtonBusy(dom.refreshButton, true, '刷新中...');
  setNotification('正在获取最新健康检查结果...', 'info');

  try {
    const response = await fetchWithTimeout('/api/health');
    const payload = await response.json();

    if (!response.ok || !payload?.success) {
      throw createHealthLoadError(HEALTH_FAILURE_MESSAGE, payload?.error || `HTTP ${response.status}`);
    }

    renderDashboard(payload.data);
    setNotification('健康检查已更新。', 'success');
  } catch (error) {
    if (error.name === 'AbortError') {
      renderFailure(HEALTH_TIMEOUT_MESSAGE);
      setNotification(HEALTH_TIMEOUT_MESSAGE, 'error');
      return;
    }

    console.error('Health dashboard request failed:', error?.details || error);
    renderFailure(HEALTH_FAILURE_MESSAGE);
    setNotification(HEALTH_FAILURE_MESSAGE, 'error');
  } finally {
    setButtonBusy(dom.refreshButton, false, '', '立即刷新');
  }
}

function syncAutoRefreshButton() {
  const active = Boolean(autoRefreshTimer);
  dom.toggleAutoRefresh.dataset.active = active ? 'true' : 'false';
  dom.toggleAutoRefresh.textContent = active ? '自动刷新开启' : '自动刷新关闭';
}

function toggleAutoRefresh() {
  if (autoRefreshTimer) {
    window.clearInterval(autoRefreshTimer);
    autoRefreshTimer = null;
    setNotification('自动刷新已关闭。', 'info');
  } else {
    autoRefreshTimer = window.setInterval(loadHealth, AUTO_REFRESH_MS);
    setNotification('自动刷新已开启，每 30 秒同步一次。', 'success');
  }

  syncAutoRefreshButton();
}

setLoadingState();
loadHealth();
syncAutoRefreshButton();

dom.refreshButton.addEventListener('click', loadHealth);
dom.toggleAutoRefresh.addEventListener('click', toggleAutoRefresh);


