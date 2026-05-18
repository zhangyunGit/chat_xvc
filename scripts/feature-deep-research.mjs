import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const tempDir = mkdtempSync(join(tmpdir(), "chat-xvc-feature-deep-research-"));

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

const searchCalls = [];
globalThis.fetch = async (url, init) => {
  const body = JSON.parse(init.body);
  searchCalls.push(body.q);
  return {
    ok: true,
    async json() {
      const index = searchCalls.length;
      return {
        organic: [
          {
            title: "搜索结果 " + index,
            link: "https://example.com/research/" + index,
            snippet: "这是第 " + index + " 个研究子任务的公开资料摘要。",
            source: "Example",
            position: 1
          }
        ]
      };
    }
  };
};

const modelCalls = [];
async function streamText(text, onDelta) {
  for (let index = 0; index < text.length; index += 8) {
    onDelta(text.slice(index, index + 8));
  }
  return text;
}

const llmProvider = {
  async chatStream(messages, options = {}, onDelta) {
    modelCalls.push({ messages, options, stream: true });
    const system = messages[0].content;
    if (system.includes("ResearchPlanner")) {
      return streamText(JSON.stringify({
        thinking: "先确认研究对象，再拆成业务、财务和风险。",
        objective: "对浪潮信息进行深度研究",
        steps: [
          { id: "s1", title: "业务与行业", query: "浪潮信息 业务 行业 AI服务器", rationale: "确认主营业务和行业位置" },
          { id: "s2", title: "财务与估值", query: "浪潮信息 财报 估值", rationale: "查看财务和估值" },
          { id: "s3", title: "风险因素", query: "浪潮信息 风险 供应链", rationale: "识别主要风险" }
        ]
      }), onDelta);
    }
    if (system.includes("ResearchSynthesizer")) {
      return streamText(JSON.stringify({
        thinking: "把搜索结果和子任务分析合并成结构化报告。",
        report: "# 浪潮信息深度研究\\n\\n## 结论\\n需要结合业务增长、估值和供应链风险综合判断。\\n\\n## 来源\\n参考 [1] [2] [3]。"
      }), onDelta);
    }
    throw new Error("Unexpected streaming model call");
  },
  async chat(messages, options = {}) {
    modelCalls.push({ messages, options, stream: false });
    const system = messages[0].content;
    if (!system.includes("子任务搜索分析员")) throw new Error("Expected step analyzer");
    return "子任务分析：" + messages[1].content.slice(0, 60);
  }
};

const env = {
  SERPER_API_KEY: "test-key",
  GEMINI_CHAT_MODEL: "gemini-3-flash-preview",
  CACHE: undefined
};

const user = {
  id: "feature-user",
  name: "张宇",
  email: "user@example.com",
  aiNickname: "阿六",
  profileStatus: "completed",
  createdAt: "",
  updatedAt: ""
};

const uiEvents = [];
const result = await new ResearchService(env, llmProvider).runDeepResearch({
  message: "帮我对它进行深度研究下",
  user,
  recentMessages: [
    {
      id: "m1",
      conversationId: "c1",
      role: "user",
      content: "很好。你觉得浪潮信息这个股票还能买吗",
      intent: "conversation.chitchat",
      createdAt: ""
    },
    {
      id: "m2",
      conversationId: "c1",
      role: "assistant",
      content: "你好张宇，我是阿六。针对你关心的“浪潮信息（000977.SZ）”股票分析，我整理了市场表现与技术面。",
      intent: "conversation.chitchat",
      createdAt: ""
    }
  ],
  observer: {
    onUi(ui) {
      uiEvents.push(ui);
    }
  }
});

if (searchCalls.length !== 3) throw new Error("Expected one web search per planned step");
if (modelCalls.length !== 5) throw new Error("Expected planner, three step analyses, and synthesis");
if (!modelCalls.every((call) => call.options.provider === "google-ai-studio")) {
  throw new Error("Expected Gemini provider for research workflow");
}
if (!result.reply.includes("# 浪潮信息深度研究")) throw new Error("Expected final research report");
if (result.steps.length !== 3 || !result.steps.every((step) => step.status === "success")) {
  throw new Error("Expected successful research steps");
}
if (!result.webResults || result.webResults.length !== 3) throw new Error("Expected web results on final output");

const plannerInput = modelCalls[0].messages[1].content;
if (!plannerInput.includes("围绕“浪潮信息（000977.SZ）”进行深度研究")) {
  throw new Error("Expected pronoun target to resolve to 浪潮信息");
}
if (plannerInput.includes("围绕“张宇”进行深度研究")) {
  throw new Error("User profile name must not become research target");
}

const thinkingStream = uiEvents.flatMap((ui) => ui.thinkDelta ? [ui.thinkDelta.delta] : []).join("");
if (!thinkingStream.includes("先确认研究对象")) throw new Error("Expected planner thinking stream");
if (!thinkingStream.includes("结构化报告")) throw new Error("Expected synthesis thinking stream");
if (!uiEvents.some((ui) => ui.researchSteps?.some((step) => step.status === "active"))) {
  throw new Error("Expected active research step UI updates");
}

console.log("feature deep research ok");
`
  );

  execFileSync("node", [testFile], { stdio: "inherit" });
} finally {
  rmSync(tempDir, { recursive: true, force: true });
}
