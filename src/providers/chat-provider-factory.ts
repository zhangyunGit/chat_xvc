import { AiGatewayProvider } from "./ai-gateway-provider";
import type { LLMProvider } from "./llm-provider";
import { WorkersAiProvider } from "./workers-ai-provider";

export function createChatProvider(env: Env): LLMProvider {
  if (env.DEFAULT_CHAT_RUNTIME === "workers-ai" || env.DEFAULT_CHAT_MODEL.startsWith("@cf/")) {
    return new WorkersAiProvider(env);
  }

  return new AiGatewayProvider(env);
}
