export async function onRequest(context) {
  const { request, params } = context;

  // Reconstruct the path from params.slug (array)
  const path = params.slug ? params.slug.join('/') : '';
  const workerUrl = `https://api-edge.recuperaempresas.com.br/api/${path}`;

  // Clone the request with the new URL
  const newRequest = new Request(workerUrl, {
    method: request.method,
    headers: request.headers,
    body: request.body,
    // Copy other properties if needed
  });

  // Fetch from the Worker
  const response = await fetch(newRequest);

  // Return the response, but modify headers if needed
  const newResponse = new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers: response.headers,
  });

  return newResponse;
}
