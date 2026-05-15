import { getIntentRegistryItem } from "./intent-registry";
import type { IntentDecision, IntentName } from "../types/intent";

export function createIntentDecision(input: {
  intent: IntentName;
  confidence: number;
  entities?: Record<string, unknown>;
  needsClarification?: boolean;
  clarificationQuestion?: string;
  source: IntentDecision["source"];
}): IntentDecision {
  const registryItem = getIntentRegistryItem(input.intent);

  return {
    intent: input.intent,
    confidence: clampConfidence(input.confidence),
    entities: input.entities ?? {},
    requiredTools: registryItem.requiredTools,
    promptTemplate: registryItem.promptTemplate,
    needsClarification: input.needsClarification ?? false,
    clarificationQuestion: input.clarificationQuestion,
    needsRag: registryItem.needsRag,
    needsWebSearch: registryItem.needsWebSearch,
    shouldWriteMemory: registryItem.shouldWriteMemory,
    source: input.source
  };
}

export function createFallbackClarification(question: string): IntentDecision {
  return createIntentDecision({
    intent: "conversation.clarify",
    confidence: 0.4,
    needsClarification: true,
    clarificationQuestion: question,
    source: "fallback"
  });
}

function clampConfidence(confidence: number): number {
  return Math.max(0, Math.min(1, confidence));
}

