import type { ChatMessage } from "../types/chat";
import type { EmbeddingProvider } from "./embedding-provider";
import type { LLMProvider } from "./llm-provider";
import { describeWorkersAiResultShape, parseWorkersAiTextResult } from "./workers-ai-response";

type WorkersAiEmbeddingResult = {
  data?: unknown;
};

export class WorkersAiProvider implements LLMProvider, EmbeddingProvider {
  constructor(private readonly env: Env) {}

  async chat(messages: ChatMessage[]): Promise<string> {
    const result = (await this.env.AI.run(this.env.DEFAULT_CHAT_MODEL, {
      messages
    })) as unknown;

    const text = parseWorkersAiTextResult(result);

    if (text) {
      return text;
    }

    throw new Error(
      `Workers AI response did not contain assistant text (${describeWorkersAiResultShape(result)})`
    );
  }

  async embed(texts: string[]): Promise<number[][]> {
    const result = (await this.env.AI.run(this.env.DEFAULT_EMBEDDING_MODEL, {
      text: texts
    })) as WorkersAiEmbeddingResult;

    if (!Array.isArray(result.data)) {
      return [];
    }

    return result.data.filter(isNumberArray);
  }
}

function isNumberArray(value: unknown): value is number[] {
  return Array.isArray(value) && value.every((item) => typeof item === "number");
}
