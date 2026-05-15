import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const tempDir = mkdtempSync(join(tmpdir(), "chat-xvc-intent-router-"));

try {
  execFileSync(
    "npx",
    [
      "esbuild",
      "src/agents/intent-router.ts",
      "src/agents/rule-intent-router.ts",
      "--bundle",
      "--format=esm",
      "--splitting",
      `--outdir=${tempDir}`
    ],
    { stdio: "inherit" }
  );

  const testFile = join(tempDir, "test.mjs");
  writeFileSync(
    testFile,
    `
import { IntentRouter } from "./intent-router.js";
import { RuleIntentRouter } from "./rule-intent-router.js";

const baseInput = {
  message: "",
  userName: "张云",
  userEmail: "user@example.com",
  aiNickname: "XVC",
  profileChanged: false,
  profileReset: false,
  missingProfileFields: [],
  recentMessages: []
};

const ruleRouter = new RuleIntentRouter();

const ruleCases = [
  [{ ...baseInput, message: "重新开始", profileReset: true }, "profile.reset"],
  [{ ...baseInput, message: "我的邮箱是什么？" }, "profile.query"],
  [{ ...baseInput, message: "查看我的任务" }, "task.list"],
  [{ ...baseInput, message: "帮我创建任务：检查简历 明天下午3点" }, "task.create"],
  [{ ...baseInput, message: "查一下 Cloudflare Vectorize 最新用法" }, "research.latest_info"],
  [{ ...baseInput, message: "帮我调研 Workers AI 和 OpenAI API 的区别" }, "research.deep_report"]
];

for (const [input, expected] of ruleCases) {
  const actual = ruleRouter.route(input)?.intent;
  if (actual !== expected) {
    throw new Error(\`Expected rule intent \${expected}, got \${actual}\`);
  }
}

const pendingResetContext = [
  { role: "user", content: "重置用户", intent: "profile.reset", createdAt: "2026-01-01T00:00:00Z" },
  {
    role: "assistant",
    content: "你确定要重置用户资料吗？请回复“确定”或“取消”。",
    intent: "profile.reset",
    createdAt: "2026-01-01T00:00:01Z"
  }
];

const confirmReset = ruleRouter.route({
  ...baseInput,
  message: "确定",
  recentMessages: pendingResetContext
});
if (confirmReset?.intent !== "profile.reset" || confirmReset.entities.confirmed !== true) {
  throw new Error("Expected contextual confirmation for profile.reset");
}

const cancelReset = ruleRouter.route({
  ...baseInput,
  message: "取消",
  recentMessages: pendingResetContext
});
if (cancelReset?.intent !== "conversation.clarify" || !cancelReset.needsClarification) {
  throw new Error("Expected contextual cancellation clarification");
}

const fakeLlmProvider = {
  async chat() {
    return JSON.stringify({
      intent: "conversation.general_qa",
      confidence: 0.88,
      entities: {},
      needsClarification: false
    });
  }
};

const intentRouter = new IntentRouter(fakeLlmProvider);
const llmRoute = await intentRouter.route({ ...baseInput, message: "解释一下边缘计算" });
if (llmRoute.decision.intent !== "conversation.general_qa") {
  throw new Error(\`Expected LLM intent conversation.general_qa, got \${llmRoute.decision.intent}\`);
}
if (!llmRoute.llmCall?.responseText) {
  throw new Error("Expected LLM call metadata");
}

console.log("intent router ok");
`
  );

  execFileSync("node", [testFile], { stdio: "inherit" });
} finally {
  rmSync(tempDir, { recursive: true, force: true });
}
