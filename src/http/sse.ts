import type { ChatErrorChunk } from "../types/chat";

type SseWriter = {
  send(data: unknown): void;
  sendDelta(delta: string): void;
  sendError(error: string): void;
  done(): void;
};

const encoder = new TextEncoder();

export function createSseResponse(handler: (writer: SseWriter) => Promise<void>): Response {
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const writer = createWriter(controller);

      try {
        await handler(writer);
        writer.done();
      } catch (error) {
        writer.sendError(error instanceof Error ? error.message : "Unknown error");
      } finally {
        controller.close();
      }
    }
  });

  return new Response(stream, {
    headers: {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-cache, no-transform",
      connection: "keep-alive"
    }
  });
}

export function chunkText(text: string, size = 18): string[] {
  const chunks: string[] = [];

  for (let index = 0; index < text.length; index += size) {
    chunks.push(text.slice(index, index + size));
  }

  return chunks;
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function createWriter(controller: ReadableStreamDefaultController<Uint8Array>): SseWriter {
  return {
    send(data: unknown) {
      controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`));
    },
    sendDelta(delta: string) {
      this.send({ delta });
    },
    sendError(error: string) {
      const payload: ChatErrorChunk = { error };
      this.send(payload);
    },
    done() {
      controller.enqueue(encoder.encode("data: [DONE]\n\n"));
    }
  };
}

