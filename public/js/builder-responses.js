'use strict';
/* builder-responses.js — Form Builder: visualização e exportação de respostas */

async function fbOpenResponses(formId, formTitle) {
  FB.currentFormId = formId;
  FB.selectedResp  = null;
  fbShowView('responses');

  const titleEl = document.getElementById('fb-resp-title');
  if (titleEl) titleEl.textContent = 'Respostas: ' + (formTitle || '');

  const el = document.getElementById('fb-resp-list');
  if (el) el.innerHTML = '<div class="admin-empty-state-soft">Carregando...</div>';

  const res = await fetch(`/api/admin/forms/${formId}/responses`, { headers: fbAuthH() });
  if (!res.ok) { if(el) el.innerHTML='<div class="form-builder-feedback-error">Erro ao carregar respostas.</div>'; return; }
  const jr = await res.json();
  FB.responses = jr.responses || jr;

  const STATUS_CLS = { em_andamento:'badge-blue', concluido:'badge-green', abandonado:'badge-gray' };
  const STATUS_LBL = { em_andamento:'Em andamento', concluido:'Concluído', abandonado:'Abandonado' };
  const CLASS_CLS  = { saudavel:'badge-green', risco_moderado:'badge-amber', risco_alto:'badge-red' };
  const CLASS_LBL  = { saudavel:'Saudável', risco_moderado:'Risco Moderado', risco_alto:'Risco Alto' };

  if (!FB.responses.length) {
    if (el) el.innerHTML = '<div class="form-builder-response-empty"><div class="form-builder-response-empty-icon">📭</div><div class="form-builder-response-empty-copy">Nenhuma resposta ainda.</div></div>';
    return;
  }

  if (el) el.innerHTML = `
  <table class="admin-simple-table form-builder-response-table">
    <thead>
      <tr>
        <th>Cliente</th>
        <th>Status</th>
        <th>Pontuação</th>
        <th>Classificação</th>
        <th>Data</th>
        <th>Ação</th>
      </tr>
    </thead>
    <tbody>
      ${FB.responses.map(r => {
        const u = r['re_users!re_form_responses_user_id_fkey'] || {};
        const uname  = u.name  || r.user_name  || '—';
        const uemail = u.email || r.user_email || '—';
        return `
      <tr class="form-builder-response-row" onclick="fbOpenResponseDetail(${r.id})">
        <td>
          <div class="form-builder-response-user">${fbEsc(uname)}</div>
          <div class="form-builder-response-email">${fbEsc(uemail)}</div>
        </td>
        <td><span class="badge ${STATUS_CLS[r.status]||'badge-gray'}">${STATUS_LBL[r.status]||r.status}</span></td>
        <td>
          ${r.score_pct != null ? `<span class="form-builder-response-score">${Math.round(r.score_pct)}%</span>
          <span class="form-builder-response-score-meta">${r.score_total||0}/${r.score_max||0}</span>` : '—'}
        </td>
        <td>
          ${r.score_classification ? `<span class="badge ${CLASS_CLS[r.score_classification]||'badge-gray'}">${CLASS_LBL[r.score_classification]||r.score_classification}</span>` : '—'}
        </td>
        <td class="form-builder-response-date">${r.updated_at ? new Date(r.updated_at).toLocaleDateString('pt-BR') : '—'}</td>
        <td>
          <button class="btn-ghost form-builder-response-action" onclick="event.stopPropagation();fbOpenResponseDetail(${r.id})">
            Ver detalhes
          </button>
        </td>
      </tr>`;
      }).join('')}
    </tbody>
  </table>`;
}

async function fbOpenResponseDetail(respId) {
  const modal = document.getElementById('fb-resp-detail-modal');
  if (!modal) return;
  fbOpenTransientModal('fb-resp-detail-modal');

  const body = document.getElementById('fb-resp-detail-body');
  if (body) body.innerHTML = '<div class="admin-empty-state-soft">Carregando detalhes...</div>';

  const res = await fetch(`/api/admin/forms/${FB.currentFormId}/responses/${respId}`, { headers: fbAuthH() });
  if (!res.ok) { if(body) body.innerHTML='<div class="form-builder-feedback-error">Erro ao carregar.</div>'; return; }
  const jr = await res.json();
  const data = jr.response || jr;

  const CLASS_CLS = { saudavel:'badge-green', risco_moderado:'badge-amber', risco_alto:'badge-red' };
  const CLASS_LBL = { saudavel:'Saudável', risco_moderado:'Risco Moderado', risco_alto:'Risco Alto' };

  const rawAnswers = jr.answers || [];
  const answers = rawAnswers.map(a => ({
    ...a,
    question_label: (a['re_form_questions'] || {}).label || a.question_label || ('Questão #'+a.question_id),
  }));

  if (body) body.innerHTML = `
    ${data.score_pct != null ? `
    <div class="form-builder-response-summary">
      <div>
        <div class="form-builder-response-summary-score">${Math.round(data.score_pct)}%</div>
        <div class="form-builder-response-summary-meta">Pontuação: ${data.score_total||0} / ${data.score_max||0} pontos</div>
      </div>
      ${data.score_classification ? `<span class="form-builder-response-summary-badge">${CLASS_LBL[data.score_classification]||data.score_classification}</span>` : ''}
    </div>` : ''}

    ${data.auto_report ? `
    <div class="form-builder-auto-report">
      <div class="form-builder-auto-report-title">📄 RELATÓRIO AUTOMÁTICO</div>
      <div class="form-builder-auto-report-body">${fbEsc(data.auto_report)}</div>
    </div>` : ''}

    <div class="form-builder-answer-list">
      ${answers.map(a => `
      <div class="form-builder-answer-card">
        <div class="form-builder-answer-label">${fbEsc(a.question_label||'Questão #'+a.question_id)}</div>
        <div class="form-builder-answer-value">${a.value_json ? JSON.stringify(a.value_json) : (fbEsc(a.value) || '<em class="form-builder-answer-empty">Sem resposta</em>')}</div>
        ${a.score != null ? `<div class="form-builder-answer-score">Pontos: ${a.score}</div>` : ''}
      </div>`).join('')}
    </div>
  `;
}

function fbCloseRespDetailModal() {
  fbCloseTransientModal('fb-resp-detail-modal');
}

function fbExportResponsesCSV() {
  if (!FB.responses.length) { fbToast('Sem respostas para exportar.','error'); return; }
  const rows = [['ID','Cliente','Email','Status','Pontuação %','Classificação','Data']];
  FB.responses.forEach(r => rows.push([
    r.id, r.user_name||'', r.user_email||'', r.status||'',
    r.score_pct != null ? Math.round(r.score_pct) : '',
    r.score_classification||'',
    r.updated_at ? new Date(r.updated_at).toLocaleDateString('pt-BR') : ''
  ]));
  const csv  = rows.map(r => r.map(c => `"${String(c).replace(/"/g,'""')}"`).join(',')).join('\n');
  const blob = new Blob(['\uFEFF'+csv], { type:'text/csv;charset=utf-8;' });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a'); a.href=url; a.download='respostas.csv'; a.click();
  URL.revokeObjectURL(url);
}
