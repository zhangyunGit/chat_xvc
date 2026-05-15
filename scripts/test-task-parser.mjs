import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const tempDir = mkdtempSync(join(tmpdir(), "chat-xvc-task-parser-"));

try {
  execFileSync(
    "npx",
    [
      "esbuild",
      "src/tools/task-command-parser.ts",
      "--bundle",
      "--format=esm",
      `--outfile=${join(tempDir, "task-command-parser.mjs")}`
    ],
    { stdio: "inherit" }
  );

  const testFile = join(tempDir, "test.mjs");
  writeFileSync(
    testFile,
    `
import { parseTaskCommand } from "./task-command-parser.mjs";

const cases = [
  ["帮我创建任务：检查简历 明天下午3点", "create"],
  ["帮我创建一个任务：完成算法工程师简历优化，高优先级", "create"],
  ["查看我的任务", "list"],
  ["任务具体内容是什么？", "detail"],
  ["把检查简历改成准备面试，优先级改成高", "update"],
  ["完成任务 检查简历", "complete"],
  ["删除任务 检查简历", "delete"],
  ["给检查简历这个任务加一条要求：重点检查项目经历", "add_requirement"],
  ["修改检查简历任务的第1条要求，改成重点检查项目成果", "update_requirement"],
  ["删除检查简历任务的第1条要求", "delete_requirement"],
  ["把下面内容提取任务：检查简历；准备面试", "extract_from_text"]
];

for (const [message, expected] of cases) {
  const actual = parseTaskCommand(message).type;
  if (actual !== expected) {
    throw new Error(\`Expected \${expected} for "\${message}", got \${actual}\`);
  }
}

const updateCommand = parseTaskCommand("把检查简历改成准备面试，优先级改成高");
if (updateCommand.type !== "update") throw new Error("Expected update command");
if (updateCommand.dueAt !== undefined) throw new Error("Update without due date must not clear dueAt");
if (updateCommand.title !== "准备面试") throw new Error(\`Unexpected updated title: \${updateCommand.title}\`);

const createCommand = parseTaskCommand("帮我创建任务：检查简历，重点检查项目经历和量化成果 明天下午3点");
if (createCommand.type !== "create") throw new Error("Expected create command");
if (!createCommand.detail.includes("重点检查项目经历")) throw new Error("Expected create detail");

console.log("task parser ok");
`
  );

  execFileSync("node", [testFile], { stdio: "inherit" });
} finally {
  rmSync(tempDir, { recursive: true, force: true });
}
