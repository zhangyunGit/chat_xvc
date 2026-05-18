import { Bubble, Carousel, Think, Typing } from "@chatui/core";
import { useEffect, useRef, useState } from "react";
import type { ClipboardEvent, DragEvent } from "react";
import { TaskCard } from "../components/TaskCard";
import { getStoredSession, storeSession } from "./storage";
import { useSseChat, type ChatAudioInput, type ChatImageInput, type ChatVideoInput, type UiMessage, type UiStatus } from "./useSseChat";

type SessionPayload = {
  greeting?: string;
};

type ComposerAttachment = {
  id: string;
  name: string;
  type: string;
  size: number;
  file: File;
};

type UploadFilesPayload = {
  userId: string;
  files: Array<{
    id: string;
    filename: string;
    contentType: string | null;
    size: number;
    status: string;
    createdAt: string;
    updatedAt: string;
  }>;
};

type ManagedMemory = {
  id: string;
  content: string;
  kind: string;
  confidence: number;
  createdAt: string;
  updatedAt: string;
};

const defaultGreeting =
  "你好，我是 XVC。你可以告诉我你的姓名和邮箱，方便我后续称呼你并保存你的任务；如果暂时不想提供，也可以直接开始使用。";

export function ChatWorkspace() {
  const [greeting, setGreeting] = useState(defaultGreeting);
  const [draft, setDraft] = useState("");
  const [deepThinking, setDeepThinking] = useState(false);
  const [smartSearch, setSmartSearch] = useState(false);
  const [isDraggingFile, setIsDraggingFile] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [isMemoryPanelOpen, setIsMemoryPanelOpen] = useState(false);
  const [isLoadingMemories, setIsLoadingMemories] = useState(false);
  const [memoryError, setMemoryError] = useState<string | null>(null);
  const [memories, setMemories] = useState<ManagedMemory[]>([]);
  const [attachments, setAttachments] = useState<ComposerAttachment[]>([]);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const messagesRef = useRef<HTMLDivElement | null>(null);
  const { messages, isStreaming, sendMessage, replaceGreeting, removeFileFromMessages, sessionRef } = useSseChat(greeting);

  useEffect(() => {
    const { userId } = getStoredSession();
    const query = userId ? `?userId=${encodeURIComponent(userId)}` : "";
    fetch(`/api/session${query}`)
      .then(async (response) => (await response.json()) as SessionPayload)
      .then((payload) => {
        if (payload.greeting) {
          setGreeting(payload.greeting);
          replaceGreeting(payload.greeting);
        }
      })
      .catch(() => {
        const fallbackGreeting = "你好，我是 XVC。需要我做什么吗~";
        setGreeting(fallbackGreeting);
        replaceGreeting(fallbackGreeting);
      });
  }, [replaceGreeting]);

  useEffect(() => {
    const node = messagesRef.current;
    if (!node) return;

    const frame = window.requestAnimationFrame(() => {
      node.scrollTo({
        top: node.scrollHeight,
        behavior: "smooth"
      });
    });

    return () => window.cancelAnimationFrame(frame);
  }, [messages]);

  function renderMessageContent(message: UiMessage) {
    const text = message.text;
    const streaming = Boolean(message.streaming);
    const status = message.status;
    const tasks = message.tasks ?? [];
    const files = message.files ?? [];
    const audioPreviews = message.audios ?? [];
    const imagePreviews = message.images ?? [];
    const videoPreviews = message.videos ?? [];
    const sources = message.sources ?? [];
    const webResults = message.webResults ?? [];
    const researchSteps = message.researchSteps ?? [];
    const thinks = message.thinks ?? [];
    const planThink = thinks.find((think) => think.id === "research-plan");
    const synthesisThink = thinks.find((think) => think.id === "research-synthesis");
    const otherThinks = thinks.filter((think) => think.id !== "research-plan" && think.id !== "research-synthesis");
    const isResearchMessage = researchSteps.length > 0 || thinks.length > 0 || webResults.length > 0;

    return (
      <div className="assistant-stack">
        {status ? <AssistantStatus status={status} /> : null}
        {isResearchMessage ? (
          <ResearchFlow
            text={text}
            status={status}
            streaming={streaming}
            planThink={planThink}
            synthesisThink={synthesisThink}
            otherThinks={otherThinks}
            steps={researchSteps}
            webResults={webResults}
          />
        ) : text ? (
          <Bubble content={text} />
        ) : null}
        {audioPreviews.length > 0 ? <AudioPreviewList audios={audioPreviews} /> : null}
        {imagePreviews.length > 0 ? <ImagePreviewGrid images={imagePreviews} /> : null}
        {videoPreviews.length > 0 ? <VideoKeyframePreview videos={videoPreviews} /> : null}
        {tasks && tasks.length > 0 ? (
          <div className="task-result-grid">
            {tasks.map((task) => (
              <TaskCard
                key={task.id}
                id={task.id}
                title={task.title}
                detail={task.detail}
                statusLabel={task.statusLabel}
                dueAt={task.dueAt ?? ""}
              />
            ))}
          </div>
        ) : null}
        {files.length > 0 ? (
          <div className="file-result-grid">
            {files.map((file) => (
              <FileResultCard key={file.id} file={file} onDelete={deleteUploadedFile} />
            ))}
          </div>
        ) : null}
        {sources.length > 0 ? (
          <DocumentSourceList sources={sources} />
        ) : null}
        {streaming && !status && !isResearchMessage ? <Typing /> : null}
      </div>
    );
  }

  async function submitMessage(text: string) {
    const trimmed = text.trim();
    if ((!trimmed && attachments.length === 0) || isStreaming || isUploading) return;

    setIsUploading(true);
    try {
      const imageAttachments = attachments.filter(isImageAttachment);
      const videoAttachments = attachments.filter(isVideoAttachment);
      const audioAttachments = attachments.filter(isAudioAttachment);
      const fileAttachments = attachments.filter(
        (attachment) => !isImageAttachment(attachment) && !isVideoAttachment(attachment) && !isAudioAttachment(attachment)
      );
      const audios = audioAttachments.length > 0
        ? await Promise.all(audioAttachments.map(toChatAudioInput))
        : [];
      const images = imageAttachments.length > 0
        ? await Promise.all(imageAttachments.map(toChatImageInput))
        : [];
      const videos = videoAttachments.length > 0
        ? await Promise.all(videoAttachments.map(toChatVideoInput))
        : [];
      const uploadedFiles = fileAttachments.length > 0
        ? await uploadAttachments(fileAttachments, sessionRef.current.userId)
        : null;
      if (uploadedFiles?.userId) {
        sessionRef.current = {
          ...sessionRef.current,
          userId: uploadedFiles.userId
        };
      }
      const uploadSummary = uploadedFiles && uploadedFiles.files.length > 0
        ? [
            `我已上传文件：${uploadedFiles.files.map((file) => file.filename).join("、")}。`,
            "上传文件元数据：",
            ...uploadedFiles.files.map((file) => `- ${file.filename} [fileId:${file.id}]`)
          ].join("\n")
        : "";
      const fallbackMessage = audios.length > 0
        ? "请将这段音频转写成文字。"
        : videos.length > 0
        ? "请基于视频关键帧总结视频内容，并提取画面中的文字和关键信息。"
        : images.length > 0
        ? "请理解这张图片，并提取其中的文字和关键信息。"
        : "请先保存这些文件，后续用于文档问答。";
      const message = [uploadSummary, trimmed || fallbackMessage]
        .filter(Boolean)
        .join("\n");

      setDraft("");
      setAttachments([]);
      void sendMessage(message, {
        forceWebSearch: smartSearch,
        forceDeepResearch: deepThinking,
        audios,
        images,
        videos
      });
    } catch (error) {
      window.alert(error instanceof Error ? error.message : "发送失败");
    } finally {
      setIsUploading(false);
    }
  }

  function addAttachments(files: FileList | File[]) {
    const nextAttachments = Array.from(files).map((file) => ({
      id: `${file.name}-${file.lastModified}-${crypto.randomUUID()}`,
      name: file.name || "粘贴图片",
      type: file.type || "application/octet-stream",
      size: file.size,
      file
    }));

    setAttachments((current) => [...current, ...nextAttachments].slice(0, 12));
  }

  function handlePaste(event: ClipboardEvent<HTMLTextAreaElement>) {
    if (event.clipboardData.files.length > 0) {
      addAttachments(event.clipboardData.files);
    }
  }

  function handleDragOver(event: DragEvent<HTMLFormElement>) {
    event.preventDefault();
    setIsDraggingFile(true);
  }

  function handleDragLeave(event: DragEvent<HTMLFormElement>) {
    if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
      setIsDraggingFile(false);
    }
  }

  function handleDrop(event: DragEvent<HTMLFormElement>) {
    event.preventDefault();
    setIsDraggingFile(false);
    if (event.dataTransfer.files.length > 0) {
      addAttachments(event.dataTransfer.files);
    }
  }

  function removeAttachment(id: string) {
    setAttachments((current) => current.filter((attachment) => attachment.id !== id));
  }

  async function deleteUploadedFile(file: NonNullable<UiMessage["files"]>[number]) {
    const userId = sessionRef.current.userId;
    if (!userId) {
      window.alert("当前会话还没有用户 ID，无法删除文件。");
      return;
    }

    const confirmed = window.confirm(`删除文件「${file.filename}」？这会同时删除原始文件和已索引的文档片段。`);
    if (!confirmed) return;

    try {
      const response = await fetch(`/api/files/${encodeURIComponent(file.id)}?userId=${encodeURIComponent(userId)}`, {
        method: "DELETE"
      });
      const payload = (await response.json()) as { error?: string };

      if (!response.ok) {
        throw new Error(payload.error ?? "文件删除失败");
      }

      removeFileFromMessages(file.id);
    } catch (error) {
      window.alert(error instanceof Error ? error.message : "文件删除失败");
    }
  }

  async function openMemoryPanel() {
    setIsMemoryPanelOpen(true);
    await loadMemories();
  }

  async function loadMemories() {
    const userId = sessionRef.current.userId;
    if (!userId) {
      setMemoryError("当前会话还没有用户 ID。先发送一条消息后再查看记忆。");
      setMemories([]);
      return;
    }

    setIsLoadingMemories(true);
    setMemoryError(null);
    try {
      const response = await fetch(`/api/memories?userId=${encodeURIComponent(userId)}`);
      const payload = (await response.json()) as { memories?: ManagedMemory[]; error?: string };
      if (!response.ok) {
        throw new Error(payload.error ?? "记忆读取失败");
      }
      setMemories(payload.memories ?? []);
    } catch (error) {
      setMemoryError(error instanceof Error ? error.message : "记忆读取失败");
    } finally {
      setIsLoadingMemories(false);
    }
  }

  async function deleteMemory(memory: ManagedMemory) {
    const userId = sessionRef.current.userId;
    if (!userId) {
      setMemoryError("当前会话还没有用户 ID。");
      return;
    }

    const confirmed = window.confirm(`删除这条记忆？\n\n${memory.content}`);
    if (!confirmed) return;

    try {
      const response = await fetch(`/api/memories/${encodeURIComponent(memory.id)}?userId=${encodeURIComponent(userId)}`, {
        method: "DELETE"
      });
      const payload = (await response.json()) as { error?: string };
      if (!response.ok) {
        throw new Error(payload.error ?? "记忆删除失败");
      }
      setMemories((current) => current.filter((item) => item.id !== memory.id));
    } catch (error) {
      setMemoryError(error instanceof Error ? error.message : "记忆删除失败");
    }
  }

  function shouldRenderMessage(message: UiMessage) {
    if (message.role === "user") return true;

    return Boolean(
      message.text ||
      message.status ||
      message.audios?.length ||
      message.images?.length ||
      message.videos?.length ||
      message.tasks?.length ||
      message.files?.length ||
      message.sources?.length ||
      message.webResults?.length ||
      message.researchSteps?.length ||
      message.thinks?.length
    );
  }

  return (
    <main className="xvc-shell">
      <section className="chat-panel" aria-label="XVC Assistant">
        <section className="xvc-chat">
          <header className="xvc-chat__header">
            <h1>XVC Assistant</h1>
            <button type="button" className="xvc-chat__memory-button" onClick={openMemoryPanel}>
              记忆
            </button>
          </header>
          <div ref={messagesRef} className="xvc-chat__messages" role="log" aria-live="polite">
            {messages.map((message) =>
              shouldRenderMessage(message) ? (
                <article key={message.id} className={`xvc-message xvc-message--${message.role}`}>
                  <div className="xvc-message__avatar">{message.role === "user" ? "你" : "X"}</div>
                  <div className="xvc-message__body">{renderMessageContent(message)}</div>
                </article>
              ) : null
            )}
          </div>
          <form
            className={isDraggingFile ? "xvc-chat__composer is-dragging" : "xvc-chat__composer"}
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            onDrop={handleDrop}
            onSubmit={(event) => {
              event.preventDefault();
              submitMessage(draft);
            }}
          >
            {isDraggingFile ? <div className="xvc-chat__drop-mask">松开后添加文件</div> : null}
            {attachments.length > 0 ? (
              <div className="xvc-chat__attachments" aria-label="已选择附件">
                {attachments.map((attachment) => (
                  <div
                    key={attachment.id}
                    className="xvc-chat__attachment"
                  >
                    <span className="xvc-chat__attachment-kind">{getAttachmentKindLabel(attachment)}</span>
                    <strong>{attachment.name}</strong>
                    <button
                      type="button"
                      className="xvc-chat__attachment-remove"
                      aria-label={`移除附件 ${attachment.name}`}
                      title="移除附件"
                      onClick={() => removeAttachment(attachment.id)}
                    >
                      ×
                    </button>
                  </div>
                ))}
              </div>
            ) : null}
            <textarea
              value={draft}
              rows={2}
              onChange={(event) => setDraft(event.target.value)}
              onPaste={handlePaste}
              onKeyDown={(event) => {
                if (event.key === "Enter" && !event.shiftKey) {
                  event.preventDefault();
                  submitMessage(draft);
                }
              }}
              placeholder={isUploading ? "附件处理中..." : isStreaming ? "XVC 正在回复..." : "给 XVC 发送消息"}
            />
            <div className="xvc-chat__composer-footer">
              <div className="xvc-chat__mode-group" aria-label="对话模式">
                <button
                  type="button"
                  className={deepThinking ? "xvc-chat__mode is-active" : "xvc-chat__mode"}
                  aria-pressed={deepThinking}
                  onClick={() => setDeepThinking((value) => !value)}
                >
                  <span aria-hidden="true">✣</span>
                  深度思考
                </button>
                <button
                  type="button"
                  className={smartSearch ? "xvc-chat__mode is-active" : "xvc-chat__mode"}
                  aria-pressed={smartSearch}
                  onClick={() => setSmartSearch((value) => !value)}
                >
                  <span aria-hidden="true">◎</span>
                  智能搜索
                </button>
              </div>
              <div className="xvc-chat__actions">
                <input
                  ref={fileInputRef}
                  type="file"
                  multiple
                  className="xvc-chat__file-input"
                  onChange={(event) => {
                    if (event.target.files) addAttachments(event.target.files);
                    event.target.value = "";
                  }}
                />
                <button
                  type="button"
                  className="xvc-chat__attach-button"
                  aria-label="添加附件"
                  onClick={() => fileInputRef.current?.click()}
                >
                  <svg viewBox="0 0 24 24" aria-hidden="true">
                    <path d="M8.6 12.8 14.9 6.5a3.2 3.2 0 0 1 4.5 4.5l-7.9 7.9a5 5 0 0 1-7.1-7.1l7.8-7.8" />
                  </svg>
                </button>
                <button
                  type="submit"
                  className="xvc-chat__send-button"
                  aria-label="发送消息"
                  disabled={isStreaming || isUploading || (!draft.trim() && attachments.length === 0)}
                >
                {isUploading ? "…" : "↑"}
                </button>
              </div>
            </div>
          </form>
        </section>
      </section>
      {isMemoryPanelOpen ? (
        <MemoryPanel
          memories={memories}
          isLoading={isLoadingMemories}
          error={memoryError}
          onClose={() => setIsMemoryPanelOpen(false)}
          onRefresh={loadMemories}
          onDelete={deleteMemory}
        />
      ) : null}
    </main>
  );
}

