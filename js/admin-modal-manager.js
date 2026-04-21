'use strict';

(function () {
  const BREAKPOINT = 900;
  const SELECTOR = '.admin-modal-overlay, .mkt-modal-overlay';
  const BODY_LOCK_CLASS = 're-admin-modal-open';
  const ROOT_ID = 're-admin-modal-root';
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
    subscribers: new Set(),
    registry: Object.create(null),
    root: null,
    lastWidth: 0,
    modal: null,
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

  function ensureRoot() {
    if (state.root && document.body?.contains(state.root)) return state.root;
    let root = document.getElementById(ROOT_ID);
    if (!root) {
      root = document.createElement('div');
      root.id = ROOT_ID;
    }
    if (!root.parentNode && document.body) {
      document.body.appendChild(root);
    }
    state.root = root;
    return root;
  }

  function subscribe(listener) {
    if (typeof listener !== 'function') return function noop() {};
    state.subscribers.add(listener);
    return function unsubscribe() {
      state.subscribers.delete(listener);
    };
  }

  function getModalState() {
    return state.modal
      ? {
          name: state.modal.name,
          id: state.modal.id,
          props: state.modal.props || {},
          source: state.modal.source || null,
          static: !!state.modal.static,
        }
      : null;
  }

  function notify() {
    const snapshot = getModalState();
    state.subscribers.forEach(function (listener) {
      try {
        listener(snapshot);
      } catch (error) {
        console.warn('[RE:admin-modal] subscriber failed', error.message);
      }
    });
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
    if (!topModal && state.modal && !state.modal.static) {
      state.modal = null;
      notify();
    } else if (topModal && (!state.modal || state.modal.id !== topModal.id)) {
      state.modal = {
        name: topModal.dataset.reModalName || topModal.id || 'anonymous-modal',
        id: topModal.id || null,
        props: state.modal?.props || {},
        source: topModal.dataset.reModalSource || null,
        static: topModal.dataset.reModalStatic === '1',
      };
      notify();
    }
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
    if (opts.name) modal.dataset.reModalName = opts.name;
    if (opts.static === true) modal.dataset.reModalStatic = '1';
    if (opts.static === false) modal.dataset.reModalStatic = '0';
    if (!modal.dataset.reModalStatic) {
      modal.dataset.reModalStatic = STATIC_MODAL_IDS.includes(modal.id) ? '1' : '0';
    }
    if (opts.defaultOpen === true) modal.dataset.reModalDefaultOpen = '1';
    ensureBindings(modal);
    return modal;
  }

  function setModalRecord(record) {
    state.modal = record
      ? {
          name: record.name || record.id || 'anonymous-modal',
          id: record.id || null,
          props: record.props || {},
          source: record.source || null,
          static: !!record.static,
          focusSelector: record.focusSelector || null,
          element: record.element || null,
        }
      : null;
    notify();
  }

  function focusModal(modal, focusSelector) {
    if (!modal) return;
    const target = focusSelector
      ? modal.querySelector(focusSelector)
      : modal.querySelector('input,select,textarea,button,[tabindex]:not([tabindex="-1"])');
    if (target && typeof target.focus === 'function') {
      target.focus();
    }
  }

  function resolveModalNode(name, props, options) {
    const opts = options || {};
    const payload = props || {};

    if (payload.element instanceof HTMLElement) {
      return payload.element;
    }

    if (typeof payload.html === 'string') {
      const wrapper = document.createElement('div');
      wrapper.innerHTML = payload.html.trim();
      return wrapper.firstElementChild;
    }

    const renderer = opts.renderer || state.registry[name];
    if (typeof renderer === 'function') {
      return renderer(payload, opts);
    }

    return null;
  }

  function renderDynamicModal(record) {
    const root = ensureRoot();
    if (!root) return null;

    root.innerHTML = '';
    if (!record) {
      syncBodyLock();
      return null;
    }

    const modal = resolveModalNode(record.name, record.props, record);
    if (!modal) {
      setModalRecord(null);
      syncBodyLock();
      return null;
    }

    if (!modal.id && record.id) modal.id = record.id;
    modal.classList.remove('ui-hidden');
    tagModal(modal, record.source, {
      name: record.name,
      static: false,
    });
    root.appendChild(modal);
    focusModal(modal, record.focusSelector);
    syncActiveModal();
    return modal;
  }

  function closeCurrentDynamicModal(reason) {
    if (!state.modal || state.modal.static) return;
    const root = ensureRoot();
    if (root) root.innerHTML = '';
    const closed = state.modal;
    setModalRecord(null);
    syncActiveModal();
    log('close', {
      id: closed.id || null,
      name: closed.name || null,
      source: closed.source || null,
      reason: reason || 'close-current-dynamic',
    });
  }

  function closeModalElement(modal, reason) {
    if (!modal) return;
    const isStatic = modal.dataset.reModalStatic === '1';
    if (isStatic) {
      if (!modal.classList.contains('ui-hidden')) {
        modal.classList.add('ui-hidden');
      }
      if (state.modal && state.modal.id === modal.id) {
        setModalRecord(null);
      }
    } else if (state.modal && state.modal.id === modal.id) {
      closeCurrentDynamicModal(reason || 'close-dynamic');
      return;
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
    if (state.modal && state.modal.id === id && !state.modal.static) {
      closeCurrentDynamicModal(reason || 'close-by-id');
      return;
    }
    const modal = document.getElementById(id);
    if (!modal) return;
    closeModalElement(modal, reason || 'close-by-id');
  }

  function closeAll(options) {
    const keepId = options?.keepId || null;
    const reason = options?.reason || 'close-all';

    if (state.modal && !state.modal.static && (!keepId || state.modal.id !== keepId)) {
      closeCurrentDynamicModal(reason);
    }

    getVisibleModals().forEach(function (modal) {
      if (keepId && modal.id === keepId) return;
      closeModalElement(modal, reason);
    });

    if (!keepId) setModalRecord(null);
    syncActiveModal();
  }

  function enforceSingleVisible(options) {
    const keepId = options?.keepId || state.modal?.id || null;
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

    if (keepModal) {
      setModalRecord({
        name: keepModal.dataset.reModalName || keepModal.id || 'anonymous-modal',
        id: keepModal.id || null,
        props: state.modal?.props || {},
        source: keepModal.dataset.reModalSource || null,
        static: keepModal.dataset.reModalStatic === '1',
      });
    }
    syncBodyLock();
    log('enforce-single-visible', {
      keepId: keepModal?.id || null,
      visibleIds: visible.map(function (modal) { return modal.id || null; }),
    });
  }

  function openModal(name, props, options) {
    const opts = options || {};
    const id = opts.id || props?.id || name;
    const record = {
      name: name,
      id: id,
      props: props || {},
      source: opts.source || ('open-modal:' + name),
      static: false,
      focusSelector: opts.focusSelector || null,
      renderer: opts.renderer || null,
    };

    closeAll({ keepId: id, reason: opts.reason || 'open-modal' });
    setModalRecord(record);
    const modal = renderDynamicModal(record);
    if (!modal) return null;
    enforceSingleVisible({ keepId: modal.id || id });
    log('open', {
      id: modal.id || id || null,
      name: name,
      source: record.source,
      reason: opts.reason || 'open-modal',
    });
    return modal;
  }

  function toggleModal(name, props, options) {
    const nextId = options?.id || props?.id || name;
    if (state.modal && state.modal.name === name && state.modal.id === nextId) {
      closeModal();
      return null;
    }
    return openModal(name, props, options);
  }

  function closeModal() {
    if (state.modal?.id) {
      closeById(state.modal.id, 'close-modal');
      return;
    }
    closeAll({ reason: 'close-modal-fallback' });
  }

  function register(name, renderer) {
    if (!name || typeof renderer !== 'function') return;
    state.registry[name] = renderer;
  }

  function openDialog(config) {
    const cfg = config || {};
    const widths = {
      sm: '360px',
      md: '480px',
      lg: '620px',
      xl: '760px',
    };
    const width = cfg.width || widths[cfg.size || 'md'] || '480px';
    const headerActions = cfg.headerActionsHtml || '';
    const closeLabel = cfg.closeLabel || '&times;';
    const html = `
      <div id="${cfg.id}" class="admin-modal-overlay admin-modal-overlay-high">
        <div class="admin-modal" style="max-width:${width};width:95%;border-radius:12px;padding:24px;background:#fff;position:relative">
          <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px;gap:12px">
            <div style="font-weight:700;font-size:15px">${cfg.title || ''}</div>
            <div style="display:flex;align-items:center;gap:8px">
              ${headerActions}
              <button type="button" onclick="window.REAdminModal.closeById('${cfg.id}', 'dialog-close-button')" style="background:none;border:none;cursor:pointer;font-size:20px;color:#6b7280;line-height:1">${closeLabel}</button>
            </div>
          </div>
          <div class="modal-body">${cfg.bodyHtml || ''}</div>
          ${cfg.footerHtml ? `<div style="display:flex;justify-content:flex-end;gap:8px;margin-top:20px">${cfg.footerHtml}</div>` : ''}
        </div>
      </div>`;

    return openModal(cfg.name || cfg.id || 'dialog', { html: html }, {
      id: cfg.id,
      source: cfg.source || 'open-dialog',
      reason: cfg.reason || 'open-dialog',
      focusSelector: cfg.focusSelector || null,
    });
  }

  function openStatic(id, source) {
    const modal = document.getElementById(id);
    if (!modal) return null;
    closeAll({ keepId: id, reason: 'open-static' });
    tagModal(modal, source, {
      name: id,
      static: true,
    });
    modal.classList.remove('ui-hidden');
    setModalRecord({
      name: id,
      id: id,
      props: {},
      source: source || 'open-static',
      static: true,
    });
    ensureBindings(modal);
    syncBodyLock();
    enforceSingleVisible({ keepId: id });
    log('open', {
      id: id,
      name: id,
      source: source || 'open-static',
      reason: 'open-static',
    });
    return modal;
  }

  function append(modal, source) {
    if (!modal) return null;
    return openModal(modal.id || source || 'dynamic-modal', { element: modal }, {
      id: modal.id || null,
      source: source || 'append-modal',
      reason: 'append-modal',
    });
  }

  function insertHtml(id, html, source) {
    return openModal(id || source || 'dynamic-modal', { html: html }, {
      id: id || null,
      source: source || 'insert-html',
      reason: 'insert-html',
    });
  }

  function dumpState() {
    const snapshot = getManagedModals().map(function (modal) {
      return {
        id: modal.id || null,
        name: modal.dataset.reModalName || null,
        visible: isElementVisible(modal),
        className: modal.className,
        source: modal.dataset.reModalSource || null,
        static: modal.dataset.reModalStatic || '0',
      };
    });
    log('dump-state', {
      active: getModalState(),
      count: snapshot.length,
      modals: snapshot,
    });
    return snapshot;
  }

  function sanitizeShellOverlays(reason) {
    const sidebar = document.getElementById('appSidebar');
    const sidebarBackdrop = document.getElementById('sidebarBackdrop');
    const authGuard = document.getElementById('authGuard');
    const blockers = [];

    if (sidebarBackdrop && !sidebar?.classList.contains('mobile-open')) {
      sidebarBackdrop.classList.remove('open');
      if (isElementVisible(sidebarBackdrop)) blockers.push('sidebarBackdrop');
    }

    STATIC_MODAL_IDS.forEach(function (id) {
      ensureStaticBaseline(document.getElementById(id));
    });

    if (getVisibleModals().length > 1) {
      enforceSingleVisible({ keepId: state.modal?.id || null });
      blockers.push('multipleModals');
    }

    if (authGuard && document.body.dataset.reAdminAuthReady === '1') {
      authGuard.remove();
      blockers.push('staleAuthGuard');
    }

    const snapshot = {
      reason: reason || 'sanitize',
      activeModal: getModalState(),
      visibleModals: getVisibleModals().map(function (modal) { return modal.id || null; }),
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
      if (!isElementVisible(element)) return false;
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
      activeModal: getModalState(),
      stack: stackSummary,
      fixedHighZ: suspects,
    };
    log('viewport-audit', report);
    return report;
  }

  function handleModalMutation(modal, reason) {
    if (!modal) return;
    tagModal(modal, modal.dataset.reModalSource || reason, {
      name: modal.dataset.reModalName || modal.id || 'anonymous-modal',
      static: STATIC_MODAL_IDS.includes(modal.id),
    });
    ensureBindings(modal);
    if (isElementVisible(modal)) {
      setModalRecord({
        name: modal.dataset.reModalName || modal.id || 'anonymous-modal',
        id: modal.id || null,
        props: state.modal?.props || {},
        source: modal.dataset.reModalSource || reason,
        static: modal.dataset.reModalStatic === '1',
      });
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
        enforceSingleVisible({ keepId: state.modal?.id || null });
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
      tagModal(modal, (sourcePrefix || 'register-static') + ':' + id, {
        name: id,
        static: true,
      });
      ensureStaticBaseline(modal);
    });
    syncActiveModal();
  }

  function init() {
    if (state.initialized) return;
    state.initialized = true;
    ensureRoot();
    registerStatic(STATIC_MODAL_IDS, 'init');
    getManagedModals().forEach(function (modal) {
      tagModal(modal, modal.dataset.reModalSource || 'initial-dom', {
        name: modal.dataset.reModalName || modal.id || 'anonymous-modal',
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
    log('init', {
      breakpoint: BREAKPOINT,
      modals: getManagedModals().length,
      staticModals: STATIC_MODAL_IDS,
    });
  }

  window.REAdminModal = {
    append: append,
    closeAll: closeAll,
    closeById: closeById,
    closeModal: closeModal,
    collectViewportBlockers: collectViewportBlockers,
    dumpState: dumpState,
    enforceSingleVisible: enforceSingleVisible,
    getModalState: getModalState,
    getVisibleModals: getVisibleModals,
    init: init,
    insertHtml: insertHtml,
    openDialog: openDialog,
    openModal: openModal,
    openStatic: openStatic,
    register: register,
    registerStatic: registerStatic,
    sanitizeShellOverlays: sanitizeShellOverlays,
    subscribe: subscribe,
    syncActiveModal: syncActiveModal,
    tagModal: tagModal,
    toggleModal: toggleModal,
  };

  window.closeModal = function closeModalCompat(id) {
    if (id) {
      closeById(id, 'window-closeModal');
      return;
    }
    closeModal();
  };
})();
