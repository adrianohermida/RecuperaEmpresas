'use strict';

const express = require('express');

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

const router = express.Router();

router.get('/api/services', requireAuth, async (req, res) => {
  try {
    const { data: services } = await sb.from('re_services')
      .select('id,name,description,category,price_cents,features,delivery_days,featured')
      .eq('active', true)
      .order('featured', { ascending: false })
      .order('created_at');
    res.json({ services: services || [] });
  } catch (e) {
    res.json({ services: [] });
  }
});

router.get('/api/services/:id', requireAuth, async (req, res) => {
  try {
    const { data: service } = await sb.from('re_services')
      .select('*')
      .eq('id', req.params.id)
      .eq('active', true)
      .single();
    if (!service) return res.status(404).json({ error: 'Serviço não encontrado.' });
    res.json({ service });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.post('/api/services/:id/order', requireAuth, async (req, res) => {
  try {
    const { data: service } = await sb.from('re_services')
      .select('*')
      .eq('id', req.params.id)
      .eq('active', true)
      .single();
    if (!service) return res.status(404).json({ error: 'Serviço não encontrado.' });

    const serviceName = service.name || service.title || 'Serviço';

    const { data: invoice } = await sb.from('re_invoices').insert({
      user_id: req.user.id,
      description: `Serviço: ${serviceName}`,
      amount_cents: service.price_cents,
      due_date: new Date(Date.now() + 3 * 86400000).toISOString().split('T')[0],
      status: 'pending',
      payment_method: 'boleto',
      created_by: null,
    }).select().single();

    const { data: order, error: orderError } = await sb.from('re_service_orders').insert({
      user_id: req.user.id,
      service_id: service.id,
      amount_cents: service.price_cents,
      status: 'pending_payment',
      payment_method: 'boleto',
      invoice_id: invoice?.id || null,
      contracted_at: new Date().toISOString(),
    }).select().single();
    if (orderError) return res.status(500).json({ error: orderError.message });

    if (service.journey_id) {
      sb.from('re_journey_assignments').upsert({
        journey_id: service.journey_id,
        user_id: req.user.id,
        assigned_by: null,
        status: 'active',
        notes: `Atribuído automaticamente pela contratação do serviço "${serviceName}"`,
      }, { onConflict: 'journey_id,user_id' }).then(() => {}).catch((error) => console.warn('[async journey assign]', error?.message));
    }

    pushNotification(
      req.user.id,
      'service',
      'Pedido recebido!',
      `Seu pedido para "${serviceName}" foi registrado. Aguarde o boleto.`,
      'service_order',
      order?.id
    ).catch((error) => console.warn('[async]', error?.message));

    res.json({ success: true, order, invoice });
  } catch (e) {
    console.error('[SERVICE ORDER]', e.message);
    res.status(500).json({ error: e.message });
  }
});

router.get('/api/service-orders', requireAuth, async (req, res) => {
  try {
    const { data: orders } = await sb.from('re_service_orders')
      .select('*,re_services(name,category)')
      .eq('user_id', req.user.id)
      .order('created_at', { ascending: false });
    res.json({ orders: orders || [] });
  } catch (e) {
    res.json({ orders: [] });
  }
});

router.get('/api/admin/services', requireAdmin, async (req, res) => {
  try {
    const { data: services, error } = await selectWithColumnFallback('re_services', {
      columns: ['id', 'name', 'title', 'description', 'category', 'price_cents', 'price', 'delivery_days', 'features', 'featured', 'journey_id', 'active', 'created_by', 'created_at', 'updated_at'],
      requiredColumns: ['id'],
      orderBy: ['created_at', 'id'],
    });
    if (error) {
      if (isSchemaCompatibilityError(error.message, ['re_services', 'name', 'title', 'description', 'category', 'price_cents', 'price', 'delivery_days', 'features', 'featured', 'journey_id', 'active', 'created_by'])) {
        console.warn('[ADMIN SERVICES] returning empty list due to schema mismatch:', error.message);
        return res.json({ services: [] });
      }
      throw error;
    }
    res.json({ services: services || [] });
  } catch (e) {
    res.json({ services: [] });
  }
});

router.post('/api/admin/services', requireAdmin, async (req, res) => {
  try {
    const { name, description, category, price_cents, delivery_days, features, featured, journey_id } = req.body;
    if (!name || !price_cents) return res.status(400).json({ error: 'name e price_cents são obrigatórios.' });

    const parsedPriceCents = parseInt(price_cents, 10);
    const parsedPrice = parsedPriceCents / 100;
    const basePayload = {
      name,
      title: name,
      description,
      category,
      price_cents: parsedPriceCents,
      price: parsedPrice,
      delivery_days: delivery_days || null,
      features: features || null,
      featured: featured || false,
      journey_id: journey_id || null,
      active: true,
      created_by: req.user.id,
    };
    const cleanPayload = (payload) => Object.fromEntries(Object.entries(payload).filter(([, value]) => value !== undefined));
    const returningColumns = ['id', 'name', 'title', 'description', 'category', 'price_cents', 'price', 'delivery_days', 'features', 'featured', 'journey_id', 'active', 'created_by', 'created_at', 'updated_at'];
    const insertAttempts = [
      {
        payload: basePayload,
        requiredColumns: ['name', 'price_cents', 'active'],
        requiredReturningColumns: ['id', 'name', 'price_cents', 'active'],
      },
      {
        payload: { ...basePayload, category: null, journey_id: null, created_by: null },
        requiredColumns: ['name', 'price_cents', 'active'],
        requiredReturningColumns: ['id', 'name', 'price_cents', 'active'],
      },
      {
        payload: { ...basePayload, active: undefined, category: null, journey_id: null, created_by: null },
        requiredColumns: ['name', 'price_cents'],
        requiredReturningColumns: ['id', 'name', 'price_cents'],
      },
      {
        payload: { title: name, description, price_cents: parsedPriceCents, delivery_days: delivery_days || null, features: features || null, featured: featured || false, category: null },
        requiredColumns: ['title', 'price_cents'],
        requiredReturningColumns: ['id', 'title', 'price_cents'],
      },
      {
        payload: { title: name, description, price: parsedPrice, delivery_days: delivery_days || null, features: features || null, featured: featured || false, category: null },
        requiredColumns: ['title', 'price'],
        requiredReturningColumns: ['id', 'title', 'price'],
      },
      {
        payload: { name, description, price: parsedPrice, delivery_days: delivery_days || null, features: features || null, featured: featured || false, category: null },
        requiredColumns: ['name', 'price'],
        requiredReturningColumns: ['id', 'name', 'price'],
      },
    ];

    let insertResult = null;
    for (const attempt of insertAttempts) {
      insertResult = await insertWithColumnFallback('re_services', cleanPayload(attempt.payload), {
        requiredColumns: attempt.requiredColumns,
        returningColumns,
        requiredReturningColumns: attempt.requiredReturningColumns,
      });
      if (!insertResult.error) break;
    }

    const { data: rawService, error } = insertResult;
    if (error) {
      if (isSchemaCompatibilityError(error.message, ['re_services', 'name', 'title', 'description', 'category', 'price_cents', 'price', 'delivery_days', 'features', 'featured', 'journey_id', 'active', 'created_by'])) {
        return res.status(503).json({
          error: 'Serviços temporariamente indisponíveis até concluir a atualização do banco.',
          diagnostic: buildRouteDiagnostic('/api/admin/services', error, insertAttempts),
        });
      }
      return res.status(500).json({ error: error.message });
    }

    const service = {
      ...rawService,
      name: rawService?.name || rawService?.title || name,
      title: rawService?.title || rawService?.name || name,
      price_cents: rawService?.price_cents ?? parsedPriceCents,
      price: rawService?.price ?? parsedPrice,
      active: rawService?.active ?? true,
      description: rawService?.description ?? description ?? null,
      category: rawService?.category ?? category ?? null,
      featured: rawService?.featured ?? !!featured,
      journey_id: rawService?.journey_id ?? journey_id ?? null,
    };
    auditLog({
      actorId: req.user.id,
      actorEmail: req.user.email,
      actorRole: 'admin',
      entityType: 'service',
      entityId: service.id,
      action: 'create',
      after: { name, price_cents },
    }).catch((error) => console.warn('[async]', error?.message));
    res.json({ success: true, service });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.put('/api/admin/services/:id', requireAdmin, async (req, res) => {
  try {
    const { active, name, description, price_cents, category, featured, journey_id } = req.body;
    const updates = {};
    if (active !== undefined) updates.active = active;
    if (name !== undefined) {
      updates.name = name;
      updates.title = name;
    }
    if (description !== undefined) updates.description = description;
    if (price_cents !== undefined) {
      updates.price_cents = parseInt(price_cents, 10);
      updates.price = parseInt(price_cents, 10) / 100;
    }
    if (category !== undefined) updates.category = category;
    if (featured !== undefined) updates.featured = featured;
    if (journey_id !== undefined) updates.journey_id = journey_id || null;

    let updateResult = await updateWithColumnFallback('re_services', { id: req.params.id }, updates, {
      returningColumns: ['id', 'name', 'title', 'description', 'category', 'price_cents', 'price', 'delivery_days', 'features', 'featured', 'journey_id', 'active', 'created_by', 'created_at', 'updated_at'],
      requiredReturningColumns: ['id', 'name', 'price_cents', 'active'],
    });
    if (updateResult.error && category !== undefined && /invalid input value.*category|violates .*category/i.test(String(updateResult.error.message || ''))) {
      updateResult = await updateWithColumnFallback('re_services', { id: req.params.id }, { ...updates, category: null }, {
        returningColumns: ['id', 'name', 'title', 'description', 'category', 'price_cents', 'price', 'delivery_days', 'features', 'featured', 'journey_id', 'active', 'created_by', 'created_at', 'updated_at'],
        requiredReturningColumns: ['id', 'name', 'price_cents', 'active'],
      });
    }
    if (updateResult.error && journey_id !== undefined && /journey_id/i.test(String(updateResult.error.message || ''))) {
      updateResult = await updateWithColumnFallback('re_services', { id: req.params.id }, { ...updates, journey_id: null }, {
        returningColumns: ['id', 'name', 'title', 'description', 'category', 'price_cents', 'price', 'delivery_days', 'features', 'featured', 'journey_id', 'active', 'created_by', 'created_at', 'updated_at'],
        requiredReturningColumns: ['id', 'name', 'price_cents', 'active'],
      });
    }

    const { data: service, error } = updateResult;
    if (error) {
      if (isSchemaCompatibilityError(error.message, ['re_services', 'name', 'title', 'description', 'category', 'price_cents', 'price', 'featured', 'journey_id', 'active'])) {
        return res.status(503).json({ error: 'Serviços temporariamente indisponíveis até concluir a atualização do banco.' });
      }
      return res.status(500).json({ error: error.message });
    }
    res.json({ success: true, service });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.get('/api/admin/service-orders', requireAdmin, async (req, res) => {
  try {
    const { data: orders } = await sb.from('re_service_orders')
      .select('*,re_users!re_service_orders_user_id_fkey(name,email),re_services(name,category)')
      .order('created_at', { ascending: false })
      .limit(200);
    res.json({ orders: orders || [] });
  } catch (e) {
    res.json({ orders: [] });
  }
});

router.put('/api/admin/service-orders/:id', requireAdmin, async (req, res) => {
  try {
    const { status, admin_notes, delivered_at } = req.body;
    const updates = { updated_at: new Date().toISOString() };
    if (status !== undefined) updates.status = status;
    if (admin_notes !== undefined) updates.admin_notes = admin_notes;
    if (delivered_at !== undefined) updates.delivered_at = delivered_at;
    if (status === 'active') updates.activated_at = new Date().toISOString();
    if (status === 'delivered') updates.completed_at = new Date().toISOString();
    if (status === 'cancelled') updates.cancelled_at = new Date().toISOString();

    const { data: order, error } = await sb.from('re_service_orders')
      .update(updates)
      .eq('id', req.params.id)
      .select()
      .single();
    if (error) return res.status(500).json({ error: error.message });

    const { data: orderDetails } = await sb.from('re_service_orders')
      .select('user_id,re_services(id,name,title,journey_id)')
      .eq('id', req.params.id)
      .single();
    const serviceName = orderDetails?.re_services?.name || orderDetails?.re_services?.title || 'Serviço';

    if (status === 'active' && orderDetails?.re_services?.journey_id && orderDetails?.user_id) {
      sb.from('re_journey_assignments').upsert({
        journey_id: orderDetails.re_services.journey_id,
        user_id: orderDetails.user_id,
        assigned_by: req.user.id,
        status: 'active',
        notes: `Ativado pelo consultor via pedido de serviço "${serviceName}"`,
      }, { onConflict: 'journey_id,user_id' }).then(() => {}).catch((error) => console.warn('[async journey assign]', error?.message));
    }

    if (status === 'active') {
      pushNotification(
        orderDetails?.user_id,
        'service',
        'Serviço ativo!',
        `"${serviceName}" foi ativado. Acesse Jornadas para ver as etapas.`,
        'service_order',
        req.params.id
      ).catch((error) => console.warn('[async]', error?.message));
    }
    if (status === 'delivered') {
      pushNotification(
        orderDetails?.user_id,
        'service',
        'Serviço entregue!',
        `"${serviceName}" foi concluído e entregue.`,
        'service_order',
        req.params.id
      ).catch((error) => console.warn('[async]', error?.message));
    }

    res.json({ success: true, order });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;