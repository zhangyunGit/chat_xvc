import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const tempDir = mkdtempSync(join(tmpdir(), "chat-xvc-audio-transcription-service-"));

try {
  execFileSync(
    "npx",
    [
      "esbuild",
      "src/services/audio-transcription-service.ts",
      "--bundle",
      "--format=esm",
      `--outfile=${join(tempDir, "audio-transcription-service.mjs")}`
    ],
    { stdio: "inherit" }
  );

  const testFile = join(tempDir, "test.mjs");
  writeFileSync(
    testFile,
    `
import { AudioTranscriptionService } from "./audio-transcription-service.mjs";

let capturedRequest = null;
globalThis.fetch = async (url, init) => {
  capturedRequest = {
    url,
    init,
    body: JSON.parse(init.body)
  };
  return new Response(JSON.stringify({
    candidates: [{ content: { parts: [{ text: "转写完成" }] } }]
  }), { status: 200, headers: { "content-type": "application/json" } });
};

const service = new AudioTranscriptionService({
  GEMINI_API_KEY: "gemini-key",
  GEMINI_LITE_MODEL: "google-ai-studio/gemini-3.1-flash-lite"
});

const result = await service.transcribe({
  message: "请转写",
  audios: [
    {
      name: "voice.mp3",
      contentType: "audio/mp3",
      size: 5,
      dataUrl: "data:audio/mpeg;base64,aGVsbG8="
    }
  ]
});

if (result.reply !== "转写完成") throw new Error("Expected transcription reply");
if (!capturedRequest.url.includes("/models/gemini-3.1-flash-lite:generateContent")) {
  throw new Error("Expected normalized Gemini lite model URL");
}
if (capturedRequest.init.headers["x-goog-api-key"] !== "gemini-key") {
  throw new Error("Expected Gemini API key header");
}
if (capturedRequest.body.contents[0].parts[1].inlineData.mimeType !== "audio/mpeg") {
  throw new Error("Expected normalized audio MIME type");
}
if (capturedRequest.body.contents[0].parts[1].inlineData.data !== "aGVsbG8=") {
  throw new Error("Expected raw base64 audio in provider request");
}
if (JSON.stringify(result.promptMessages).includes("aGVsbG8=")) {
  throw new Error("Expected audio data to be redacted from logs");
}

let failed = false;
try {
  await service.transcribe({
    message: "bad",
    audios: [{ contentType: "text/plain", dataUrl: "data:text/plain;base64,aGk=" }]
  });
} catch (error) {
  failed = /暂不支持音频类型/.test(error.message);
}
if (!failed) throw new Error("Expected non-audio input rejection");

console.log("audio transcription service ok");
`
  );

  execFileSync("node", [testFile], { stdio: "inherit" });
} finally {
  rmSync(tempDir, { recursive: true, force: true });
}
