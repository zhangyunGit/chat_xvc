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
  DEFAULT_CHAT_PROVIDER: "deepseek",
  DEFAULT_CHAT_MODEL: "deepseek-v4-flash",
  DEEPSEEK_API_KEY: "deepseek-key",
  GEMINI_API_KEY: "gemini-key"
});

const reply = await provider.chat([{ role: "user", content: "hi" }]);
if (reply !== "ok") throw new Error("Expected parsed assistant reply");
if (!calls[0].url.includes("/acc/deepseek_falsh/compat/chat/completions")) throw new Error("Bad gateway URL");
if (calls[0].body.model !== "deepseek/deepseek-v4-flash") throw new Error("Bad DeepSeek model prefix");
if (calls[0].init.headers.authorization !== "Bearer deepseek-key") throw new Error("Bad DeepSeek auth header");

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

console.log("ai gateway provider ok");
`
  );

  execFileSync("node", [testFile], { stdio: "inherit" });
} finally {
  rmSync(tempDir, { recursive: true, force: true });
}
