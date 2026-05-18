import { useCallback, useMemo, useRef, useState } from "react";
import { getStoredSession, storeSession } from "./storage";

export type UiTask = {
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

export type UiFile = {
  id: string;
  filename: string;
  contentType: string | null;
  size: number;
  status: string;
  createdAt: string;
  updatedAt: string;
};

export type UiSource = {
  chunkId: string;
  fileId: string;
  filename: string;
  sectionPath: string | null;
  chunkIndex: number;
  score: number;
  preview: string;
};

export type UiWebResult = {
  title: string;
  link: string;
  snippet: string;
  source: string | null;
  date: string | null;
  position: number;
};

export type UiResearchStep = {
  id: string;
  title: string;
  query: string;
  status: "pending" | "active" | "success" | "fail";
  summary?: string;
};

export type UiThink = {
  id: string;
  title: string;
  content: string;
  isDone: boolean;
  thinkTime?: number;
};

export type UiStatus = {
  phase: "intent_routing" | "tool_running" | "external_search" | "model_thinking";
  label: string;
};

export type ChatImageInput = {
  name: string;
  contentType: string;
  size: number;
  dataUrl: string;
};

export type ChatVideoInput = {
  name: string;
  contentType: string;
  size: number;
  durationSec: number;
  frames: Array<{
    timestampSec: number;
    width: number;
    height: number;
    dataUrl: string;
  }>;
};

export type ChatAudioInput = {
  name: string;
  contentType: string;
  size: number;
  dataUrl: string;
};

export type UiMessage = {
  id: string;
  role: "user" | "assistant";
  text: string;
  audios?: ChatAudioInput[];
  images?: ChatImageInput[];
  videos?: ChatVideoInput[];
  tasks?: UiTask[];
  files?: UiFile[];
  sources?: UiSource[];
  webResults?: UiWebResult[];
  researchSteps?: UiResearchStep[];
  thinks?: UiThink[];
  status?: UiStatus;
  streaming?: boolean;
};

type ChatMetaPayload = {
  type: "meta";
  userId?: string;
  conversationId?: string;
};

type ChatDeltaPayload = {
  delta?: string;
  error?: string;
};

type ChatStatusPayload = {
  type: "status";
  phase: UiStatus["phase"] | "complete";
  label: string;
};

type ChatUiPayload = {
  type: "ui";
  tasks?: UiTask[];
  files?: UiFile[];
  sources?: UiSource[];
  webResults?: UiWebResult[];
  researchSteps?: UiResearchStep[];
  thinks?: UiThink[];
  thinkStart?: UiThink;
  thinkDelta?: {
    id: string;
    delta: string;
  };
  thinkDone?: {
    id: string;
    thinkTime?: number;
  };
};

export function useSseChat(initialGreeting: string) {
  const [messages, setMessages] = useState<UiMessage[]>([
    {
      id: crypto.randomUUID(),
      role: "assistant",
      text: initialGreeting
    }
  ]);
  const [isStreaming, setIsStreaming] = useState(false);
  const sessionRef = useRef(getStoredSession());

  const replaceGreeting = useCallback((text: string) => {
    setMessages((current) => {
      const [firstMessage, ...restMessages] = current;
      if (!firstMessage || firstMessage.role !== "assistant") return current;
      return [{ ...firstMessage, text }, ...restMessages];
    });
  }, []);

  const appendAssistantText = useCallback((id: string, delta: string) => {
    setMessages((current) =>
      current.map((message) =>
        message.id === id ? { ...message, text: message.text + delta, status: undefined } : message
      )
    );
  }, []);

  const updateAssistantStatus = useCallback((id: string, status: UiStatus | null) => {
    setMessages((current) =>
      current.map((message) =>
        message.id === id ? { ...message, status: status ?? undefined } : message
      )
    );
  }, []);

  const attachAssistantTasks = useCallback((id: string, tasks: UiTask[]) => {
    setMessages((current) =>
      current.map((message) =>
        message.id === id ? { ...message, tasks } : message
      )
    );
  }, []);

  const attachAssistantFiles = useCallback((id: string, files: UiFile[]) => {
    setMessages((current) =>
      current.map((message) =>
        message.id === id ? { ...message, files } : message
      )
    );
  }, []);

  const attachAssistantSources = useCallback((id: string, sources: UiSource[]) => {
    setMessages((current) =>
      current.map((message) =>
        message.id === id ? { ...message, sources } : message
      )
    );
  }, []);

  const attachAssistantWebResults = useCallback((id: string, webResults: UiWebResult[]) => {
    setMessages((current) =>
      current.map((message) =>
        message.id === id ? { ...message, webResults } : message
      )
    );
  }, []);

  const attachAssistantResearchSteps = useCallback((id: string, researchSteps: UiResearchStep[]) => {
    setMessages((current) =>
      current.map((message) =>
        message.id === id ? { ...message, researchSteps } : message
      )
    );
  }, []);

  const attachAssistantThinks = useCallback((id: string, thinks: UiThink[]) => {
    setMessages((current) =>
      current.map((message) =>
        message.id === id ? { ...message, thinks } : message
      )
    );
  }, []);

  const startAssistantThink = useCallback((id: string, think: UiThink) => {
    setMessages((current) =>
      current.map((message) => {
        if (message.id !== id) return message;
        const existing = message.thinks ?? [];
        return {
          ...message,
          thinks: existing.some((item) => item.id === think.id)
            ? existing.map((item) => item.id === think.id ? { ...item, ...think } : item)
            : [...existing, think]
        };
      })
    );
  }, []);

  const appendAssistantThink = useCallback((id: string, thinkId: string, delta: string) => {
    setMessages((current) =>
      current.map((message) => {
        if (message.id !== id || !message.thinks) return message;
        return {
          ...message,
          thinks: message.thinks.map((think) =>
            think.id === thinkId ? { ...think, content: `${think.content}${delta}` } : think
          )
        };
      })
    );
  }, []);

  const finishAssistantThink = useCallback((id: string, thinkId: string, thinkTime?: number) => {
    setMessages((current) =>
      current.map((message) => {
        if (message.id !== id || !message.thinks) return message;
        return {
          ...message,
          thinks: message.thinks.map((think) =>
            think.id === thinkId ? { ...think, isDone: true, thinkTime } : think
          )
        };
      })
    );
  }, []);

  const removeFileFromMessages = useCallback((fileId: string) => {
    setMessages((current) =>
      current.map((message) =>
        message.files
          ? { ...message, files: message.files.filter((file) => file.id !== fileId) }
          : message
      )
    );
  }, []);

  const sendMessage = useCallback(
    async (
      text: string,
      options: {
        forceWebSearch?: boolean;
        forceDeepResearch?: boolean;
        audios?: ChatAudioInput[];
        images?: ChatImageInput[];
        videos?: ChatVideoInput[];
      } = {}
    ) => {
      const trimmed = text.trim();
      if (!trimmed || isStreaming) return;

      const assistantId = crypto.randomUUID();
      const attachmentNotes = [
        options.audios?.length ? `[已附加 ${options.audios.length} 段音频]` : "",
        options.images?.length ? `[已附加 ${options.images.length} 张图片]` : "",
        options.videos?.length
          ? `[已附加 ${options.videos.length} 个视频，提取 ${countVideoFrames(options.videos)} 个关键帧]`
          : ""
      ].filter(Boolean);
      const userText = attachmentNotes.length > 0
        ? [trimmed, ...attachmentNotes].join("\n")
        : trimmed;
      setMessages((current) => [
        ...current,
        {
          id: crypto.randomUUID(),
          role: "user",
          text: userText,
          audios: options.audios,
          images: options.images,
          videos: options.videos
        },
        { id: assistantId, role: "assistant", text: "", streaming: true }
      ]);
      setIsStreaming(true);

      try {
        const response = await fetch("/api/chat", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            message: trimmed,
            userId: sessionRef.current.userId,
            conversationId: sessionRef.current.conversationId,
            forceWebSearch: options.forceWebSearch === true,
            forceDeepResearch: options.forceDeepResearch === true,
            audios: options.audios ?? [],
            images: options.images ?? [],
            videos: options.videos ?? []
          })
        });

        if (!response.body) {
          throw new Error("当前浏览器不支持流式响应。");
        }

        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";

        while (true) {
          const { value, done } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });
          const events = buffer.split("\n\n");
          buffer = events.pop() ?? "";

          for (const eventText of events) {
            const line = eventText.split("\n").find((item) => item.startsWith("data: "));
            if (!line) continue;

            const data = line.slice(6);
            if (data === "[DONE]") continue;

            const payload = JSON.parse(data) as
              | ChatMetaPayload
              | ChatDeltaPayload
              | ChatStatusPayload
              | ChatUiPayload;

            if ("type" in payload && payload.type === "meta") {
              sessionRef.current = {
                userId: payload.userId ?? sessionRef.current.userId,
                conversationId: payload.conversationId ?? sessionRef.current.conversationId
              };
              storeSession(sessionRef.current);
            }

            if ("type" in payload && payload.type === "status") {
              if (payload.phase === "complete") {
                updateAssistantStatus(assistantId, null);
              } else {
                updateAssistantStatus(assistantId, {
                  phase: payload.phase,
                  label: payload.label
                });
              }
            }

            if ("type" in payload && payload.type === "ui" && payload.tasks) {
              attachAssistantTasks(assistantId, payload.tasks);
            }

            if ("type" in payload && payload.type === "ui" && payload.files) {
              attachAssistantFiles(assistantId, payload.files);
            }

            if ("type" in payload && payload.type === "ui" && payload.sources) {
              attachAssistantSources(assistantId, payload.sources);
            }

            if ("type" in payload && payload.type === "ui" && payload.webResults) {
              attachAssistantWebResults(assistantId, payload.webResults);
            }

            if ("type" in payload && payload.type === "ui" && payload.researchSteps) {
              attachAssistantResearchSteps(assistantId, payload.researchSteps);
            }

            if ("type" in payload && payload.type === "ui" && payload.thinks) {
              attachAssistantThinks(assistantId, payload.thinks);
            }

            if ("type" in payload && payload.type === "ui" && payload.thinkStart) {
              startAssistantThink(assistantId, payload.thinkStart);
            }

            if ("type" in payload && payload.type === "ui" && payload.thinkDelta) {
              appendAssistantThink(assistantId, payload.thinkDelta.id, payload.thinkDelta.delta);
            }

            if ("type" in payload && payload.type === "ui" && payload.thinkDone) {
              finishAssistantThink(assistantId, payload.thinkDone.id, payload.thinkDone.thinkTime);
            }

            if ("delta" in payload && payload.delta) appendAssistantText(assistantId, payload.delta);
            if ("error" in payload && payload.error) appendAssistantText(assistantId, `\n错误：${payload.error}`);
          }
        }
      } catch (error) {
        appendAssistantText(
          assistantId,
          error instanceof Error ? `连接失败：${error.message}` : "连接失败：未知错误"
        );
      } finally {
        setIsStreaming(false);
        setMessages((current) =>
          current.map((message) =>
            message.id === assistantId ? { ...message, streaming: false } : message
          )
        );
      }
    },
    [
      appendAssistantText,
      attachAssistantFiles,
      attachAssistantSources,
      attachAssistantTasks,
      attachAssistantWebResults,
      attachAssistantResearchSteps,
      attachAssistantThinks,
      appendAssistantThink,
      finishAssistantThink,
      isStreaming,
      startAssistantThink,
      updateAssistantStatus
    ]
  );

  return useMemo(
    () => ({
      messages,
      isStreaming,
      sendMessage,
      replaceGreeting,
      removeFileFromMessages,
      sessionRef
    }),
    [messages, isStreaming, sendMessage, replaceGreeting, removeFileFromMessages]
  );
}

function countVideoFrames(videos: ChatVideoInput[]): number {
  return videos.reduce((total, video) => total + video.frames.length, 0);
}
