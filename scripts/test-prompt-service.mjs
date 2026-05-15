import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const tempDir = mkdtempSync(join(tmpdir(), "chat-xvc-prompt-service-"));

try {
  execFileSync(
    "npx",
    [
      "esbuild",
      "src/prompts/prompt-service.ts",
      "--bundle",
      "--format=esm",
      `--outfile=${join(tempDir, "prompt-service.mjs")}`
    ],
    { stdio: "inherit" }
  );

  const testFile = join(tempDir, "test.mjs");
  writeFileSync(
    testFile,
    `
import { createPromptMessages } from "./prompt-service.mjs";

const user = {
  id: "u1",
  name: "张云",
  email: "user@example.com",
  aiNickname: "XVC",
  profileStatus: "completed",
  createdAt: "",
  updatedAt: ""
};

const decision = {
  intent: "research.latest_info",
  confidence: 0.9,
  entities: {},
  requiredTools: ["web_search"],
  promptTemplate: "deep_research",
  needsClarification: false,
  needsRag: false,
  needsWebSearch: true,
  shouldWriteMemory: false,
  source: "rule"
};

const messages = createPromptMessages({
  user,
  decision,
  userMessage: "查一下最新信息",
  searchResults: [{ title: "Result", link: "https://example.com", snippet: "Snippet" }]
});

if (!messages[0].content.includes("外部搜索与研究助手")) throw new Error("Expected research prompt");
if (!messages[0].content.includes("Result")) throw new Error("Expected search result in prompt");
if (!messages[0].content.includes("research.latest_info")) throw new Error("Expected intent in prompt");

const taskMessages = createPromptMessages({
  user,
  decision: {
    ...decision,
    intent: "task.detail",
    requiredTools: ["get_task_detail"],
    promptTemplate: "task_manager",
    needsWebSearch: false
  },
  userMessage: "任务具体内容是什么？",
  toolResultText: '{"functionName":"get_task_detail","status":"success"}'
});

if (!taskMessages[0].content.includes("任务管理助手")) throw new Error("Expected task prompt");
if (!taskMessages[1].content.includes("任务工具执行/参数检查结果")) throw new Error("Expected tool result block");
if (!taskMessages[1].content.includes("get_task_detail")) throw new Error("Expected tool result content");

console.log("prompt service ok");
`
  );

  execFileSync("node", [testFile], { stdio: "inherit" });
} finally {
  rmSync(tempDir, { recursive: true, force: true });
}