async function uploadAttachments(
  attachments: ComposerAttachment[],
  userId: string | null
): Promise<UploadFilesPayload> {
  const formData = new FormData();
  if (userId) formData.set("userId", userId);

  for (const attachment of attachments) {
    formData.append("files", attachment.file, attachment.name);
  }

  const response = await fetch("/api/files", {
    method: "POST",
    body: formData
  });

  const payload = (await response.json()) as Partial<UploadFilesPayload> & { error?: string };
  if (!response.ok) {
    throw new Error(payload.error ?? "文件上传失败");
  }

  if (payload.userId) {
    storeSession({ userId: payload.userId });
  }

  return {
    userId: payload.userId ?? userId ?? "",
    files: payload.files ?? []
  };
}

function isImageAttachment(attachment: ComposerAttachment): boolean {
  return attachment.type.toLowerCase().startsWith("image/");
}

function isAudioAttachment(attachment: ComposerAttachment): boolean {
  const type = attachment.type.toLowerCase();
  const name = attachment.name.toLowerCase();
  return (
    type.startsWith("audio/") ||
    /\.(mp3|wav|m4a|aac|flac|oga|ogg|opus)$/i.test(name)
  );
}

function isVideoAttachment(attachment: ComposerAttachment): boolean {
  const type = attachment.type.toLowerCase();
  const name = attachment.name.toLowerCase();
  return (
    type.startsWith("video/") ||
    /\.(mp4|webm|mov|m4v)$/i.test(name)
  );
}

