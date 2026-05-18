import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const tempDir = mkdtempSync(join(tmpdir(), "chat-xvc-search-failure-reply-"));

try {
  execFileSync(
    "npx",
    [
      "esbuild",
      "src/services/chat-service.ts",
      "--bundle",
      "--format=esm",
      `--outfile=${join(tempDir, "chat-service.mjs")}`
    ],
    { stdio: "inherit" }
  );

  const testFile = join(tempDir, "test.mjs");
  writeFileSync(
    testFile,
    `
import { createSearchFailureReply } from "./chat-service.mjs";

const reply = createSearchFailureReply("SERPER_API_KEY 未配置");

if (!reply.includes("外部搜索暂时不可用")) throw new Error("Expected explicit search failure headline");
if (!reply.includes("SERPER_API_KEY 未配置")) throw new Error("Expected readable failure reason");
if (!reply.includes("稍后重试")) throw new Error("Expected retry guidance");

console.log("search failure reply ok");
`
  );

  execFileSync("node", [testFile], { stdio: "inherit" });
} finally {
  rmSync(tempDir, { recursive: true, force: true });
}
