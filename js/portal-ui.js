'use strict';

(function () {
  function ensureHost() {
    var host = document.getElementById('portalUiHost');
    if (host) return host;
    host = document.createElement('div');
    host.id = 'portalUiHost';
    document.body.appendChild(host);
    return host;
  }

  function removeNode(node) {
    if (node && node.parentNode) node.parentNode.removeChild(node);
  }

  function renderActions(actions, close) {
    return (actions || []).map(function (action, index) {
      var className = action.tone === 'primary'
        ? 'btn btn-primary'
        : action.tone === 'danger'
          ? 'btn btn-danger-outline'
          : 'btn btn-secondary';
      return '<button type="button" class="' + className + '" data-portal-action="' + index + '">' + action.label + '</button>';
    }).join('');
  }

  function bindActions(root, actions, close) {
    root.querySelectorAll('[data-portal-action]').forEach(function (button) {
      button.addEventListener('click', function () {
        var action = actions[Number(button.getAttribute('data-portal-action'))];
        if (!action) return;
        Promise.resolve(action.onClick && action.onClick({ close: close })).then(function (result) {
          if (result !== false && action.closeOnClick !== false) close();
        });
      });
    });
  }

  function useModal(options) {
    var opts = options || {};
    var host = ensureHost();
    var overlay = document.createElement('div');
    overlay.className = 'portal-ui-overlay';
    overlay.innerHTML = [
      '<div class="portal-ui-modal ' + (opts.size ? 'portal-ui-modal-' + opts.size : '') + '">',
      '  <div class="portal-ui-modal-head">',
      '    <div>',
      '      <div class="portal-ui-modal-title">' + (opts.title || '') + '</div>',
      (opts.subtitle ? '      <div class="portal-ui-modal-sub">' + opts.subtitle + '</div>' : ''),
      '    </div>',
      '    <button type="button" class="portal-ui-close" aria-label="Fechar">&times;</button>',
      '  </div>',
      '  <div class="portal-ui-modal-body"></div>',
      (opts.actions && opts.actions.length
        ? '  <div class="portal-ui-modal-actions">' + renderActions(opts.actions) + '</div>'
        : ''),
      '</div>'
    ].join('');

    var closed = false;
    function close() {
      if (closed) return;
      closed = true;
      removeNode(overlay);
      opts.onClose && opts.onClose();
    }

    overlay.addEventListener('mousedown', function (event) {
      if (event.target === overlay && opts.closeOnBackdrop !== false) close();
    });
    overlay.querySelector('.portal-ui-close').addEventListener('click', close);
    overlay.querySelector('.portal-ui-modal-body').append(opts.content || document.createElement('div'));
    bindActions(overlay, opts.actions || [], close);
    host.appendChild(overlay);
    return { close: close, element: overlay };
  }

  function useDrawer(options) {
    var opts = options || {};
    var host = ensureHost();
    var overlay = document.createElement('div');
    overlay.className = 'portal-ui-overlay portal-ui-drawer-overlay';
    overlay.innerHTML = [
      '<aside class="portal-ui-drawer ' + (opts.side === 'left' ? 'portal-ui-drawer-left' : '') + '">',
      '  <div class="portal-ui-drawer-head">',
      '    <div>',
      '      <div class="portal-ui-modal-title">' + (opts.title || '') + '</div>',
      (opts.subtitle ? '      <div class="portal-ui-modal-sub">' + opts.subtitle + '</div>' : ''),
      '    </div>',
      '    <button type="button" class="portal-ui-close" aria-label="Fechar">&times;</button>',
      '  </div>',
      '  <div class="portal-ui-drawer-body"></div>',
      (opts.actions && opts.actions.length
        ? '  <div class="portal-ui-modal-actions">' + renderActions(opts.actions) + '</div>'
        : ''),
      '</aside>'
    ].join('');

    var closed = false;
    function close() {
      if (closed) return;
      closed = true;
      removeNode(overlay);
      opts.onClose && opts.onClose();
    }

    overlay.addEventListener('mousedown', function (event) {
      if (event.target === overlay && opts.closeOnBackdrop !== false) close();
    });
    overlay.querySelector('.portal-ui-close').addEventListener('click', close);
    overlay.querySelector('.portal-ui-drawer-body').append(opts.content || document.createElement('div'));
    bindActions(overlay, opts.actions || [], close);
    host.appendChild(overlay);
    return { close: close, element: overlay };
  }

  function cloneState(columns) {
    return (columns || []).map(function (column) {
      return {
        id: column.id,
        title: column.title,
        cards: (column.cards || []).map(function (card) { return { ...card }; }),
      };
    });
  }

  function useKanban(initialColumns) {
    var state = cloneState(initialColumns);
    function getState() {
      return cloneState(state);
    }
    function setState(next) {
      state = cloneState(next);
      return getState();
    }
    function addColumn(column) {
      state.push({ id: column.id, title: column.title, cards: column.cards || [] });
      return getState();
    }
    function renameColumn(columnId, title) {
      state = state.map(function (column) {
        return column.id === columnId ? { ...column, title: title } : column;
      });
      return getState();
    }
    function moveColumn(columnId, targetIndex) {
      var index = state.findIndex(function (column) { return column.id === columnId; });
      if (index < 0) return getState();
      var column = state.splice(index, 1)[0];
      state.splice(Math.max(0, Math.min(targetIndex, state.length)), 0, column);
      return getState();
    }
    function addCard(columnId, card) {
      state = state.map(function (column) {
        return column.id === columnId
          ? { ...column, cards: column.cards.concat([{ ...card }]) }
          : column;
      });
      return getState();
    }
    function moveCard(cardId, fromColumnId, toColumnId, targetIndex) {
      var movingCard = null;
      state = state.map(function (column) {
        if (column.id !== fromColumnId) return column;
        return {
          ...column,
          cards: column.cards.filter(function (card) {
            if (card.id === cardId) movingCard = { ...card };
            return card.id !== cardId;
          }),
        };
      });
      if (!movingCard) return getState();
      state = state.map(function (column) {
        if (column.id !== toColumnId) return column;
        var nextCards = column.cards.slice();
        nextCards.splice(Math.max(0, Math.min(targetIndex, nextCards.length)), 0, movingCard);
        return { ...column, cards: nextCards };
      });
      return getState();
    }
    return {
      getState: getState,
      setState: setState,
      addColumn: addColumn,
      renameColumn: renameColumn,
      moveColumn: moveColumn,
      addCard: addCard,
      moveCard: moveCard,
    };
  }

  window.REPortalUI = {
    useModal: useModal,
    useDrawer: useDrawer,
    useKanban: useKanban,
  };
})();