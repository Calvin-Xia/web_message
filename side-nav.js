const shell = typeof document === 'undefined' ? null : document.querySelector('[data-side-nav-shell]');
export const SIDE_NAV_TRANSITION_ZONE_PX = 112;
let closeSideNavController = () => {};

export function closeSideNav(options = {}) {
  closeSideNavController(options);
}

export function findCenteredSection(metrics, viewportCenter) {
  const centered = metrics.find(({ rect }) => viewportCenter >= rect.top && viewportCenter < rect.bottom);
  if (centered) {
    return centered.id;
  }

  // If the viewport center lands between sections, keep the nearest section highlighted.
  return metrics
    .map(({ id, rect }) => ({
      id,
      distance: Math.min(Math.abs(rect.top - viewportCenter), Math.abs(rect.bottom - viewportCenter)),
    }))
    .sort((first, second) => first.distance - second.distance)[0]?.id;
}

export function findTransitionSections(
  metrics,
  viewportCenter,
  { isDesktop = true, transitionZonePx = SIDE_NAV_TRANSITION_ZONE_PX } = {},
) {
  if (!isDesktop) {
    return [];
  }

  for (let index = 0; index < metrics.length - 1; index += 1) {
    const current = metrics[index];
    const next = metrics[index + 1];
    const seamStart = Math.min(current.rect.bottom, next.rect.top);
    const seamEnd = Math.max(current.rect.bottom, next.rect.top);
    const seamCenter = (current.rect.bottom + next.rect.top) / 2;
    const isBetweenSections = viewportCenter >= seamStart && viewportCenter <= seamEnd;
    const isNearSeam = Math.abs(viewportCenter - seamCenter) <= transitionZonePx;

    if (isBetweenSections || isNearSeam) {
      return [current.id, next.id];
    }
  }

  return [];
}

if (shell) {
  const button = document.querySelector('[data-side-nav-toggle]');
  const backdrop = document.querySelector('[data-side-nav-backdrop]');
  const nav = button?.getAttribute('aria-controls')
    ? document.getElementById(button.getAttribute('aria-controls'))
    : document.querySelector('[data-side-nav]');
  let lastFocusedElement = null;

  function isDesktopNavMode() {
    return button ? window.getComputedStyle(button).display === 'none' : false;
  }

  function syncNavMode() {
    if (!nav || !button) {
      return;
    }

    const isOpen = document.body.hasAttribute('data-side-nav-open');
    const isDesktop = isDesktopNavMode();
    button.setAttribute('aria-expanded', String(isOpen));
    nav.setAttribute('aria-hidden', String(!isDesktop && !isOpen));
    if (isDesktop) {
      if (backdrop) {
        backdrop.hidden = true;
      }
      document.body.removeAttribute('data-side-nav-open');
      button.setAttribute('aria-expanded', 'false');
    }
  }

  function openNav() {
    if (!nav || !button) {
      return;
    }

    lastFocusedElement = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    document.body.setAttribute('data-side-nav-open', 'true');
    button.setAttribute('aria-expanded', 'true');
    nav.setAttribute('aria-hidden', 'false');
    if (backdrop) {
      backdrop.hidden = false;
    }
    nav.focus({ preventScroll: true });
  }

  function closeNav({ restoreFocus = false } = {}) {
    if (!nav || !button) {
      return;
    }

    document.body.removeAttribute('data-side-nav-open');
    button.setAttribute('aria-expanded', 'false');
    nav.setAttribute('aria-hidden', String(!isDesktopNavMode()));
    if (backdrop) {
      backdrop.hidden = true;
    }
    if (restoreFocus && lastFocusedElement && document.contains(lastFocusedElement)) {
      lastFocusedElement.focus({ preventScroll: true });
    }
  }

  closeSideNavController = closeNav;

  function setActiveSections(sectionLinks, activeSectionId, transitionSectionIds = []) {
    if (!nav) {
      return;
    }

    const transitionIds = new Set(transitionSectionIds);
    sectionLinks.forEach((link) => {
      const sectionId = link.hash.slice(1);
      link.removeAttribute('data-side-nav-state');
      link.removeAttribute('aria-current');

      if (sectionId === activeSectionId) {
        link.setAttribute('aria-current', 'page');
        return;
      }

      if (transitionIds.has(sectionId)) {
        link.setAttribute('data-side-nav-state', 'transition');
        return;
      }
    });
  }

  function updateActiveSections(sectionLinks, sections) {
    const viewportCenter = window.innerHeight / 2;
    const metrics = sections.map((section) => ({
      id: section.id,
      rect: section.getBoundingClientRect(),
    }));
    const activeSectionId = findCenteredSection(metrics, viewportCenter);
    const transitionSectionIds = findTransitionSections(metrics, viewportCenter, {
      isDesktop: isDesktopNavMode(),
    });

    if (transitionSectionIds.length > 0) {
      setActiveSections(
        sectionLinks,
        activeSectionId,
        transitionSectionIds.filter((sectionId) => sectionId !== activeSectionId),
      );
      return;
    }

    setActiveSections(sectionLinks, activeSectionId);
  }

  function bindActiveSectionTracking() {
    if (!nav) {
      return;
    }

    const sectionLinks = Array.from(nav.querySelectorAll('a[data-side-nav-link][href^="#"]'));
    const sections = sectionLinks
      .map((link) => document.getElementById(link.hash.slice(1)))
      .filter((section) => section instanceof HTMLElement);

    if (sections.length === 0) {
      return;
    }

    let activeAnimationFrame = null;
    const scheduleActiveSectionUpdate = () => {
      if (activeAnimationFrame) {
        return;
      }

      activeAnimationFrame = window.requestAnimationFrame(() => {
        activeAnimationFrame = null;
        updateActiveSections(sectionLinks, sections);
      });
    };

    updateActiveSections(sectionLinks, sections);
    window.addEventListener('scroll', scheduleActiveSectionUpdate, { passive: true });
    window.addEventListener('resize', scheduleActiveSectionUpdate);
  }

  button?.addEventListener('click', () => {
    if (document.body.hasAttribute('data-side-nav-open')) {
      closeNav({ restoreFocus: true });
      return;
    }
    openNav();
  });

  backdrop?.addEventListener('click', () => closeNav({ restoreFocus: true }));

  nav?.querySelectorAll('a').forEach((link) => {
    link.addEventListener('click', () => closeNav({ restoreFocus: true }));
  });

  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && document.body.hasAttribute('data-side-nav-open')) {
      closeNav({ restoreFocus: true });
    }
  });

  window.addEventListener('resize', syncNavMode);
  syncNavMode();
  bindActiveSectionTracking();
}
