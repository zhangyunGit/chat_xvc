import type { LlmCallLogInput } from "../types/domain";

export class LlmLogRepository {
  constructor(private readonly db: D1Database) {}

  async create(input: LlmCallLogInput): Promise<void> {
    await this.db
      .prepare(
        `INSERT INTO llm_call_logs (
          id,
          request_id,
          conversation_id,
          user_id,
          user_name,
          user_email,
          model_name,
          stage,
          intent,
          provider,
          status,
          duration_ms,
          error_text,
          query_text,
          response_text,
          prompt_json
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .bind(
        crypto.randomUUID(),
        input.requestId ?? null,
        input.conversationId ?? null,
        input.userId,
        input.userName,
        input.userEmail,
        input.modelName,
        input.stage ?? null,
        input.intent ?? null,
        input.provider ?? null,
        input.status ?? "success",
        input.durationMs ?? null,
        input.errorText ?? null,
        input.queryText,
        input.responseText,
        input.promptJson
      )
      .run();
  }
}
