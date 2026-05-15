import { badRequest } from "../http/json";
import { chunkText, createSseResponse, sleep } from "../http/sse";
import { ChatService } from "../services/chat-service";
import type { ChatRequest } from "../types/chat";

export async function handleChatRoute(request: Request, env: Env): Promise<Response> {
  const body = await request.json<ChatRequest>().catch((): ChatRequest => ({}));
  const message = body.message?.trim();

  if (!message) {
    return badRequest("message is required");
  }

  const chatService = new ChatService(env);

  return createSseResponse(async (writer) => {
    const result = await chatService.createAssistantReply({
      message,
      conversationId: body.conversationId,
      userId: body.userId
    });

    writer.send({
      type: "meta",
      userId: result.userId,
      conversationId: result.conversationId
    });

    for (const chunk of chunkText(result.reply)) {
      writer.sendDelta(chunk);
      await sleep(20);
    }
  });
}
