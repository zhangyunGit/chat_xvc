import type { LLMProvider } from "../providers/llm-provider";
import type { ChatMessage, ChatUiPayload, ChatUiResearchStep, ChatUiThink } from "../types/chat";
import type { SearchResult } from "../types/search";
import { SearchTools } from "../tools/search-tools";
import type { ConversationMessage, UserProfile } from "../types/domain";

const maxResearchSteps = 5;
const maxResultsPerStep = 6;
const maxSourcesForSynthesis = 20;

type ResearchPlanStep = {
  id: string;
  title: string;
  query: string;
  rationale: string;
};

type ResearchPlan = {
  thinking: string;
  objective: string;
  steps: ResearchPlanStep[];
};

type ResearchStepResult = {
  step: ResearchPlanStep;
  results: SearchResult[];
  analysis: string;
  error?: string;
};

export type ResearchWorkflowResult = {
  reply: string;
  webResults: SearchResult[];
  steps: ChatUiResearchStep[];
  thinks: ChatUiThink[];
  streamed?: boolean;
  llmCalls: Array<{
    stage: string;
    provider?: string;
    modelName?: string;
    responseText: string;
    promptMessages: ChatMessage[];
  }>;
};

export type ResearchObserver = {
  onStatus?: (status: { phase: "tool_running" | "external_search" | "model_thinking"; label: string }) => void;
  onUi?: (ui: ChatUiPayload) => void;
  onDelta?: (delta: string) => void | Promise<void>;
};

export class ResearchService {
  private readonly searchTools: SearchTools;

  constructor(
    private readonly env: Env,
    private readonly llmProvider: LLMProvider
  ) {
    this.searchTools = new SearchTools(env);
  }

  async runDeepResearch(input: {
    message: string;
    user: UserProfile;
    recentMessages?: ConversationMessage[];
    observer?: ResearchObserver;
  }): Promise<ResearchWorkflowResult> {
    const llmCalls: ResearchWorkflowResult["llmCalls"] = [];
    const thinks: ChatUiThink[] = [];
    const researchQuestion = resolveContextualResearchQuestion(input.message, input.recentMessages ?? []);

    input.observer?.onStatus?.({
      phase: "tool_running",
      label: "制定研究计划中"
    });

    const planMessages = createPlannerMessages({
      user: input.user,
      question: researchQuestion,
      originalMessage: input.message,
      recentMessages: input.recentMessages ?? []
    });
    const planStream = await this.runThinkingStream({
      id: "research-plan",
      title: "研究规划思考",
      messages: planMessages,
      observer: input.observer,
      options: {
        provider: "google-ai-studio",
        model: this.env.GEMINI_CHAT_MODEL
      }
    });
    const planResponse = planStream.text;
    llmCalls.push({
      stage: "research.plan",
      provider: "google-ai-studio",
      modelName: this.env.GEMINI_CHAT_MODEL,
      responseText: planResponse,
      promptMessages: planMessages
    });

    const plan = parseResearchPlan(planResponse, researchQuestion);
    const planThink = finalizeThinkContent(planStream.think, plan.thinking);
    thinks.push(planThink);

    let uiSteps = plan.steps.map(toPendingUiStep);
    input.observer?.onUi?.({
      researchSteps: uiSteps,
      thinks
    });

    const stepResults: ResearchStepResult[] = [];

    for (let index = 0; index < plan.steps.length; index += 1) {
      const step = plan.steps[index];
      uiSteps = updateStep(uiSteps, step.id, { status: "active" });
      input.observer?.onUi?.({ researchSteps: uiSteps });
      input.observer?.onStatus?.({
        phase: "external_search",
        label: `搜索：子问题 ${index + 1}/${plan.steps.length}`
      });

      try {
        const searchResponse = await this.searchTools.webSearch(step.query, {
          num: maxResultsPerStep,
          kind: "search"
        });
        const results = searchResponse.results;

        input.observer?.onStatus?.({
          phase: "model_thinking",
          label: `分析：子问题 ${index + 1}/${plan.steps.length}`
        });

        const analysisMessages = createStepAnalysisMessages({
          user: input.user,
          originalQuestion: researchQuestion,
          step,
          results
        });
        const analysis = await this.llmProvider.chat(analysisMessages, {
          provider: "google-ai-studio",
          model: this.env.GEMINI_CHAT_MODEL
        });
        llmCalls.push({
          stage: `research.step_analysis.${index + 1}`,
          provider: "google-ai-studio",
          modelName: this.env.GEMINI_CHAT_MODEL,
          responseText: analysis,
          promptMessages: analysisMessages
        });
        stepResults.push({ step, results, analysis });

        uiSteps = updateStep(uiSteps, step.id, {
          status: "success",
          summary: analysis.slice(0, 180)
        });
        input.observer?.onUi?.({ researchSteps: uiSteps });
      } catch (error) {
        const message = error instanceof Error ? error.message : "未知错误";
        stepResults.push({
          step,
          results: [],
          analysis: `该子问题搜索失败：${message}`,
          error: message
        });
        uiSteps = updateStep(uiSteps, step.id, {
          status: "fail",
          summary: `搜索失败：${message}`
        });
        input.observer?.onUi?.({ researchSteps: uiSteps });
      }
    }

    input.observer?.onStatus?.({
      phase: "model_thinking",
      label: "生成研究报告中"
    });

    const sources = dedupeSearchResults(stepResults.flatMap((item) => item.results)).slice(0, maxSourcesForSynthesis);
    const synthesisMessages = createSynthesisMessages({
      user: input.user,
      originalQuestion: researchQuestion,
      plan,
      stepResults,
      sources
    });
    const synthesisStream = await this.runThinkingStream({
      id: "research-synthesis",
      title: "汇总报告思考",
      messages: synthesisMessages,
      observer: input.observer,
      outputField: "report",
      onOutputDelta: input.observer?.onDelta,
      options: {
        provider: "google-ai-studio",
        model: this.env.GEMINI_CHAT_MODEL
      }
    });
    const synthesisResponse = synthesisStream.text;
    llmCalls.push({
      stage: "research.synthesis",
      provider: "google-ai-studio",
      modelName: this.env.GEMINI_CHAT_MODEL,
      responseText: synthesisResponse,
      promptMessages: synthesisMessages
    });

    const synthesis = parseSynthesis(synthesisResponse);
    thinks.push(finalizeThinkContent(synthesisStream.think, synthesis.thinking));
    input.observer?.onUi?.({
      researchSteps: uiSteps,
      thinks
    });

    return {
      reply: synthesis.report,
      webResults: sources,
      steps: uiSteps,
      thinks,
      streamed: synthesisStream.outputStreamed,
      llmCalls
    };
  }

