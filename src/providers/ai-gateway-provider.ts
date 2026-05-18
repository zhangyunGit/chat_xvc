import type { ChatMessage } from "../types/chat";
import type { LLMChatOptions, LLMProvider } from "./llm-provider";

type AiGatewayChatCompletion = {
  choices?: Array<{
    message?: {
      content?: unknown;
      reasoning_content?: unknown;
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

  async chat(messages: ChatMessage[], options: LLMChatOptions = {}): Promise<string> {
    const provider = options.provider ?? resolveProvider(this.env);
    const model = resolveGatewayModel(this.env, provider, options.model);
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
        `AI Gateway chat failed: ${response.status} ${response.statusText} (${model}) ${providerMessage}`
      );
    }

    const assistantText = parseAssistantText(parsed);
    if (!assistantText) {
      throw new Error(`AI Gateway response did not contain assistant text (${model})`);
    }

    return assistantText;
  }

  async chatStream(
    messages: ChatMessage[],
    options: LLMChatOptions = {},
    onDelta: (delta: string) => void | Promise<void>
  ): Promise<string> {
    const provider = options.provider ?? resolveProvider(this.env);
    const model = resolveGatewayModel(this.env, provider, options.model);
    const apiKey = resolveApiKey(this.env, provider);
    const endpoint = `https://gateway.ai.cloudflare.com/v1/${this.env.CLOUDFLARE_ACCOUNT_ID}/${this.env.AI_GATEWAY_ID}/compat/chat/completions`;
    const response = await fetch(endpoint, {
      method: "POST",
      headers: createHeaders(provider, apiKey),
      body: JSON.stringify({
        model,
        messages,
        stream: true
      })
    });

    if (!response.ok || !response.body) {
      const responseText = await response.text();
      const parsed = parseJson(responseText);
      const providerMessage = parsed?.error?.message ?? responseText;
      throw new Error(
        `AI Gateway stream failed: ${response.status} ${response.statusText} (${model}) ${providerMessage}`
      );
    }

    return readChatCompletionStream(response.body, onDelta);
  }
}

function resolveProvider(env: Env): GatewayProviderName {
  const configured = env.DEFAULT_CHAT_PROVIDER?.trim();
  if (configured === "google-ai-studio" || configured === "gemini") return "google-ai-studio";
  return "deepseek";
}

function resolveGatewayModel(env: Env, provider: GatewayProviderName, overrideModel?: string): string {
  const configuredModel = normalizeGatewayModel(provider, (overrideModel ?? env.DEFAULT_CHAT_MODEL).trim());
  const providerPrefix = `${provider}/`;

  return configuredModel.startsWith(providerPrefix)
    ? configuredModel
    : `${provider}/${configuredModel.replace(/^(deepseek|google-ai-studio|gemini)\//, "")}`;
}

function normalizeGatewayModel(provider: GatewayProviderName, model: string): string {
  let normalized = model;
  if (provider === "google-ai-studio" && normalized.startsWith("gemini/")) {
    normalized = normalized.replace(/^gemini\//, "google-ai-studio/");
  }

  if (provider === "deepseek") {
    normalized = normalized
      .replace(/^deepseek\/deepseek\//, "deepseek/")
      .replace(/deepseek-v4-pro\[1m\]$/, "deepseek-v4-pro");
  }

  return normalized;
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
          if (isRecord(item) && typeof item.output_text === "string") return item.output_text;
          return "";
        })
        .join("")
        .trim();

      if (text) return text;
    }

    if (typeof choice.message?.reasoning_content === "string" && choice.message.reasoning_content.trim()) {
      return choice.message.reasoning_content;
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

async function readChatCompletionStream(
  body: ReadableStream<Uint8Array>,
  onDelta: (delta: string) => void | Promise<void>
): Promise<string> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let text = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const events = buffer.split("\n\n");
    buffer = events.pop() ?? "";

    for (const eventText of events) {
      const lines = eventText
        .split("\n")
        .map((line) => line.trim())
        .filter((line) => line.startsWith("data:"));

      for (const line of lines) {
        const data = line.slice(5).trim();
        if (!data || data === "[DONE]") continue;

        const delta = parseStreamDelta(data);
        if (delta) {
          text += delta;
          await onDelta(delta);
        }
      }
    }
  }

  return text.trim();
}

function parseStreamDelta(data: string): string {
  try {
    const parsed = JSON.parse(data) as {
      choices?: Array<{
        delta?: {
          content?: unknown;
          reasoning_content?: unknown;
        };
        text?: unknown;
      }>;
      output_text?: unknown;
    };

    if (typeof parsed.output_text === "string") return parsed.output_text;

    return (parsed.choices ?? [])
      .map((choice) => {
        if (typeof choice.delta?.content === "string") return choice.delta.content;
        if (typeof choice.delta?.reasoning_content === "string") return choice.delta.reasoning_content;
        if (typeof choice.text === "string") return choice.text;
        return "";
      })
      .join("");
  } catch {
    return "";
  }
}
