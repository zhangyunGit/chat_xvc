import type { LLMProvider } from "../providers/llm-provider";
import { createIntentRouterMessages } from "../prompts/intent-router-prompt";
import type { ChatMessage } from "../types/chat";
import type { IntentDecision, IntentName, IntentRouteInput } from "../types/intent";
import { knownIntentNames } from "./intent-registry";
import { createFallbackClarification, createIntentDecision } from "./intent-utils";

export type LlmIntentRoute = {
  decision: IntentDecision;
  promptMessages: ChatMessage[];
  responseText: string;
};

export class LlmIntentRouter {
  constructor(private readonly llmProvider: LLMProvider) {}

  async route(input: IntentRouteInput): Promise<LlmIntentRoute> {
    const promptMessages = createIntentRouterMessages(input);
    const responseText = await this.llmProvider.chat(promptMessages);
    const parsed = parseIntentClassifierJson(responseText);

    if (!parsed || !knownIntentNames.has(parsed.intent)) {
      return {
        decision: createFallbackClarification("你是想管理任务、查询资料，还是普通提问？"),
        promptMessages,
        responseText
      };
    }

    return {
      decision: createIntentDecision({
        intent: parsed.intent,
        confidence: parsed.confidence,
        entities: parsed.entities,
        needsClarification: parsed.needsClarification,
        clarificationQuestion: parsed.clarificationQuestion,
        source: "llm"
      }),
      promptMessages,
      responseText
    };
  }
}

type ParsedIntentJson = {
  intent: IntentName;
  confidence: number;
  entities: Record<string, unknown>;
  needsClarification: boolean;
  clarificationQuestion?: string;
};

function parseIntentClassifierJson(text: string): ParsedIntentJson | null {
  const candidate = extractJsonObject(text);
  if (!candidate) return null;

  try {
    const value = JSON.parse(candidate) as Partial<ParsedIntentJson>;

    if (typeof value.intent !== "string") return null;

    return {
      intent: value.intent as IntentName,
      confidence: typeof value.confidence === "number" ? value.confidence : 0.5,
      entities: isRecord(value.entities) ? value.entities : {},
      needsClarification: Boolean(value.needsClarification),
      clarificationQuestion:
        typeof value.clarificationQuestion === "string" ? value.clarificationQuestion : undefined
    };
  } catch {
    return null;
  }
}

function extractJsonObject(text: string): string | null {
  const fenced = text.match(/```(?:json)?\s*(\{[\s\S]*?\})\s*```/i);
  if (fenced?.[1]) return fenced[1];

  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start === -1 || end === -1 || end <= start) return null;

  return text.slice(start, end + 1);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
