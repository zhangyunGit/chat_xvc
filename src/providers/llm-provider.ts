import type { ChatMessage } from "../types/chat";

export interface LLMProvider {
  chat(messages: ChatMessage[]): Promise<string>;
}