  private async runThinkingStream(input: {
    id: string;
    title: string;
    messages: ChatMessage[];
    observer?: ResearchObserver;
    outputField?: string;
    onOutputDelta?: (delta: string) => void | Promise<void>;
    options: {
      provider: "google-ai-studio";
      model: string;
    };
  }): Promise<{ text: string; think: ChatUiThink; outputStreamed: boolean }> {
    const startedAt = Date.now();
    const think: ChatUiThink = {
      id: input.id,
      title: input.title,
      content: "",
      isDone: false
    };
    input.observer?.onUi?.({ thinkStart: think });

    const thinkingExtractor = createJsonStringFieldDeltaExtractor("thinking");
    const outputExtractor = input.outputField
      ? createJsonStringFieldDeltaExtractor(input.outputField)
      : null;
    let outputStreamed = false;
    const text = this.llmProvider.chatStream
      ? await this.llmProvider.chatStream(input.messages, input.options, (delta) => {
          const visibleDelta = thinkingExtractor.push(delta);
          if (visibleDelta) {
            think.content += visibleDelta;
            input.observer?.onUi?.({
              thinkDelta: {
                id: input.id,
                delta: visibleDelta
              }
            });
          }
          const outputDelta = outputExtractor?.push(delta) ?? "";
          if (outputDelta && input.onOutputDelta) {
            outputStreamed = true;
            return input.onOutputDelta(outputDelta);
          }
        })
      : await this.llmProvider.chat(input.messages, input.options);

    if (!this.llmProvider.chatStream) {
      think.content = extractJsonStringField(text, "thinking") || text;
      input.observer?.onUi?.({
        thinkDelta: {
          id: input.id,
          delta: think.content
        }
      });
    }

    think.isDone = true;
    think.thinkTime = Math.max(1, Math.round((Date.now() - startedAt) / 1000));
    input.observer?.onUi?.({
      thinkDone: {
        id: input.id,
        thinkTime: think.thinkTime
      }
    });

    return { text, think, outputStreamed };
  }
}

