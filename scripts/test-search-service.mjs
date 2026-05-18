import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const tempDir = mkdtempSync(join(tmpdir(), "chat-xvc-search-service-"));

try {
  execFileSync(
    "npx",
    [
      "esbuild",
      "src/services/search-service.ts",
      "--bundle",
      "--format=esm",
      `--outfile=${join(tempDir, "search-service.mjs")}`
    ],
    { stdio: "inherit" }
  );

  const testFile = join(tempDir, "test.mjs");
  writeFileSync(
    testFile,
    `
import { SearchService } from "./search-service.mjs";

let providerCalls = 0;
const provider = {
  async search(query, options) {
    providerCalls += 1;
    return {
      query,
      results: [
        { title: "Result", link: "https://example.com", snippet: options.kind ?? "search" }
      ]
    };
  }
};

const store = new Map();
const cache = {
  async get(key, type) {
    const value = store.get(key) ?? null;
    if (type === "json" && value) return JSON.parse(value);
    return value;
  },
  async put(key, value, options) {
    if (!options || options.expirationTtl !== 900) throw new Error("Expected default TTL");
    store.set(key, value);
  }
};

const service = new SearchService(provider, cache);
const first = await service.search("  Cloudflare Workers  ", { num: 8 });
const second = await service.search("Cloudflare Workers", { num: 8 });

if (providerCalls !== 1) throw new Error("Expected cached second search");
if (first.cached) throw new Error("First search should not be cached");
if (!second.cached) throw new Error("Second search should be cached");
if (second.results[0].title !== "Result") throw new Error("Expected cached result");

const empty = await service.search("   ");
if (empty.results.length !== 0) throw new Error("Expected empty query to skip provider");
if (providerCalls !== 1) throw new Error("Empty query should not call provider");

console.log("search service ok");
`
  );

  execFileSync("node", [testFile], { stdio: "inherit" });
} finally {
  rmSync(tempDir, { recursive: true, force: true });
}