function getAttachmentKindLabel(attachment: ComposerAttachment): string {
  if (isAudioAttachment(attachment)) return "音频";
  if (isImageAttachment(attachment)) return "图片";
  if (isVideoAttachment(attachment)) return "视频";
  return "文件";
}

async function toChatAudioInput(attachment: ComposerAttachment): Promise<ChatAudioInput> {
  return {
    name: attachment.name,
    contentType: attachment.type || inferAudioContentType(attachment.name),
    size: attachment.size,
    dataUrl: await readFileAsDataUrl(attachment.file)
  };
}

async function toChatImageInput(attachment: ComposerAttachment): Promise<ChatImageInput> {
  return {
    name: attachment.name,
    contentType: attachment.type || "image/png",
    size: attachment.size,
    dataUrl: await readFileAsDataUrl(attachment.file)
  };
}

async function toChatVideoInput(attachment: ComposerAttachment): Promise<ChatVideoInput> {
  const frames = await extractVideoFrames(attachment.file);

  return {
    name: attachment.name,
    contentType: attachment.type || "video/*",
    size: attachment.size,
    durationSec: frames.durationSec,
    frames: frames.frames
  };
}

function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === "string") {
        resolve(reader.result);
      } else {
        reject(new Error("图片读取失败"));
      }
    };
    reader.onerror = () => reject(new Error("图片读取失败"));
    reader.readAsDataURL(file);
  });
}

