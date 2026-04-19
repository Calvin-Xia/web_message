import { afterEach, describe, expect, it, vi } from 'vitest';

class FakeElement {
  constructor({ id = '', tagName = 'div', attributes = {}, rect = null } = {}) {
    this.id = id;
    this.tagName = tagName.toUpperCase();
    this.attributes = new Map(Object.entries(attributes));
    this.children = [];
    this.eventListeners = new Map();
    this.hidden = false;
    this.ownerDocument = null;
    this.rect = rect;
    if (id) {
      this.attributes.set('id', id);
    }
  }

  get hash() {
    const href = this.getAttribute('href') || '';
    return href.startsWith('#') ? href : '';
  }

  appendChild(child) {
    child.ownerDocument = this.ownerDocument;
    this.children.push(child);
    return child;
  }

  setAttribute(name, value) {
    this.attributes.set(name, String(value));
  }

  getAttribute(name) {
    return this.attributes.get(name) ?? null;
  }

  removeAttribute(name) {
    this.attributes.delete(name);
  }

  hasAttribute(name) {
    return this.attributes.has(name);
  }

  addEventListener(type, listener) {
    const listeners = this.eventListeners.get(type) || [];
    listeners.push(listener);
    this.eventListeners.set(type, listeners);
  }

  dispatchEvent(event) {
    const listeners = this.eventListeners.get(event.type) || [];
    listeners.forEach((listener) => listener(event));
  }

  focus() {
    this.ownerDocument.activeElement = this;
  }

  querySelectorAll(selector) {
    return collectDescendants(this).filter((element) => matchesSelector(element, selector));
  }

  getBoundingClientRect() {
    return this.rect || { top: 0, bottom: 0 };
  }
}

class FakeDocument {
  constructor() {
    this.body = new FakeElement({ tagName: 'body' });
    this.body.ownerDocument = this;
    this.activeElement = this.body;
    this.eventListeners = new Map();
    this.elements = [this.body];
  }

  register(element) {
    element.ownerDocument = this;
    this.elements.push(element);
    element.children.forEach((child) => this.register(child));
    return element;
  }

  querySelector(selector) {
    return this.elements.find((element) => matchesSelector(element, selector)) || null;
  }

  getElementById(id) {
    return this.elements.find((element) => element.id === id) || null;
  }

  addEventListener(type, listener) {
    const listeners = this.eventListeners.get(type) || [];
    listeners.push(listener);
    this.eventListeners.set(type, listeners);
  }

  dispatchEvent(event) {
    const listeners = this.eventListeners.get(event.type) || [];
    listeners.forEach((listener) => listener(event));
  }

  contains(element) {
    return this.elements.includes(element);
  }
}

function collectDescendants(element) {
  return element.children.flatMap((child) => [child, ...collectDescendants(child)]);
}

function matchesSelector(element, selector) {
  if (selector === 'a') {
    return element.tagName === 'A';
  }

  if (selector === 'a[data-side-nav-link][href^="#"]') {
    return element.tagName === 'A'
      && element.hasAttribute('data-side-nav-link')
      && (element.getAttribute('href') || '').startsWith('#');
  }

  const dataAttribute = selector.match(/^\[([a-z0-9-]+)\]$/i)?.[1];
  if (dataAttribute) {
    return element.hasAttribute(dataAttribute);
  }

  return false;
}

function createWindow({ button, isDesktop, innerHeight }) {
  const eventListeners = new Map();

  return {
    innerHeight,
    getComputedStyle(element) {
      return {
        display: element === button && isDesktop() ? 'none' : 'block',
      };
    },
    requestAnimationFrame(callback) {
      callback();
      return 1;
    },
    addEventListener(type, listener) {
      const listeners = eventListeners.get(type) || [];
      listeners.push(listener);
      eventListeners.set(type, listeners);
    },
    dispatchEvent(event) {
      const listeners = eventListeners.get(event.type) || [];
      listeners.forEach((listener) => listener(event));
    },
  };
}

