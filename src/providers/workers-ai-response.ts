type UnknownRecord = Record<string, unknown>;

const directTextFields = [
  "response",
  "result",
  "text",
  "output_text",
  "generated_text",
  "completion",
  "answer"
];

export function parseWorkersAiTextResult(result: unknown): string | null {
  if (typeof result === "string") {
    return normalizeText(result);
  }

  if (!isRecord(result)) {
    return null;
  }

  const direct = extractDirectText(result);
  if (direct) return direct;

  const choiceText = extractChoiceText(result);
  if (choiceText) return choiceText;

  const messageText = extractMessageText(result);
  if (messageText) return messageText;

  const nestedMessage = isRecord(result.message) ? extractMessageText(result.message) : null;
  if (nestedMessage) return nestedMessage;

  const outputText = extractOutputText(result);
  if (outputText) return outputText;

  const contentText = extractContentText(result.content);
  if (contentText) return contentText;

  const nestedResult = isRecord(result.result) ? parseWorkersAiTextResult(result.result) : null;
  if (nestedResult) return nestedResult;

  const nestedResponse = isRecord(result.response) ? parseWorkersAiTextResult(result.response) : null;
  if (nestedResponse) return nestedResponse;

  return null;
}

export function describeWorkersAiResultShape(result: unknown): string {
  if (result === null) return "null";
  if (Array.isArray(result)) return "array";
  if (typeof result !== "object") return typeof result;

  const keys = Object.keys(result as UnknownRecord).slice(0, 12);
  return `object keys: ${keys.length > 0 ? keys.join(", ") : "(empty)"}`;
}

function extractDirectText(record: UnknownRecord): string | null {
  for (const field of directTextFields) {
    const value = record[field];
    if (typeof value === "string") {
      const text = normalizeText(value);
      if (text) return text;
    }
  }

  return null;
}

function extractChoiceText(record: UnknownRecord): string | null {
  if (!Array.isArray(record.choices)) {
    return null;
  }

  const texts = record.choices
    .map((choice) => {
      if (typeof choice === "string") return choice;
      if (!isRecord(choice)) return null;

      const direct = extractDirectText(choice);
      if (direct) return direct;

      const message = isRecord(choice.message) ? extractMessageText(choice.message) : null;
      if (message) return message;

      const delta = isRecord(choice.delta) ? extractMessageText(choice.delta) : null;
      if (delta) return delta;

      return extractContentText(choice.content);
    })
    .filter((text): text is string => Boolean(text));

  return joinTextParts(texts);
}

function extractMessageText(record: UnknownRecord): string | null {
  const direct = extractDirectText(record);
  if (direct) return direct;

  if (typeof record.content === "string") {
    return normalizeText(record.content);
  }

  return extractContentText(record.content);
}

function extractOutputText(record: UnknownRecord): string | null {
  if (!Array.isArray(record.output)) {
    return null;
  }

  const texts = record.output
    .map((item) => {
      if (typeof item === "string") return item;
      if (!isRecord(item)) return null;

      const direct = extractDirectText(item);
      if (direct) return direct;

      return extractContentText(item.content);
    })
    .filter((text): text is string => Boolean(text));

  return joinTextParts(texts);
}

function extractContentText(content: unknown): string | null {
  if (typeof content === "string") {
    return normalizeText(content);
  }

  if (!Array.isArray(content)) {
    return null;
  }

  const texts = content
    .map((part) => {
      if (typeof part === "string") return part;
      if (!isRecord(part)) return null;

      const direct = extractDirectText(part);
      if (direct) return direct;

      if (isRecord(part.text)) {
        return extractDirectText(part.text);
      }

      return null;
    })
    .filter((text): text is string => Boolean(text));

  return joinTextParts(texts);
}

function joinTextParts(parts: string[]): string | null {
  const text = parts.map(normalizeText).filter(Boolean).join("");
  return text || null;
}

function normalizeText(text: string): string {
  return text.trim();
}

function isRecord(value: unknown): value is UnknownRecord {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