function createPlannerMessages(input: {
  user: UserProfile;
  question: string;
  originalMessage: string;
  recentMessages: ConversationMessage[];
}): ChatMessage[] {
  return [
    {
      role: "system",
      content: [
        "你是 Chat XVC 的 ResearchPlanner，使用更强模型负责深度研究的总规划。",
        "请输出 JSON，不要输出 markdown。",
        "如果用户当前问题使用“它/这个/上述对象/那家公司/那只股票”等指代，必须依据最近对话解析研究对象。",
        "用户资料中的姓名只用于称呼用户，不能当作研究对象，除非用户当前问题明确要求研究该姓名。",
        "JSON schema:",
        '{"thinking":"规划思考过程，简洁但要说明拆解理由","objective":"研究目标","steps":[{"id":"s1","title":"子任务标题","query":"搜索 query","rationale":"为什么需要查这个"}]}',
        `最多 ${maxResearchSteps} 个子任务。搜索 query 应适合直接提交给 Google/Serper。`,
        "如果问题是比较类，子任务要覆盖比较维度；如果是事实核查，要覆盖来源可信度和反例。"
      ].join("\n")
    },
    {
      role: "user",
      content: [
        `用户姓名：${input.user.name ?? "未知用户"}`,
        "最近对话：",
        formatRecentConversation(input.recentMessages),
        "",
        "用户当前原始请求：",
        input.originalMessage,
        "",
        "已解析后的研究问题：",
        input.question
      ].join("\n")
    }
  ];
}

function createStepAnalysisMessages(input: {
  user: UserProfile;
  originalQuestion: string;
  step: ResearchPlanStep;
  results: SearchResult[];
}): ChatMessage[] {
  return [
    {
      role: "system",
      content: [
        "你是 Chat XVC 的子任务搜索分析员，使用快速模型分析单个研究子问题。",
        "只基于提供的搜索结果，输出 3-5 条要点。",
        "指出可靠事实、可能推断和信息缺口。不要编造来源。"
      ].join("\n")
    },
    {
      role: "user",
      content: [
        "原始问题：",
        input.originalQuestion,
        "",
        `子任务：${input.step.title}`,
        `搜索 query：${input.step.query}`,
        "",
        "搜索结果：",
        formatSearchResults(input.results)
      ].join("\n")
    }
  ];
}

function createSynthesisMessages(input: {
  user: UserProfile;
  originalQuestion: string;
  plan: ResearchPlan;
  stepResults: ResearchStepResult[];
  sources: SearchResult[];
}): ChatMessage[] {
  return [
    {
      role: "system",
      content: [
        "你是 Chat XVC 的 ResearchSynthesizer，使用更强模型负责最终深度研究报告。",
        "请输出 JSON，不要输出 markdown 包裹。",
        "JSON schema:",
        '{"thinking":"汇总思考过程，说明如何综合各子任务、如何处理冲突和缺口","report":"面向用户的最终中文研究报告，使用 markdown"}',
        "报告必须包含：结论摘要、分主题分析、关键对比或事实核查、信息局限、来源列表。",
        "引用来源时使用搜索结果编号，例如 [1]、[2]。不要引用不存在的来源。"
      ].join("\n")
    },
    {
      role: "user",
      content: [
        `用户：${input.user.name ?? "未知用户"}`,
        "原始问题：",
        input.originalQuestion,
        "",
        "研究目标：",
        input.plan.objective,
        "",
        "子任务分析：",
        input.stepResults
          .map((item, index) => {
            const error = item.error ? `\n失败原因：${item.error}` : "";
            return `${index + 1}. ${item.step.title}\n搜索 query：${item.step.query}${error}\n分析：${item.analysis}`;
          })
          .join("\n\n"),
        "",
        "全局来源：",
        formatSearchResults(input.sources)
      ].join("\n")
    }
  ];
}

function parseResearchPlan(text: string, fallbackQuestion: string): ResearchPlan {
  const parsed = parseJsonObject(text);
  const rawSteps = Array.isArray(parsed?.steps) ? parsed.steps : [];
  const steps = rawSteps
    .map((item, index): ResearchPlanStep | null => {
      if (!isRecord(item)) return null;
      const title = typeof item.title === "string" && item.title.trim() ? item.title.trim() : `子问题 ${index + 1}`;
      const query = typeof item.query === "string" && item.query.trim() ? item.query.trim() : `${fallbackQuestion} ${title}`;
      return {
        id: typeof item.id === "string" && item.id.trim() ? item.id.trim() : `s${index + 1}`,
        title,
        query,
        rationale: typeof item.rationale === "string" ? item.rationale : ""
      };
    })
    .filter((item): item is ResearchPlanStep => Boolean(item))
    .slice(0, maxResearchSteps);

  return {
    thinking: typeof parsed?.thinking === "string" ? parsed.thinking : "根据用户问题拆解研究目标和搜索子任务。",
    objective: typeof parsed?.objective === "string" ? parsed.objective : fallbackQuestion,
    steps: steps.length > 0
      ? steps
      : [
          {
            id: "s1",
            title: "核心资料检索",
            query: fallbackQuestion,
            rationale: "模型规划未返回有效子任务，使用原始问题直接搜索。"
          }
        ]
  };
}

