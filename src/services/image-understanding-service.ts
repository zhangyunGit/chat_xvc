import type { LLMProvider } from "../providers/llm-provider";
import type { ChatImageInput, ChatMessage, ChatVideoInput } from "../types/chat";

const DEFAULT_IMAGE_MODEL = "gemini-3.1-flash-lite";
const MAX_IMAGE_COUNT = 4;
const MAX_VIDEO_COUNT = 2;
const MAX_VIDEO_FRAME_COUNT = 20;
const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
const SUPPORTED_IMAGE_TYPES = new Set([
  "image/png",
  "image/jpeg",
  "image/jpg",
  "image/webp",
  "image/gif"
]);

export type ImageUnderstandingResult = {
  reply: string;
  promptMessages: ChatMessage[];
  redactedPromptMessages: ChatMessage[];
  provider: "google-ai-studio";
  modelName: string;
  durationMs: number;
  streamed: boolean;
};

export class ImageUnderstandingService {
  constructor(
    private readonly env: Env,
    private readonly chatProvider: LLMProvider
  ) {}

  async analyze(input: {
    message: string;
    images: ChatImageInput[];
    onDelta?: (delta: string) => void | Promise<void>;
  }): Promise<ImageUnderstandingResult> {
    const images = normalizeImages(input.images, {
      maxCount: MAX_IMAGE_COUNT,
      emptyMessage: "未收到图片。请粘贴或拖入一张图片后再发送。"
    });
    const promptMessages = createImageUnderstandingPrompt({
      message: input.message,
      images
    });
    const startedAt = Date.now();
    const modelName = this.env.GEMINI_LITE_MODEL?.trim() || DEFAULT_IMAGE_MODEL;
    const shouldStream = Boolean(this.chatProvider.chatStream && input.onDelta);
    const reply = shouldStream && this.chatProvider.chatStream && input.onDelta
      ? await this.chatProvider.chatStream(promptMessages, {
          provider: "google-ai-studio",
          model: modelName
        }, input.onDelta)
      : await this.chatProvider.chat(promptMessages, {
          provider: "google-ai-studio",
          model: modelName
        });

    return {
      reply,
      promptMessages,
      redactedPromptMessages: redactImagePrompt(promptMessages),
      provider: "google-ai-studio",
      modelName,
      durationMs: Date.now() - startedAt,
      streamed: shouldStream
    };
  }

  async analyzeVideoKeyframes(input: {
    message: string;
    videos: ChatVideoInput[];
    onDelta?: (delta: string) => void | Promise<void>;
  }): Promise<ImageUnderstandingResult> {
    const videos = normalizeVideos(input.videos);
    const promptMessages = createVideoKeyframePrompt({
      message: input.message,
      videos
    });
    const startedAt = Date.now();
    const modelName = this.env.GEMINI_LITE_MODEL?.trim() || DEFAULT_IMAGE_MODEL;
    const shouldStream = Boolean(this.chatProvider.chatStream && input.onDelta);
    const reply = shouldStream && this.chatProvider.chatStream && input.onDelta
      ? await this.chatProvider.chatStream(promptMessages, {
          provider: "google-ai-studio",
          model: modelName
        }, input.onDelta)
      : await this.chatProvider.chat(promptMessages, {
          provider: "google-ai-studio",
          model: modelName
        });

    return {
      reply,
      promptMessages,
      redactedPromptMessages: redactImagePrompt(promptMessages),
      provider: "google-ai-studio",
      modelName,
      durationMs: Date.now() - startedAt,
      streamed: shouldStream
    };
  }
}

function createImageUnderstandingPrompt(input: {
  message: string;
  images: NormalizedImage[];
}): ChatMessage[] {
  const userRequest = input.message.trim() || "请理解图片内容，并提取其中的文字和关键信息。";

  return [
    {
      role: "system",
      content: [
        "你是图片理解和 OCR 助手。",
        "根据用户的文字要求和图片内容回答；如果用户要求 OCR，优先完整、忠实地转写图片中文字。",
        "保留表格、列表、标题层级和关键排版关系；识别不确定的文字用“[不确定]”标注。",
        "不要编造图片中不存在的信息。默认使用中文回答。"
      ].join("\n")
    },
    {
      role: "user",
      content: [
        {
          type: "text",
          text: [
            `用户要求：${userRequest}`,
            `图片数量：${input.images.length}`,
            "请结合所有图片作答。"
          ].join("\n")
        },
        ...input.images.map((image) => ({
          type: "image_url" as const,
          image_url: {
            url: image.dataUrl,
            detail: "auto" as const
          }
        }))
      ]
    }
  ];
}

function createVideoKeyframePrompt(input: {
  message: string;
  videos: NormalizedVideo[];
}): ChatMessage[] {
  const userRequest = input.message.trim() || "请基于视频关键帧总结视频内容，并提取画面中的文字和关键信息。";
  const frameDescriptions = input.videos.flatMap((video, videoIndex) =>
    video.frames.map((frame, frameIndex) => {
      const timestamp = formatTimestamp(frame.timestampSec ?? 0);
      return `视频 ${videoIndex + 1} ${video.name} - 帧 ${frameIndex + 1}: ${timestamp}, ${frame.width ?? 0}x${frame.height ?? 0}`;
    })
  );

  return [
    {
      role: "system",
      content: [
        "你是视频关键帧理解和 OCR 助手。",
        "你看到的是按时间顺序抽取的视频关键帧，不是完整视频流；不要声称已经观看完整视频。",
        "根据关键帧回答用户问题。需要 OCR 时，转写关键帧中的可见文字，并尽量标注对应时间点。",
        "如果问题依赖音频、关键帧之间的动作或未采样片段，要明确说明当前关键帧不足以判断。",
        "默认使用中文回答。"
      ].join("\n")
    },
    {
      role: "user",
      content: [
        {
          type: "text",
          text: [
            `用户要求：${userRequest}`,
            `视频数量：${input.videos.length}`,
            "关键帧清单：",
            ...frameDescriptions,
            "",
            "请按时间顺序综合这些关键帧作答。"
          ].join("\n")
        },
        ...input.videos.flatMap((video) =>
          video.frames.map((frame) => ({
            type: "image_url" as const,
            image_url: {
              url: frame.dataUrl,
              detail: "auto" as const
            }
          }))
        )
      ]
    }
  ];
}

