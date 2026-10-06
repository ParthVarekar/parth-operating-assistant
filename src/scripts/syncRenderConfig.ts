import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import https from "node:https";

const SERVICE_ID = "srv-db2nagegekts73dj0a30";

function getRenderToken(): string {
  const cliYamlPath = resolve(process.env.USERPROFILE || "", ".render", "cli.yaml");
  if (!existsSync(cliYamlPath)) {
    throw new Error("Render CLI config not found at ~/.render/cli.yaml");
  }
  const content = readFileSync(cliYamlPath, "utf-8");
  const match = content.match(/key:\s*([^\r\n]+)/);
  if (!match || !match[1]) {
    throw new Error("Could not extract Render API token from ~/.render/cli.yaml");
  }
  return match[1].trim();
}

function renderApiRequest(method: string, path: string, bodyObj?: any): Promise<any> {
  const token = getRenderToken();
  const body = bodyObj ? JSON.stringify(bodyObj) : "";

  return new Promise((resolvePromise, rejectPromise) => {
    const req = https.request(
      {
        hostname: "api.render.com",
        path,
        method,
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: "application/json",
          "Content-Type": "application/json",
          ...(body ? { "Content-Length": Buffer.byteLength(body) } : {}),
        },
      },
      (res) => {
        let responseData = "";
        res.on("data", (chunk) => (responseData += chunk));
        res.on("end", () => {
          if (res.statusCode && res.statusCode >= 200 && res.statusCode < 300) {
            try {
              resolvePromise(JSON.parse(responseData || "{}"));
            } catch {
              resolvePromise(responseData);
            }
          } else {
            rejectPromise(new Error(`Render API ${method} ${path} failed (${res.statusCode}): ${responseData}`));
          }
        });
      }
    );

    req.on("error", rejectPromise);
    if (body) {
      req.write(body);
    }
    req.end();
  });
}

function parseLocalEnv(): Record<string, string> {
  const envPath = resolve(process.cwd(), ".env");
  if (!existsSync(envPath)) return {};

  const lines = readFileSync(envPath, "utf-8").split(/\r?\n/);
  const result: Record<string, string> = {};

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eqIdx = trimmed.indexOf("=");
    if (eqIdx <= 0) continue;
    const key = trimmed.slice(0, eqIdx).trim();
    let val = trimmed.slice(eqIdx + 1).trim();
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    result[key] = val;
  }

  return result;
}

async function main() {
  console.log("==================================================");
  console.log("🚀 SYNCING CONFIG & SECRETS TO RENDER CLOUD");
  console.log(`🎯 Target Service: ${SERVICE_ID}`);
  console.log("==================================================");

  // 1. Sync Secret File (WhatsApp Multi-File Auth Session)
  const authBundlePath = resolve(process.cwd(), "data", "whatsapp_auth_bundle.json");
  if (existsSync(authBundlePath)) {
    console.log("📦 Uploading WhatsApp multi-file auth session as Secret File...");
    const bundleContent = readFileSync(authBundlePath, "utf-8");
    await renderApiRequest("PUT", `/v1/services/${SERVICE_ID}/secret-files`, [
      {
        name: "whatsapp_auth.json",
        content: bundleContent,
      },
    ]);
    console.log("✅ Secret file whatsapp_auth.json mounted at /etc/secrets/whatsapp_auth.json");
  } else {
    console.warn("⚠️ data/whatsapp_auth_bundle.json not found. Run npm run export:whatsapp first.");
  }

  // 2. Prepare Environment Variables
  const localEnv = parseLocalEnv();
  const envMap: Record<string, string> = {
    ...localEnv,
    NODE_ENV: "production",
    NODE_VERSION: "22.14.0",
    PORT: "10000",
    RENDER_EXTERNAL_URL: "https://parth-operating-assistant.onrender.com",
    DATABASE_PATH: "./data/assistant.db",
    GITHUB_USERNAME: "ParthVarekar",
  };

  const envVarsArray = Object.entries(envMap).map(([key, value]) => ({
    key,
    value,
  }));

  console.log(`🔑 Syncing ${envVarsArray.length} environment variables to Render...`);
  await renderApiRequest("PUT", `/v1/services/${SERVICE_ID}/env-vars`, envVarsArray);
  console.log("✅ Environment variables synchronized successfully.");

  console.log("==================================================");
  console.log("🎉 Render Cloud Configuration Complete!");
  console.log("==================================================");
}

main().catch((err) => {
  console.error("❌ Sync failed:", err?.message || err);
  process.exit(1);
});
