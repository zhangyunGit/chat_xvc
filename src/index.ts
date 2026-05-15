import { routeRequest } from "./routes";

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    return routeRequest(request, env);
  }
};