function parseSynthesis(text: string): { thinking: string; report: string } {
  const parsed = parseJsonObject(text);
  if (typeof parsed?.report === "string" && parsed.report.trim()) {
    return {
      thinking: typeof parsed.thinking === "string" ? parsed.thinking : "综合子任务分析和来源生成最终报告。",
      report: parsed.report
    };
  }

  return {
    thinking: "模型未返回结构化 JSON，直接使用原始输出作为报告。",
    report: text
  };
}

function resolveContextualResearchQuestion(message: string, recentMessages: ConversationMessage[]): string {
  const trimmed = message.trim();
  if (!hasContextualReference(trimmed)) return trimmed;

  const target = findRecentResearchTarget(recentMessages);
  if (!target) return trimmed;

  return `围绕“${target}”进行深度研究。用户当前原始请求：${trimmed}`;
}

function hasContextualReference(message: string): boolean {
  return /它|这个|该|上述|上面|前面|刚才|那家|那只|这家公司|这只股票|这个股票/u.test(message);
}

function findRecentResearchTarget(messages: ConversationMessage[]): string | null {
  for (const message of [...messages].reverse()) {
    const content = normalizeConversationContent(message.content);
    const target =
      extractStockTarget(content) ??
      extractConcernedTarget(content) ??
      extractQuotedTarget(content);

    if (target) return target;
  }

  return null;
}

function extractStockTarget(content: string): string | null {
  const withCode = content.match(/([\u4e00-\u9fa5A-Za-z][\u4e00-\u9fa5A-Za-z0-9·]{1,24})[（(]\s*([0-9]{6}(?:\.[A-Z]{2})?)\s*[）)]/u);
  if (withCode?.[1] && withCode[2]) {
    return `${withCode[1].trim()}（${withCode[2].trim()}）`;
  }

  const stock = content.match(/(?:觉得|分析|研究|关注|关心|买|卖)?\s*([\u4e00-\u9fa5A-Za-z][\u4e00-\u9fa5A-Za-z0-9·]{1,24})(?:这个|这只|该)?股票/u);
  return stock?.[1]?.trim() ?? null;
}

function extractConcernedTarget(content: string): string | null {
  const match = content.match(/(?:针对你关心的|关于|围绕|研究对象[：:])\s*[“"']?([^”"',，。；;：:\n（(]{2,40})/u);
  return match?.[1]?.trim() ?? null;
}

function extractQuotedTarget(content: string): string | null {
  const matches = [...content.matchAll(/[“"']([^”"'\n]{2,40})[”"']/gu)]
    .map((match) => match[1].trim())
    .filter((value) => !/帮我|请|是否|什么|怎么|如何|为什么/u.test(value));

  return matches.at(-1) ?? null;
}

function normalizeConversationContent(content: string): string {
  return content
    .replace(/\[[a-z]+:[^\]]+\]/giu, "")
    .replace(/\s+/g, " ")
    .trim();
}

function formatRecentConversation(messages: ConversationMessage[]): string {
  if (messages.length === 0) return "无。";

  return messages
    .slice(-8)
    .map((message) => {
      const role = message.role === "user" ? "用户" : message.role === "assistant" ? "助手" : "系统";
      return `${role}：${normalizeConversationContent(message.content).slice(0, 900)}`;
    })
    .join("\n");
}

function parseJsonObject(text: string): Record<string, unknown> | null {
  const trimmed = text.trim();
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1]?.trim();
  const candidates = [trimmed, fenced].filter((item): item is string => Boolean(item));

  for (const candidate of candidates) {
    try {
      const parsed = JSON.parse(candidate);
      return isRecord(parsed) ? parsed : null;
    } catch {
      const start = candidate.indexOf("{");
      const end = candidate.lastIndexOf("}");
      if (start >= 0 && end > start) {
        try {
          const parsed = JSON.parse(candidate.slice(start, end + 1));
          return isRecord(parsed) ? parsed : null;
        } catch {
          // Try the next candidate.
        }
      }
    }
  }

  return null;
}

function toPendingUiStep(step: ResearchPlanStep): ChatUiResearchStep {
  return {
    id: step.id,
    title: step.title,
    query: step.query,
    status: "pending"
  };
}

