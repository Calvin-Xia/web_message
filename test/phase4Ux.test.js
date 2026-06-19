import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

function readSource(path) {
  return readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
}

function readOptionalSource(path) {
  try {
    return readSource(path);
  } catch {
    return null;
  }
}

async function loadFrontendUx() {
  try {
    return await import('../frontend-ux.js');
  } catch {
    return null;
  }
}

describe('phase 4 shared UX helpers', () => {
  it('retries transient failures with exponential backoff', async () => {
    const ux = await loadFrontendUx();

    expect(ux).not.toBeNull();
    if (!ux) {
      return;
    }

    const delays = [];
    let attempts = 0;
    const result = await ux.retryRequest(async () => {
      attempts += 1;
      if (attempts < 3) {
        const error = new Error('temporary');
        error.retryable = true;
        throw error;
      }
      return 'ok';
    }, {
      maxRetries: 3,
      retryDelay: 100,
      retryBackoff: 2,
      shouldRetry: (error) => error.retryable,
      sleep: async (delay) => {
        delays.push(delay);
      },
    });

    expect(result).toBe('ok');
    expect(attempts).toBe(3);
    expect(delays).toEqual([100, 200]);
  });

  it('does not retry failures rejected by the retry policy', async () => {
    const ux = await loadFrontendUx();

    expect(ux).not.toBeNull();
    if (!ux) {
      return;
    }

    let attempts = 0;
    await expect(ux.retryRequest(async () => {
      attempts += 1;
      throw new Error('invalid request');
    }, {
      maxRetries: 3,
      shouldRetry: () => false,
      sleep: async () => {},
    })).rejects.toThrow('invalid request');
    expect(attempts).toBe(1);
  });

  it('retries retryable HTTP responses but returns the final response', async () => {
    const ux = await loadFrontendUx();

    expect(ux).not.toBeNull();
    if (!ux) {
      return;
    }

    expect(ux.isRetryableHttpStatus(408)).toBe(true);
    expect(ux.isRetryableHttpStatus(429)).toBe(true);
    expect(ux.isRetryableHttpStatus(503)).toBe(true);
    expect(ux.isRetryableHttpStatus(400)).toBe(false);
    expect(ux.isRetryableHttpStatus(404)).toBe(false);

    const statuses = [503, 503, 200];
    const delays = [];
    const response = await ux.retryFetch(async () => ({
      ok: statuses[0] === 200,
      status: statuses.shift(),
    }), {
      maxRetries: 2,
      retryDelay: 50,
      retryBackoff: 2,
      sleep: async (delay) => {
        delays.push(delay);
      },
    });

    expect(response.status).toBe(200);
    expect(delays).toEqual([50, 100]);
  });

  it('calculates timeline edge indicators from the scroll position', async () => {
    const ux = await loadFrontendUx();

    expect(ux).not.toBeNull();
    if (!ux) {
      return;
    }

    expect(ux.getHorizontalScrollState({
      scrollLeft: 0,
      scrollWidth: 872,
      clientWidth: 280,
    })).toEqual({
      canScrollBackward: false,
      canScrollForward: true,
    });
    expect(ux.getHorizontalScrollState({
      scrollLeft: 592,
      scrollWidth: 872,
      clientWidth: 280,
    })).toEqual({
      canScrollBackward: true,
      canScrollForward: false,
    });
    expect(ux.getHorizontalScrollState({
      scrollLeft: 672.7,
      scrollWidth: 877,
      clientWidth: 202,
    })).toEqual({
      canScrollBackward: true,
      canScrollForward: false,
    });
  });

  it('renders accessible list, detail and statistics skeletons', async () => {
    const ux = await loadFrontendUx();

    expect(ux).not.toBeNull();
    if (!ux) {
      return;
    }

    expect(ux.renderSkeleton('list', 2)).toContain('data-skeleton="list"');
    expect(ux.renderSkeleton('list', 2).match(/skeleton-card/g)).toHaveLength(2);
    expect(ux.renderSkeleton('detail')).toContain('data-skeleton="detail"');
    expect(ux.renderSkeleton('stats', 3).match(/skeleton-stat/g)).toHaveLength(3);
    expect(ux.renderSkeleton('stats')).toContain('aria-hidden="true"');
  });
});

