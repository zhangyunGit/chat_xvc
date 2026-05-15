import type { LLMProvider } from "../providers/llm-provider";
import type { IntentRouteInput, IntentRouteResult } from "../types/intent";
import { createFallbackClarification } from "./intent-utils";
import { LlmIntentRouter } from "./llm-intent-router";
import { RuleIntentRouter } from "./rule-intent-router";

const ruleConfidenceThreshold = 0.85;
const llmConfidenceThreshold = 0.65;

export class IntentRouter {
  private readonly llmIntentRouter: LlmIntentRouter;
  private readonly ruleIntentRouter = new RuleIntentRouter();

  constructor(llmProvider: LLMProvider) {
    this.llmIntentRouter = new LlmIntentRouter(llmProvider);
  }

  async route(input: IntentRouteInput): Promise<IntentRouteResult> {
    const ruleDecision = this.ruleIntentRouter.route(input);

    if (ruleDecision && ruleDecision.confidence >= ruleConfidenceThreshold) {
      return { decision: ruleDecision };
    }

    const llmRoute = await this.llmIntentRouter.route(input);

    if (
      ruleDecision?.intent === "task.create" &&
      llmRoute.decision.intent !== "task.create"
    ) {
      return {
        decision: ruleDecision,
        llmCall: {
          promptMessages: llmRoute.promptMessages,
          responseText: llmRoute.responseText
        }
      };
    }

    if (llmRoute.decision.confidence < llmConfidenceThreshold) {
      if (ruleDecision) {
        return {
          decision: ruleDecision,
          llmCall: {
            promptMessages: llmRoute.promptMessages,
            responseText: llmRoute.responseText
          }
        };
      }

      return {
        decision: createFallbackClarification(
          llmRoute.decision.clarificationQuestion ?? "你希望我执行什么操作？"
        ),
        llmCall: {
          promptMessages: llmRoute.promptMessages,
          responseText: llmRoute.responseText
        }
      };
    }

    return {
      decision: llmRoute.decision,
      llmCall: {
        promptMessages: llmRoute.promptMessages,
        responseText: llmRoute.responseText
      }
    };
  }
}
