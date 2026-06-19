export const RETRY_CONFIG = Object.freeze({
  maxRetries: 2,
  retryDelay: 400,
  retryBackoff: 2,
});

function wait(delay) {
  return new Promise((resolve) => window.setTimeout(resolve, delay));
}

export async function retryRequest(operation, config = {}) {
  const {
    maxRetries = RETRY_CONFIG.maxRetries,
    retryDelay = RETRY_CONFIG.retryDelay,
    retryBackoff = RETRY_CONFIG.retryBackoff,
    shouldRetry = () => true,
    sleep = wait,
    onRetry = () => {},
  } = config;

  let attempt = 0;
  while (true) {
    try {
      return await operation(attempt);
    } catch (error) {
      if (attempt >= maxRetries || !shouldRetry(error, attempt)) {
        throw error;
      }

      const delay = retryDelay * (retryBackoff ** attempt);
      onRetry(error, attempt + 1, delay);
      await sleep(delay);
      attempt += 1;
    }
  }
}

export function isRetryableHttpStatus(status) {
  return status === 408 || status === 425 || status === 429 || status >= 500;
}

function isRetryableNetworkError(error) {
  return error?.retryable === true
    || error?.name === 'AbortError'
    || error instanceof TypeError;
}

export async function retryFetch(operation, config = {}) {
  try {
    return await retryRequest(async (attempt) => {
      const response = await operation(attempt);
      if (!isRetryableHttpStatus(response.status)) {
        return response;
      }

      const error = new Error(`Retryable HTTP status: ${response.status}`);
      error.retryable = true;
      error.retryResponse = response;
      throw error;
    }, {
      ...config,
      shouldRetry: config.shouldRetry || isRetryableNetworkError,
    });
  } catch (error) {
    if (error?.retryResponse) {
      return error.retryResponse;
    }
    throw error;
  }
}

export function getHorizontalScrollState({
  scrollLeft,
  scrollWidth,
  clientWidth,
}) {
  const maxScrollLeft = Math.max(0, scrollWidth - clientWidth);
  const tolerance = 4;

  return {
    canScrollBackward: scrollLeft > tolerance,
    canScrollForward: scrollLeft < maxScrollLeft - tolerance,
  };
}

function normalizeSkeletonCount(count) {
  const value = Number(count);
  return Number.isFinite(value) ? Math.max(1, Math.min(8, Math.floor(value))) : 1;
}

function renderListSkeleton(count) {
  return Array.from({ length: normalizeSkeletonCount(count) }, () => `
    <div class="skeleton-card">
      <div class="skeleton skeleton-line skeleton-line--short"></div>
      <div class="skeleton skeleton-line"></div>
      <div class="skeleton skeleton-line skeleton-line--medium"></div>
    </div>
  `).join('');
}

function renderDetailSkeleton() {
  return `
    <div class="skeleton-detail">
      <div class="skeleton skeleton-line skeleton-line--short"></div>
      <div class="skeleton skeleton-block"></div>
      <div class="skeleton skeleton-line"></div>
      <div class="skeleton skeleton-line skeleton-line--medium"></div>
    </div>
  `;
}

function renderStatsSkeleton(count) {
  return Array.from({ length: normalizeSkeletonCount(count) }, () => `
    <div class="skeleton-stat">
      <div class="skeleton skeleton-line skeleton-line--short"></div>
      <div class="skeleton skeleton-number"></div>
    </div>
  `).join('');
}

export function renderSkeleton(type, count = 1) {
  const renderers = {
    list: () => renderListSkeleton(count),
    detail: renderDetailSkeleton,
    stats: () => renderStatsSkeleton(count),
  };
  const renderer = renderers[type] || renderers.detail;

  return `<div class="skeleton-group" data-skeleton="${type}" aria-hidden="true">${renderer()}</div>`;
}