async function extractVideoFrames(file: File): Promise<{
  durationSec: number;
  frames: ChatVideoInput["frames"];
}> {
  const url = URL.createObjectURL(file);
  const video = document.createElement("video");
  video.preload = "metadata";
  video.muted = true;
  video.playsInline = true;
  video.src = url;

  try {
    await waitForVideoMetadata(video);
    const durationSec = Number.isFinite(video.duration) ? video.duration : 0;
    if (durationSec <= 0 || video.videoWidth <= 0 || video.videoHeight <= 0) {
      throw new Error("无法读取视频时长或尺寸。请换一个视频文件。");
    }

    const timestamps = createVideoFrameTimestamps(durationSec);
    const frames = [];
    for (const timestampSec of timestamps) {
      await seekVideo(video, timestampSec);
      frames.push(captureVideoFrame(video, timestampSec));
    }

    return {
      durationSec,
      frames
    };
  } finally {
    video.removeAttribute("src");
    video.load();
    URL.revokeObjectURL(url);
  }
}

function waitForVideoMetadata(video: HTMLVideoElement): Promise<void> {
  return new Promise((resolve, reject) => {
    const timeout = window.setTimeout(() => {
      cleanup();
      reject(new Error("视频元数据读取超时。"));
    }, 8000);
    const onLoaded = () => {
      cleanup();
      resolve();
    };
    const onError = () => {
      cleanup();
      reject(new Error("视频读取失败。请确认浏览器支持该视频格式。"));
    };
    const cleanup = () => {
      window.clearTimeout(timeout);
      video.removeEventListener("loadedmetadata", onLoaded);
      video.removeEventListener("error", onError);
    };

    video.addEventListener("loadedmetadata", onLoaded, { once: true });
    video.addEventListener("error", onError, { once: true });
    video.load();
  });
}