function updateStep(
  steps: ChatUiResearchStep[],
  stepId: string,
  patch: Partial<ChatUiResearchStep>
): ChatUiResearchStep[] {
  return steps.map((step) => step.id === stepId ? { ...step, ...patch } : step);
}

function toThink(input: {
  id: string;
  title: string;
  content: string;
  startedAt: number;
}): ChatUiThink {
  return {
    id: input.id,
    title: input.title,
    content: input.content,
    isDone: true,
    thinkTime: Math.max(1, Math.round((Date.now() - input.startedAt) / 1000))
  };
}

function finalizeThinkContent(think: ChatUiThink, parsedThinking: string): ChatUiThink {
  return {
    ...think,
    content: parsedThinking || think.content,
    isDone: true
  };
}

function createJsonStringFieldDeltaExtractor(fieldName: string): { push: (chunk: string) => string } {
  let mode: "search_key" | "after_key" | "before_value" | "in_value" | "done" = "search_key";
  let inKeyString = false;
  let keyEscape = false;
  let currentKey = "";
  let valueEscape = false;
  let unicodeEscape: string | null = null;

  return {
    push(chunk: string): string {
      let output = "";

      for (const char of chunk) {
        if (mode === "done") break;

        if (mode === "search_key") {
          if (!inKeyString) {
            if (char === '"') {
              inKeyString = true;
              keyEscape = false;
              currentKey = "";
            }
            continue;
          }

          if (keyEscape) {
            currentKey += decodeJsonEscape(char);
            keyEscape = false;
            continue;
          }

          if (char === "\\") {
            keyEscape = true;
            continue;
          }

          if (char === '"') {
            inKeyString = false;
            if (currentKey === fieldName) {
              mode = "after_key";
            }
            continue;
          }

          currentKey += char;
          continue;
        }

        if (mode === "after_key") {
          if (/\s/.test(char)) continue;
          mode = char === ":" ? "before_value" : "search_key";
          continue;
        }

        if (mode === "before_value") {
          if (/\s/.test(char)) continue;
          if (char === '"') {
            mode = "in_value";
            valueEscape = false;
            unicodeEscape = null;
          } else {
            mode = "done";
          }
          continue;
        }

        if (unicodeEscape !== null) {
          unicodeEscape += char;
          if (unicodeEscape.length === 4) {
            output += String.fromCharCode(Number.parseInt(unicodeEscape, 16));
            unicodeEscape = null;
            valueEscape = false;
          }
          continue;
        }

        if (valueEscape) {
          if (char === "u") {
            unicodeEscape = "";
            continue;
          }
          output += decodeJsonEscape(char);
          valueEscape = false;
          continue;
        }

        if (char === "\\") {
          valueEscape = true;
          continue;
        }

        if (char === '"') {
          mode = "done";
          continue;
        }

        output += char;
      }

      return output;
    }
  };
}

function extractJsonStringField(text: string, fieldName: string): string {
  const extractor = createJsonStringFieldDeltaExtractor(fieldName);
  return extractor.push(text);
}

function decodeJsonEscape(char: string): string {
  switch (char) {
    case '"':
      return '"';
    case "\\":
      return "\\";
    case "/":
      return "/";
    case "b":
      return "\b";
    case "f":
      return "\f";
    case "n":
      return "\n";
    case "r":
      return "\r";
    case "t":
      return "\t";
    default:
      return char;
  }
}

function dedupeSearchResults(results: SearchResult[]): SearchResult[] {
  const seen = new Set<string>();
  const deduped: SearchResult[] = [];

  for (const result of results) {
    const key = normalizeResultKey(result.link || result.title);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    deduped.push(result);
  }

  return deduped.map((result, index) => ({
    ...result,
    position: index + 1
  }));
}

function normalizeResultKey(value: string): string {
  try {
    const url = new URL(value);
    url.hash = "";
    url.search = "";
    return `${url.hostname.replace(/^www\./, "")}${url.pathname.replace(/\/$/, "")}`.toLowerCase();
  } catch {
    return value.toLowerCase().replace(/\s+/g, " ").trim();
  }
}

function formatSearchResults(results: SearchResult[]): string {
  if (results.length === 0) return "无搜索结果。";

  return results
    .map((result, index) => {
      const date = result.date ? `\n  日期：${result.date}` : "";
      const source = result.source ? `\n  来源：${result.source}` : "";
      return `[${index + 1}] ${result.title}\n  URL：${result.link}${source}\n  摘要：${result.snippet}${date}`;
    })
    .join("\n");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
