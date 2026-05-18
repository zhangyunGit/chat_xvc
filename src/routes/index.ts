import { notFound } from "../http/json";
import { handleChatRoute } from "./chat";
import { handleFilesRoute } from "./files";
import { handleHealthRoute } from "./health";
import { handleHomeRoute } from "./home";
import { handleMemoriesRoute } from "./memories";
import { handleSessionRoute } from "./session";

export async function routeRequest(request: Request, env: Env, ctx?: ExecutionContext): Promise<Response> {
  const url = new URL(request.url);

  if (request.method === "GET" && url.pathname === "/") {
    return handleHomeRoute(request, env);
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

  if (url.pathname === "/api/files" || url.pathname.startsWith("/api/files/")) {
    return handleFilesRoute(request, env, ctx);
  }

  if (url.pathname === "/api/memories" || url.pathname.startsWith("/api/memories/")) {
    return handleMemoriesRoute(request, env);
  }

  if (request.method === "GET" && !url.pathname.startsWith("/api/")) {
    return handleHomeRoute(request, env);
  }

  return notFound();
}
