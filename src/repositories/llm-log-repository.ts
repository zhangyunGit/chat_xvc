import type { LlmCallLogInput } from "../types/domain";

export class LlmLogRepository {
  constructor(private readonly db: D1Database) {}

  async create(input: LlmCallLogInput): Promise<void> {
    await this.db
      .prepare(
        `INSERT INTO llm_call_logs (
          id,
          user_id,
          user_name,
          user_email,
          model_name,
          query_text,
          response_text,
          prompt_json
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .bind(
        crypto.randomUUID(),
        input.userId,
        input.userName,
        input.userEmail,
        input.modelName,
        input.queryText,
        input.responseText,
        input.promptJson
      )
      .run();
  }
}

