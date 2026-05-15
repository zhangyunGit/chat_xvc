import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const tempDir = mkdtempSync(join(tmpdir(), "chat-xvc-workers-ai-response-"));

try {
  execFileSync(
    "npx",
    [
      "esbuild",
      "src/providers/workers-ai-response.ts",
      "--bundle",
      "--format=esm",
      `--outfile=${join(tempDir, "workers-ai-response.mjs")}`
    ],
    { stdio: "inherit" }
  );

  const testFile = join(tempDir, "test.mjs");
  writeFileSync(
    testFile,
    `
import { parseWorkersAiTextResult } from "./workers-ai-response.mjs";

const cases = [
  ["plain string", "plain string"],
  [{ response: "llama response" }, "llama response"],
  [{ result: "qwen result" }, "qwen result"],
  [{ generated_text: "gemma generated" }, "gemma generated"],
  [{ response: "glm response" }, "glm response"],
  [{ result: { response: "glm nested response" } }, "glm nested response"],
  [{ choices: [{ message: { content: "glm openai-style chat" } }] }, "glm openai-style chat"],
  [{ text: "generic text" }, "generic text"],
  [{ choices: [{ message: { content: "openai message" } }] }, "openai message"],
  [{ choices: [{ text: "openai completion" }] }, "openai completion"],
  [{ choices: [{ delta: { content: "stream delta" } }] }, "stream delta"],
  [{ message: { content: "message content" } }, "message content"],
  [{ output_text: "responses output text" }, "responses output text"],
  [{ output: [{ content: [{ type: "output_text", text: "responses array" }] }] }, "responses array"],
  [{ content: [{ type: "text", text: "content array" }] }, "content array"],
  [{ result: { response: "nested workers ai" } }, "nested workers ai"]
];

for (const [input, expected] of cases) {
  const actual = parseWorkersAiTextResult(input);
  if (actual !== expected) {
    throw new Error(\`Expected "\${expected}", got "\${actual}" for \${JSON.stringify(input)}\`);
  }
}

if (parseWorkersAiTextResult({ usage: { tokens: 1 } }) !== null) {
  throw new Error("Expected null for object without assistant text");
}

console.log("workers ai response parser ok");
`
  );

  execFileSync("node", [testFile], { stdio: "inherit" });
} finally {
  rmSync(tempDir, { recursive: true, force: true });
}
