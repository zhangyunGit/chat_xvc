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
  userId: string;
  userName: string | null;
  userEmail: string | null;
  modelName: string;
  queryText: string;
  responseText: string;
  promptJson: string;
};