describe('phase 4 page integration', () => {
  it('optimizes the public submission form for mobile input and focus', () => {
    const html = readSource('index.html');

    expect(html).toContain('id="newSubmissionTitle"');
    expect(html).toContain('id="issueForm" class="mt-4 space-y-4" novalidate aria-labelledby="newSubmissionTitle"');
    expect(html).toMatch(/id="name"[^>]+type="text"[^>]+inputmode="text"[^>]+autofocus/);
    expect(html).toMatch(/id="studentId"[^>]+type="text"[^>]+inputmode="numeric"/);
    expect(html).toMatch(/id="email"[^>]+type="email"[^>]+inputmode="email"/);
    expect(html).toContain('class="grid issue-identity-grid gap-4 sm:grid-cols-2"');
    expect(html).toContain('id="trackingReceipt" hidden');
    expect(html).toContain('tabindex="-1"');
  });

  it('loads the shared UX runtime on every user-facing page', () => {
    ['index.html', 'tracking.html', 'admin.html', 'health.html', 'login.html'].forEach((path) => {
      expect(readSource(path)).toContain('<script type="module" src="/assets/ux-runtime.js"></script>');
    });
  });

  it('provides global offline, error recovery, lazy image and timeline behavior', () => {
    const runtime = readOptionalSource('ux-runtime.js');

    expect(runtime).not.toBeNull();
    if (!runtime) {
      return;
    }

    expect(runtime).toContain("window.addEventListener('offline'");
    expect(runtime).toContain("window.addEventListener('online'");
    expect(runtime).toContain("window.addEventListener('error'");
    expect(runtime).toContain("window.addEventListener('unhandledrejection'");
    expect(runtime).toContain('IntersectionObserver');
    expect(runtime).toContain("event.key === 'ArrowLeft'");
    expect(runtime).toContain("event.key === 'ArrowRight'");
    expect(runtime).toContain("window.dispatchEvent(new CustomEvent('app:retry'))");
  });

  it('traps modal focus, restores focus and synchronizes disclosure state', () => {
    const runtime = readSource('ux-runtime.js');

    expect(runtime).toContain('dialogLastFocused');
    expect(runtime).toContain("event.key === 'Escape'");
    expect(runtime).toContain("event.key !== 'Tab'");
    expect(runtime).toContain("dialog.querySelector('[data-dialog-close]')");
    expect(runtime).toContain("summary.setAttribute('aria-expanded'");
    expect(runtime).toContain('getDialogFocusableElements(dialog)[0]?.focus');
  });

  it('integrates safe retries, reconnect reloads and skeletons into live clients', () => {
    const publicScript = readSource('public-app.js');
    const adminScript = readSource('admin-app.js');
    const healthScript = readSource('health-app.js');
    const trackingPage = readSource('tracking.html');
    const adminPage = readSource('admin.html');

    [publicScript, adminScript, healthScript, trackingPage].forEach((source) => {
      expect(source).toContain('retryFetch');
      expect(source).toContain("window.addEventListener('app:retry'");
    });
    expect(publicScript).toContain("renderSkeleton('list', 3)");
    expect(adminScript).toContain("renderSkeleton('list', 4)");
    expect(adminScript).toContain("renderSkeleton('detail')");
    expect(adminScript).toContain("renderSkeleton('stats', 6)");
    expect(adminPage).toContain('id="metricsSkeleton"');
    expect(adminPage).toContain('id="metricsGrid"');
  });

  it('provides horizontal timeline controls and lazy image loading', () => {
    const tracking = readSource('tracking.html');
    const admin = readSource('admin-app.js');
    const pages = ['index.html', 'tracking.html', 'admin.html', 'health.html']
      .map(readSource)
      .join('\n');

    expect(tracking).toContain('data-timeline-shell');
    expect(tracking).toContain('data-timeline-scroll');
    expect(admin).toContain('data-timeline-shell');
    expect(admin).toContain('data-timeline-scroll');
    expect(pages).not.toMatch(/<img(?![^>]+loading="lazy")/);
    expect(pages).not.toMatch(/<img(?![^>]+decoding="async")/);
  });

  it('uses semantic dynamic lists and described dialogs', () => {
    const publicPage = readSource('index.html');
    const publicScript = readSource('public-app.js');
    const adminPage = readSource('admin.html');
    const adminScript = readSource('admin-app.js');

    expect(publicPage).toContain('id="publicList" class="mt-6 grid gap-4" role="list"');
    expect(publicScript).toContain('<article role="listitem" class="public-card');
    expect(adminPage).toContain('id="issuesList" class="grid gap-4" role="list"');
    expect(adminScript).toContain('<article role="listitem" class="issue-card');
    expect(adminPage).toContain('aria-describedby="userModalDescription"');
    expect(adminPage).toContain('aria-describedby="slaRuleModalDescription"');
    expect(adminPage).toContain('aria-describedby="assignRuleModalDescription"');
    expect(adminPage).toContain('aria-describedby="batchConfirmSummary"');
    expect(adminPage).toContain('data-dialog-close');
    expect(publicScript).toContain('aria-label="查看处理进度：问题 ${escapeHtml(item.trackingCode)}"');
  });

  it('defines skeleton, timeline, mobile form and visible focus styles', () => {
    const css = readSource('src/input.css');

    expect(css).toContain('.skeleton');
    expect(css).toContain('@keyframes skeleton-loading');
    expect(css).toContain('.timeline-scroll');
    expect(css).toContain('flex: 0 0 280px');
    expect(css).toContain('gap: 1rem');
    expect(css).toContain('.issue-identity-grid');
    expect(css).toContain('outline: 3px solid');
    expect(css).toContain('.result-grid > *');
    expect(css).toContain('min-width: 0');
  });

  it('uses AA contrast colors for text and status tokens', () => {
    const css = readSource('src/input.css');

    expect(css).toContain("--ui-warn: #96560a;");
    expect(css).toContain("body[data-page-role] [class~='text-[#72809a]']");
    expect(css).toContain('color: #596579;');
    expect(readSource('index.html')).not.toContain('color: #72809a;');
  });

  it('adds explicit cache policies for static assets', () => {
    const headers = readSource('_headers');
    const storageRule = headers.match(/^\/storage\/\*\r?\n([\s\S]*?)(?=\r?\n\/|\s*$)/m)?.[1] || '';

    expect(headers).toMatch(/^\/styles\.css\r?\n\s+Cache-Control:/m);
    expect(headers).toMatch(/^\/\*\.js\r?\n\s+Cache-Control:/m);
    expect(headers).toMatch(/^\/storage\/\*\r?\n\s+Cache-Control:/m);
    expect(headers).toMatch(/^\/assets\/\*\r?\n\s+Cache-Control: public, max-age=31536000, immutable/m);
    expect(storageRule).toContain('stale-while-revalidate');
    expect(storageRule).not.toContain('immutable');
  });

  it('builds minified page-level ESM bundles with shared hashed chunks', () => {
    const packageJson = JSON.parse(readSource('package.json'));
    const buildScript = readOptionalSource('scripts/build-js.mjs');

    expect(packageJson.devDependencies.esbuild).toBeTruthy();
    expect(packageJson.scripts['build:js']).toBe('node scripts/build-js.mjs');
    expect(packageJson.scripts.build).toContain('build:js');
    expect(buildScript).not.toBeNull();
    if (!buildScript) {
      return;
    }

    expect(buildScript).toContain("format: 'esm'");
    expect(buildScript).toContain('splitting: true');
    expect(buildScript).toContain('minify: true');
    expect(buildScript).toContain("chunkNames: 'chunks/[name]-[hash]'");
    expect(buildScript).toContain("'public-app': 'public-app.js'");
    expect(buildScript).toContain("'admin-app': 'admin-app.js'");
    expect(buildScript).toContain("'health-app': 'health-app.js'");
    expect(buildScript).toContain("'login-app': 'login-app.js'");
    expect(existsSync(new URL('../assets/public-app.js', import.meta.url))).toBe(true);
    expect(existsSync(new URL('../assets/admin-app.js', import.meta.url))).toBe(true);
    expect(existsSync(new URL('../assets/health-app.js', import.meta.url))).toBe(true);
    expect(existsSync(new URL('../assets/login-app.js', import.meta.url))).toBe(true);
  });
});