function createSideNavDom({ desktop = false, innerHeight = 800, sections = [] } = {}) {
  const document = new FakeDocument();
  let desktopMode = desktop;
  const shell = document.register(new FakeElement({ attributes: { 'data-side-nav-shell': '' } }));
  const button = document.register(new FakeElement({
    tagName: 'button',
    attributes: {
      'data-side-nav-toggle': '',
      'aria-controls': 'sideNav',
      'aria-expanded': 'false',
    },
  }));
  const backdrop = document.register(new FakeElement({ attributes: { 'data-side-nav-backdrop': '' } }));
  const nav = document.register(new FakeElement({
    id: 'sideNav',
    tagName: 'aside',
    attributes: { 'data-side-nav': '' },
  }));
  const sectionElements = sections.map(({ id, rect }) => document.register(new FakeElement({ id, rect })));
  const links = sections.map(({ id }) => {
    const link = new FakeElement({
      tagName: 'a',
      attributes: {
        'data-side-nav-link': '',
        href: `#${id}`,
      },
    });
    link.ownerDocument = document;
    nav.appendChild(link);
    document.register(link);
    return link;
  });

  document.body.appendChild(shell);
  shell.appendChild(button);
  shell.appendChild(backdrop);
  shell.appendChild(nav);
  sectionElements.forEach((section) => shell.appendChild(section));

  const window = createWindow({
    button,
    innerHeight,
    isDesktop: () => desktopMode,
  });

  return {
    document,
    window,
    button,
    backdrop,
    nav,
    links,
    setDesktop(value) {
      desktopMode = value;
    },
  };
}

async function importSideNavWith(dom) {
  vi.resetModules();
  globalThis.document = dom.document;
  globalThis.window = dom.window;
  globalThis.HTMLElement = FakeElement;
  await import('../side-nav.js');
}

async function importSideNavLogic() {
  vi.resetModules();
  globalThis.document = { querySelector: () => null };
  const module = await import('../side-nav.js');
  delete globalThis.document;
  return module;
}

afterEach(() => {
  vi.resetModules();
  delete globalThis.document;
  delete globalThis.window;
  delete globalThis.HTMLElement;
});

describe('side navigation behavior', () => {
  it('exports testable section tracking helpers', async () => {
    const { findCenteredSection, findTransitionSections } = await importSideNavLogic();
    const metrics = [
      { id: 'first', rect: { top: 0, bottom: 280 } },
      { id: 'second', rect: { top: 360, bottom: 720 } },
    ];

    expect(findCenteredSection(metrics, 400)).toBe('second');
    expect(findCenteredSection(metrics, 340)).toBe('second');
    expect(findTransitionSections(metrics, 340, { isDesktop: true })).toEqual(['first', 'second']);
    expect(findTransitionSections(metrics, 340, { isDesktop: false })).toEqual([]);
  });

  it('opens from the mobile button and closes with Escape while restoring focus', async () => {
    const dom = createSideNavDom();
    await importSideNavWith(dom);

    dom.button.focus();
    dom.button.dispatchEvent({ type: 'click' });

    expect(dom.document.body.hasAttribute('data-side-nav-open')).toBe(true);
    expect(dom.button.getAttribute('aria-expanded')).toBe('true');
    expect(dom.nav.getAttribute('aria-hidden')).toBe('false');
    expect(dom.backdrop.hidden).toBe(false);
    expect(dom.document.activeElement).toBe(dom.nav);

    dom.document.dispatchEvent({ type: 'keydown', key: 'Escape' });

    expect(dom.document.body.hasAttribute('data-side-nav-open')).toBe(false);
    expect(dom.button.getAttribute('aria-expanded')).toBe('false');
    expect(dom.nav.getAttribute('aria-hidden')).toBe('true');
    expect(dom.backdrop.hidden).toBe(true);
    expect(dom.document.activeElement).toBe(dom.button);
  });

  it('clears the mobile open state when CSS switches to desktop mode', async () => {
    const dom = createSideNavDom();
    await importSideNavWith(dom);

    dom.button.dispatchEvent({ type: 'click' });
    dom.setDesktop(true);
    dom.window.dispatchEvent({ type: 'resize' });

    expect(dom.document.body.hasAttribute('data-side-nav-open')).toBe(false);
    expect(dom.button.getAttribute('aria-expanded')).toBe('false');
    expect(dom.nav.getAttribute('aria-hidden')).toBe('false');
    expect(dom.backdrop.hidden).toBe(true);
  });

  it('marks the centered section current and the neighbor as a desktop transition', async () => {
    const dom = createSideNavDom({
      desktop: true,
      innerHeight: 700,
      sections: [
        { id: 'first', rect: { top: 0, bottom: 300 } },
        { id: 'second', rect: { top: 380, bottom: 760 } },
      ],
    });

    await importSideNavWith(dom);

    expect(dom.links[0].getAttribute('data-side-nav-state')).toBe('transition');
    expect(dom.links[0].hasAttribute('aria-current')).toBe(false);
    expect(dom.links[1].getAttribute('aria-current')).toBe('page');
  });
});
