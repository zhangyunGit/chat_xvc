import { FileRepository } from "../repositories/file-repository";
import { DocumentChunkRepository } from "../repositories/document-chunk-repository";
import { VectorRepository } from "../repositories/vector-repository";
import type { UploadedFile } from "../types/domain";
import { UserService } from "./user-service";

export type FileUploadResult = {
  userId: string;
  files: UploadedFile[];
};

const maxFileSizeBytes = 25 * 1024 * 1024;

export class FileService {
  private readonly fileRepository: FileRepository;
  private readonly userService: UserService;

  constructor(private readonly env: Env) {
    this.fileRepository = new FileRepository(env.DB);
    this.userService = new UserService(env.DB);
  }

  async uploadFiles(input: {
    userId?: string;
    files: File[];
  }): Promise<FileUploadResult> {
    const userResolution = await this.userService.resolveUser({
      userId: input.userId,
      message: "",
      skipProfileExtraction: true
    });

    const uploadedFiles: UploadedFile[] = [];

    for (const file of input.files) {
      const fileId = crypto.randomUUID();
      const filename = sanitizeFilename(file.name || "untitled");
      const r2Key = createR2Key(userResolution.user.id, fileId, filename);

      if (file.size > maxFileSizeBytes) {
        throw new Error(`File ${filename} exceeds the 25 MB upload limit`);
      }

      await this.env.FILES.put(r2Key, file.stream(), {
        httpMetadata: {
          contentType: file.type || "application/octet-stream"
        },
        customMetadata: {
          userId: userResolution.user.id,
          originalFilename: filename
        }
      });

      const record = await this.fileRepository.create({
        id: fileId,
        userId: userResolution.user.id,
        r2Key,
        filename,
        contentType: file.type || "application/octet-stream",
        size: file.size,
        status: "uploaded"
      });

      uploadedFiles.push(record);
    }

    return {
      userId: userResolution.user.id,
      files: uploadedFiles
    };
  }

  async listFiles(userId: string): Promise<UploadedFile[]> {
    return this.fileRepository.listByUser(userId);
  }

  async deleteFile(input: {
    userId: string;
    fileId: string;
  }): Promise<UploadedFile> {
    const file = await this.fileRepository.findById(input.userId, input.fileId);
    if (!file || file.status === "deleted") {
      throw new Error("File not found");
    }

    const chunkRepository = new DocumentChunkRepository(this.env.DB);
    const vectorRepository = new VectorRepository(this.env.VECTORIZE);
    const chunks = await chunkRepository.listByFile(input.userId, input.fileId);

    await this.fileRepository.updateStatus({
      userId: input.userId,
      fileId: input.fileId,
      status: "deleted",
      processingError: null
    });
    await vectorRepository.deleteByIds(chunks.map((chunk) => chunk.vectorId));
    await chunkRepository.deleteByFile(input.userId, input.fileId);
    await this.env.FILES.delete(file.r2Key);

    const deletedFile = await this.fileRepository.findById(input.userId, input.fileId);
    if (!deletedFile) {
      throw new Error("Failed to delete file");
    }

    return deletedFile;
  }
}

function createR2Key(userId: string, fileId: string, filename: string): string {
  return `users/${userId}/files/${fileId}/${filename}`;
}

function sanitizeFilename(filename: string): string {
  return filename
    .replace(/[\\/]/g, "-")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 180) || "untitled";
}
