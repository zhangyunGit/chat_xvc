import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const tempDir = mkdtempSync(join(tmpdir(), "chat-xvc-image-understanding-service-"));

try {
  execFileSync(
    "npx",
    [
      "esbuild",
      "src/services/image-understanding-service.ts",
      "--bundle",
      "--format=esm",
      `--outfile=${join(tempDir, "image-understanding-service.mjs")}`
    ],
    { stdio: "inherit" }
  );

  const testFile = join(tempDir, "test.mjs");
  writeFileSync(
    testFile,
    `
import { ImageUnderstandingService } from "./image-understanding-service.mjs";

let receivedMessages = null;
let receivedOptions = null;
const provider = {
  async chat(messages, options) {
    receivedMessages = messages;
    receivedOptions = options;
    return "识别完成";
  }
};

const service = new ImageUnderstandingService(
  { GEMINI_LITE_MODEL: "gemini-3.1-flash-lite" },
  provider
);

const result = await service.analyze({
  message: "请 OCR",
  images: [
    {
      name: "receipt.png",
      contentType: "image/png",
      size: 5,
      dataUrl: "data:image/png;base64,aGVsbG8="
    }
  ]
});

if (result.reply !== "识别完成") throw new Error("Expected provider reply");
if (receivedOptions.provider !== "google-ai-studio") throw new Error("Expected Gemini provider");
if (receivedOptions.model !== "gemini-3.1-flash-lite") throw new Error("Expected lite model");
if (!Array.isArray(receivedMessages[1].content)) throw new Error("Expected multimodal user content");
if (!receivedMessages[1].content[1].image_url.url.startsWith("data:image/png;base64,")) {
  throw new Error("Expected raw image data for provider call");
}
if (result.redactedPromptMessages[1].content[1].image_url.url.includes("aGVsbG8=")) {
  throw new Error("Expected image data to be redacted from logs");
}

const videoResult = await service.analyzeVideoKeyframes({
  message: "总结视频",
  videos: [
    {
      name: "demo.mp4",
      contentType: "video/mp4",
      size: 100,
      durationSec: 12,
      frames: [
        {
          timestampSec: 0.1,
          width: 640,
          height: 360,
          dataUrl: "data:image/jpeg;base64,aGVsbG8="
        },
        {
          timestampSec: 6,
          width: 640,
          height: 360,
          dataUrl: "data:image/jpeg;base64,aGVsbG8="
        }
      ]
    }
  ]
});

if (videoResult.reply !== "识别完成") throw new Error("Expected video provider reply");
if (!receivedMessages[0].content.includes("视频关键帧理解")) throw new Error("Expected video keyframe system prompt");
if (!receivedMessages[1].content[0].text.includes("0:06")) throw new Error("Expected timestamp metadata");
if (videoResult.redactedPromptMessages[1].content[1].image_url.url.includes("aGVsbG8=")) {
  throw new Error("Expected video keyframe data to be redacted from logs");
}

let failed = false;
try {
  await service.analyze({
    message: "bad",
    images: [{ contentType: "text/plain", dataUrl: "data:text/plain;base64,aGk=" }]
  });
} catch (error) {
  failed = /图片数据格式不正确|暂不支持图片类型/.test(error.message);
}
if (!failed) throw new Error("Expected non-image input rejection");

console.log("image understanding service ok");
`
  );

  execFileSync("node", [testFile], { stdio: "inherit" });
} finally {
  rmSync(tempDir, { recursive: true, force: true });
}