function seekVideo(video: HTMLVideoElement, timestampSec: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const timeout = window.setTimeout(() => {
      cleanup();
      reject(new Error("视频关键帧提取超时。"));
    }, 8000);
    const onSeeked = () => {
      cleanup();
      resolve();
    };
    const onError = () => {
      cleanup();
      reject(new Error("视频关键帧提取失败。"));
    };
    const cleanup = () => {
      window.clearTimeout(timeout);
      video.removeEventListener("seeked", onSeeked);
      video.removeEventListener("error", onError);
    };

    video.addEventListener("seeked", onSeeked, { once: true });
    video.addEventListener("error", onError, { once: true });
    video.currentTime = Math.min(Math.max(0, timestampSec), Math.max(0, video.duration - 0.1));
  });
}

function captureVideoFrame(
  video: HTMLVideoElement,
  timestampSec: number
): ChatVideoInput["frames"][number] {
  const maxEdge = 1024;
  const scale = Math.min(1, maxEdge / Math.max(video.videoWidth, video.videoHeight));
  const width = Math.max(1, Math.round(video.videoWidth * scale));
  const height = Math.max(1, Math.round(video.videoHeight * scale));
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d");
  if (!context) {
    throw new Error("当前浏览器不支持视频关键帧提取。");
  }

  context.drawImage(video, 0, 0, width, height);

  return {
    timestampSec,
    width,
    height,
    dataUrl: canvas.toDataURL("image/jpeg", 0.76)
  };
}

