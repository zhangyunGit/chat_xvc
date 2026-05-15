import { notFound } from "../http/json";
import { handleChatRoute } from "./chat";
import { handleHealthRoute } from "./health";
import { handleHomeRoute } from "./home";
import { handleSessionRoute } from "./session";

export async function routeRequest(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);

  if (request.method === "GET" && url.pathname === "/") {
    return handleHomeRoute();
  }

  if (request.method === "GET" && url.pathname === "/api/health") {
    return handleHealthRoute(env);
  }

  if (request.method === "GET" && url.pathname === "/api/session") {
    return handleSessionRoute(request, env);
  }

  if (request.method === "POST" && url.pathname === "/api/chat") {
    return handleChatRoute(request, env);
  }

  return notFound();
}
