import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { gzipSync } from "node:zlib";

/**
 * Packs the local WhatsApp auth directory into an exportable base64 string
 * for cloud hosting environments like Render or Railway.
 */
function exportWhatsAppAuth() {
  const authDir = resolve(process.cwd(), "data", "whatsapp_auth");
  const credsFile = resolve(authDir, "creds.json");

  if (!existsSync(credsFile)) {
    console.error("❌ No creds.json found in data/whatsapp_auth.");
    console.error("Please run: npm run auth:whatsapp to scan your QR code first.");
    process.exit(1);
  }

  const files = readdirSync(authDir);
  const bundleMap: Record<string, string> = {};

  for (const file of files) {
    const fullPath = resolve(authDir, file);
    try {
      bundleMap[file] = readFileSync(fullPath, "utf-8");
    } catch (err: any) {
      console.warn(`Skipping unreadable file ${file}:`, err?.message);
    }
  }

  const jsonStr = JSON.stringify(bundleMap);
  const gzippedBuffer = gzipSync(Buffer.from(jsonStr, "utf-8"));
  const base64Bundle = gzippedBuffer.toString("base64");

  // Also extract creds.json individually as minimal fallback
  const rawCreds = readFileSync(credsFile, "utf-8");
  const base64Creds = Buffer.from(rawCreds, "utf-8").toString("base64");

  // Save artifacts locally in data/ (gitignored)
  const bundlePath = resolve(process.cwd(), "data", "whatsapp_auth_bundle.b64");
  const jsonPath = resolve(process.cwd(), "data", "whatsapp_auth_bundle.json");
  writeFileSync(bundlePath, base64Bundle, "utf-8");
  writeFileSync(jsonPath, jsonStr, "utf-8");

  console.log("==================================================");
  console.log("📲 WHATSAPP AUTH EXPORT FOR RENDER / CLOUD HOSTING");
  console.log("==================================================");
  console.log(`✅ Bundled ${files.length} authentication files.`);
  console.log(`📁 Bundle saved to: data/whatsapp_auth_bundle.b64 (${base64Bundle.length} chars)`);
  console.log(`📁 JSON bundle saved to: data/whatsapp_auth_bundle.json (${jsonStr.length} bytes)`);
  console.log("\n🚀 Deployment Options for Render:");
  console.log("--------------------------------------------------");
  console.log("Option A (Recommended for Render Secret File):");
  console.log("  In Render Dashboard -> Environment -> Secret Files:");
  console.log("  Filename: /etc/secrets/whatsapp_auth.json");
  console.log("  File Contents: Paste contents of data/whatsapp_auth_bundle.json");
  console.log("\nOption B (Render Environment Variable):");
  console.log("  Key: WHATSAPP_AUTH_BASE64");
  console.log("  Value: Paste contents of data/whatsapp_auth_bundle.b64");
  console.log("\nOption C (Minimal creds.json variable):");
  console.log("  Key: WHATSAPP_CREDS_BASE64");
  console.log(`  Value: ${base64Creds}`);
  console.log("==================================================");
}

exportWhatsAppAuth();
