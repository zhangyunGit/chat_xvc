import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";

const config = existsSync("config.json") ? JSON.parse(readFileSync("config.json", "utf8")) : {};
const secrets = [
  {
    name: "SERPER_API_KEY",
    value: process.env.SERPER_API_KEY ?? config.serper?.apikey,
    required: false
  },
  {
    name: "DEEPSEEK_API_KEY",
    value: process.env.DEEPSEEK_API_KEY ?? config.deepseek?.apikey,
    required: true
  },
  {
    name: "GEMINI_API_KEY",
    value: process.env.GEMINI_API_KEY ?? config.gemini?.apikey,
    required: true
  }
];

for (const secret of secrets) {
  if (!secret.value) {
    if (secret.required) {
      throw new Error(`Missing ${secret.name}. Export it in the shell or add it to config.json for local provisioning.`);
    }

    console.log(`Skipping optional Worker secret: ${secret.name}`);
    continue;
  }

  console.log(`Syncing Worker secret: ${secret.name}`);
  execFileSync("npx", ["wrangler", "secret", "put", secret.name, "--config", "wrangler.generated.jsonc"], {
    input: `${secret.value}\n`,
    stdio: ["pipe", "inherit", "inherit"]
  });
}

console.log("Secrets synced.");