function createVideoFrameTimestamps(durationSec: number): number[] {
  const maxFrames = durationSec <= 30 ? 8 : durationSec <= 180 ? 16 : 20;
  const targetFrames = Math.min(maxFrames, Math.max(3, Math.ceil(durationSec / (durationSec <= 30 ? 5 : 12))));
  const lastTimestamp = Math.max(0.1, durationSec - 0.2);

  if (targetFrames === 1) return [Math.min(0.1, lastTimestamp)];

  return Array.from({ length: targetFrames }, (_, index) => {
    const ratio = targetFrames === 1 ? 0 : index / (targetFrames - 1);
    return Number((0.1 + (lastTimestamp - 0.1) * ratio).toFixed(2));
  });
}

function inferAudioContentType(filename: string): string {
  const lower = filename.toLowerCase();
  if (lower.endsWith(".mp3")) return "audio/mpeg";
  if (lower.endsWith(".wav")) return "audio/wav";
  if (lower.endsWith(".m4a")) return "audio/mp4";
  if (lower.endsWith(".aac")) return "audio/aac";
  if (lower.endsWith(".flac")) return "audio/flac";
  if (lower.endsWith(".ogg") || lower.endsWith(".oga")) return "audio/ogg";
  if (lower.endsWith(".opus")) return "audio/opus";
  return "audio/mpeg";
}

function AssistantStatus({ status }: { status: UiStatus }) {
  const label = status.phase === "external_search" ? "外部搜索中" : status.label;

  return (
    <div className={`assistant-status assistant-status--${status.phase}`} role="status" aria-live="polite">
      <span className="assistant-status__dot" />
      <span>{label}</span>
    </div>
  );
}

function AudioPreviewList({ audios }: { audios: ChatAudioInput[] }) {
  return (
    <div className="message-audio-list" aria-label="音频附件">
      {audios.map((audio, index) => (
        <section key={`${audio.name}-${index}`} className="message-audio-card">
          <div className="message-audio-card__meta">
            <span>音频</span>
            <strong>{audio.name || `音频 ${index + 1}`}</strong>
            <small>{audio.contentType} · {formatFileSize(audio.size)}</small>
          </div>
          <audio controls src={audio.dataUrl}>
            当前浏览器不支持音频播放。
          </audio>
        </section>
      ))}
    </div>
  );
}

function ImagePreviewGrid({ images }: { images: ChatImageInput[] }) {
  return (
    <div className="message-media-grid" aria-label="图片附件">
      {images.map((image, index) => (
        <figure key={`${image.name}-${index}`} className="message-media-card">
          <img src={image.dataUrl} alt={image.name || `图片 ${index + 1}`} />
          <figcaption>
            <span>{image.name || `图片 ${index + 1}`}</span>
            <small>{formatFileSize(image.size)}</small>
          </figcaption>
        </figure>
      ))}
    </div>
  );
}

function VideoKeyframePreview({ videos }: { videos: ChatVideoInput[] }) {
  return (
    <div className="message-video-stack" aria-label="视频关键帧">
      {videos.map((video, videoIndex) => (
        <section key={`${video.name}-${videoIndex}`} className="message-video-card">
          <header className="message-video-card__header">
            <div>
              <span>视频关键帧</span>
              <strong>{video.name || `视频 ${videoIndex + 1}`}</strong>
            </div>
            <small>
              {formatDuration(video.durationSec)} · {video.frames.length} 帧
            </small>
          </header>
          <Carousel className="message-video-carousel" dots draggable>
            {video.frames.map((frame, frameIndex) => (
              <figure key={`${video.name}-${frame.timestampSec}-${frameIndex}`} className="message-video-frame">
                <img
                  src={frame.dataUrl}
                  alt={`${video.name || `视频 ${videoIndex + 1}`} ${formatDuration(frame.timestampSec)} 关键帧`}
                />
                <figcaption>
                  <span>{formatDuration(frame.timestampSec)}</span>
                  <small>{frame.width}x{frame.height}</small>
                </figcaption>
              </figure>
            ))}
          </Carousel>
        </section>
      ))}
    </div>
  );
}

