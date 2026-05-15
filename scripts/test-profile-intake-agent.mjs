import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const tempDir = mkdtempSync(join(tmpdir(), "chat-xvc-profile-intake-agent-"));

try {
  execFileSync(
    "npx",
    [
      "esbuild",
      "src/agents/profile-intake-agent.ts",
      "--bundle",
      "--format=esm",
      `--outfile=${join(tempDir, "profile-intake-agent.mjs")}`
    ],
    { stdio: "inherit" }
  );

  const testFile = join(tempDir, "test.mjs");
  writeFileSync(
    testFile,
    `
import { ProfileIntakeAgent } from "./profile-intake-agent.mjs";

const user = {
  id: "u1",
  name: null,
  email: null,
  aiNickname: "XVC",
  profileStatus: "pending",
  createdAt: "",
  updatedAt: ""
};

const provider = {
  async chat() {
    return '{"name":"张云","email":"666@qq.com","aiNickname":"豆豆","refused":false,"ignored":false,"shouldContinueNormalChat":false,"confidence":0.98}';
  }
};

const result = await new ProfileIntakeAgent(provider).extract({
  user,
  message: "张云,666@qq.com",
  recentMessages: []
});

if (result.decision.name !== "张云") throw new Error("Expected name");
if (result.decision.email !== "666@qq.com") throw new Error("Expected email");
if (result.decision.aiNickname !== "豆豆") throw new Error("Expected ai nickname");
if (result.decision.ignored) throw new Error("Unexpected ignored");

console.log("profile intake agent ok");
`
  );

  execFileSync("node", [testFile], { stdio: "inherit" });
} finally {
  rmSync(tempDir, { recursive: true, force: true });
}
