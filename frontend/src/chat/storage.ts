export const storageKeys = {
  userId: "chat-xvc:user-id",
  conversationId: "chat-xvc:conversation-id"
} as const;

export function getStoredSession() {
  return {
    userId: localStorage.getItem(storageKeys.userId),
    conversationId: localStorage.getItem(storageKeys.conversationId)
  };
}

export function storeSession(input: { userId?: string | null; conversationId?: string | null }) {
  if (input.userId) localStorage.setItem(storageKeys.userId, input.userId);
  if (input.conversationId) localStorage.setItem(storageKeys.conversationId, input.conversationId);
}
