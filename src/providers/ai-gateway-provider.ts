import type { ChatMessage } from "../types/chat";
import type { LLMProvider } from "./llm-provider";

type AiGatewayChatCompletion = {
  choices?: Array<{
    message?: {
      content?: unknown;
    };
    text?: unknown;
  }>;
  output_text?: unknown;
  error?: {
    message?: string;
  };
};

type GatewayProviderName = "deepseek" | "google-ai-studio";

export class AiGatewayProvider implements LLMProvider {
  constructor(private readonly env: Env) {}

  async chat(messages: ChatMessage[]): Promise<string> {
    const provider = resolveProvider(this.env);
    const model = resolveGatewayModel(this.env, provider);
    const apiKey = resolveApiKey(this.env, provider);
    const endpoint = `https://gateway.ai.cloudflare.com/v1/${this.env.CLOUDFLARE_ACCOUNT_ID}/${this.env.AI_GATEWAY_ID}/compat/chat/completions`;
    const response = await fetch(endpoint, {
      method: "POST",
      headers: createHeaders(provider, apiKey),
      body: JSON.stringify({
        model,
        messages,
        stream: false
      })
    });

    const responseText = await response.text();
    const parsed = parseJson(responseText);

    if (!response.ok) {
      const providerMessage = parsed?.error?.message ?? responseText;
      throw new Error(
        `AI Gateway chat failed: ${response.status} ${response.statusText} (${provider}/${model}) ${providerMessage}`
      );
    }

    const assistantText = parseAssistantText(parsed);
    if (!assistantText) {
      throw new Error(`AI Gateway response did not contain assistant text (${provider}/${model})`);
    }

    return assistantText;
  }
}

function resolveProvider(env: Env): GatewayProviderName {
  const configured = env.DEFAULT_CHAT_PROVIDER?.trim();
  if (configured === "google-ai-studio" || configured === "gemini") return "google-ai-studio";
  return "deepseek";
}

function resolveGatewayModel(env: Env, provider: GatewayProviderName): string {
  const configuredModel = env.DEFAULT_CHAT_MODEL.trim();

  if (configuredModel.includes("/")) {
    return configuredModel;
  }

  return `${provider}/${configuredModel}`;
}

function resolveApiKey(env: Env, provider: GatewayProviderName): string {
  const apiKey = provider === "google-ai-studio" ? env.GEMINI_API_KEY : env.DEEPSEEK_API_KEY;

  if (!apiKey) {
    throw new Error(
      provider === "google-ai-studio"
        ? "GEMINI_API_KEY is not configured"
        : "DEEPSEEK_API_KEY is not configured"
    );
  }

  return apiKey;
}

function createHeaders(provider: GatewayProviderName, apiKey: string): HeadersInit {
  const headers: Record<string, string> = {
    "content-type": "application/json",
    authorization: `Bearer ${apiKey}`
  };

  if (provider === "google-ai-studio") {
    headers["x-goog-api-key"] = apiKey;
  }

  return headers;
}

function parseAssistantText(response: AiGatewayChatCompletion | null): string | null {
  if (!response) return null;

  if (typeof response.output_text === "string" && response.output_text.trim()) {
    return response.output_text;
  }

  for (const choice of response.choices ?? []) {
    if (typeof choice.message?.content === "string" && choice.message.content.trim()) {
      return choice.message.content;
    }

    if (Array.isArray(choice.message?.content)) {
      const text = choice.message.content
        .map((item) => {
          if (typeof item === "string") return item;
          if (isRecord(item) && typeof item.text === "string") return item.text;
          return "";
        })
        .join("")
        .trim();

      if (text) return text;
    }

    if (typeof choice.text === "string" && choice.text.trim()) {
      return choice.text;
    }
  }

  return null;
}

function parseJson(text: string): AiGatewayChatCompletion | null {
  try {
    return JSON.parse(text) as AiGatewayChatCompletion;
  } catch {
    return null;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
