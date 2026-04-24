import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

function readPage(path) {
  return readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
}

function readSource(path) {
  return readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
}

function getCssBlock(css, selector) {
  const escapedSelector = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = new RegExp(`${escapedSelector}\\s*\\{`).exec(css);
  if (!match) {
    return '';
  }

  const blockStart = match.index + match[0].length;
  let depth = 1;
  for (let index = blockStart; index < css.length; index += 1) {
    if (css[index] === '{') {
      depth += 1;
    }
    if (css[index] === '}') {
      depth -= 1;
      if (depth === 0) {
        return css.slice(blockStart, index);
      }
    }
  }

  return '';
}

describe('side navigation pages', () => {
  it('reads CSS blocks that contain nested braces', () => {
    const css = `
      .outer {
        color: red;
        @supports (selector(:has(*))) {
          color: blue;
        }
        background: white;
      }
      .next {
        color: black;
      }
    `;

    const block = getCssBlock(css, '.outer');

    expect(block).toContain('color: blue;');
    expect(block).toContain('background: white;');
    expect(block).not.toContain('.next');
  });

  it('adds public page sidebar navigation with section and site links', () => {
    const html = readPage('index.html');

    expect(html).toContain('data-side-nav-shell');
    expect(html).toContain('id="publicSideNav"');
    expect(html).toContain('aria-controls="publicSideNav"');
    expect(html).toContain('aria-expanded="false"');
    expect(html).toContain('href="#newSubmission"');
    expect(html).toContain('href="#publicFeed"');
    expect(html).toContain('href="#insightsPanel"');
    expect(html).toContain('href="#knowledgePanel"');
    expect(html).toContain('href="/tracking.html"');
    expect(html).toContain('href="/admin.html"');
    expect(html).toContain('href="/health.html"');
    expect(html).toContain('src="/side-nav.js"');
  });

  it('adds admin page sidebar navigation while keeping issue drawer layering separate', () => {
    const html = readPage('admin.html');

    expect(html).toContain('data-side-nav-shell');
    expect(html).toContain('id="adminSideNav"');
    expect(html).toContain('aria-controls="adminSideNav"');
    expect(html).toContain('aria-expanded="false"');
    expect(html).toContain('href="#metricsSection"');
    expect(html).toContain('href="#knowledgeSection"');
    expect(html).toContain('href="#queueSection"');
    expect(html).toContain('href="/"');
    expect(html).toContain('href="/tracking.html"');
    expect(html).toContain('id="issueDrawer"');
    expect(html).toContain('src="/side-nav.js"');
  });

  it('closes the mobile side nav before opening the admin issue drawer', () => {
    const script = readSource('admin-app.js');

    expect(script).toContain("import { closeSideNav } from './side-nav.js';");
    expect(script).not.toContain('function closeSideNavForDrawer()');
    expect(script).toContain('closeSideNav();');
  });

  it('uses a graphical mobile menu affordance instead of text-only buttons', () => {
    const publicHtml = readPage('index.html');
    const adminHtml = readPage('admin.html');

    expect(publicHtml).toContain('side-nav-toggle__icon');
    expect(adminHtml).toContain('side-nav-toggle__icon');
  });

  it('floats the mobile menu affordance away from page headings', () => {
    const css = readSource('src/input.css');
    const toggleBlock = getCssBlock(css, '.side-nav-toggle');
    const labelBlock = getCssBlock(css, '.side-nav-toggle__label');

    expect(toggleBlock).toContain('position: fixed;');
    expect(toggleBlock).toContain('left: calc(1rem + env(safe-area-inset-left));');
    expect(toggleBlock).toContain('bottom: calc(1rem + env(safe-area-inset-bottom));');
    expect(toggleBlock).toContain('width: 3.25rem;');
    expect(toggleBlock).toContain('height: 3.25rem;');
    expect(toggleBlock).toContain('border-radius: 999px;');
    expect(toggleBlock).toContain('background: rgba(36, 87, 214, 0.14);');
    expect(toggleBlock).toContain('border-color: rgba(36, 87, 214, 0.34);');
    expect(labelBlock).toContain('clip: rect(0, 0, 0, 0);');
  });

  it('keeps the page shell out of the mobile drawer stacking context', () => {
    const css = readSource('src/input.css');
    const pageShellBlock = getCssBlock(css, '.page-shell');

    expect(pageShellBlock).not.toContain('z-index');
    expect(css).toContain('z-index: 35;');
    expect(css).toContain('z-index: 30;');
  });

  it('hides admin sidebar section links until login state is active', () => {
    const html = readPage('admin.html');
    const css = readSource('src/input.css');
    const defaultBlock = getCssBlock(css, "body[data-page-role='admin'] .side-nav__admin-section");
    const authenticatedBlock = getCssBlock(css, "body[data-page-role='admin'][data-admin-authenticated='true'] .side-nav__admin-section");

    expect(html).toContain('class="side-nav__section side-nav__admin-section"');
    expect(defaultBlock).toContain('display: none;');
    expect(authenticatedBlock).toContain('display: grid;');
  });

  it('uses viewport-center transition highlights for desktop sidebar scrolling', () => {
    const script = readSource('side-nav.js');
    const css = readSource('src/input.css');

    expect(script).toContain('const SIDE_NAV_TRANSITION_ZONE_PX = 112;');
    expect(script).toContain('window.innerHeight / 2');
    expect(script).toContain("data-side-nav-state', 'transition'");
    expect(script).toContain('isDesktopNavMode()');
    expect(script).toContain('requestAnimationFrame');
    expect(script).toContain('const activeSectionId = findCenteredSection(metrics, viewportCenter);');
    expect(script).toContain('transitionSectionIds.filter((sectionId) => sectionId !== activeSectionId)');
    expect(script).not.toContain('setActiveSections(sectionLinks, null, transitionSectionIds);');
    expect(css).toContain(".side-nav__link[data-side-nav-state='transition']");
    expect(css).toContain('background: var(--ui-accent-soft);');
  });

  it('derives desktop sidebar mode from the CSS-rendered toggle state', () => {
    const script = readSource('side-nav.js');

    expect(script).not.toContain('matchMedia');
    expect(script).toContain('function isDesktopNavMode()');
    expect(script).toContain("window.getComputedStyle(button).display === 'none'");
    expect(script).toContain("window.addEventListener('resize', syncNavMode);");
  });

  it('uses a deep blue primary highlight for active sidebar links', () => {
    const css = readSource('src/input.css');
    const tokenBlock = getCssBlock(css, 'body[data-page-role]');
    const sideNavCurrentBlock = getCssBlock(css, ".side-nav__link[aria-current='page']");
    const globalCurrentBlock = getCssBlock(css, "body[data-page-role] [aria-current='page']");

    expect(tokenBlock).toContain('--ui-nav-active: #173f8a;');
    expect(sideNavCurrentBlock).toContain('background: var(--ui-nav-active);');
    expect(globalCurrentBlock).toContain('background: var(--ui-nav-active);');
  });

  it('keeps public section jump links only in the sidebar', () => {
    const html = readPage('index.html');

    expect(html).not.toContain('hero-link-grid');
    expect(html).not.toContain('aria-label="下方区域跳转"');
  });

  it('uses compact spacing for public form sections with legends', () => {
    const html = readPage('index.html');

    expect(html).not.toContain('class="form-section space-y-4"');
    expect(html).toContain('class="form-section form-section--stacked"');
  });
});
