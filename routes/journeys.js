'use strict';

const express = require('express');
const { sb } = require('../lib/config');
const { requireAuth, requireAdmin } = require('../lib/auth');
const { isSchemaCompatibilityError } = require('../lib/schema');

const router = express.Router();

router.get('/api/admin/journeys', requireAdmin, async (req, res) => {
  try {
    const { data } = await sb.from('re_journeys')
      .select('*')
      .order('created_at', { ascending: false });
    res.json(data || []);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.get('/api/admin/journeys/:id', requireAdmin, async (req, res) => {
  try {
    const { data: journey } = await sb.from('re_journeys')
      .select('*').eq('id', req.params.id).single();
    if (!journey) return res.status(404).json({ error: 'Jornada não encontrada.' });

    const { data: steps } = await sb.from('re_journey_steps')
      .select('*,re_forms(id,title,type,status)')
      .eq('journey_id', req.params.id)
      .order('order_index', { ascending: true });

    res.json({ ...journey, steps: steps || [] });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.post('/api/admin/journeys', requireAdmin, async (req, res) => {
  try {
    const { name, description, status } = req.body;
    if (!name) return res.status(400).json({ error: 'Nome é obrigatório.' });
    const { data } = await sb.from('re_journeys').insert({
      name,
      description: description || null,
      status: status || 'draft',
      created_by: req.user.id,
    }).select().single();
    res.json(data);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.put('/api/admin/journeys/:id', requireAdmin, async (req, res) => {
  try {
    const { name, description, status } = req.body;
    const updates = {};
    if (name !== undefined) updates.name = name;
    if (description !== undefined) updates.description = description;
    if (status !== undefined) updates.status = status;
    const { data } = await sb.from('re_journeys').update(updates).eq('id', req.params.id).select().single();
    res.json(data);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.delete('/api/admin/journeys/:id', requireAdmin, async (req, res) => {
  try {
    const journeyId = req.params.id;
    const { data: journey } = await sb.from('re_journeys').select('is_system').eq('id', journeyId).maybeSingle();
    if (journey?.is_system) return res.status(403).json({ error: 'Jornadas do sistema não podem ser excluídas.' });

    const [{ data: steps, error: stepsListError }, { data: assignments, error: assignmentsListError }] = await Promise.all([
      sb.from('re_journey_steps').select('id').eq('journey_id', journeyId),
      sb.from('re_journey_assignments').select('id').eq('journey_id', journeyId),
    ]);

    if (stepsListError) throw stepsListError;
    if (assignmentsListError) throw assignmentsListError;

    const stepIds = (steps || []).map((step) => step.id).filter(Boolean);
    const assignmentIds = (assignments || []).map((assignment) => assignment.id).filter(Boolean);

    const { error: unlinkServicesError } = await sb.from('re_services')
      .update({ journey_id: null })
      .eq('journey_id', journeyId);
    if (unlinkServicesError && !isSchemaCompatibilityError(unlinkServicesError.message, ['re_services', 'journey_id'])) throw unlinkServicesError;

    if (assignmentIds.length) {
      const { error: completionsByAssignmentError } = await sb.from('re_journey_step_completions')
        .delete()
        .in('assignment_id', assignmentIds);
      if (completionsByAssignmentError && !isSchemaCompatibilityError(completionsByAssignmentError.message, ['re_journey_step_completions', 'assignment_id'])) throw completionsByAssignmentError;
    }

    if (stepIds.length) {
      const { error: completionsByStepError } = await sb.from('re_journey_step_completions')
        .delete()
        .in('step_id', stepIds);
      if (completionsByStepError && !isSchemaCompatibilityError(completionsByStepError.message, ['re_journey_step_completions', 'step_id'])) throw completionsByStepError;
    }

    if (assignmentIds.length) {
      const { error: assignmentsError } = await sb.from('re_journey_assignments')
        .delete()
        .eq('journey_id', journeyId);
      if (assignmentsError) throw assignmentsError;
    }

    if (stepIds.length) {
      const { error: stepsError } = await sb.from('re_journey_steps')
        .delete()
        .eq('journey_id', journeyId);
      if (stepsError) throw stepsError;
    }

    const { error: journeyDeleteError } = await sb.from('re_journeys').delete().eq('id', journeyId);
    if (journeyDeleteError) throw journeyDeleteError;

    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.post('/api/admin/journeys/:id/steps', requireAdmin, async (req, res) => {
  try {
    const { title, description, form_id, is_optional, unlock_condition } = req.body;
    if (!title) return res.status(400).json({ error: 'Título da etapa é obrigatório.' });

    const { count } = await sb.from('re_journey_steps')
      .select('id', { count: 'exact', head: true }).eq('journey_id', req.params.id);

    const { data } = await sb.from('re_journey_steps').insert({
      journey_id: req.params.id,
      form_id: form_id || null,
      title,
      description: description || null,
      order_index: count || 0,
      is_optional: !!is_optional,
      unlock_condition: unlock_condition || {},
    }).select().single();
    res.json(data);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.put('/api/admin/journeys/:id/steps/:stepId', requireAdmin, async (req, res) => {
  try {
    const { title, description, form_id, is_optional, order_index, unlock_condition } = req.body;
    const updates = {};
    if (title !== undefined) updates.title = title;
    if (description !== undefined) updates.description = description;
    if (form_id !== undefined) updates.form_id = form_id || null;
    if (is_optional !== undefined) updates.is_optional = !!is_optional;
    if (order_index !== undefined) updates.order_index = order_index;
    if (unlock_condition !== undefined) updates.unlock_condition = unlock_condition;
    const { data } = await sb.from('re_journey_steps')
      .update(updates).eq('id', req.params.stepId).eq('journey_id', req.params.id).select().single();
    res.json(data);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.post('/api/admin/journeys/:id/steps/reorder', requireAdmin, async (req, res) => {
  try {
    const { order } = req.body;
    if (!Array.isArray(order)) return res.status(400).json({ error: 'order deve ser um array.' });
    for (const item of order) {
      await sb.from('re_journey_steps')
        .update({ order_index: item.order_index })
        .eq('id', item.id).eq('journey_id', req.params.id);
    }
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.delete('/api/admin/journeys/:id/steps/:stepId', requireAdmin, async (req, res) => {
  try {
    await sb.from('re_journey_steps').delete()
      .eq('id', req.params.stepId).eq('journey_id', req.params.id);
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.get('/api/admin/journeys/:id/assignments', requireAdmin, async (req, res) => {
  try {
    const { data } = await sb.from('re_journey_assignments')
      .select('*,re_users(id,name,email,company)')
      .eq('journey_id', req.params.id)
      .order('assigned_at', { ascending: false });
    res.json(data || []);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.post('/api/admin/journeys/:id/assignments', requireAdmin, async (req, res) => {
  try {
    const { user_id, notes } = req.body;
    if (!user_id) return res.status(400).json({ error: 'user_id é obrigatório.' });
    const { data } = await sb.from('re_journey_assignments').upsert({
      journey_id: req.params.id,
      user_id,
      assigned_by: req.user.id,
      status: 'active',
      notes: notes || null,
    }, { onConflict: 'journey_id,user_id' }).select().single();
    res.json(data);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.put('/api/admin/journeys/:id/assignments/:asnId', requireAdmin, async (req, res) => {
  try {
    const { status, notes, current_step_index } = req.body;
    const updates = {};
    if (status !== undefined) updates.status = status;
    if (notes !== undefined) updates.notes = notes;
    if (current_step_index !== undefined) updates.current_step_index = current_step_index;
    if (status === 'completed') updates.completed_at = new Date().toISOString();
    const { data } = await sb.from('re_journey_assignments')
      .update(updates).eq('id', req.params.asnId).eq('journey_id', req.params.id).select().single();
    res.json(data);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.delete('/api/admin/journeys/:id/assignments/:asnId', requireAdmin, async (req, res) => {
  try {
    await sb.from('re_journey_assignments')
      .delete().eq('id', req.params.asnId).eq('journey_id', req.params.id);
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.post('/api/admin/journeys/:id/assignments/:asnId/complete-step', requireAdmin, async (req, res) => {
  try {
    const { step_id, form_response_id, notes } = req.body;
    if (!step_id) return res.status(400).json({ error: 'step_id é obrigatório.' });

    await sb.from('re_journey_step_completions').upsert({
      assignment_id: req.params.asnId,
      step_id,
      form_response_id: form_response_id || null,
      notes: notes || null,
      completed_at: new Date().toISOString(),
    }, { onConflict: 'assignment_id,step_id' });

    const { data: steps } = await sb.from('re_journey_steps')
      .select('id,order_index').eq('journey_id', req.params.id).order('order_index');
    const completedIdx = steps?.findIndex((step) => step.id === step_id) ?? -1;
    const nextIdx = completedIdx + 1;
    if (nextIdx < (steps?.length || 0)) {
      await sb.from('re_journey_assignments')
        .update({ current_step_index: nextIdx }).eq('id', req.params.asnId);
    } else {
      await sb.from('re_journey_assignments')
        .update({ status: 'completed', completed_at: new Date().toISOString() })
        .eq('id', req.params.asnId);
    }
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.get('/api/admin/journeys/:id/assignments/:asnId/progress', requireAdmin, async (req, res) => {
  try {
    const { data: assignment } = await sb.from('re_journey_assignments')
      .select('*,re_users(name,email)').eq('id', req.params.asnId).single();
    if (!assignment) return res.status(404).json({ error: 'Atribuição não encontrada.' });

    const { data: steps } = await sb.from('re_journey_steps')
      .select('*,re_forms(id,title)').eq('journey_id', req.params.id).order('order_index');

    const { data: completions } = await sb.from('re_journey_step_completions')
      .select('step_id,completed_at,form_response_id').eq('assignment_id', req.params.asnId);
    const completionMap = {};
    for (const completion of (completions || [])) completionMap[completion.step_id] = completion;

    const stepsWithStatus = (steps || []).map((step) => ({
      ...step,
      completed: !!completionMap[step.id],
      completed_at: completionMap[step.id]?.completed_at || null,
      form_response_id: completionMap[step.id]?.form_response_id || null,
    }));

    res.json({ assignment, steps: stepsWithStatus });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.get('/api/my-journeys', requireAuth, async (req, res) => {
  try {
    const uid = req.user.id;
    const { data: assignments } = await sb.from('re_journey_assignments')
      .select('*,re_journeys(id,name,description,status)')
      .eq('user_id', uid).in('status', ['active', 'completed']);

    const { data: onboarding } = await sb.from('re_onboarding')
      .select('status').eq('user_id', uid).single();
    const onboardingDone = onboarding?.status === 'completed';

    const result = await Promise.all((assignments || []).map(async (assignment) => {
      const { data: steps } = await sb.from('re_journey_steps')
        .select('id,title,description,order_index,is_optional,form_id,re_forms(id,title,is_system,system_key)')
        .eq('journey_id', assignment.journey_id).order('order_index');

      const { data: completions } = await sb.from('re_journey_step_completions')
        .select('step_id,completed_at').eq('assignment_id', assignment.id);
      const doneSet = new Set((completions || []).map((completion) => completion.step_id));

      if (onboardingDone) {
        for (const step of (steps || [])) {
          if (step.re_forms?.system_key === 'onboarding_14steps' && !doneSet.has(step.id)) {
            await sb.from('re_journey_step_completions').upsert({
              assignment_id: assignment.id,
              step_id: step.id,
              completed_at: new Date().toISOString(),
              notes: 'Completado automaticamente via onboarding do portal',
            }, { onConflict: 'assignment_id,step_id' }).catch((error) => console.warn('[auto-complete step]', error?.message));
            doneSet.add(step.id);
            if (assignment.current_step_index === step.order_index) {
              const nextIdx = step.order_index + 1;
              await sb.from('re_journey_assignments')
                .update({ current_step_index: nextIdx }).eq('id', assignment.id)
                .catch((error) => console.warn('[auto-advance journey]', error?.message));
              assignment.current_step_index = nextIdx;
            }
          }
        }
      }

      return {
        assignment_id: assignment.id,
        journey_id: assignment.journey_id,
        journey_name: assignment.re_journeys?.name,
        journey_description: assignment.re_journeys?.description,
        status: assignment.status,
        current_step_index: assignment.current_step_index,
        assigned_at: assignment.assigned_at,
        completed_at: assignment.completed_at,
        steps: (steps || []).map((step) => ({
          ...step,
          completed: doneSet.has(step.id),
        })),
        progress_pct: steps?.length ? Math.round((doneSet.size / steps.length) * 100) : 0,
      };
    }));
    res.json(result);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.post('/api/my-journeys/:asnId/complete-step', requireAuth, async (req, res) => {
  try {
    const uid = req.user.id;
    const { step_id, form_response_id } = req.body;
    if (!step_id) return res.status(400).json({ error: 'step_id é obrigatório.' });

    const { data: assignment } = await sb.from('re_journey_assignments')
      .select('id,journey_id').eq('id', req.params.asnId).eq('user_id', uid).single();
    if (!assignment) return res.status(403).json({ error: 'Sem acesso.' });

    await sb.from('re_journey_step_completions').upsert({
      assignment_id: req.params.asnId,
      step_id,
      form_response_id: form_response_id || null,
      completed_at: new Date().toISOString(),
    }, { onConflict: 'assignment_id,step_id' });

    const { data: steps } = await sb.from('re_journey_steps')
      .select('id,order_index').eq('journey_id', assignment.journey_id).order('order_index');
    const currentIdx = steps?.findIndex((step) => step.id === step_id) ?? -1;
    const nextIdx = currentIdx + 1;
    if (nextIdx < (steps?.length || 0)) {
      await sb.from('re_journey_assignments')
        .update({ current_step_index: nextIdx }).eq('id', req.params.asnId);
    } else {
      await sb.from('re_journey_assignments')
        .update({ status: 'completed', completed_at: new Date().toISOString() })
        .eq('id', req.params.asnId);
    }
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;
