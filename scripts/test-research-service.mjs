import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const tempDir = mkdtempSync(join(tmpdir(), "chat-xvc-research-service-"));

try {
  execFileSync(
    "npx",
    [
      "esbuild",
      "src/services/research-service.ts",
      "--bundle",
      "--format=esm",
      `--outfile=${join(tempDir, "research-service.mjs")}`
    ],
    { stdio: "inherit" }
  );

  const testFile = join(tempDir, "test.mjs");
  writeFileSync(
    testFile,
    `
import { ResearchService } from "./research-service.mjs";

let fetchCalls = 0;
globalThis.fetch = async () => {
  fetchCalls += 1;
  return {
    ok: true,
    async json() {
      return {
        organic: [
          { title: "Result " + fetchCalls, link: "https://example.com/" + fetchCalls, snippet: "Snippet", source: "Example", position: 1 }
        ]
      };
    }
  };
};

const modelCalls = [];
const streamJson = async (text, onDelta) => {
  for (let index = 0; index < text.length; index += 9) {
    onDelta(text.slice(index, index + 9));
  }
  return text;
};
const llmProvider = {
  async chatStream(messages, options = {}, onDelta) {
    modelCalls.push({ messages, options, stream: true });
    const system = messages[0].content;
    if (system.includes("ResearchPlanner")) {
      return streamJson(JSON.stringify({
        thinking: "先拆成产品和价格两个子任务。",
        objective: "比较方案",
        steps: [
          { id: "s1", title: "产品能力", query: "product capability", rationale: "看能力" },
          { id: "s2", title: "价格", query: "pricing", rationale: "看成本" }
        ]
      }), onDelta);
    }
    if (system.includes("ResearchSynthesizer")) {
      return streamJson(JSON.stringify({
        thinking: "综合两个子任务并按来源编号引用。",
        report: "# 报告\\n\\n结论来自 [1] 和 [2]。"
      }), onDelta);
    }
    throw new Error("Unexpected streaming model call");
  },
  async chat(messages, options = {}) {
    modelCalls.push({ messages, options });
    const system = messages[0].content;
    if (system.includes("ResearchPlanner")) {
      return JSON.stringify({
        thinking: "先拆成产品和价格两个子任务。",
        objective: "比较方案",
        steps: [
          { id: "s1", title: "产品能力", query: "product capability", rationale: "看能力" },
          { id: "s2", title: "价格", query: "pricing", rationale: "看成本" }
        ]
      });
    }
    if (system.includes("ResearchSynthesizer")) {
      return JSON.stringify({
        thinking: "综合两个子任务并按来源编号引用。",
        report: "# 报告\\n\\n结论来自 [1] 和 [2]。"
      });
    }
    return "子任务分析要点";
  }
};

const env = {
  SERPER_API_KEY: "test-key",
  GEMINI_CHAT_MODEL: "gemini-3-flash-preview",
  CACHE: undefined
};

const user = {
  id: "u1",
  name: "张云",
  email: "user@example.com",
  aiNickname: "XVC",
  profileStatus: "completed",
  createdAt: "",
  updatedAt: ""
};

const uiEvents = [];
const result = await new ResearchService(env, llmProvider).runDeepResearch({
  message: "深度调研 A 和 B",
  user,
  observer: {
    onUi: (ui) => uiEvents.push(ui)
  }
});

if (fetchCalls !== 2) throw new Error("Expected one search per planned step");
if (modelCalls.length !== 4) throw new Error("Expected planner, two analyses, and synthesis calls");
if (modelCalls[0].options.provider !== "google-ai-studio") throw new Error("Planner should use Gemini provider");
if (modelCalls[0].options.model !== "gemini-3-flash-preview") throw new Error("Planner should use Gemini flash model");
if (modelCalls[1].options.provider !== "google-ai-studio") throw new Error("Step analysis should use Gemini provider");
if (modelCalls[1].options.model !== "gemini-3-flash-preview") throw new Error("Step analysis should use Gemini flash model");
if (modelCalls[3].options.model !== "gemini-3-flash-preview") throw new Error("Synthesis should use Gemini flash model");
if (!result.reply.includes("# 报告")) throw new Error("Expected final report");
if (result.steps.length !== 2 || !result.steps.every((step) => step.status === "success")) throw new Error("Expected successful UI steps");
if (result.thinks.length !== 2) throw new Error("Expected planner and synthesis thinking");
if (!uiEvents.some((ui) => ui.researchSteps?.some((step) => step.status === "active"))) throw new Error("Expected active step UI update");
const thinkDeltas = uiEvents.flatMap((ui) => ui.thinkDelta ? [ui.thinkDelta.delta] : []);
const streamedThinking = thinkDeltas.join("");
if (!streamedThinking.includes("先拆成产品和价格两个子任务。")) throw new Error("Expected planner thinking stream");
if (!streamedThinking.includes("综合两个子任务并按来源编号引用。")) throw new Error("Expected synthesis thinking stream");
if (streamedThinking.includes("steps") || streamedThinking.includes("report")) {
  throw new Error("Think stream should not include JSON fields outside thinking");
}

modelCalls.length = 0;
fetchCalls = 0;
await new ResearchService(env, llmProvider).runDeepResearch({
  message: "帮我对它进行深度研究下",
  user,
  recentMessages: [
    {
      id: "m1",
      conversationId: "c1",
      role: "user",
      content: "很好。你觉得浪潮信息这个股票还能买吗",
      intent: "conversation.general_qa",
      createdAt: ""
    },
    {
      id: "m2",
      conversationId: "c1",
      role: "assistant",
      content: "你好张云，我是 XVC。针对你关心的“浪潮信息（000977.SZ）”股票分析，我整理了以下要点。",
      intent: "conversation.general_qa",
      createdAt: ""
    }
  ],
  observer: {
    onUi: () => undefined
  }
});

const contextualPlannerInput = modelCalls[0].messages[1].content;
if (!contextualPlannerInput.includes("围绕“浪潮信息（000977.SZ）”进行深度研究")) {
  throw new Error("Expected contextual research question to resolve pronoun to 浪潮信息");
}
if (contextualPlannerInput.includes("围绕“张云”进行深度研究")) {
  throw new Error("User profile name must not be used as contextual research target");
}

console.log("research service ok");
`
  );

  execFileSync("node", [testFile], { stdio: "inherit" });
} finally {
  rmSync(tempDir, { recursive: true, force: true });
}
