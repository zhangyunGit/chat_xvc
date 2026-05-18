export type UserProfile = {
  id: string;
  email: string | null;
  name: string | null;
  aiNickname: string;
  profileStatus: "pending" | "completed" | "skipped";
  createdAt: string;
  updatedAt: string;
};

export type UserProfilePatch = {
  email?: string;
  name?: string;
  aiNickname?: string;
  profileStatus?: UserProfile["profileStatus"];
};

export type Conversation = {
  id: string;
  userId: string | null;
  title: string | null;
  createdAt: string;
  updatedAt: string;
};

export type MessageRole = "user" | "assistant" | "system";

export type ConversationMessage = {
  id: string;
  conversationId: string;
  role: MessageRole;
  content: string;
  intent: string | null;
  createdAt: string;
};

export type MemoryKind =
  | "preference"
  | "fact"
  | "instruction"
  | "project_context"
  | "conversation"
  | "conversation_summary"
  | "other";

export type MemoryStatus = "active" | "deleted";

export type UserMemory = {
  id: string;
  userId: string;
  content: string;
  kind: MemoryKind;
  vectorId: string;
  sourceMessageId: string | null;
  confidence: number;
  status: MemoryStatus;
  embeddingModel: string;
  createdAt: string;
  updatedAt: string;
};

export type CreateMemoryInput = {
  id?: string;
  userId: string;
  content: string;
  kind: MemoryKind;
  vectorId: string;
  sourceMessageId?: string | null;
  confidence?: number;
  embeddingModel?: string;
};

export type TaskStatus = "open" | "in_progress" | "done" | "cancelled";

export type TaskPriority = "low" | "medium" | "high";

export type Task = {
  id: string;
  userId: string;
  title: string;
  detail: string;
  status: TaskStatus;
  priority: TaskPriority;
  dueAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export type TaskRequirement = {
  id: string;
  taskId: string;
  content: string;
  createdAt: string;
  updatedAt: string;
};

export type TaskWithRequirements = Task & {
  requirements: TaskRequirement[];
};

export type UploadedFileStatus = "uploaded" | "processing" | "indexed" | "failed" | "deleted";

export type UploadedFile = {
  id: string;
  userId: string;
  r2Key: string;
  filename: string;
  contentType: string | null;
  size: number;
  status: UploadedFileStatus;
  processingError: string | null;
  indexedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export type CreateUploadedFileInput = {
  id?: string;
  userId: string;
  r2Key: string;
  filename: string;
  contentType?: string | null;
  size: number;
  status?: UploadedFileStatus;
};

export type DocumentChunk = {
  id: string;
  fileId: string;
  userId: string;
  chunkIndex: number;
  content: string;
  vectorId: string;
  tokenEstimate: number;
  embeddingModel: string;
  contentHash: string;
  metadataJson: string | null;
  sectionPath: string | null;
  charStart: number | null;
  charEnd: number | null;
  parentChunkId: string | null;
  createdAt: string;
};

export type CreateDocumentChunkInput = {
  id?: string;
  fileId: string;
  userId: string;
  chunkIndex: number;
  content: string;
  vectorId: string;
  tokenEstimate: number;
  embeddingModel: string;
  contentHash: string;
  metadataJson?: string | null;
  sectionPath?: string | null;
  charStart?: number | null;
  charEnd?: number | null;
  parentChunkId?: string | null;
};

export type CreateTaskInput = {
  userId: string;
  title: string;
  detail: string;
  priority?: TaskPriority;
  dueAt?: string | null;
};

export type UpdateTaskInput = {
  title?: string;
  detail?: string;
  status?: TaskStatus;
  priority?: TaskPriority;
  dueAt?: string | null;
};

export type LlmCallLogInput = {
  requestId?: string | null;
  conversationId?: string | null;
  userId: string;
  userName: string | null;
  userEmail: string | null;
  modelName: string;
  stage?: string | null;
  intent?: string | null;
  provider?: string | null;
  status?: "success" | "error" | "skipped";
  durationMs?: number | null;
  errorText?: string | null;
  queryText: string;
  responseText: string;
  promptJson: string;
};
