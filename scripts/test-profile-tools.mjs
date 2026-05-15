import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const tempDir = mkdtempSync(join(tmpdir(), "chat-xvc-profile-tools-"));

try {
  execFileSync(
    "npx",
    [
      "esbuild",
      "src/tools/profile-tools.ts",
      "--bundle",
      "--format=esm",
      `--outfile=${join(tempDir, "profile-tools.mjs")}`
    ],
    { stdio: "inherit" }
  );

  const testFile = join(tempDir, "test.mjs");
  writeFileSync(
    testFile,
    `
import { isProfileResetIntent } from "./profile-tools.mjs";

if (!isProfileResetIntent("重新开始")) throw new Error("Expected reset intent");
if (!isProfileResetIntent("我是另一个用户")) throw new Error("Expected switch-user intent");
if (isProfileResetIntent("查看我的任务")) throw new Error("Unexpected reset intent");

console.log("profile tools ok");
`
  );

  execFileSync("node", [testFile], { stdio: "inherit" });
} finally {
  rmSync(tempDir, { recursive: true, force: true });
}