function FileResultCard({
  file,
  onDelete
}: {
  file: NonNullable<UiMessage["files"]>[number];
  onDelete: (file: NonNullable<UiMessage["files"]>[number]) => void;
}) {
  return (
    <section className="file-card" aria-label={`文件 ${file.filename}`}>
      <div className="file-card__icon">{file.contentType?.startsWith("image/") ? "IMG" : "DOC"}</div>
      <div className="file-card__body">
        <h3>{file.filename}</h3>
        <p>{formatFileSize(file.size)} · {file.status} · {formatDate(file.createdAt)}</p>
      </div>
      <button
        type="button"
        className="file-card__delete"
        aria-label={`删除文件 ${file.filename}`}
        title="删除文件"
        onClick={() => onDelete(file)}
      >
        ×
      </button>
    </section>
  );
}

function SourceResultCard({ source }: { source: NonNullable<UiMessage["sources"]>[number] }) {
  return (
    <section className="source-card" aria-label={`来源 ${source.filename}`}>
      <div className="source-card__rail">
        <span>{source.chunkIndex + 1}</span>
      </div>
      <div className="source-card__body">
        <div className="source-card__meta">
          <strong>{source.filename}</strong>
          <span>{source.sectionPath || "文档片段"}</span>
          <em>{Math.round(source.score * 100)}%</em>
        </div>
        <p>{source.preview}</p>
      </div>
    </section>
  );
}

function DocumentSourceList({ sources }: { sources: NonNullable<UiMessage["sources"]> }) {
  const [showAllSources, setShowAllSources] = useState(false);
  const visibleSources = showAllSources ? sources : sources.slice(0, 3);
  const hiddenSourceCount = Math.max(0, sources.length - visibleSources.length);

  return (
    <div className="source-result-list" aria-label="文档来源">
      {visibleSources.map((source) => (
        <SourceResultCard key={source.chunkId} source={source} />
      ))}
      {hiddenSourceCount > 0 ? (
        <button
          type="button"
          className="source-result-more"
          onClick={() => setShowAllSources(true)}
        >
          显示剩余 {hiddenSourceCount} 条文档片段
        </button>
      ) : null}
    </div>
  );
}

function WebResultCard({ result }: { result: NonNullable<UiMessage["webResults"]>[number] }) {
  return (
    <a className="source-card source-card--web" href={result.link} target="_blank" rel="noreferrer">
      <div className="source-card__rail">
        <span>{result.position || "W"}</span>
      </div>
      <div className="source-card__body">
        <div className="source-card__meta">
          <strong>{result.title}</strong>
          <span>{result.source || result.link}</span>
          {result.date ? <em>{result.date}</em> : null}
        </div>
        <p>{result.snippet || result.link}</p>
      </div>
    </a>
  );
}

function MemoryPanel({
  memories,
  isLoading,
  error,
  onClose,
  onRefresh,
  onDelete
}: {
  memories: ManagedMemory[];
  isLoading: boolean;
  error: string | null;
  onClose: () => void;
  onRefresh: () => void;
  onDelete: (memory: ManagedMemory) => void;
}) {
  return (
    <div className="memory-panel-backdrop" role="presentation">
      <aside className="memory-panel" aria-label="长期记忆管理">
        <header className="memory-panel__header">
          <div>
            <span>Long-term Memory</span>
            <h2>长期记忆</h2>
          </div>
          <div className="memory-panel__actions">
            <button type="button" onClick={onRefresh} disabled={isLoading}>
              刷新
            </button>
            <button type="button" className="memory-panel__close" aria-label="关闭记忆面板" onClick={onClose}>
              ×
            </button>
          </div>
        </header>

        {error ? <div className="memory-panel__error">{error}</div> : null}
        {isLoading ? <div className="memory-panel__empty">正在读取记忆...</div> : null}
        {!isLoading && memories.length === 0 && !error ? (
          <div className="memory-panel__empty">
            <strong>还没有长期记忆</strong>
            <p>你可以在对话中说“请记住：我喜欢先给结论再解释”。</p>
          </div>
        ) : null}

        <div className="memory-list">
          {memories.map((memory) => (
            <section key={memory.id} className="memory-card">
              <div className="memory-card__topline">
                <span>{formatMemoryKind(memory.kind)}</span>
                <time>{formatDate(memory.updatedAt)}</time>
              </div>
              <p>{memory.content}</p>
              <button type="button" onClick={() => onDelete(memory)}>
                删除
              </button>
            </section>
          ))}
        </div>
      </aside>
    </div>
  );
}

function formatMemoryKind(kind: string): string {
  const labels: Record<string, string> = {
    preference: "偏好",
    fact: "事实",
    instruction: "指令",
    project_context: "项目背景",
    conversation: "对话片段",
    conversation_summary: "阶段摘要",
    other: "其他"
  };

  return labels[kind] ?? kind;
}

