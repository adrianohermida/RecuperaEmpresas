'use strict';

(function () {
  const BREAKPOINT = 900;
  const SELECTOR = '.admin-modal-overlay, .mkt-modal-overlay';
  const BODY_LOCK_CLASS = 're-admin-modal-open';
  const STATIC_MODAL_IDS = [
    'jrn-modal-form',
    'jrn-modal-step',
    'jrn-modal-assign',
    'fb-modal-new',
    'fb-logic-modal',
    'fb-assign-modal',
    'fb-resp-detail-modal',
  ];

  const state = {
    initialized: false,
    observer: null,
    resizeHandler: null,
    keydownHandler: null,
    activeModalId: null,
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

  function log(action, details) {
    console.info('[RE:admin-modal]', action, details || {});
  }

  function isOverlay(element) {
    return !!(element && element.nodeType === 1 && element.matches && element.matches(SELECTOR));
  }

  function isElementVisible(element) {
    if (!element) return false;
    if (element.classList?.contains('ui-hidden')) return false;
    if (element.hidden) return false;
    const style = window.getComputedStyle(element);
    return style.display !== 'none' && style.visibility !== 'hidden' && style.opacity !== '0';
  }

  function getManagedModals() {
    return Array.from(document.querySelectorAll(SELECTOR));
  }

  function getVisibleModals() {
    return getManagedModals().filter(isElementVisible);
  }

  function getTopVisibleModal() {
    const visible = getVisibleModals();
    return visible.length ? visible[visible.length - 1] : null;
  }

  function syncBodyLock() {
    document.body.classList.toggle(BODY_LOCK_CLASS, getVisibleModals().length > 0);
  }

  function syncActiveModal() {
    const topModal = getTopVisibleModal();
    state.activeModalId = topModal ? (topModal.id || null) : null;
    syncBodyLock();
  }

  function ensureStaticBaseline(modal) {
    if (!modal || modal.dataset.reModalStatic !== '1') return;
    if (modal.dataset.reModalDefaultOpen === '1') return;
    if (!modal.classList.contains('ui-hidden')) {
      modal.classList.add('ui-hidden');
    }
  }

  function ensureBindings(modal) {
    if (!modal || modal.dataset.reModalBound === '1') return modal;
    modal.dataset.reModalBound = '1';
    modal.addEventListener('mousedown', function (event) {
      if (event.target !== modal) return;
      closeModalElement(modal, 'backdrop-click');
    });
    return modal;
  }

  function tagModal(modal, source, options) {
    if (!modal) return modal;
    const opts = options || {};
    modal.dataset.reModalManaged = '1';
    if (source) modal.dataset.reModalSource = source;
    if (opts.static === true) modal.dataset.reModalStatic = '1';
    if (opts.static === false) modal.dataset.reModalStatic = '0';
    if (!modal.dataset.reModalStatic) {
      modal.dataset.reModalStatic = STATIC_MODAL_IDS.includes(modal.id) ? '1' : '0';
    }
    if (opts.defaultOpen === true) modal.dataset.reModalDefaultOpen = '1';
    ensureBindings(modal);
    return modal;
  }

  function closeModalElement(modal, reason) {
    if (!modal) return;
    if (modal.dataset.reModalStatic === '1') {
      if (!modal.classList.contains('ui-hidden')) {
        modal.classList.add('ui-hidden');
      }
    } else {
      modal.remove();
    }
    syncActiveModal();
    log('close', {
      id: modal.id || null,
      source: modal.dataset.reModalSource || null,
      reason: reason || 'close',
    });
  }

  function closeById(id, reason) {
    const modal = document.getElementById(id);
    if (!modal) return;
    closeModalElement(modal, reason || 'close-by-id');
  }

  function closeAll(options) {
    const keepId = options?.keepId || null;
    const reason = options?.reason || 'close-all';
    getVisibleModals().forEach(function (modal) {
      if (keepId && modal.id === keepId) return;
      closeModalElement(modal, reason);
    });
    syncActiveModal();
  }

  function enforceSingleVisible(options) {
    const keepId = options?.keepId || state.activeModalId || null;
    const visible = getVisibleModals();
    if (visible.length <= 1) {
      syncActiveModal();
      return;
    }

    const keepModal = visible.find(function (modal) {
      return keepId && modal.id === keepId;
    }) || visible[visible.length - 1];

    visible.forEach(function (modal) {
      if (keepModal && modal === keepModal) return;
      closeModalElement(modal, 'enforce-single-visible');
    });

    state.activeModalId = keepModal ? (keepModal.id || null) : null;
    syncBodyLock();
    log('enforce-single-visible', {
      keepId: state.activeModalId,
      visibleIds: visible.map(function (modal) { return modal.id || null; }),
    });
  }

  function activateModal(modal, source, options) {
    if (!modal) return null;
    const opts = options || {};
    tagModal(modal, source, opts);
    if (opts.closeOthers !== false) {
      closeAll({ keepId: modal.id || null, reason: opts.reason || 'activate-modal' });
    }
    modal.classList.remove('ui-hidden');
    state.activeModalId = modal.id || null;
    ensureBindings(modal);
    syncBodyLock();
    enforceSingleVisible({ keepId: modal.id || null });
    log('open', {
      id: modal.id || null,
      source: modal.dataset.reModalSource || source || null,
      reason: opts.reason || 'open',
    });
    return modal;
  }

  function openStatic(id, source) {
    const modal = document.getElementById(id);
    if (!modal) return null;
    return activateModal(modal, source, { static: true, reason: 'open-static' });
  }

  function append(modal, source) {
    if (!modal) return null;
    tagModal(modal, source, { static: false });
    document.body.appendChild(modal);
    return activateModal(modal, source, { static: false, reason: 'append-modal' });
  }

  function insertHtml(id, html, source) {
    const existing = document.getElementById(id);
    if (existing) closeModalElement(existing, 'replace-modal');
    const wrapper = document.createElement('div');
    wrapper.innerHTML = html.trim();
    const modal = wrapper.firstElementChild;
    if (!modal) return null;
    if (!modal.id && id) modal.id = id;
    tagModal(modal, source, { static: false });
    document.body.appendChild(modal);
    return activateModal(modal, source, { static: false, reason: 'insert-html' });
  }

  function dumpState() {
    const snapshot = getManagedModals().map(function (modal) {
      return {
        id: modal.id || null,
        visible: isElementVisible(modal),
        className: modal.className,
        source: modal.dataset.reModalSource || null,
        static: modal.dataset.reModalStatic || '0',
      };
    });
    log('dump-state', { activeModalId: state.activeModalId, count: snapshot.length, modals: snapshot });
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
    const blockers = [];

    if (sidebarBackdrop && !sidebar?.classList.contains('mobile-open')) {
      sidebarBackdrop.classList.remove('open');
      if (isVisible(sidebarBackdrop)) blockers.push('sidebarBackdrop');
    }

    if (drawerOverlay && !drawer?.classList.contains('open')) {
      drawerOverlay.classList.remove('open');
      if (isVisible(drawerOverlay)) blockers.push('drawerOverlay');
    }

    STATIC_MODAL_IDS.forEach(function (id) {
      ensureStaticBaseline(document.getElementById(id));
    });

    if (getVisibleModals().length > 1) {
      enforceSingleVisible({ keepId: state.activeModalId });
      blockers.push('multipleModals');
    }

    if (authGuard && document.body.dataset.reAdminAuthReady === '1') {
      authGuard.remove();
      blockers.push('staleAuthGuard');
    }

    const snapshot = {
      reason: reason || 'sanitize',
      activeModalId: state.activeModalId,
      visibleModals: getVisibleModals().map(function (modal) { return modal.id || null; }),
      drawerOpen: !!drawer?.classList.contains('open'),
      drawerOverlayOpen: !!drawerOverlay?.classList.contains('open'),
      sidebarOpen: !!sidebar?.classList.contains('mobile-open'),
      sidebarBackdropOpen: !!sidebarBackdrop?.classList.contains('open'),
      authGuardPresent: !!document.getElementById('authGuard'),
      blockers: blockers,
    };
    syncActiveModal();
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
      activeModalId: state.activeModalId,
      stack: stackSummary,
      fixedHighZ: suspects,
    };
    log('viewport-audit', report);
    return report;
  }

  function handleModalMutation(modal, reason) {
    if (!modal) return;
    tagModal(modal, modal.dataset.reModalSource || reason, {
      static: STATIC_MODAL_IDS.includes(modal.id),
    });
    ensureBindings(modal);
    if (isElementVisible(modal)) {
      state.activeModalId = modal.id || state.activeModalId;
      enforceSingleVisible({ keepId: modal.id || null });
    } else {
      syncActiveModal();
    }
  }

  function observeMutations() {
    if (state.observer || !document.body) return;
    state.observer = new MutationObserver(function (mutations) {
      mutations.forEach(function (mutation) {
        if (mutation.type === 'childList') {
          mutation.addedNodes.forEach(function (node) {
            if (!node || node.nodeType !== 1) return;
            const element = node;
            if (isOverlay(element)) {
              handleModalMutation(element, 'mutation');
            }
            element.querySelectorAll?.(SELECTOR).forEach(function (nestedModal) {
              handleModalMutation(nestedModal, 'mutation-nested');
            });
          });
          return;
        }

        if (mutation.type === 'attributes' && isOverlay(mutation.target)) {
          handleModalMutation(mutation.target, 'attribute-change');
        }
      });
    });

    state.observer.observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['class', 'hidden', 'style'],
    });
  }

  function bindResizeGuard() {
    if (state.resizeHandler) return;
    state.lastWidth = window.innerWidth;
    state.resizeHandler = debounce(function () {
      const currentWidth = window.innerWidth;
      const previousWidth = state.lastWidth;
      if (currentWidth === previousWidth) return;
      state.lastWidth = currentWidth;
      if (currentWidth > BREAKPOINT || previousWidth > BREAKPOINT) {
        sanitizeShellOverlays('resize');
        enforceSingleVisible({ keepId: state.activeModalId });
      }
    }, 120);
    window.addEventListener('resize', state.resizeHandler);
  }

  function bindEscapeHandler() {
    if (state.keydownHandler) return;
    state.keydownHandler = function (event) {
      if (event.key !== 'Escape') return;
      const activeModal = getTopVisibleModal();
      if (!activeModal) return;
      closeModalElement(activeModal, 'escape');
    };
    document.addEventListener('keydown', state.keydownHandler);
  }

  function registerStatic(ids, sourcePrefix) {
    (ids || []).forEach(function (id) {
      const modal = document.getElementById(id);
      if (!modal) return;
      tagModal(modal, (sourcePrefix || 'register-static') + ':' + id, { static: true });
      ensureStaticBaseline(modal);
    });
    syncActiveModal();
  }

  function init() {
    if (state.initialized) return;
    state.initialized = true;
    registerStatic(STATIC_MODAL_IDS, 'init');
    getManagedModals().forEach(function (modal) {
      tagModal(modal, modal.dataset.reModalSource || 'initial-dom', {
        static: STATIC_MODAL_IDS.includes(modal.id),
      });
    });
    observeMutations();
    bindResizeGuard();
    bindEscapeHandler();
    sanitizeShellOverlays('init');
    collectViewportBlockers('init');
    window.addEventListener('pageshow', function () {
      sanitizeShellOverlays('pageshow');
      collectViewportBlockers('pageshow');
    });
    log('init', { breakpoint: BREAKPOINT, modals: getManagedModals().length, staticModals: STATIC_MODAL_IDS });
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
    registerStatic: registerStatic,
    sanitizeShellOverlays: sanitizeShellOverlays,
    collectViewportBlockers: collectViewportBlockers,
    tagModal: tagModal,
    syncActiveModal: syncActiveModal,
  };

  window.closeModal = function closeModal(id) {
    closeById(id, 'window-closeModal');
  };
})();
