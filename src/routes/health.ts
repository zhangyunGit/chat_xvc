import { json } from "../http/json";

export function handleHealthRoute(env: Env): Response {
  return json({
    ok: true,
    app: env.APP_NAME,
    runtime: "cloudflare-workers"
  });
}

