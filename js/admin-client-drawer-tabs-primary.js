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
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-bottom:20px;">
        <div class="stat-card blue" style="margin:0;">
          <div class="stat-value" style="font-size:22px;">${pct}%</div>
          <div class="stat-label">Progresso onboarding</div>
        </div>
        <div class="stat-card ${onboarding.completed ? 'green' : 'amber'}" style="margin:0;">
          <div class="stat-value" style="font-size:22px;">${step}/14</div>
          <div class="stat-label">Etapas preenchidas</div>
        </div>
      </div>
      <div style="margin-bottom:16px;">
        <span class="badge ${status.cls}" style="font-size:13px;">${status.label}</span>
        ${onboarding.completedAt ? `<span style="font-size:12px;color:var(--text-muted);margin-left:8px;">Concluído em ${onboarding.completedAt}</span>` : ''}
      </div>
      <div style="margin-bottom:16px;">
        <div style="font-size:13px;font-weight:700;color:var(--dark);margin-bottom:8px;">Informações do cliente</div>
        <table style="width:100%;font-size:13px;border-collapse:collapse;">
          ${[['Nome', user.name], ['E-mail', user.email], ['Empresa', user.company || '—'], ['Cadastrado em', new Date(user.createdAt).toLocaleDateString('pt-BR')]].map(([label, value]) =>
            `<tr><td style="padding:5px 0;color:var(--text-muted);width:38%;">${label}</td><td style="padding:5px 0;font-weight:500;">${value}</td></tr>`
          ).join('')}
        </table>
      </div>
      <div style="font-size:13px;font-weight:700;color:var(--dark);margin-bottom:8px;">Etapas do onboarding</div>
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
        const comments = (chapter.comments || []).map(comment => `<div style="font-size:12px;background:#F8FAFC;border-radius:6px;padding:8px 10px;margin-top:6px;">
          <strong>${comment.from === 'client' ? 'Cliente' : 'Equipe'}</strong>: ${comment.text}
          <span style="float:right;color:var(--text-muted);">${new Date(comment.ts).toLocaleDateString('pt-BR')}</span>
        </div>`).join('');
        return `<div class="chapter-item" style="flex-direction:column;align-items:flex-start;gap:10px;">
          <div style="display:flex;align-items:center;gap:12px;width:100%;">
            <div class="chapter-num${done ? ' done' : ''}">${checkIcon}</div>
            <div class="chapter-title" style="flex:1;">${chapter.title}</div>
            <span class="badge ${status.cls}">${status.label}</span>
          </div>
          <div style="display:flex;gap:8px;align-items:center;padding-left:44px;width:100%;">
            <select class="portal-select" style="width:auto;flex:1;font-size:13px;" onchange="updateChapterStatus('${currentClientId}',${chapter.id},this.value)">
              ${Object.entries(CHAPTER_STATUS).map(([value, config]) => `<option value="${value}"${chapter.status === value ? ' selected' : ''}>${config.label}</option>`).join('')}
            </select>
          </div>
          ${comments ? `<div style="padding-left:44px;width:100%;">${comments}</div>` : ''}
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
      <div style="margin-bottom:16px;">
        <div style="font-size:14px;font-weight:700;margin-bottom:10px;">Adicionar tarefa</div>
        <input type="text" class="portal-input" id="newTaskTitle" placeholder="Título da tarefa" style="margin-bottom:8px;"/>
        <input type="text" class="portal-input" id="newTaskDesc" placeholder="Descrição (opcional)" style="margin-bottom:8px;"/>
        <input type="date" class="portal-input" id="newTaskDate" style="margin-bottom:12px;"/>
        <button class="btn-primary" onclick="addTask()">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" style="margin-right:4px;"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
          Adicionar tarefa
        </button>
      </div>
      <div style="font-size:14px;font-weight:700;margin-bottom:10px;">Tarefas atribuídas</div>
      <div class="task-list">
        ${!tasks.length
          ? '<div class="empty-state"><p>Nenhuma tarefa criada.</p></div>'
          : tasks.map(task => `<div class="task-item">
              <div class="task-dot ${task.status}"></div>
              <div style="flex:1;">
                <div class="task-title" style="${task.status === 'concluido' ? 'text-decoration:line-through;color:var(--text-muted)' : ''}">${task.title}</div>
                ${task.description ? `<div style="font-size:12px;color:var(--text-muted);">${task.description}</div>` : ''}
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
})();