function ResearchFlow({
  text,
  status,
  streaming,
  planThink,
  synthesisThink,
  otherThinks,
  steps,
  webResults
}: {
  text: string;
  status?: UiStatus;
  streaming: boolean;
  planThink?: NonNullable<UiMessage["thinks"]>[number];
  synthesisThink?: NonNullable<UiMessage["thinks"]>[number];
  otherThinks: NonNullable<UiMessage["thinks"]>;
  steps: NonNullable<UiMessage["researchSteps"]>;
  webResults: NonNullable<UiMessage["webResults"]>;
}) {
  const [showAllWebResults, setShowAllWebResults] = useState(false);
  const visibleWebResults = showAllWebResults ? webResults : webResults.slice(0, 3);
  const hiddenWebResultCount = Math.max(0, webResults.length - visibleWebResults.length);

  return (
    <>
      {planThink ? <ResearchThink think={planThink} /> : null}
      {steps.length > 0 ? <ResearchPlanSummary steps={steps} /> : null}
      {steps.length > 0 ? <ResearchStepper steps={steps} /> : null}
      {synthesisThink ? <ResearchThink think={synthesisThink} /> : null}
      {otherThinks.length > 0 ? (
        <div className="think-stack">
          {otherThinks.map((think) => <ResearchThink key={think.id} think={think} />)}
        </div>
      ) : null}
      {text ? <Bubble content={text} /> : null}
      {webResults.length > 0 ? (
        <div className="source-result-list" aria-label="外部搜索来源">
          {visibleWebResults.map((result) => (
            <WebResultCard key={`${result.link}-${result.position}`} result={result} />
          ))}
          {hiddenWebResultCount > 0 ? (
            <button
              type="button"
              className="source-result-more"
              onClick={() => setShowAllWebResults(true)}
            >
              显示剩余 {hiddenWebResultCount} 条参考链接
            </button>
          ) : null}
        </div>
      ) : null}
      {streaming && !status && !text ? <Typing /> : null}
    </>
  );
}

function ResearchThink({ think }: { think: NonNullable<UiMessage["thinks"]>[number] }) {
  return (
    <Think className="research-think" isDone={think.isDone} thinkTime={think.thinkTime}>
      <strong>{think.title}</strong>
      <Bubble content={think.content || "正在生成可展示的思考过程..."} />
    </Think>
  );
}

function ResearchPlanSummary({ steps }: { steps: NonNullable<UiMessage["researchSteps"]> }) {
  return (
    <section className="research-plan-summary" aria-label="规划结果">
      <div className="research-section-label">规划结果</div>
      <ol>
        {steps.map((step) => (
          <li key={step.id}>
            <div className="research-plan-summary__content">
              <strong>{step.title}</strong>
              <span>{step.query}</span>
            </div>
          </li>
        ))}
      </ol>
    </section>
  );
}

function ResearchStepper({ steps }: { steps: NonNullable<UiMessage["researchSteps"]> }) {
  const [expandedStepId, setExpandedStepId] = useState<string | null>(null);

  return (
    <section className="research-plan" aria-label="深度研究步骤">
      <div className="research-section-label">子任务进度</div>
      <div className="research-step-list">
        {steps.map((step, index) => (
          <button
            key={step.id}
            type="button"
            className={expandedStepId === step.id ? "research-step is-expanded" : "research-step"}
            aria-expanded={expandedStepId === step.id}
            onClick={() => setExpandedStepId((current) => current === step.id ? null : step.id)}
          >
            <span className={`research-step__index research-step__index--${step.status}`}>{index + 1}</span>
            <span className="research-step__content">
              <span className="research-step__title">{step.title}</span>
              <span className="research-step__query">{step.query}</span>
              {step.summary ? <span className="research-step__summary">{step.summary}</span> : null}
            </span>
            <span className="research-step__status">{formatResearchStepStatus(step.status)}</span>
          </button>
        ))}
      </div>
    </section>
  );
}

function formatResearchStepStatus(status: NonNullable<UiMessage["researchSteps"]>[number]["status"]): string {
  if (status === "active") return "进行中";
  if (status === "success") return "完成";
  if (status === "fail") return "失败";
  return "等待";
}

function formatFileSize(size: number): string {
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
  return `${(size / 1024 / 1024).toFixed(1)} MB`;
}

function formatDuration(seconds: number): string {
  const safeSeconds = Math.max(0, Math.floor(seconds));
  const minutes = Math.floor(safeSeconds / 60);
  const rest = safeSeconds % 60;
  return `${minutes}:${String(rest).padStart(2, "0")}`;
}

function formatDate(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit"
  });
}
