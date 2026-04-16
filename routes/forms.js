'use strict';
const router = require('express').Router();
const { sb } = require('../lib/config');
const { requireAuth, requireAdmin } = require('../lib/auth');
const { auditLog, pushNotification } = require('../lib/logging');
const {
  buildRouteDiagnostic,
  insertWithColumnFallback,
  isSchemaCompatibilityError,
  selectWithColumnFallback,
  updateWithColumnFallback,
} = require('../lib/schema');

async function loadFullForm(formId) {
  const { data: form } = await sb.from('re_forms').select('*').eq('id', formId).single();
  if (!form) return null;

  const { data: pages } = await sb.from('re_form_pages')
    .select('*').eq('form_id', formId).order('order_index');
  const { data: questions } = await sb.from('re_form_questions')
    .select('*').eq('form_id', formId).order('order_index');
  const { data: logic } = await sb.from('re_form_logic')
    .select('*').eq('form_id', formId);

  const allPages = (pages || []).map((page) => ({
    ...page,
    questions: (questions || [])
      .filter((question) => question.page_id === page.id)
      .sort((left, right) => left.order_index - right.order_index),
  }));

  return {
    ...form,
    pages: allPages,
    questions: questions || [],
    logic: logic || [],
  };
}

router.get('/api/admin/forms', requireAdmin, async (req, res) => {
  try {
    const { type, status } = req.query;
    const { data: forms, error } = await selectWithColumnFallback('re_forms', {
      columns: ['id', 'title', 'description', 'type', 'status', 'settings', 'linked_plan_chapter', 'created_by', 'created_at', 'updated_at'],
      requiredColumns: ['id', 'title'],
      orderBy: ['created_at', 'id'],
      apply: (query) => {
        let next = query;
        if (type) next = next.eq('type', type);
        if (status) next = next.eq('status', status);
        return next;
      },
    });
    if (error) {
      if (isSchemaCompatibilityError(error.message, ['re_forms', 'title', 'description', 'type', 'status', 'settings', 'linked_plan_chapter', 'created_by'])) {
        console.warn('[FORMS LIST] returning empty list due to schema mismatch:', error.message);
        return res.json({ forms: [] });
      }
      throw error;
    }

    const ids = (forms || []).map((form) => form.id);
    const counts = {};
    if (ids.length) {
      const { data: responses, error: responseError } = await sb.from('re_form_responses')
        .select('form_id').in('form_id', ids).eq('status', 'completed');
      if (responseError) {
        console.warn('[FORMS LIST] response counts unavailable:', responseError.message);
      } else {
        (responses || []).forEach((response) => {
          counts[response.form_id] = (counts[response.form_id] || 0) + 1;
        });
      }
    }

    res.json({ forms: (forms || []).map((form) => ({ ...form, response_count: counts[form.id] || 0 })) });
  } catch (error) {
    console.error('[FORMS LIST]', error.message);
    res.json({ forms: [] });
  }
});

