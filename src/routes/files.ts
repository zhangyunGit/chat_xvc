import { badRequest, json } from "../http/json";
import { DocumentProcessingService } from "../services/document-processing-service";
import { FileService } from "../services/file-service";

const maxUploadFiles = 12;

export async function handleFilesRoute(request: Request, env: Env, ctx?: ExecutionContext): Promise<Response> {
  const fileId = getFileIdFromPath(request);

  if (request.method === "POST") {
    if (fileId) return new Response("Method not allowed", { status: 405 });
    return handleUploadFiles(request, env, ctx);
  }

  if (request.method === "GET") {
    if (fileId) return new Response("Method not allowed", { status: 405 });
    return handleListFiles(request, env);
  }

  if (request.method === "DELETE") {
    if (!fileId) return badRequest("fileId is required");
    return handleDeleteFile(request, env, fileId);
  }

  return new Response("Method not allowed", { status: 405 });
}

async function handleUploadFiles(request: Request, env: Env, ctx?: ExecutionContext): Promise<Response> {
  const contentType = request.headers.get("content-type") ?? "";
  if (!contentType.includes("multipart/form-data")) {
    return badRequest("multipart/form-data is required");
  }

  const formData = await request.formData();
  const userId = getOptionalString(formData.get("userId"));
  const files = collectUploadedFiles(formData.getAll("files"));

  if (files.length === 0) {
    return badRequest("at least one file is required");
  }

  if (files.length > maxUploadFiles) {
    return badRequest(`at most ${maxUploadFiles} files can be uploaded at once`);
  }

  const fileService = new FileService(env);
  const result = await fileService.uploadFiles({ userId, files }).catch((error) => {
    if (error instanceof Error && /upload limit|exceeds/i.test(error.message)) {
      return error;
    }
    throw error;
  });

  if (result instanceof Error) {
    return badRequest(result.message);
  }

  const processingService = new DocumentProcessingService(env);
  const processingPromise = Promise.all(
    result.files.map((file) => processingService.processFile(file.id))
  ).then(() => undefined);

  if (ctx) {
    ctx.waitUntil(processingPromise);
  } else {
    processingPromise.catch(() => undefined);
  }

  return json({
    userId: result.userId,
    files: result.files.map(toPublicFile)
  });
}

async function handleListFiles(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  const userId = url.searchParams.get("userId");
  if (!userId) {
    return badRequest("userId is required");
  }

  const fileService = new FileService(env);
  const files = await fileService.listFiles(userId);

  return json({
    userId,
    files: files.map(toPublicFile)
  });
}

async function handleDeleteFile(request: Request, env: Env, fileId: string): Promise<Response> {
  const url = new URL(request.url);
  const userId = url.searchParams.get("userId");
  if (!userId) {
    return badRequest("userId is required");
  }

  const fileService = new FileService(env);
  const deletedFile = await fileService.deleteFile({ userId, fileId }).catch((error) => {
    if (error instanceof Error && /not found/i.test(error.message)) {
      return error;
    }
    throw error;
  });

  if (deletedFile instanceof Error) {
    return badRequest(deletedFile.message);
  }

  return json({
    userId,
    file: toPublicFile(deletedFile)
  });
}

function toPublicFile(file: {
  id: string;
  filename: string;
  contentType: string | null;
  size: number;
  status: string;
  createdAt: string;
  updatedAt: string;
}) {
  return {
    id: file.id,
    filename: file.filename,
    contentType: file.contentType,
    size: file.size,
    status: file.status,
    createdAt: file.createdAt,
    updatedAt: file.updatedAt
  };
}

function collectUploadedFiles(values: unknown[]): File[] {
  return values.filter((value): value is File => value instanceof File && value.size > 0);
}

function getOptionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function getFileIdFromPath(request: Request): string | null {
  const pathname = new URL(request.url).pathname;
  const prefix = "/api/files/";

  if (!pathname.startsWith(prefix)) return null;

  const fileId = decodeURIComponent(pathname.slice(prefix.length)).trim();
  return fileId || null;
}
