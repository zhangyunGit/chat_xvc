export type ChatRole = "system" | "user" | "assistant";

export type ChatMessage = {
  role: ChatRole;
  content: string;
};

export type ChatRequest = {
  message?: string;
  conversationId?: string;
  userId?: string;
};

export type ChatInput = {
  message: string;
  conversationId?: string;
  userId?: string;
};

export type ChatServiceResult = {
  reply: string;
  userId: string;
  conversationId: string;
};

export type ChatChunk = {
  delta: string;
};

export type ChatMetaChunk = {
  type: "meta";
  userId: string;
  conversationId: string;
};

export type ChatErrorChunk = {
  error: string;
};
