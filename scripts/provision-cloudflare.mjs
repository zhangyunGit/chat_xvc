import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";

const CONFIG_PATH = "config.json";
const RESOURCES_PATH = "cloudflare.resources.json";
const WRANGLER_TEMPLATE_PATH = "wrangler.jsonc";
const WRANGLER_GENERATED_PATH = "wrangler.generated.jsonc";

const resourceNames = {
  worker: "chat-xvc",
  d1: "chat_xvc_db",
  r2: "chat-xvc-files",
  kv: "chat_xvc_cache",
  vectorize: "chat-xvc-documents",
  aiGateway: "deepseek_falsh",
  vectorDimensions: 384,
  vectorMetric: "cosine"
};

const config = loadJson(CONFIG_PATH);
const accountId = config.cloudflare?.account_id;

if (!accountId) {
  throw new Error("Missing cloudflare.account_id in config.json. Copy config.example.json and fill it first.");
}

if (!process.env.CLOUDFLARE_API_TOKEN) {
  throw new Error(
    "Missing CLOUDFLARE_API_TOKEN. Create a scoped Cloudflare API token and run this script with CLOUDFLARE_API_TOKEN set in the environment."
  );
}

const resources = existsSync(RESOURCES_PATH) ? loadJson(RESOURCES_PATH) : {};

console.log("Provisioning Cloudflare resources for account:", mask(accountId));
patchWranglerAccount(accountId);

resources.account_id = accountId;
resources.worker_name = resourceNames.worker;
resources.d1 = needsProvision(resources.d1) ? createD1() : resources.d1;
resources.r2 = needsProvision(resources.r2) ? createR2() : resources.r2;
resources.kv = needsProvision(resources.kv) ? createKv() : resources.kv;
resources.vectorize = needsProvision(resources.vectorize) ? createVectorize() : resources.vectorize;
resources.ai_gateway = needsProvision(resources.ai_gateway) ? await createAiGateway(accountId) : resources.ai_gateway;

writeFileSync(RESOURCES_PATH, `${JSON.stringify(resources, null, 2)}\n`);
patchWrangler(resources);

console.log("Cloudflare resources saved to", RESOURCES_PATH);
console.log("wrangler.generated.jsonc has been updated with resource bindings.");
console.log("Next: npm run cf:migrate:remote && npm run cf:deploy");