router.post('/api/admin/forms', requireAdmin, async (req, res) => {
  try {
    const { title, description, type, settings, linked_plan_chapter } = req.body;
    if (!title) return res.status(400).json({ error: 'Título é obrigatório.' });

    const basePayload = {
      title,
      description: description || null,
      type: type || 'custom',
      settings: settings || { scoring_enabled: false, show_progress: true, allow_resume: true },
      linked_plan_chapter: linked_plan_chapter || null,
      created_by: req.user.id,
      status: 'draft',
    };
    const formReturningColumns = ['id', 'title', 'description', 'type', 'settings', 'linked_plan_chapter', 'created_by', 'status', 'created_at', 'updated_at'];
    const formAttempts = [
      { payload: basePayload, requiredColumns: ['title'] },
      { payload: { ...basePayload, type: 'custom', created_by: null, linked_plan_chapter: null }, requiredColumns: ['title'] },
      { payload: { title, description: description || null, type: 'custom', status: 'draft' }, requiredColumns: ['title'] },
      { payload: { title, description: description || null }, requiredColumns: ['title'] },
      { payload: { title }, requiredColumns: ['title'] },
    ];

    let formInsert = null;
    for (const attempt of formAttempts) {
      formInsert = await insertWithColumnFallback('re_forms', attempt.payload, {
        requiredColumns: attempt.requiredColumns,
        returningColumns: formReturningColumns,
        requiredReturningColumns: ['id', 'title'],
      });
      if (!formInsert.error) break;
    }

    const { data: form, error } = formInsert;
    if (error) {
      if (isSchemaCompatibilityError(error.message, ['re_forms', 'title', 'description', 'type', 'settings', 'linked_plan_chapter', 'created_by', 'status'])) {
        return res.status(503).json({
          error: 'Formulários temporariamente indisponíveis até concluir a atualização do banco.',
          diagnostic: buildRouteDiagnostic('/api/admin/forms', error, formAttempts),
        });
      }
      return res.status(500).json({ error: error.message });
    }

    const { error: pageError } = await insertWithColumnFallback('re_form_pages', {
      form_id: form.id,
      title: 'Página 1',
      order_index: 0,
    }, {
      requiredColumns: ['form_id', 'title'],
      returningColumns: ['id', 'form_id', 'title', 'order_index'],
      requiredReturningColumns: ['id', 'form_id', 'title'],
    });
    if (pageError) {
      if (isSchemaCompatibilityError(pageError.message, ['re_form_pages', 'form_id', 'title', 'order_index'])) {
        console.warn('[FORMS CREATE] first page unavailable due to schema mismatch, continuing with empty form:', pageError.message);
      } else {
        return res.status(500).json({ error: pageError.message });
      }
    }

    auditLog({ actorId: req.user.id, actorEmail: req.user.email, actorRole: 'admin', entityType: 'form', entityId: form.id, action: 'create', after: { title, type } }).catch((error) => console.warn('[async]', error?.message));
    res.json({ success: true, form });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.get('/api/admin/forms/:id', requireAdmin, async (req, res) => {
  try {
    const form = await loadFullForm(req.params.id);
    if (!form) return res.status(404).json({ error: 'Formulário não encontrado.' });
    res.json({ form });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.put('/api/admin/forms/:id', requireAdmin, async (req, res) => {
  try {
    const { title, description, type, status, settings, linked_plan_chapter } = req.body;
    const updates = { updated_at: new Date().toISOString() };
    if (title !== undefined) updates.title = title;
    if (description !== undefined) updates.description = description;
    if (type !== undefined) updates.type = type;
    if (status !== undefined) updates.status = status;
    if (settings !== undefined) updates.settings = settings;
    if (linked_plan_chapter !== undefined) updates.linked_plan_chapter = linked_plan_chapter;
    const { data: form, error } = await updateWithColumnFallback('re_forms', { id: req.params.id }, updates, {
      requiredColumns: ['updated_at'],
    });
    if (error) return res.status(500).json({ error: error.message });
    res.json({ success: true, form });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.delete('/api/admin/forms/:id', requireAdmin, async (req, res) => {
  try {
    await sb.from('re_forms').delete().eq('id', req.params.id);
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.post('/api/admin/forms/:id/duplicate', requireAdmin, async (req, res) => {
  try {
    const src = await loadFullForm(req.params.id);
    if (!src) return res.status(404).json({ error: 'Formulário não encontrado.' });

    const { data: newForm, error: formInsertError } = await insertWithColumnFallback('re_forms', {
      title: `${src.title} (cópia)`,
      description: src.description,
      type: src.type,
      settings: src.settings,
      status: 'draft',
      linked_plan_chapter: src.linked_plan_chapter,
      created_by: req.user.id,
      template_id: src.id,
      version: 1,
    }, { requiredColumns: ['title', 'type', 'settings'] });
    if (formInsertError) return res.status(500).json({ error: formInsertError.message });

    const pageIdMap = {};
    for (const page of src.pages) {
      const { data: newPage } = await sb.from('re_form_pages').insert({
        form_id: newForm.id,
        title: page.title,
        description: page.description,
        order_index: page.order_index,
      }).select().single();
      pageIdMap[page.id] = newPage.id;
    }

    const questionIdMap = {};
    for (const question of src.questions) {
      const { data: newQuestion } = await sb.from('re_form_questions').insert({
        form_id: newForm.id,
        page_id: pageIdMap[question.page_id] || null,
        order_index: question.order_index,
        type: question.type,
        label: question.label,
        description: question.description,
        placeholder: question.placeholder,
        required: question.required,
        options: question.options,
        settings: question.settings,
        weight: question.weight,
        score_map: question.score_map,
        formula: question.formula,
      }).select().single();
      questionIdMap[question.id] = newQuestion.id;
    }

    for (const rule of src.logic) {
      await sb.from('re_form_logic').insert({
        form_id: newForm.id,
        source_question_id: questionIdMap[rule.source_question_id] || null,
        operator: rule.operator,
        condition_value: rule.condition_value,
        action: rule.action,
        target_question_id: rule.target_question_id ? questionIdMap[rule.target_question_id] : null,
        target_page_id: rule.target_page_id ? pageIdMap[rule.target_page_id] : null,
      });
    }

    res.json({ success: true, form: newForm });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.post('/api/admin/forms/:id/assign', requireAdmin, async (req, res) => {
  try {
    const { user_ids } = req.body;
    if (!Array.isArray(user_ids) || !user_ids.length) {
      return res.status(400).json({ error: 'user_ids é obrigatório.' });
    }
    const rows = user_ids.map((userId) => ({ form_id: req.params.id, user_id: userId, assigned_by: req.user.id }));
    await sb.from('re_form_assignments').upsert(rows, { onConflict: 'form_id,user_id' });
    for (const userId of user_ids) {
      const { data: form } = await sb.from('re_forms').select('title').eq('id', req.params.id).single();
      pushNotification(userId, 'task', 'Novo formulário disponível', form?.title || 'Formulário', 'form', req.params.id).catch((error) => console.warn('[async]', error?.message));
    }
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.get('/api/admin/forms/:id/assignments', requireAdmin, async (req, res) => {
  try {
    const { data } = await sb.from('re_form_assignments')
      .select('*,re_users!re_form_assignments_user_id_fkey(name,email,company)')
      .eq('form_id', req.params.id);
    res.json({ assignments: data || [] });
  } catch {
    res.json({ assignments: [] });
  }
});

router.delete('/api/admin/forms/:id/assignments/:uid', requireAdmin, async (req, res) => {
  try {
    await sb.from('re_form_assignments').delete().eq('form_id', req.params.id).eq('user_id', req.params.uid);
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.post('/api/admin/forms/:id/pages', requireAdmin, async (req, res) => {
  try {
    const { title, description } = req.body;
    const { data: last } = await sb.from('re_form_pages')
      .select('order_index').eq('form_id', req.params.id).order('order_index', { ascending: false }).limit(1).single();
    const { data: page } = await sb.from('re_form_pages').insert({
      form_id: req.params.id,
      title: title || 'Nova Página',
      description: description || null,
      order_index: (last?.order_index ?? -1) + 1,
    }).select().single();
    res.json({ success: true, page });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.put('/api/admin/forms/:id/pages/:pageId', requireAdmin, async (req, res) => {
  try {
    const { title, description, order_index } = req.body;
    const updates = {};
    if (title !== undefined) updates.title = title;
    if (description !== undefined) updates.description = description;
    if (order_index !== undefined) updates.order_index = order_index;
    const { data: page } = await sb.from('re_form_pages').update(updates).eq('id', req.params.pageId).select().single();
    res.json({ success: true, page });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.delete('/api/admin/forms/:id/pages/:pageId', requireAdmin, async (req, res) => {
  try {
    await sb.from('re_form_questions').delete().eq('page_id', req.params.pageId);
    await sb.from('re_form_pages').delete().eq('id', req.params.pageId);
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.post('/api/admin/forms/:id/questions', requireAdmin, async (req, res) => {
  try {
    const { page_id, type, label, description, placeholder, required, options, settings, weight, score_map, formula } = req.body;
    if (!page_id || !type) return res.status(400).json({ error: 'page_id e type são obrigatórios.' });
    const { data: last } = await sb.from('re_form_questions')
      .select('order_index').eq('page_id', page_id).order('order_index', { ascending: false }).limit(1).single();
    const { data: question, error } = await sb.from('re_form_questions').insert({
      form_id: req.params.id,
      page_id,
      type,
      label: label || 'Nova Pergunta',
      description: description || null,
      placeholder: placeholder || null,
      required: required || false,
      options: options || null,
      settings: settings || null,
      weight: weight ?? 1,
      score_map: score_map || null,
      formula: formula || null,
      order_index: (last?.order_index ?? -1) + 1,
    }).select().single();
    if (error) return res.status(500).json({ error: error.message });
    res.json({ success: true, question });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.put('/api/admin/forms/:id/questions/:qId', requireAdmin, async (req, res) => {
  try {
    const allowed = ['label', 'description', 'placeholder', 'required', 'options', 'settings', 'weight', 'score_map', 'formula', 'type', 'order_index', 'page_id'];
    const updates = {};
    allowed.forEach((key) => {
      if (req.body[key] !== undefined) updates[key] = req.body[key];
    });
    const { data: question, error } = await sb.from('re_form_questions').update(updates).eq('id', req.params.qId).select().single();
    if (error) return res.status(500).json({ error: error.message });
    res.json({ success: true, question });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.delete('/api/admin/forms/:id/questions/:qId', requireAdmin, async (req, res) => {
  try {
    await sb.from('re_form_logic').delete().or(`source_question_id.eq.${req.params.qId},target_question_id.eq.${req.params.qId}`);
    await sb.from('re_form_questions').delete().eq('id', req.params.qId);
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.post('/api/admin/forms/:id/questions/reorder', requireAdmin, async (req, res) => {
  try {
    const { order } = req.body;
    for (const item of (order || [])) {
      await sb.from('re_form_questions').update({ order_index: item.order_index }).eq('id', item.id);
    }
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.get('/api/admin/forms/:id/logic', requireAdmin, async (req, res) => {
  try {
    let query = sb.from('re_form_logic').select('*').eq('form_id', req.params.id);
    if (req.query.question_id) query = query.eq('source_question_id', req.query.question_id);
    const { data: rules } = await query.order('id');
    res.json({ rules: rules || [] });
  } catch {
    res.json({ rules: [] });
  }
});

router.post('/api/admin/forms/:id/logic', requireAdmin, async (req, res) => {
  try {
    const { source_question_id, operator, condition_value, action, target_question_id, target_page_id } = req.body;
    if (!source_question_id || !action) {
      return res.status(400).json({ error: 'source_question_id e action são obrigatórios.' });
    }
    const { data: rule } = await sb.from('re_form_logic').insert({
      form_id: req.params.id,
      source_question_id,
      operator: operator || 'equals',
      condition_value: condition_value ?? null,
      action,
      target_question_id: target_question_id || null,
      target_page_id: target_page_id || null,
    }).select().single();
    res.json({ success: true, rule });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.delete('/api/admin/forms/:id/logic/:ruleId', requireAdmin, async (req, res) => {
  try {
    await sb.from('re_form_logic').delete().eq('id', req.params.ruleId).eq('form_id', req.params.id);
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.get('/api/admin/forms/:id/responses', requireAdmin, async (req, res) => {
  try {
    const { status } = req.query;
    let query = sb.from('re_form_responses')
      .select('*,re_users!re_form_responses_user_id_fkey(name,email,company)')
      .eq('form_id', req.params.id)
      .order('started_at', { ascending: false });
    if (status) query = query.eq('status', status);
    const { data: responses } = await query;
    res.json({ responses: responses || [] });
  } catch {
    res.json({ responses: [] });
  }
});

router.get('/api/admin/forms/:id/responses/:responseId', requireAdmin, async (req, res) => {
  try {
    const { data: response } = await sb.from('re_form_responses')
      .select('*,re_users!re_form_responses_user_id_fkey(name,email,company)')
      .eq('id', req.params.responseId).single();
    if (!response) return res.status(404).json({ error: 'Resposta não encontrada.' });
    const { data: answers } = await sb.from('re_form_answers')
      .select('*,re_form_questions(label,type)')
      .eq('response_id', req.params.responseId);
    res.json({ response, answers: answers || [] });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.post('/api/admin/forms/:id/assign-email', requireAdmin, async (req, res) => {
  try {
    const { email } = req.body;
    if (!email) return res.status(400).json({ error: 'Email obrigatório.' });
    const { data: user } = await sb.from('re_users').select('id,name,email').eq('email', email).single();
    if (!user) return res.status(404).json({ error: 'Cliente não encontrado com este email.' });
    await sb.from('re_form_assignments').upsert({ form_id: req.params.id, user_id: user.id, assigned_by: req.user.id }, { onConflict: 'form_id,user_id' });
    const { data: form } = await sb.from('re_forms').select('title').eq('id', req.params.id).single();
    pushNotification(user.id, 'task', 'Novo formulário disponível', form?.title || 'Formulário', 'form', req.params.id).catch((error) => console.warn('[async]', error?.message));
    res.json({ success: true, user });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.get('/api/forms', requireAuth, async (req, res) => {
  try {
    const userId = req.user.id;
    const { data: assignments } = await sb.from('re_form_assignments').select('form_id').eq('user_id', userId);
    const formIds = (assignments || []).map((assignment) => assignment.form_id);

    let forms = [];
    if (formIds.length) {
      const { data } = await sb.from('re_forms')
        .select('id,title,description,type,settings')
        .in('id', formIds).eq('status', 'active');
      forms = data || [];
    }

    const withStatus = await Promise.all(forms.map(async (form) => {
      const { data: responses } = await sb.from('re_form_responses')
        .select('id,status,completed_at,score_pct')
        .eq('form_id', form.id).eq('user_id', userId)
        .order('started_at', { ascending: false }).limit(1);
      const latest = responses?.[0] || null;
      return {
        ...form,
        my_status: latest?.status || 'not_started',
        my_response_id: latest?.id || null,
        completed_at: latest?.completed_at || null,
        score_pct: latest?.score_pct || null,
      };
    }));

    res.json({ forms: withStatus });
  } catch {
    res.json({ forms: [] });
  }
});

router.get('/api/forms/:id', requireAuth, async (req, res) => {
  try {
    const { data: assignment } = await sb.from('re_form_assignments')
      .select('id').eq('form_id', req.params.id).eq('user_id', req.user.id).single();
    if (!assignment) return res.status(403).json({ error: 'Sem acesso a este formulário.' });

    const form = await loadFullForm(req.params.id);
    if (!form || form.status === 'inactive') return res.status(404).json({ error: 'Formulário não disponível.' });
    res.json({ form });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.post('/api/forms/:id/responses', requireAuth, async (req, res) => {
  try {
    const formId = req.params.id;
    const { data: existing } = await sb.from('re_form_responses')
      .select('*').eq('form_id', formId).eq('user_id', req.user.id)
      .eq('status', 'in_progress').order('started_at', { ascending: false }).limit(1).single();
    if (existing) return res.json({ response: existing, resumed: true });

    const { data: firstPage } = await sb.from('re_form_pages')
      .select('id').eq('form_id', formId).order('order_index').limit(1).single();

    const { data: response } = await sb.from('re_form_responses').insert({
      form_id: formId,
      user_id: req.user.id,
      status: 'in_progress',
      current_page_id: firstPage?.id || null,
    }).select().single();

    res.json({ response, resumed: false });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.put('/api/forms/:id/responses/:responseId', requireAuth, async (req, res) => {
  try {
    const { answers, current_page_id } = req.body;
    const { data: response } = await sb.from('re_form_responses')
      .select('id,user_id').eq('id', req.params.responseId).single();
    if (!response || response.user_id !== req.user.id) {
      return res.status(403).json({ error: 'Sem permissão.' });
    }

    if (current_page_id) {
      await sb.from('re_form_responses').update({ current_page_id }).eq('id', req.params.responseId);
    }

    if (Array.isArray(answers)) {
      for (const answer of answers) {
        await sb.from('re_form_answers').upsert({
          response_id: req.params.responseId,
          question_id: answer.question_id,
          value: answer.value ?? null,
          value_json: answer.value_json ?? null,
          file_path: answer.file_path ?? null,
          updated_at: new Date().toISOString(),
        }, { onConflict: 'response_id,question_id' });
      }
    }
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.post('/api/forms/:id/responses/:responseId/complete', requireAuth, async (req, res) => {
  try {
    const {
      score_total,
      score_max,
      score_pct,
      score_classification,
      score_details,
      calculation_results,
      auto_report,
    } = req.body;

    const { data: response } = await sb.from('re_form_responses')
      .select('user_id').eq('id', req.params.responseId).single();
    if (!response || response.user_id !== req.user.id) {
      return res.status(403).json({ error: 'Sem permissão.' });
    }

    await sb.from('re_form_responses').update({
      status: 'completed',
      completed_at: new Date().toISOString(),
      score_total: score_total ?? null,
      score_max: score_max ?? null,
      score_pct: score_pct ?? null,
      score_classification: score_classification ?? null,
      score_details: score_details ?? null,
      calculation_results: calculation_results ?? null,
      auto_report: auto_report ?? null,
    }).eq('id', req.params.responseId);

    const { data: form } = await sb.from('re_forms').select('title').eq('id', req.params.id).single();
    const { data: admins } = await sb.from('re_users').select('id').eq('is_admin', true).limit(10);
    for (const admin of (admins || [])) {
      pushNotification(admin.id, 'task', 'Formulário concluído', `${form?.title || 'Formulário'} — resposta de ${req.user.name || req.user.email}`, 'form_response', req.params.responseId).catch((error) => console.warn('[async]', error?.message));
    }
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.get('/api/my-forms', requireAuth, async (req, res) => {
  try {
    const userId = req.user.id;
    const { data: assignments } = await sb.from('re_form_assignments').select('form_id').eq('user_id', userId);
    const formIds = (assignments || []).map((assignment) => assignment.form_id);
    if (!formIds.length) return res.json([]);

    const { data: forms } = await sb.from('re_forms')
      .select('id,title,description,type,status')
      .in('id', formIds).in('status', ['active', 'publicado']);

    const withStatus = await Promise.all((forms || []).map(async (form) => {
      const { data: responses } = await sb.from('re_form_responses')
        .select('id,status,score_pct,score_classification,current_page_id,updated_at')
        .eq('form_id', form.id).eq('user_id', userId)
        .order('updated_at', { ascending: false }).limit(1);
      const response = responses?.[0] || null;
      const statusMap = { in_progress: 'em_andamento', completed: 'concluido' };
      return {
        ...form,
        response_status: response ? (statusMap[response.status] || response.status) : 'nao_iniciado',
        response_id: response?.id || null,
        response_progress: null,
        score_pct: response?.score_pct || null,
        score_classification: response?.score_classification || null,
      };
    }));
    res.json(withStatus);
  } catch {
    res.json([]);
  }
});

router.get('/api/my-forms/:id', requireAuth, async (req, res) => {
  try {
    const userId = req.user.id;
    const formId = req.params.id;
    const { data: assignment } = await sb.from('re_form_assignments')
      .select('id').eq('form_id', formId).eq('user_id', userId).single();
    if (!assignment) return res.status(403).json({ error: 'Sem acesso a este formulário.' });

    const form = await loadFullForm(formId);
    if (!form) return res.status(404).json({ error: 'Formulário não encontrado.' });

    const { data: existing } = await sb.from('re_form_responses')
      .select('id,status,current_page_id,score_pct,score_total,score_max,score_classification,auto_report')
      .eq('form_id', formId).eq('user_id', userId)
      .order('updated_at', { ascending: false }).limit(1).single();

    let existingWithAnswers = null;
    if (existing) {
      const { data: answers } = await sb.from('re_form_answers')
        .select('question_id,value,value_json').eq('response_id', existing.id);
      existingWithAnswers = { ...existing, answers: answers || [] };
    }

    res.json({ ...form, existing_response: existingWithAnswers });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.post('/api/my-forms/:id/response', requireAuth, async (req, res) => {
  try {
    const userId = req.user.id;
    const formId = req.params.id;
    const { answers, current_page_id, status } = req.body;

    const { data: assignment } = await sb.from('re_form_assignments')
      .select('id').eq('form_id', formId).eq('user_id', userId).single();
    if (!assignment) return res.status(403).json({ error: 'Sem acesso.' });

    let { data: response } = await sb.from('re_form_responses')
      .select('id,status,started_at').eq('form_id', formId).eq('user_id', userId)
      .not('status', 'eq', 'completed')
      .order('updated_at', { ascending: false }).limit(1).single();

    const isCompleting = status === 'concluido';
    const dbStatus = isCompleting ? 'completed' : 'in_progress';
    const now = new Date().toISOString();

    if (!response) {
      const { data: newResponse } = await sb.from('re_form_responses').insert({
        form_id: formId,
        user_id: userId,
        status: dbStatus,
        current_page_id: current_page_id || null,
        last_active_at: now,
        updated_at: now,
      }).select('id,status,started_at').single();
      response = newResponse;
    } else {
      const updates = { status: dbStatus, updated_at: now, last_active_at: now };
      if (current_page_id) updates.current_page_id = current_page_id;
      if (isCompleting) {
        updates.completed_at = now;
        if (response.started_at) {
          updates.time_to_complete_seconds = Math.round((Date.now() - new Date(response.started_at).getTime()) / 1000);
        }
      }
      await sb.from('re_form_responses').update(updates).eq('id', response.id);
    }

    const responseId = response.id;

    if (answers && typeof answers === 'object') {
      for (const [questionId, value] of Object.entries(answers)) {
        const isArray = Array.isArray(value);
        const isComplex = isArray || (typeof value === 'object' && value !== null);
        await sb.from('re_form_answers').upsert({
          response_id: responseId,
          question_id: parseInt(questionId, 10),
          value: isComplex ? null : (value == null ? null : String(value)),
          value_json: isComplex ? value : null,
          updated_at: new Date().toISOString(),
        }, { onConflict: 'response_id,question_id' });
      }
    }

    let scoreData = {};
    if (isCompleting) {
      const { data: questions } = await sb.from('re_form_questions')
        .select('id,weight,score_map,type').eq('form_id', formId);

      let totalScore = 0;
      let maxScore = 0;
      const scoreDetails = {};

      for (const question of (questions || [])) {
        if (!question.weight) continue;
        maxScore += question.weight;
        const answerKey = String(question.id);
        const answerValue = answers?.[answerKey];
        const scoreMap = question.score_map || {};
        let points = 0;
        if (answerValue != null && scoreMap[String(answerValue)] !== undefined) {
          points = parseFloat(scoreMap[String(answerValue)]) || 0;
        } else if (typeof answerValue === 'number') {
          points = answerValue * (question.weight / 10);
        }
        totalScore += points;
        scoreDetails[question.id] = points;
      }

      const scorePct = maxScore > 0 ? (totalScore / maxScore) * 100 : null;
      const classification = scorePct == null
        ? null
        : scorePct >= 70
          ? 'saudavel'
          : scorePct >= 40
            ? 'risco_moderado'
            : 'risco_alto';

      const { data: form } = await sb.from('re_forms').select('title,type').eq('id', formId).single();
      let autoReport = null;
      if (scorePct != null) {
        autoReport = `Relatório de ${form?.title || 'Diagnóstico'}\n\nPontuação: ${Math.round(scorePct)}% (${totalScore.toFixed(1)}/${maxScore} pontos)\n`;
        autoReport += classification === 'saudavel'
          ? 'Situação: SAUDÁVEL — A empresa apresenta boa saúde financeira e operacional.\n'
          : classification === 'risco_moderado'
            ? 'Situação: RISCO MODERADO — Há pontos de atenção que merecem acompanhamento.\n'
            : 'Situação: RISCO ALTO — A empresa necessita de intervenção imediata.\n';
        autoReport += `\nEste relatório foi gerado automaticamente com base nas respostas fornecidas em ${new Date().toLocaleDateString('pt-BR')}.`;
      }

      await sb.from('re_form_responses').update({
        score_total: totalScore,
        score_max: maxScore,
        score_pct: scorePct,
        score_classification: classification,
        score_details: scoreDetails,
        auto_report: autoReport,
      }).eq('id', responseId);

      scoreData = {
        score_total: totalScore,
        score_max: maxScore,
        score_pct: scorePct,
        score_classification: classification,
        auto_report: autoReport,
      };

      const { data: admins } = await sb.from('re_users').select('id').eq('is_admin', true).limit(10);
      for (const admin of (admins || [])) {
        pushNotification(admin.id, 'task', 'Formulário concluído', `${form?.title || 'Formulário'} — resposta de ${req.user.name || req.user.email}`, 'form_response', responseId).catch((error) => console.warn('[async]', error?.message));
      }
    }

    res.json({ response_id: responseId, ...scoreData });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.get('/api/my-form-responses', requireAuth, async (req, res) => {
  try {
    const { data } = await sb.from('re_form_responses')
      .select('*,re_forms(title,type)')
      .eq('user_id', req.user.id)
      .order('started_at', { ascending: false });
    res.json({ responses: data || [] });
  } catch {
    res.json({ responses: [] });
  }
});

router.get('/api/admin/forms/:id/stats', requireAdmin, async (req, res) => {
  try {
    const formId = req.params.id;
    const { data: all } = await sb.from('re_form_responses')
      .select('id,status,started_at,completed_at,abandoned_at,time_to_complete_seconds,last_active_at,metadata')
      .eq('form_id', formId);

    const rows = all || [];
    const total = rows.length;
    const completed = rows.filter((row) => row.status === 'completed').length;
    const abandoned = rows.filter((row) => row.abandoned_at != null || row.status === 'abandoned').length;
    const inProgress = total - completed - abandoned;

    const completedRows = rows.filter((row) => row.time_to_complete_seconds != null);
    const avgTime = completedRows.length
      ? Math.round(completedRows.reduce((sum, row) => sum + row.time_to_complete_seconds, 0) / completedRows.length)
      : null;

    const completionRate = total > 0 ? Math.round((completed / total) * 100) : 0;
    const abandonmentRate = total > 0 ? Math.round((abandoned / total) * 100) : 0;

    const cutoff = new Date(Date.now() - 30 * 24 * 3600 * 1000).toISOString();
    const recentRows = rows.filter((row) => row.started_at >= cutoff);
    const dailyMap = {};
    for (const row of recentRows) {
      const day = row.started_at.slice(0, 10);
      dailyMap[day] = (dailyMap[day] || 0) + 1;
    }
    const dailyStarts = Object.entries(dailyMap)
      .map(([date, count]) => ({ date, count }))
      .sort((left, right) => left.date.localeCompare(right.date));

    res.json({
      total,
      completed,
      abandoned,
      in_progress: inProgress,
      completion_rate: completionRate,
      abandonment_rate: abandonmentRate,
      avg_time_seconds: avgTime,
      daily_starts: dailyStarts,
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.post('/api/admin/forms/:id/responses/:responseId/abandon', requireAdmin, async (req, res) => {
  try {
    await sb.from('re_form_responses').update({
      status: 'abandoned',
      abandoned_at: new Date().toISOString(),
    }).eq('id', req.params.responseId).eq('form_id', req.params.id);
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;