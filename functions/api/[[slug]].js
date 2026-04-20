export async function onRequest(context) {
  const { request, params } = context;
  const incomingUrl = new URL(request.url);

  // Reconstroi o path a partir de params.slug (array)
  const path = params.slug ? params.slug.join('/') : '';
  const workerUrl = `https://api-edge.recuperaempresas.com.br/api/${path}${incomingUrl.search}`;

  // Clona a requisição para o novo destino
  const newRequest = new Request(workerUrl, {
    method: request.method,
    headers: request.headers,
    body: request.body,
  });

  // Faz o fetch para o Worker
  const response = await fetch(newRequest);
  return response;
}
