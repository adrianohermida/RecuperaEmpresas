'use strict';

(function () {
  function stepIconDone() {
    return `<span class="step-row-icon step-icon-done">
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><polyline points="20 6 9 17 4 12"/></svg>
    </span>`;
  }

  function stepIconActive() {
    return `<span class="step-row-icon step-icon-active">
      <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor"><polygon points="5 3 19 12 5 21 5 3"/></svg>
    </span>`;
  }

  function stepIconTodo() {
    return '<span class="step-row-icon step-icon-todo"></span>';
  }

  function renderOverview(context) {
    const { body, user, onboarding, currentClientId } = context;
    logDrawerDiagnostic('Visão Geral', {
      route: `/api/admin/client/${currentClientId}`,
      source: 'cache:/api/admin/client/:id',
      expectedKeys: ['user', 'onboarding'],
      actualPayload: { user, onboarding },
      note: 'Deveria usar os dados já carregados da rota base do drawer e conter user e onboarding preenchidos.',
    });

    const step = onboarding.step || 1;
    const pct = onboarding.completed ? 100 : Math.round((step - 1) / 14 * 100);
    const status = STATUS_LABELS[onboarding.status] || STATUS_LABELS.nao_iniciado;

    body.innerHTML = `
      <div class="cdp-overview-grid">
        <div class="stat-card blue cdp-overview-card">
          <div class="stat-value cdp-overview-value">${pct}%</div>
          <div class="stat-label">Progresso onboarding</div>
        </div>
        <div class="stat-card ${onboarding.completed ? 'green' : 'amber'} cdp-overview-card">
          <div class="stat-value cdp-overview-value">${step}/14</div>
          <div class="stat-label">Etapas preenchidas</div>
        </div>
      </div>
      <div class="cdp-section-gap">
        <span class="badge ${status.cls} cdp-status-badge">${status.label}</span>
        ${onboarding.completedAt ? `<span class="cdp-status-meta">Concluído em ${onboarding.completedAt}</span>` : ''}
      </div>
      <div class="cdp-section-gap">
        <div class="cdp-section-title">Informações do cliente</div>
        <table class="cdp-info-table">
          ${[['Nome', user.name], ['E-mail', user.email], ['Empresa', user.company || '—'], ['Cadastrado em', new Date(user.createdAt).toLocaleDateString('pt-BR')]].map(([label, value]) =>
            `<tr><td class="cdp-info-label">${label}</td><td class="cdp-info-value">${value}</td></tr>`
          ).join('')}
        </table>
      </div>
      <div class="cdp-section-title">Etapas do onboarding</div>
      <div class="steps-list">
        ${Array.from({ length: 14 }, (_, index) => {
          const stepNumber = index + 1;
          const done = onboarding.completed || stepNumber < step;
          const active = !onboarding.completed && stepNumber === step;
          const rowClass = done ? 'done' : active ? 'active' : 'todo';
          const icon = done ? stepIconDone() : active ? stepIconActive() : stepIconTodo();
          return `<div class="step-row ${rowClass}">${icon}<span>Etapa ${stepNumber} — ${STEP_TITLES[stepNumber]}</span></div>`;
        }).join('')}
      </div>`;
  }

  function renderPlan(context) {
    const { body, plan, currentClientId } = context;
    logDrawerDiagnostic('Business Plan', {
      route: `/api/admin/client/${currentClientId}`,
      source: 'cache:/api/admin/client/:id',
      expectedKeys: ['chapters'],
      actualPayload: plan,
      note: 'Deveria usar o campo plan da rota base e conter chapters para montar o Business Plan.',
    });

    body.innerHTML = `<div class="chapter-list">
      ${(plan.chapters || []).map(chapter => {
        const status = CHAPTER_STATUS[chapter.status] || CHAPTER_STATUS.pendente;
        const done = chapter.status === 'aprovado';
        const checkIcon = done
          ? `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><polyline points="20 6 9 17 4 12"/></svg>`
          : chapter.id;
        const comments = (chapter.comments || []).map(comment => `<div class="cdp-plan-comment">
          <div class="cdp-plan-comment-head">
            <strong>${comment.from === 'client' ? 'Cliente' : 'Equipe'}</strong>
            <span class="cdp-plan-comment-date">${new Date(comment.ts).toLocaleDateString('pt-BR')}</span>
          </div>
          <div>${comment.text}</div>
        </div>`).join('');
        return `<div class="chapter-item cdp-plan-item">
          <div class="cdp-plan-head">
            <div class="chapter-num${done ? ' done' : ''}">${checkIcon}</div>
            <div class="chapter-title cdp-plan-title">${chapter.title}</div>
            <span class="badge ${status.cls}">${status.label}</span>
          </div>
          <div class="cdp-plan-controls">
            <select class="portal-select cdp-plan-select" onchange="updateChapterStatus('${currentClientId}',${chapter.id},this.value)">
              ${Object.entries(CHAPTER_STATUS).map(([value, config]) => `<option value="${value}"${chapter.status === value ? ' selected' : ''}>${config.label}</option>`).join('')}
            </select>
          </div>
          ${comments ? `<div class="cdp-plan-comments">${comments}</div>` : ''}
        </div>`;
      }).join('')}
    </div>`;
  }

  function renderTasks(context) {
    const { body, tasks, currentClientId } = context;
    logDrawerDiagnostic('Tarefas', {
      route: `/api/admin/client/${currentClientId}`,
      source: 'cache:/api/admin/client/:id',
      expectedKeys: ['tasks'],
      actualPayload: { tasks },
      note: 'Deveria usar o array tasks da rota base; quando vazio, o array ainda precisa existir.',
    });

    body.innerHTML = `
      <div class="cdp-section-gap">
        <div class="cdp-task-heading">Adicionar tarefa</div>
        <input type="text" class="portal-input cdp-task-input" id="newTaskTitle" placeholder="Título da tarefa"/>
        <input type="text" class="portal-input cdp-task-input" id="newTaskDesc" placeholder="Descrição (opcional)"/>
        <input type="date" class="portal-input cdp-task-input cdp-task-input-date" id="newTaskDate"/>
        <button class="btn-primary" onclick="addTask()">
          <svg class="cdp-task-add-icon" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
          Adicionar tarefa
        </button>
      </div>
      <div class="cdp-task-heading">Tarefas atribuídas</div>
      <div class="task-list">
        ${!tasks.length
          ? '<div class="empty-state"><p>Nenhuma tarefa criada.</p></div>'
          : tasks.map(task => `<div class="task-item">
              <div class="task-dot ${task.status}"></div>
              <div class="cdp-task-copy">
                <div class="task-title ${task.status === 'concluido' ? 'dashboard-task-title-done' : ''}">${task.title}</div>
                ${task.description ? `<div class="cdp-task-desc">${task.description}</div>` : ''}
              </div>
              ${task.dueDate ? `<div class="task-due">${new Date(task.dueDate).toLocaleDateString('pt-BR')}</div>` : ''}
              <span class="badge ${task.status === 'concluido' ? 'badge-green' : 'badge-amber'}">${task.status === 'concluido' ? 'Concluída' : 'Pendente'}</span>
            </div>`).join('')}
      </div>`;
  }

  window.REAdminDrawerPrimaryTabs = {
    render(tab, context) {
      if (tab === 'overview') {
        renderOverview(context);
        return true;
      }
      if (tab === 'plan') {
        renderPlan(context);
        return true;
      }
      if (tab === 'tasks') {
        renderTasks(context);
        return true;
      }
      return false;
    },
  };

console.info('[RE:admin-client-drawer-tabs-primary] loaded');
})();