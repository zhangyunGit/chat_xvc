import { badRequest, json } from "../http/json";
import { MemoryService } from "../services/memory-service";
import type { UserMemory } from "../types/domain";

export async function handleMemoriesRoute(request: Request, env: Env): Promise<Response> {
  const memoryId = getMemoryIdFromPath(request);

  if (request.method === "GET") {
    if (memoryId) return new Response("Method not allowed", { status: 405 });
    return handleListMemories(request, env);
  }

  if (request.method === "DELETE") {
    if (!memoryId) return badRequest("memoryId is required");
    return handleDeleteMemory(request, env, memoryId);
  }

  return new Response("Method not allowed", { status: 405 });
}

async function handleListMemories(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  const userId = url.searchParams.get("userId");
  if (!userId) return badRequest("userId is required");

  const memoryService = new MemoryService(env);
  const memories = await memoryService.listMemories(userId);

  return json({
    userId,
    memories: memories.map(toPublicMemory)
  });
}

async function handleDeleteMemory(request: Request, env: Env, memoryId: string): Promise<Response> {
  const url = new URL(request.url);
  const userId = url.searchParams.get("userId");
  if (!userId) return badRequest("userId is required");

  const memoryService = new MemoryService(env);
  const memory = await memoryService.deleteMemoryById({ userId, memoryId });
  if (!memory) return badRequest("memory not found");

  return json({
    userId,
    memory: toPublicMemory(memory)
  });
}

function toPublicMemory(memory: UserMemory) {
  return {
    id: memory.id,
    content: memory.content,
    kind: memory.kind,
    confidence: memory.confidence,
    createdAt: memory.createdAt,
    updatedAt: memory.updatedAt
  };
}

function getMemoryIdFromPath(request: Request): string | null {
  const pathname = new URL(request.url).pathname;
  const prefix = "/api/memories/";

  if (!pathname.startsWith(prefix)) return null;

  const memoryId = decodeURIComponent(pathname.slice(prefix.length)).trim();
  return memoryId || null;
}
