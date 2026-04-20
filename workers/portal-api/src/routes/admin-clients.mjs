import { requireAdmin } from '../lib/auth.mjs';
import { json, methodNotAllowed } from '../lib/http.mjs';

// Exemplo básico: lista de clientes mockada
const mockClients = [
  { id: 1, name: 'Cliente Exemplo 1', email: 'cliente1@exemplo.com' },
  { id: 2, name: 'Cliente Exemplo 2', email: 'cliente2@exemplo.com' },
];

export async function onRequest(context) {
  const { request, env } = context;
  if (request.method !== 'GET') return methodNotAllowed();

  // Autorização admin
  const auth = await requireAdmin(request, env);
  if (!auth.ok) return auth.response;

  // Aqui você pode buscar clientes reais do banco, se desejar
  return json({ clients: mockClients });
}
