import { html } from "../ui";

export async function handleHomeRoute(request: Request, env: Env): Promise<Response> {
  if (env.ASSETS) {
    try {
      return await env.ASSETS.fetch(request);
    } catch {
    }
  }

  return new Response(html, {
    headers: { "content-type": "text/html; charset=utf-8" }
  });
}
