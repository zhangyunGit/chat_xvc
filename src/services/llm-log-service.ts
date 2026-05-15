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
    queryText: string;
    responseText: string;
    promptMessages: ChatMessage[];
  }): Promise<void> {
    try {
      await this.llmLogRepository.create({
        userId: input.user.id,
        userName: input.user.name,
        userEmail: input.user.email,
        modelName: this.env.DEFAULT_CHAT_MODEL,
        queryText: input.queryText,
        responseText: input.responseText,
        promptJson: JSON.stringify({
          model: this.env.DEFAULT_CHAT_MODEL,
          messages: input.promptMessages
        })
      });
    } catch (error) {
      console.error("Failed to persist LLM call log", error);
    }
  }
}
