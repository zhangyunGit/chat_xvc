import { html } from "../ui";

export function handleHomeRoute(): Response {
  return new Response(html, {
    headers: { "content-type": "text/html; charset=utf-8" }
  });
}

