import { createProfileIntakeMessages } from "../prompts/profile-intake-prompt";
import type { LLMProvider } from "../providers/llm-provider";
import type { ChatMessage } from "../types/chat";
import type { UserProfile } from "../types/domain";
import type { RecentIntentMessage } from "../types/intent";

export type ProfileIntakeDecision = {
  name: string | null;
  email: string | null;
  aiNickname: string | null;
  refused: boolean;
  ignored: boolean;
  shouldContinueNormalChat: boolean;
  confidence: number;
};

export type ProfileIntakeResult = {
  decision: ProfileIntakeDecision;
  promptMessages: ChatMessage[];
  responseText: string;
};

export class ProfileIntakeAgent {
  constructor(private readonly llmProvider: LLMProvider) {}

  async extract(input: {
    user: UserProfile;
    message: string;
    recentMessages: RecentIntentMessage[];
  }): Promise<ProfileIntakeResult> {
    const promptMessages = createProfileIntakeMessages(input);
    const responseText = await this.llmProvider.chat(promptMessages);
    const decision = parseProfileIntakeJson(responseText) ?? createEmptyDecision();

    return {
      decision,
      promptMessages,
      responseText
    };
  }
}

function parseProfileIntakeJson(text: string): ProfileIntakeDecision | null {
  const candidate = extractJsonObject(text);
  if (!candidate) return null;

  try {
    const value = JSON.parse(candidate) as Partial<ProfileIntakeDecision>;
    return {
      name: cleanName(value.name),
      email: cleanEmail(value.email),
      aiNickname: cleanAiNickname(value.aiNickname),
      refused: Boolean(value.refused),
      ignored: Boolean(value.ignored),
      shouldContinueNormalChat: Boolean(value.shouldContinueNormalChat),
      confidence: typeof value.confidence === "number" ? value.confidence : 0.5
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

function createEmptyDecision(): ProfileIntakeDecision {
  return {
    name: null,
    email: null,
    aiNickname: null,
    refused: false,
    ignored: true,
    shouldContinueNormalChat: true,
    confidence: 0
  };
}

function cleanName(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const name = value.trim();
  if (!name || name.length > 40) return null;
  return name;
}

function cleanEmail(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const email = value.trim().toLowerCase();
  return /^[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}$/i.test(email) ? email : null;
}

function cleanAiNickname(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const nickname = value.trim();
  if (!nickname || nickname.length > 30) return null;
  return nickname;
}