function createD1() {
  const output = runWrangler(["d1", "create", resourceNames.d1]);
  const databaseId = matchRequired(output, /["']?database_id["']?\s*[:=]\s*"([^"]+)"/, "D1 database_id");

  return {
    binding: "DB",
    database_name: resourceNames.d1,
    database_id: databaseId
  };
}

function createR2() {
  try {
    runWrangler(["r2", "bucket", "create", resourceNames.r2]);
  } catch (error) {
    if (/enable R2 through the Cloudflare Dashboard|code:\s*10042/i.test(error.message)) {
      return {
        binding: "FILES",
        bucket_name: resourceNames.r2,
        status: "pending_dashboard_enablement",
        note: "Enable R2 in Cloudflare Dashboard, then rerun npm run cf:provision."
      };
    }

    throw error;
  }

  return {
    binding: "FILES",
    bucket_name: resourceNames.r2
  };
}

function createKv() {
  const output = runWrangler(["kv", "namespace", "create", resourceNames.kv]);
  const id = matchRequired(output, /["']?id["']?\s*[:=]\s*"([^"]+)"/, "KV namespace id");

  return {
    binding: "CACHE",
    title: resourceNames.kv,
    id
  };
}

function createVectorize() {
  runWrangler([
    "vectorize",
    "create",
    resourceNames.vectorize,
    "--dimensions",
    String(resourceNames.vectorDimensions),
    "--metric",
    resourceNames.vectorMetric
  ]);

  return {
    binding: "VECTORIZE",
    index_name: resourceNames.vectorize,
    dimensions: resourceNames.vectorDimensions,
    metric: resourceNames.vectorMetric
  };
}

async function createAiGateway(accountId) {
  const existing = await cloudflareApi({
    accountId,
    method: "GET",
    path: `/ai-gateway/gateways/${resourceNames.aiGateway}`,
    allowNotFound: true
  });

  if (existing) {
    return normalizeAiGateway(existing);
  }

  const created = await cloudflareApi({
    accountId,
    method: "POST",
    path: "/ai-gateway/gateways",
    body: {
      id: resourceNames.aiGateway,
      collect_logs: true,
      cache_ttl: 0,
      cache_invalidate_on_update: true,
      rate_limiting_interval: 0,
      rate_limiting_limit: 0,
      retry_max_attempts: 2,
      retry_delay: 1000,
      retry_backoff: "exponential",
      workers_ai_billing_mode: "postpaid"
    }
  });

  return normalizeAiGateway(created);
}

async function cloudflareApi({ accountId, method, path, body, allowNotFound = false }) {
  const response = await fetch(`https://api.cloudflare.com/client/v4/accounts/${accountId}${path}`, {
    method,
    headers: {
      authorization: `Bearer ${process.env.CLOUDFLARE_API_TOKEN}`,
      "content-type": "application/json"
    },
    body: body ? JSON.stringify(body) : undefined
  });

  const text = await response.text();
  const parsed = text ? JSON.parse(text) : {};

  if (allowNotFound && response.status === 404) {
    return null;
  }

  if (!response.ok || parsed.success === false) {
    throw new Error(`Cloudflare API ${method} ${path} failed: ${response.status} ${text}`);
  }

  return parsed.result;
}

function normalizeAiGateway(gateway) {
  return {
    id: gateway.id ?? resourceNames.aiGateway,
    collect_logs: gateway.collect_logs ?? true,
    cache_ttl: gateway.cache_ttl ?? 0,
    providers: {
      deepseek: {
        model: "deepseek-v4-flash",
        compat_model: "deepseek/deepseek-v4-flash"
      },
      google_ai_studio: {
        model: "gemini-3-flash-preview",
        compat_model: "google-ai-studio/gemini-3-flash-preview"
      }
    }
  };
}

function runWrangler(args) {
  const wranglerArgs = ["wrangler", "--config", WRANGLER_GENERATED_PATH, ...args];
  console.log(`\n$ npx ${wranglerArgs.join(" ")}`);
  try {
    return execFileSync("npx", wranglerArgs, {
      encoding: "utf8",
      stdio: ["inherit", "pipe", "pipe"]
    });
  } catch (error) {
    const stdout = error.stdout?.toString() || "";
    const stderr = error.stderr?.toString() || "";
    const combined = `${stdout}\n${stderr}`.trim();

    if (/already exists|already been taken|duplicate/i.test(combined)) {
      throw new Error(
        `Resource already exists but ${RESOURCES_PATH} does not contain its id. Delete/rename the existing resource or fill ${RESOURCES_PATH} manually.\n${combined}`
      );
    }

    throw new Error(combined || error.message);
  }
}

function patchWrangler(resourceState) {
  const text = readFileSync(WRANGLER_TEMPLATE_PATH, "utf8")
    .replace(/"account_id":\s*"[^"]+"/, `"account_id": "${resourceState.account_id}"`)
    .replace(/"CLOUDFLARE_ACCOUNT_ID":\s*"[^"]+"/, `"CLOUDFLARE_ACCOUNT_ID": "${resourceState.account_id}"`)
    .replace(/"AI_GATEWAY_ID":\s*"[^"]+"/, `"AI_GATEWAY_ID": "${resourceState.ai_gateway.id}"`)
    .replace(/"database_id":\s*"[^"]+"/, `"database_id": "${resourceState.d1.database_id}"`)
    .replace(/"id":\s*"__KV_NAMESPACE_ID__"/, `"id": "${resourceState.kv.id}"`);

  writeFileSync(WRANGLER_GENERATED_PATH, text);
}

function patchWranglerAccount(nextAccountId) {
  const text = readFileSync(WRANGLER_TEMPLATE_PATH, "utf8").replace(
    /"account_id":\s*"[^"]+"/,
    `"account_id": "${nextAccountId}"`
  );

  writeFileSync(WRANGLER_GENERATED_PATH, text);
}

function needsProvision(resource) {
  return !resource || resource.status === "pending_dashboard_enablement";
}

function loadJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

function matchRequired(text, regex, label) {
  const match = text.match(regex);
  if (!match) {
    throw new Error(`Could not parse ${label} from Wrangler output:\n${text}`);
  }
  return match[1];
}

function mask(value) {
  return `${value.slice(0, 4)}…${value.slice(-4)}`;
}
