import { LlmLogRepository } from "../repositories/llm-log-repository";
import type { ChatMessage } from "../types/chat";
import type { UserProfile } from "../types/domain";

export class LlmLogService {
  private readonly llmLogRepository: LlmLogRepository;

  constructor(private readonly env: Env) {
    this.llmLogRepository = new LlmLogRepository(env.DB);
  }

  async logCall(input: {
    user: UserProfile;
    requestId?: string | null;
    conversationId?: string | null;
    stage?: string | null;
    intent?: string | null;
    provider?: string | null;
    modelName?: string | null;
    status?: "success" | "error" | "skipped";
    durationMs?: number | null;
    errorText?: string | null;
    queryText: string;
    responseText: string;
    promptMessages?: ChatMessage[];
  }): Promise<void> {
    if (!isLlmLoggingEnabled(this.env)) {
      return;
    }

    const provider = input.provider ?? this.env.DEFAULT_CHAT_PROVIDER;
    const modelName = input.modelName ?? this.env.DEFAULT_CHAT_MODEL;

    try {
      await this.llmLogRepository.create({
        requestId: input.requestId ?? null,
        conversationId: input.conversationId ?? null,
        userId: input.user.id,
        userName: input.user.name,
        userEmail: input.user.email,
        modelName,
        stage: input.stage ?? null,
        intent: input.intent ?? null,
        provider,
        status: input.status ?? "success",
        durationMs: input.durationMs ?? null,
        errorText: input.errorText ?? null,
        queryText: input.queryText,
        responseText: input.responseText,
        promptJson: JSON.stringify({
          requestId: input.requestId ?? null,
          conversationId: input.conversationId ?? null,
          stage: input.stage ?? null,
          intent: input.intent ?? null,
          provider,
          model: modelName,
          status: input.status ?? "success",
          durationMs: input.durationMs ?? null,
          errorText: input.errorText ?? null,
          messages: input.promptMessages ?? []
        })
      });
    } catch (error) {
      console.error("Failed to persist LLM call log", error);
    }
  }
}

function isLlmLoggingEnabled(env: Env): boolean {
  const value = env.LLM_LOGGING_ENABLED;
  if (value === undefined || value === null || value === "") return true;
  return !/^(0|false|off|no|disabled)$/i.test(value.trim());
}
