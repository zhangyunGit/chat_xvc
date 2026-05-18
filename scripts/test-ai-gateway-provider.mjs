import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const tempDir = mkdtempSync(join(tmpdir(), "chat-xvc-ai-gateway-provider-"));

try {
  execFileSync(
    "npx",
    [
      "esbuild",
      "src/providers/ai-gateway-provider.ts",
      "--bundle",
      "--format=esm",
      `--outfile=${join(tempDir, "ai-gateway-provider.mjs")}`
    ],
    { stdio: "inherit" }
  );

  const testFile = join(tempDir, "test.mjs");
  writeFileSync(
    testFile,
    `
import { AiGatewayProvider } from "./ai-gateway-provider.mjs";

const calls = [];
globalThis.fetch = async (url, init) => {
  calls.push({ url, init, body: JSON.parse(init.body) });
  return new Response(JSON.stringify({
    choices: [{ message: { content: "ok" } }]
  }), { status: 200, headers: { "content-type": "application/json" } });
};

const provider = new AiGatewayProvider({
  CLOUDFLARE_ACCOUNT_ID: "acc",
  AI_GATEWAY_ID: "deepseek_falsh",
  DEFAULT_CHAT_PROVIDER: "google-ai-studio",
  DEFAULT_CHAT_MODEL: "gemini-3.1-flash-lite",
  DEEPSEEK_API_KEY: "deepseek-key",
  GEMINI_API_KEY: "gemini-key"
});

const reply = await provider.chat([{ role: "user", content: "hi" }]);
if (reply !== "ok") throw new Error("Expected parsed assistant reply");
if (!calls[0].url.includes("/acc/deepseek_falsh/compat/chat/completions")) throw new Error("Bad gateway URL");
if (calls[0].body.model !== "google-ai-studio/gemini-3.1-flash-lite") throw new Error("Bad default Gemini lite model prefix");
if (calls[0].init.headers.authorization !== "Bearer gemini-key") throw new Error("Bad Gemini auth header");
if (calls[0].init.headers["x-goog-api-key"] !== "gemini-key") throw new Error("Missing default Gemini API key header");

calls.length = 0;
const geminiProvider = new AiGatewayProvider({
  CLOUDFLARE_ACCOUNT_ID: "acc",
  AI_GATEWAY_ID: "deepseek_falsh",
  DEFAULT_CHAT_PROVIDER: "gemini",
  DEFAULT_CHAT_MODEL: "gemini-3-flash-preview",
  DEEPSEEK_API_KEY: "deepseek-key",
  GEMINI_API_KEY: "gemini-key"
});

await geminiProvider.chat([{ role: "user", content: "hi" }]);
if (calls[0].body.model !== "google-ai-studio/gemini-3-flash-preview") throw new Error("Bad Gemini model prefix");
if (calls[0].init.headers["x-goog-api-key"] !== "gemini-key") throw new Error("Missing Gemini API key header");

calls.length = 0;
await provider.chat(
  [
    {
      role: "user",
      content: [
        { type: "text", text: "OCR this image" },
        { type: "image_url", image_url: { url: "data:image/png;base64,aGVsbG8=", detail: "auto" } }
      ]
    }
  ],
  { provider: "google-ai-studio", model: "gemini-3.1-flash-lite" }
);
if (calls[0].body.model !== "google-ai-studio/gemini-3.1-flash-lite") throw new Error("Bad Gemini lite model prefix");
if (calls[0].body.messages[0].content[1].image_url.url !== "data:image/png;base64,aGVsbG8=") {
  throw new Error("Expected multimodal content to pass through");
}

calls.length = 0;
await provider.chat([{ role: "user", content: "hi" }], { provider: "deepseek", model: "deepseek-v4-pro[1m]" });
if (calls[0].body.model !== "deepseek/deepseek-v4-pro") throw new Error("Expected DeepSeek pro model normalization");

calls.length = 0;
await provider.chat([{ role: "user", content: "hi" }], { provider: "deepseek", model: "deepseek/deepseek-v4-pro[1m]" });
if (calls[0].body.model !== "deepseek/deepseek-v4-pro") throw new Error("Expected prefixed DeepSeek pro model normalization");

globalThis.fetch = async (url, init) => {
  calls.push({ url, init, body: JSON.parse(init.body) });
  return new Response(JSON.stringify({
    choices: [{ message: { content: "", reasoning_content: "reasoning fallback" } }]
  }), { status: 200, headers: { "content-type": "application/json" } });
};

const reasoningReply = await provider.chat([{ role: "user", content: "hi" }], { provider: "deepseek", model: "deepseek/deepseek-v4-pro" });
if (reasoningReply !== "reasoning fallback") throw new Error("Expected reasoning_content fallback");
if (calls.at(-1).body.model !== "deepseek/deepseek-v4-pro") throw new Error("Expected normalized prefixed pro model");

console.log("ai gateway provider ok");
`
  );

  execFileSync("node", [testFile], { stdio: "inherit" });
} finally {
  rmSync(tempDir, { recursive: true, force: true });
}
