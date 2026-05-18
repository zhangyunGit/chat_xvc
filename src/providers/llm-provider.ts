import type { ChatMessage } from "../types/chat";

export type LLMChatOptions = {
  provider?: "deepseek" | "google-ai-studio";
  model?: string;
};

export interface LLMProvider {
  chat(messages: ChatMessage[], options?: LLMChatOptions): Promise<string>;
  chatStream?(
    messages: ChatMessage[],
    options: LLMChatOptions | undefined,
    onDelta: (delta: string) => void | Promise<void>
  ): Promise<string>;
}
