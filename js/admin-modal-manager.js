'use strict';

(function () {
  const BREAKPOINT = 900;
  const SELECTOR = '.admin-modal-overlay, .mkt-modal-overlay';
  const state = {
    initialized: false,
    observer: null,
    resizeHandler: null,
    lastWidth: 0,
  };

  function debounce(fn, wait) {
    let timer = null;
    return function debounced() {
      const args = arguments;
      clearTimeout(timer);
      timer = setTimeout(function () {
        fn.apply(null, args);
      }, wait);
    };
  }

  function isElementVisible(element) {
    if (!element) return false;
    if (element.classList?.contains('ui-hidden')) return false;
    if (element.hidden) return false;
    return true;
  }

  function getManagedModals() {
    return Array.from(document.querySelectorAll(SELECTOR));
  }

  function getVisibleModals() {
    return getManagedModals().filter(isElementVisible);
  }

  function log(action, details) {
    console.info('[RE:admin-modal]', action, details || {});
  }

  function tagModal(modal, source) {
    if (!modal) return modal;
    modal.dataset.reModalManaged = '1';
    if (source) modal.dataset.reModalSource = source;
    if (!modal.dataset.reModalStatic) modal.dataset.reModalStatic = '0';
    return modal;
  }

  function closeModalElement(modal, reason) {
    if (!modal) return;
    if (modal.dataset.reModalStatic === '1') {
      if (modal.classList.contains('ui-hidden')) return;
      modal.classList.add('ui-hidden');
    } else {
      modal.remove();
    }
    log('close', { id: modal.id || null, source: modal.dataset.reModalSource || null, reason: reason || 'close' });
  }

  function closeAll(options) {
    const keepId = options?.keepId || null;
    const reason = options?.reason || 'close-all';
    getVisibleModals().forEach(function (modal) {
      if (keepId && modal.id === keepId) return;
      closeModalElement(modal, reason);
    });
  }

  function enforceSingleVisible(options) {
    const visible = getVisibleModals();
    if (visible.length <= 1) return;
    const keepId = options?.keepId || visible[visible.length - 1].id;
    visible.forEach(function (modal) {
      if (modal.id === keepId) return;
      closeModalElement(modal, 'enforce-single-visible');
    });
    log('enforce-single-visible', {
      keepId: keepId || null,
      visibleIds: visible.map(function (modal) { return modal.id || null; }),
    });
  }

  function openStatic(id, source) {
    const modal = document.getElementById(id);
    if (!modal) return null;
    tagModal(modal, source);
    closeAll({ keepId: id, reason: 'open-static' });
    modal.classList.remove('ui-hidden');
    log('open', { id: id, source: source || 'static' });
    enforceSingleVisible({ keepId: id });
    return modal;
  }

  function closeById(id, reason) {
    const modal = document.getElementById(id);
    if (!modal) return;
    closeModalElement(modal, reason || 'close-by-id');
  }

  function append(modal, source) {
    if (!modal) return null;
    tagModal(modal, source);
    closeAll({ keepId: modal.id || null, reason: 'append-modal' });
    document.body.appendChild(modal);
    log('append', { id: modal.id || null, source: source || 'append' });
    enforceSingleVisible({ keepId: modal.id || null });
    return modal;
  }

  function insertHtml(id, html, source) {
    document.getElementById(id)?.remove();
    const wrapper = document.createElement('div');
    wrapper.innerHTML = html.trim();
    const modal = wrapper.firstElementChild;
    if (!modal) return null;
    tagModal(modal, source);
    closeAll({ keepId: id, reason: 'insert-html' });
    document.body.appendChild(modal);
    log('insert-html', { id: id || modal.id || null, source: source || 'insert-html' });
    enforceSingleVisible({ keepId: id || modal.id || null });
    return modal;
  }

  function dumpState() {
    const snapshot = getManagedModals().map(function (modal) {
      return {
        id: modal.id || null,
        visible: isElementVisible(modal),
        className: modal.className,
        source: modal.dataset.reModalSource || null,
      };
    });
    log('dump-state', { count: snapshot.length, modals: snapshot });
    return snapshot;
  }

  function isVisible(element) {
    if (!element) return false;
    if (element.classList?.contains('ui-hidden')) return false;
    if (element.hidden) return false;
    const style = window.getComputedStyle(element);
    return style.display !== 'none' && style.visibility !== 'hidden' && style.opacity !== '0';
  }

  function sanitizeShellOverlays(reason) {
    const sidebar = document.getElementById('appSidebar');
    const sidebarBackdrop = document.getElementById('sidebarBackdrop');
    const drawer = document.getElementById('clientDrawer');
    const drawerOverlay = document.getElementById('drawerOverlay');
    const authGuard = document.getElementById('authGuard');
    const visibleModals = getVisibleModals();
    const blockers = [];

    if (sidebarBackdrop && !sidebar?.classList.contains('mobile-open')) {
      sidebarBackdrop.classList.remove('open');
      if (isVisible(sidebarBackdrop)) blockers.push('sidebarBackdrop');
    }

    if (drawerOverlay && !drawer?.classList.contains('open')) {
      drawerOverlay.classList.remove('open');
      if (isVisible(drawerOverlay)) blockers.push('drawerOverlay');
    }

    if (visibleModals.length > 1) {
      enforceSingleVisible();
      blockers.push('multipleModals');
    }

    if (authGuard && document.body.dataset.reAdminAuthReady === '1') {
      authGuard.remove();
      blockers.push('staleAuthGuard');
    }

    const snapshot = {
      reason: reason || 'sanitize',
      visibleModals: getVisibleModals().map(function (modal) { return modal.id || null; }),
      drawerOpen: !!drawer?.classList.contains('open'),
      drawerOverlayOpen: !!drawerOverlay?.classList.contains('open'),
      sidebarOpen: !!sidebar?.classList.contains('mobile-open'),
      sidebarBackdropOpen: !!sidebarBackdrop?.classList.contains('open'),
      authGuardPresent: !!document.getElementById('authGuard'),
      blockers: blockers,
    };
    log('sanitize-shell', snapshot);
    return snapshot;
  }

  function collectViewportBlockers(reason) {
    const centerX = Math.max(0, Math.floor(window.innerWidth / 2));
    const centerY = Math.max(0, Math.floor(window.innerHeight / 2));
    const stack = typeof document.elementsFromPoint === 'function'
      ? document.elementsFromPoint(centerX, centerY)
      : [];

    const suspects = Array.from(document.querySelectorAll('body *')).filter(function (element) {
      if (!(element instanceof HTMLElement)) return false;
      if (!isVisible(element)) return false;
      const style = window.getComputedStyle(element);
      if (style.position !== 'fixed') return false;
      const zIndex = Number(style.zIndex || 0);
      if (!Number.isFinite(zIndex) || zIndex < 350) return false;
      return true;
    }).slice(0, 20).map(function (element) {
      const style = window.getComputedStyle(element);
      return {
        tag: element.tagName,
        id: element.id || null,
        className: element.className || null,
        zIndex: style.zIndex || 'auto',
        pointerEvents: style.pointerEvents,
        opacity: style.opacity,
        source: element.dataset?.reModalSource || null,
      };
    });

    const stackSummary = stack.slice(0, 8).map(function (element) {
      if (!(element instanceof HTMLElement)) return {};
      const style = window.getComputedStyle(element);
      return {
        tag: element.tagName,
        id: element.id || null,
        className: element.className || null,
        zIndex: style.zIndex || 'auto',
        pointerEvents: style.pointerEvents,
        position: style.position,
      };
    });

    const report = {
      reason: reason || 'viewport-audit',
      centerPoint: { x: centerX, y: centerY },
      stack: stackSummary,
      fixedHighZ: suspects,
    };
    log('viewport-audit', report);
    return report;
  }

  function observeMutations() {
    if (state.observer || !document.body) return;
    state.observer = new MutationObserver(function (mutations) {
      mutations.forEach(function (mutation) {
        mutation.addedNodes.forEach(function (node) {
          if (!node || node.nodeType !== 1) return;
          const element = node;
          if (element.matches?.(SELECTOR)) {
            tagModal(element, element.dataset.reModalSource || 'mutation');
            if (isElementVisible(element)) {
              log('mutation-open', { id: element.id || null, source: element.dataset.reModalSource || 'mutation' });
              enforceSingleVisible({ keepId: element.id || null });
            }
          }
          element.querySelectorAll?.(SELECTOR).forEach(function (nestedModal) {
            tagModal(nestedModal, nestedModal.dataset.reModalSource || 'mutation-nested');
            if (isElementVisible(nestedModal)) {
              log('mutation-open', { id: nestedModal.id || null, source: nestedModal.dataset.reModalSource || 'mutation-nested' });
              enforceSingleVisible({ keepId: nestedModal.id || null });
            }
          });
        });
      });
    });
    state.observer.observe(document.body, { childList: true, subtree: true });
  }

  function bindResizeGuard() {
    if (state.resizeHandler) return;
    state.lastWidth = window.innerWidth;
    state.resizeHandler = debounce(function () {
      const currentWidth = window.innerWidth;
      const crossedDesktop = currentWidth > BREAKPOINT || state.lastWidth > BREAKPOINT;
      if (currentWidth === state.lastWidth) return;
      state.lastWidth = currentWidth;
      if (crossedDesktop) {
        enforceSingleVisible();
      }
    }, 120);
    window.addEventListener('resize', state.resizeHandler);
  }

  function init() {
    if (state.initialized) return;
    state.initialized = true;
    getManagedModals().forEach(function (modal) {
      tagModal(modal, modal.dataset.reModalSource || 'initial-dom');
      modal.dataset.reModalStatic = '1';
    });
    observeMutations();
    bindResizeGuard();
    enforceSingleVisible();
    sanitizeShellOverlays('init');
    collectViewportBlockers('init');
    window.addEventListener('pageshow', function () {
      sanitizeShellOverlays('pageshow');
      collectViewportBlockers('pageshow');
    });
    log('init', { breakpoint: BREAKPOINT, modals: getManagedModals().length });
  }

  window.REAdminModal = {
    init: init,
    append: append,
    closeAll: closeAll,
    closeById: closeById,
    dumpState: dumpState,
    enforceSingleVisible: enforceSingleVisible,
    getVisibleModals: getVisibleModals,
    insertHtml: insertHtml,
    openStatic: openStatic,
    sanitizeShellOverlays: sanitizeShellOverlays,
    collectViewportBlockers: collectViewportBlockers,
    tagModal: tagModal,
  };

  window.closeModal = function closeModal(id) {
    closeById(id, 'window-closeModal');
  };
})();
