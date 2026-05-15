export function json(data: unknown, init?: ResponseInit): Response {
  return Response.json(data, init);
}

export function badRequest(message: string): Response {
  return json({ error: message }, { status: 400 });
}

export function notFound(): Response {
  return new Response("Not found", { status: 404 });
}

