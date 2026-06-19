import { getHorizontalScrollState } from './frontend-ux.js';

const TIMELINE_STEP = 296;
const DIALOG_FOCUS_SELECTOR = [
  'button:not([disabled])',
  '[href]',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(',');
const dialogLastFocused = new WeakMap();
let statusTimer = 0;

function getStatusBanner() {
  let banner = document.getElementById('appStatusBanner');
  if (banner) {
    return banner;
  }

  banner = document.createElement('div');
  banner.id = 'appStatusBanner';
  banner.className = 'app-status-banner';
  banner.hidden = true;
  banner.setAttribute('role', 'status');
  banner.setAttribute('aria-live', 'polite');
  banner.setAttribute('aria-atomic', 'true');
  document.body.prepend(banner);
  return banner;
}

function showStatus(message, type, { retry = false, persist = false } = {}) {
  const banner = getStatusBanner();
  window.clearTimeout(statusTimer);
  banner.dataset.type = type;
  banner.innerHTML = `
    <span>${message}</span>
    ${retry ? '<button type="button" data-app-retry>重试</button>' : ''}
  `;
  banner.hidden = false;
  banner.querySelector('[data-app-retry]')?.addEventListener('click', () => {
    window.dispatchEvent(new CustomEvent('app:retry'));
  });

  if (!persist) {
    statusTimer = window.setTimeout(() => {
      banner.hidden = true;
    }, 4000);
  }
}

function syncTimelineShell(shell) {
  const scroller = shell.querySelector('[data-timeline-scroll]');
  if (!(scroller instanceof HTMLElement)) {
    return;
  }

  const state = getHorizontalScrollState(scroller);
  shell.dataset.canScrollBackward = String(state.canScrollBackward);
  shell.dataset.canScrollForward = String(state.canScrollForward);
  shell.querySelectorAll('[data-timeline-step]').forEach((button) => {
    const direction = Number(button.dataset.timelineStep);
    button.disabled = direction < 0
      ? !state.canScrollBackward
      : !state.canScrollForward;
  });
}

function initializeTimelineShell(shell) {
  if (!(shell instanceof HTMLElement) || shell.dataset.timelineReady === 'true') {
    return;
  }

  const scroller = shell.querySelector('[data-timeline-scroll]');
  if (!(scroller instanceof HTMLElement)) {
    return;
  }

  shell.dataset.timelineReady = 'true';
  const sync = () => syncTimelineShell(shell);
  scroller.addEventListener('scroll', sync, { passive: true });
  scroller.addEventListener('keydown', (event) => {
    if (event.key === 'ArrowLeft') {
      event.preventDefault();
      scroller.scrollBy({ left: -TIMELINE_STEP, behavior: 'smooth' });
    }
    if (event.key === 'ArrowRight') {
      event.preventDefault();
      scroller.scrollBy({ left: TIMELINE_STEP, behavior: 'smooth' });
    }
  });
  shell.querySelectorAll('[data-timeline-step]').forEach((button) => {
    button.addEventListener('click', () => {
      scroller.scrollBy({
        left: Number(button.dataset.timelineStep) * TIMELINE_STEP,
        behavior: 'smooth',
      });
    });
  });
  window.addEventListener('resize', sync);
  window.requestAnimationFrame(sync);
}

function initializeTimelineShells(root = document) {
  root.querySelectorAll('[data-timeline-shell]').forEach(initializeTimelineShell);
}

function initializeLazyImages() {
  const images = document.querySelectorAll('img[loading="lazy"]');
  if (!('IntersectionObserver' in window)) {
    images.forEach((image) => image.classList.add('lazy-image--visible'));
    return;
  }

  const observer = new IntersectionObserver((entries) => {
    entries.forEach((entry) => {
      if (!entry.isIntersecting) {
        return;
      }
      entry.target.classList.add('lazy-image--visible');
      observer.unobserve(entry.target);
    });
  }, {
    rootMargin: '120px',
  });
  images.forEach((image) => observer.observe(image));
}

function getActiveDialog() {
  return Array.from(document.querySelectorAll('[role="dialog"]'))
    .find((dialog) => dialog.id !== 'issueDrawer' && !dialog.hidden && dialog.getAttribute('aria-hidden') !== 'true');
}

function getDialogFocusableElements(dialog) {
  return Array.from(dialog.querySelectorAll(DIALOG_FOCUS_SELECTOR))
    .filter((element) => element instanceof HTMLElement && element.offsetParent !== null);
}

function syncDialog(dialog) {
  if (!(dialog instanceof HTMLElement) || dialog.id === 'issueDrawer') {
    return;
  }

  const isOpen = !dialog.hidden;
  const wasOpen = dialog.dataset.uxDialogOpen === 'true';
  dialog.setAttribute('aria-hidden', String(!isOpen));
  dialog.dataset.uxDialogOpen = String(isOpen);

  if (isOpen && !wasOpen) {
    if (document.activeElement instanceof HTMLElement && !dialog.contains(document.activeElement)) {
      dialogLastFocused.set(dialog, document.activeElement);
    }
    window.requestAnimationFrame(() => {
      if (!dialog.hidden && !dialog.contains(document.activeElement)) {
        getDialogFocusableElements(dialog)[0]?.focus({ preventScroll: true });
      }
    });
    return;
  }

  if (!isOpen && wasOpen) {
    const previous = dialogLastFocused.get(dialog);
    if (previous?.isConnected) {
      previous.focus({ preventScroll: true });
    }
    dialogLastFocused.delete(dialog);
  }
}

function syncDialogs() {
  document.querySelectorAll('[role="dialog"]').forEach(syncDialog);
}

function syncDisclosure(details) {
  if (!(details instanceof HTMLDetailsElement)) {
    return;
  }

  const summary = details.querySelector(':scope > summary');
  if (!summary) {
    return;
  }

  summary.setAttribute('aria-expanded', String(details.open));
  if (details.dataset.uxDisclosureReady !== 'true') {
    details.dataset.uxDisclosureReady = 'true';
    details.addEventListener('toggle', () => {
      summary.setAttribute('aria-expanded', String(details.open));
    });
  }
}

function syncDisclosures() {
  document.querySelectorAll('details').forEach(syncDisclosure);
}

document.addEventListener('keydown', (event) => {
  const dialog = getActiveDialog();
  if (!dialog) {
    return;
  }

  if (event.key === 'Escape') {
    const closeButton = dialog.querySelector('[data-dialog-close]');
    if (closeButton instanceof HTMLElement) {
      event.preventDefault();
      closeButton.click();
    }
    return;
  }

  if (event.key !== 'Tab') {
    return;
  }

  const focusable = getDialogFocusableElements(dialog);
  if (focusable.length === 0) {
    event.preventDefault();
    dialog.focus({ preventScroll: true });
    return;
  }

  const first = focusable[0];
  const last = focusable[focusable.length - 1];
  if (event.shiftKey && document.activeElement === first) {
    event.preventDefault();
    last.focus();
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault();
    first.focus();
  }
});

window.addEventListener('offline', () => {
  showStatus('网络已断开。已保留当前页面，请恢复网络后重试。', 'offline', {
    retry: true,
    persist: true,
  });
});

window.addEventListener('online', () => {
  const banner = getStatusBanner();
  banner.hidden = true;
  showStatus('网络已恢复，正在重试最近的读取操作。', 'online');
  window.dispatchEvent(new CustomEvent('app:retry'));
});

window.addEventListener('error', () => {
  showStatus('页面遇到异常。你可以重试当前操作，或刷新页面。', 'error', {
    retry: true,
    persist: true,
  });
});

window.addEventListener('unhandledrejection', () => {
  showStatus('操作未能完成。请检查网络后重试。', 'error', {
    retry: true,
    persist: true,
  });
});

const uxObserver = new MutationObserver(() => {
  initializeTimelineShells();
  syncDialogs();
  syncDisclosures();
});
uxObserver.observe(document.documentElement, {
  attributes: true,
  attributeFilter: ['hidden', 'open'],
  childList: true,
  subtree: true,
});

initializeTimelineShells();
initializeLazyImages();
syncDialogs();
syncDisclosures();
