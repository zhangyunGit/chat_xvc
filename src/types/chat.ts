export type ChatRole = "system" | "user" | "assistant";

export type ChatContentPart =
  | {
      type: "text";
      text: string;
    }
  | {
      type: "image_url";
      image_url: {
        url: string;
        detail?: "auto" | "low" | "high";
      };
    };

export type ChatMessage = {
  role: ChatRole;
  content: string | ChatContentPart[];
};

export type ChatImageInput = {
  name?: string;
  contentType?: string;
  size?: number;
  dataUrl: string;
};

export type ChatVideoFrameInput = {
  timestampSec: number;
  width?: number;
  height?: number;
  dataUrl: string;
};

export type ChatVideoInput = {
  name?: string;
  contentType?: string;
  size?: number;
  durationSec?: number;
  frames: ChatVideoFrameInput[];
};

export type ChatAudioInput = {
  name?: string;
  contentType?: string;
  size?: number;
  dataUrl: string;
};

export type ChatRequest = {
  message?: string;
  conversationId?: string;
  userId?: string;
  forceWebSearch?: boolean;
  forceDeepResearch?: boolean;
  images?: ChatImageInput[];
  videos?: ChatVideoInput[];
  audios?: ChatAudioInput[];
};

export type ChatInput = {
  message: string;
  conversationId?: string;
  userId?: string;
  forceWebSearch?: boolean;
  forceDeepResearch?: boolean;
  images?: ChatImageInput[];
  videos?: ChatVideoInput[];
  audios?: ChatAudioInput[];
};

export type ChatServiceResult = {
  reply: string;
  userId: string;
  conversationId: string;
  requestId?: string;
  ui?: ChatUiPayload;
  streamed?: boolean;
};

export type ChatChunk = {
  delta: string;
};

export type ChatMetaChunk = {
  type: "meta";
  userId: string;
  conversationId: string;
  requestId?: string;
};

export type ChatStatusPhase = "intent_routing" | "tool_running" | "external_search" | "model_thinking" | "complete";

export type ChatStatusChunk = {
  type: "status";
  phase: ChatStatusPhase;
  label: string;
};

export type ChatUiTask = {
  id: string;
  title: string;
  detail: string;
  status: string;
  statusLabel: string;
  priority: string;
  priorityLabel: string;
  dueAt: string | null;
  requirements: Array<{
    id: string;
    content: string;
  }>;
};

export type ChatUiFile = {
  id: string;
  filename: string;
  contentType: string | null;
  size: number;
  status: string;
  createdAt: string;
  updatedAt: string;
};

export type ChatUiSource = {
  chunkId: string;
  fileId: string;
  filename: string;
  sectionPath: string | null;
  chunkIndex: number;
  score: number;
  preview: string;
};

export type ChatUiWebResult = {
  title: string;
  link: string;
  snippet: string;
  source: string | null;
  date: string | null;
  position: number;
};

export type ChatUiResearchStep = {
  id: string;
  title: string;
  query: string;
  status: "pending" | "active" | "success" | "fail";
  summary?: string;
};

export type ChatUiThink = {
  id: string;
  title: string;
  content: string;
  isDone: boolean;
  thinkTime?: number;
};

export type ChatUiPayload = {
  tasks?: ChatUiTask[];
  files?: ChatUiFile[];
  sources?: ChatUiSource[];
  webResults?: ChatUiWebResult[];
  researchSteps?: ChatUiResearchStep[];
  thinks?: ChatUiThink[];
  thinkStart?: ChatUiThink;
  thinkDelta?: {
    id: string;
    delta: string;
  };
  thinkDone?: {
    id: string;
    thinkTime?: number;
  };
};

export type ChatErrorChunk = {
  error: string;
};
