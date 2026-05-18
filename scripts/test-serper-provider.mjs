import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const tempDir = mkdtempSync(join(tmpdir(), "chat-xvc-serper-provider-"));

try {
  execFileSync(
    "npx",
    [
      "esbuild",
      "src/providers/serper-provider.ts",
      "--bundle",
      "--format=esm",
      `--outfile=${join(tempDir, "serper-provider.mjs")}`
    ],
    { stdio: "inherit" }
  );

  const testFile = join(tempDir, "test.mjs");
  writeFileSync(
    testFile,
    `
import { SerperProvider } from "./serper-provider.mjs";

let capturedRequest = null;
globalThis.fetch = async (url, init) => {
  capturedRequest = {
    url,
    method: init.method,
    headers: init.headers,
    body: JSON.parse(init.body)
  };

  return {
    ok: true,
    async json() {
      return {
        organic: [
          { title: "Cloudflare Workers", link: "https://developers.cloudflare.com/workers/", snippet: "Workers docs", position: 1 }
        ],
        news: [
          { title: "Workers news", link: "https://blog.cloudflare.com/workers", snippet: "News", date: "2026-05-01", source: "Cloudflare Blog" }
        ]
      };
    }
  };
};

const provider = new SerperProvider("test-key");
const response = await provider.search("cloudflare workers", { num: 50, gl: "us", hl: "en" });

if (capturedRequest.url !== "https://google.serper.dev/search") throw new Error("Unexpected Serper endpoint");
if (capturedRequest.method !== "POST") throw new Error("Expected POST");
if (capturedRequest.headers["X-API-KEY"] !== "test-key") throw new Error("Expected X-API-KEY header");
if (capturedRequest.body.q !== "cloudflare workers") throw new Error("Expected query in body");
if (capturedRequest.body.num !== 20) throw new Error("Expected result count clamp");
if (capturedRequest.body.gl !== "us" || capturedRequest.body.hl !== "en") throw new Error("Expected locale options");
if (response.results.length !== 2) throw new Error("Expected organic and news results");
if (response.results[0].kind !== "organic") throw new Error("Expected organic kind");
if (response.results[1].kind !== "news") throw new Error("Expected news kind");

let missingKeyFailed = false;
try {
  await new SerperProvider(undefined).search("test");
} catch (error) {
  missingKeyFailed = error.message.includes("SERPER_API_KEY");
}
if (!missingKeyFailed) throw new Error("Expected missing key error");

console.log("serper provider ok");
`
  );

  execFileSync("node", [testFile], { stdio: "inherit" });
} finally {
  rmSync(tempDir, { recursive: true, force: true });
}