function redactImagePrompt(messages: ChatMessage[]): ChatMessage[] {
  return messages.map((message) => {
    if (!Array.isArray(message.content)) return message;

    return {
      ...message,
      content: message.content.map((part) => {
        if (part.type !== "image_url") return part;

        const meta = describeDataUrl(part.image_url.url);
        return {
          type: "image_url",
          image_url: {
            url: `[image:redacted; type=${meta.contentType}; bytes=${meta.bytes}]`,
            detail: part.image_url.detail
          }
        };
      })
    };
  });
}

type NormalizedImage = {
  name: string;
  contentType: string;
  bytes: number;
  timestampSec?: number;
  width?: number;
  height?: number;
  dataUrl: string;
};

type NormalizedVideo = {
  name: string;
  contentType: string;
  size: number;
  durationSec: number;
  frames: NormalizedImage[];
};

function normalizeImages(
  images: ChatImageInput[],
  options: {
    maxCount: number;
    emptyMessage: string;
  }
): NormalizedImage[] {
  if (images.length === 0) {
    throw new Error(options.emptyMessage);
  }

  if (images.length > options.maxCount) {
    throw new Error(`一次最多支持 ${options.maxCount} 张图片。`);
  }

  return images.map((image, index) => {
    const parsed = parseImageDataUrl(image.dataUrl);
    const declaredContentType = image.contentType?.toLowerCase().trim();
    const contentType = declaredContentType || parsed.contentType;

    if (!SUPPORTED_IMAGE_TYPES.has(contentType)) {
      throw new Error(`暂不支持图片类型：${contentType || "unknown"}。请使用 PNG、JPEG、WebP 或 GIF。`);
    }

    if (parsed.bytes > MAX_IMAGE_BYTES || (image.size ?? 0) > MAX_IMAGE_BYTES) {
      throw new Error("单张图片不能超过 8MB。请压缩图片后再试。");
    }

    return {
      name: image.name?.trim() || `image-${index + 1}`,
      contentType,
      bytes: parsed.bytes,
      dataUrl: image.dataUrl
    };
  });
}

function normalizeVideos(videos: ChatVideoInput[]): NormalizedVideo[] {
  if (videos.length === 0) {
    throw new Error("未收到视频关键帧。请粘贴或拖入一个视频后再发送。");
  }

  if (videos.length > MAX_VIDEO_COUNT) {
    throw new Error(`一次最多支持 ${MAX_VIDEO_COUNT} 个视频。`);
  }

  return videos.map((video, videoIndex) => {
    if (!Array.isArray(video.frames) || video.frames.length === 0) {
      throw new Error("视频关键帧为空。请重新选择视频。");
    }

    if (video.frames.length > MAX_VIDEO_FRAME_COUNT) {
      throw new Error(`单个视频最多支持 ${MAX_VIDEO_FRAME_COUNT} 个关键帧。`);
    }

    const frames = normalizeImages(
      video.frames.map((frame, frameIndex) => ({
        name: `${video.name?.trim() || `video-${videoIndex + 1}`}-frame-${frameIndex + 1}`,
        contentType: "image/jpeg",
        dataUrl: frame.dataUrl
      })),
      {
        maxCount: MAX_VIDEO_FRAME_COUNT,
        emptyMessage: "视频关键帧为空。请重新选择视频。"
      }
    ).map((frame, frameIndex) => ({
      ...frame,
      timestampSec: sanitizeNumber(video.frames[frameIndex].timestampSec),
      width: sanitizeNumber(video.frames[frameIndex].width),
      height: sanitizeNumber(video.frames[frameIndex].height)
    }));

    return {
      name: video.name?.trim() || `video-${videoIndex + 1}`,
      contentType: video.contentType?.trim() || "video/*",
      size: sanitizeNumber(video.size),
      durationSec: sanitizeNumber(video.durationSec),
      frames
    };
  });
}

function parseImageDataUrl(dataUrl: string): { contentType: string; bytes: number } {
  const match = /^data:(image\/[a-z0-9.+-]+);base64,([a-z0-9+/=\s]+)$/iu.exec(dataUrl.trim());
  if (!match) {
    throw new Error("图片数据格式不正确。请重新粘贴或拖入图片。");
  }

  return {
    contentType: match[1].toLowerCase(),
    bytes: estimateBase64Bytes(match[2])
  };
}

function describeDataUrl(dataUrl: string): { contentType: string; bytes: number } {
  try {
    return parseImageDataUrl(dataUrl);
  } catch {
    return {
      contentType: "unknown",
      bytes: 0
    };
  }
}

function estimateBase64Bytes(base64: string): number {
  const compact = base64.replace(/\s/g, "");
  const padding = compact.endsWith("==") ? 2 : compact.endsWith("=") ? 1 : 0;
  return Math.max(0, Math.floor((compact.length * 3) / 4) - padding);
}

function sanitizeNumber(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : 0;
}

function formatTimestamp(seconds: number): string {
  const safeSeconds = Math.max(0, Math.floor(seconds));
  const minutes = Math.floor(safeSeconds / 60);
  const rest = safeSeconds % 60;
  return `${minutes}:${String(rest).padStart(2, "0")}`;
}
