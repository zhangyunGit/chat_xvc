import type { ChatAudioInput, ChatMessage } from "../types/chat";

const DEFAULT_AUDIO_MODEL = "gemini-3.1-flash-lite";
const MAX_AUDIO_COUNT = 2;
const MAX_AUDIO_BYTES = 20 * 1024 * 1024;
const SUPPORTED_AUDIO_TYPES = new Set([
  "audio/aac",
  "audio/flac",
  "audio/mp4",
  "audio/mpeg",
  "audio/mp3",
  "audio/ogg",
  "audio/opus",
  "audio/wav",
  "audio/webm",
  "audio/x-m4a"
]);

type GeminiGenerateContentResponse = {
  candidates?: Array<{
    content?: {
      parts?: Array<{
        text?: unknown;
      }>;
    };
  }>;
  error?: {
    message?: string;
  };
};

export type AudioTranscriptionResult = {
  reply: string;
  promptMessages: ChatMessage[];
  provider: "google-ai-studio";
  modelName: string;
  durationMs: number;
};

export class AudioTranscriptionService {
  constructor(private readonly env: Env) {}

  async transcribe(input: {
    message: string;
    audios: ChatAudioInput[];
  }): Promise<AudioTranscriptionResult> {
    const audios = normalizeAudios(input.audios);
    const modelName = resolveGeminiModel(this.env);
    const prompt = createAudioPrompt(input.message, audios);
    const startedAt = Date.now();
    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(modelName)}:generateContent`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-goog-api-key": resolveGeminiApiKey(this.env)
        },
        body: JSON.stringify({
          systemInstruction: {
            parts: [
              {
                text: [
                  "你是音频转写助手。",
                  "优先把语音内容准确转写成文字；如果用户要求总结、翻译或整理，也可以在转写基础上完成。",
                  "如果能判断说话人或时间段，可以用简洁段落标注；不能确定时不要编造。",
                  "默认使用中文回答。"
                ].join("\n")
              }
            ]
          },
          contents: [
            {
              role: "user",
              parts: [
                { text: prompt },
                ...audios.map((audio) => ({
                  inlineData: {
                    mimeType: audio.contentType,
                    data: audio.base64
                  }
                }))
              ]
            }
          ],
          generationConfig: {
            temperature: 0.1,
            maxOutputTokens: 8192
          }
        })
      }
    );

    const responseText = await response.text();
    const parsed = parseJson(responseText);

    if (!response.ok) {
      throw new Error(
        `Gemini audio transcription failed: ${response.status} ${response.statusText} ${parsed?.error?.message ?? responseText}`
      );
    }

    const reply = parseGeminiText(parsed);
    if (!reply) {
      throw new Error("Gemini audio transcription response did not contain text");
    }

    return {
      reply,
      promptMessages: createRedactedPromptMessages(input.message, audios),
      provider: "google-ai-studio",
      modelName,
      durationMs: Date.now() - startedAt
    };
  }
}

type NormalizedAudio = {
  name: string;
  contentType: string;
  bytes: number;
  base64: string;
};

function normalizeAudios(audios: ChatAudioInput[]): NormalizedAudio[] {
  if (audios.length === 0) {
    throw new Error("未收到音频。请上传或拖入一段音频后再发送。");
  }

  if (audios.length > MAX_AUDIO_COUNT) {
    throw new Error(`一次最多支持 ${MAX_AUDIO_COUNT} 段音频。`);
  }

  return audios.map((audio, index) => {
    const parsed = parseAudioDataUrl(audio.dataUrl);
    const contentType = normalizeAudioContentType(audio.contentType || parsed.contentType);

    if (!SUPPORTED_AUDIO_TYPES.has(contentType)) {
      throw new Error(`暂不支持音频类型：${contentType || "unknown"}。请使用 MP3、WAV、M4A、AAC、FLAC、OGG 或 WebM。`);
    }

    if (parsed.bytes > MAX_AUDIO_BYTES || (audio.size ?? 0) > MAX_AUDIO_BYTES) {
      throw new Error("单段音频不能超过 20MB。请压缩或截取后再试。");
    }

    return {
      name: audio.name?.trim() || `audio-${index + 1}`,
      contentType,
      bytes: parsed.bytes,
      base64: parsed.base64
    };
  });
}

function createAudioPrompt(message: string, audios: NormalizedAudio[]): string {
  const userRequest = message.trim() || "请将这段音频转写成文字。";

  return [
    `用户要求：${userRequest}`,
    `音频数量：${audios.length}`,
    "音频清单：",
    ...audios.map((audio, index) => `${index + 1}. ${audio.name} (${audio.contentType}, ${audio.bytes} bytes)`),
    "",
    "请输出清晰、可读的转写文本。"
  ].join("\n");
}

function createRedactedPromptMessages(message: string, audios: NormalizedAudio[]): ChatMessage[] {
  return [
    {
      role: "system",
      content: "音频转写请求；原始音频数据已从日志中脱敏。"
    },
    {
      role: "user",
      content: [
        createAudioPrompt(message, audios),
        "",
        "日志音频占位：",
        ...audios.map((audio, index) => `${index + 1}. [audio:redacted; type=${audio.contentType}; bytes=${audio.bytes}]`)
      ].join("\n")
    }
  ];
}

function parseAudioDataUrl(dataUrl: string): {
  contentType: string;
  base64: string;
  bytes: number;
} {
  const match = /^data:([^;]+);base64,([a-z0-9+/=\s]+)$/iu.exec(dataUrl.trim());
  if (!match) {
    throw new Error("音频数据格式不正确。请重新上传音频。");
  }

  const base64 = match[2].replace(/\s/g, "");
  return {
    contentType: normalizeAudioContentType(match[1]),
    base64,
    bytes: estimateBase64Bytes(base64)
  };
}

function normalizeAudioContentType(contentType: string): string {
  const normalized = contentType.toLowerCase().trim();
  if (normalized === "audio/mp3") return "audio/mpeg";
  if (normalized === "audio/x-wav") return "audio/wav";
  if (normalized === "audio/x-m4a") return "audio/mp4";
  return normalized;
}

function estimateBase64Bytes(base64: string): number {
  const padding = base64.endsWith("==") ? 2 : base64.endsWith("=") ? 1 : 0;
  return Math.max(0, Math.floor((base64.length * 3) / 4) - padding);
}

function resolveGeminiModel(env: Env): string {
  return (env.GEMINI_LITE_MODEL?.trim() || DEFAULT_AUDIO_MODEL)
    .replace(/^google-ai-studio\//, "")
    .replace(/^gemini\//, "");
}

function resolveGeminiApiKey(env: Env): string {
  if (!env.GEMINI_API_KEY) {
    throw new Error("GEMINI_API_KEY is not configured");
  }
  return env.GEMINI_API_KEY;
}

function parseGeminiText(response: GeminiGenerateContentResponse | null): string | null {
  const text = response?.candidates?.[0]?.content?.parts
    ?.map((part) => (typeof part.text === "string" ? part.text : ""))
    .join("")
    .trim();

  return text || null;
}

function parseJson(text: string): GeminiGenerateContentResponse | null {
  try {
    return JSON.parse(text) as GeminiGenerateContentResponse;
  } catch {
    return null;
  }
}
