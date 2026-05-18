import { badRequest } from "../http/json";
import { chunkText, createSseResponse, sleep } from "../http/sse";
import { ChatService } from "../services/chat-service";
import type { ChatRequest } from "../types/chat";

export async function handleChatRoute(request: Request, env: Env): Promise<Response> {
  const body = await request.json<ChatRequest>().catch((): ChatRequest => ({}));
  const images = Array.isArray(body.images) ? body.images : [];
  const videos = Array.isArray(body.videos) ? body.videos : [];
  const audios = Array.isArray(body.audios) ? body.audios : [];
  const message = body.message?.trim() || (
    audios.length > 0
      ? "请将这段音频转写成文字。"
      : videos.length > 0
      ? "请基于视频关键帧总结视频内容，并提取画面中的文字和关键信息。"
      : images.length > 0
      ? "请理解这张图片，并提取其中的文字和关键信息。"
      : ""
  );

  if (!message) {
    return badRequest("message is required");
  }

  const chatService = new ChatService(env);

  return createSseResponse(async (writer) => {
    const result = await chatService.createAssistantReply({
      message,
      conversationId: body.conversationId,
      userId: body.userId,
      forceWebSearch: body.forceWebSearch === true,
      forceDeepResearch: body.forceDeepResearch === true,
      images,
      videos,
      audios
    }, {
      onStatus: (status) => writer.sendStatus(status),
      onUi: (ui) => writer.send({ type: "ui", ...ui }),
      onDelta: (delta) => writer.sendDelta(delta)
    });

    writer.send({
      type: "meta",
      userId: result.userId,
      conversationId: result.conversationId,
      requestId: result.requestId
    });

    if (result.ui) {
      writer.send({
        type: "ui",
        ...result.ui
      });
    }

    if (!result.streamed) {
      for (const chunk of chunkText(result.reply)) {
        writer.sendDelta(chunk);
        await sleep(20);
      }
    }

    writer.sendStatus({
      phase: "complete",
      label: "完成"
    });
  });
}
