import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const tempDir = mkdtempSync(join(tmpdir(), "chat-xvc-file-intents-"));

try {
  execFileSync(
    "npx",
    [
      "esbuild",
      "src/agents/rule-intent-router.ts",
      "--bundle",
      "--format=esm",
      `--outfile=${join(tempDir, "rule-intent-router.mjs")}`
    ],
    { stdio: "inherit" }
  );

  const testFile = join(tempDir, "test.mjs");
  writeFileSync(
    testFile,
    `
import { RuleIntentRouter } from "./rule-intent-router.mjs";

const router = new RuleIntentRouter();

function route(message) {
  return router.route({
    message,
    recentMessages: [],
    userName: null,
    userEmail: null,
    aiNickname: "XVC",
    profileChanged: false,
    profileReset: false,
    missingProfileFields: []
  })?.intent;
}

if (route("我上传了哪些文件") !== "document.list") throw new Error("Expected document.list");
if (route("列出我的文档列表") !== "document.list") throw new Error("Expected document.list");
if (route("怎么上传文件？") !== "document.upload_help") throw new Error("Expected document.upload_help");
if (route("删除 FILE_FEATURE_PROGRESS.md 这个文件") !== undefined) throw new Error("Expected document.delete to go through LLM");
if (route("根据文档回答：删除文件需要删除什么？") !== "document.qa") throw new Error("Expected document.qa");
if (route("请总结该文档内容") !== "document.summarize") throw new Error("Expected document.summarize");
if (route("我已上传文件：FILE_FEATURE_PROGRESS.md。\\n上传文件元数据：\\n- FILE_FEATURE_PROGRESS.md [fileId:abc]\\n请总结该文档内容") !== "document.summarize") {
  throw new Error("Expected uploaded file summary message to route to document.summarize");
}
if (route("我已上传文件：report.pdf。\\n上传文件元数据：\\n- report.pdf [fileId:pdf_1]\\n这篇 PDF 讲了什么内容？") !== "document.summarize") {
  throw new Error("Expected uploaded PDF content question to route to document.summarize");
}
if (route("我已上传文件：report.pdf。\\n上传文件元数据：\\n- report.pdf [fileId:pdf_1]\\n根据这篇 PDF 回答：核心观点是什么？") !== "document.qa") {
  throw new Error("Expected uploaded PDF QA question to route to document.qa");
}
if (route("查看我的任务") !== "task.list") throw new Error("Expected task.list");

console.log("file intents ok");
`
  );

  execFileSync("node", [testFile], { stdio: "inherit" });
} finally {
  rmSync(tempDir, { recursive: true, force: true });
}
