import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { existsSync, rmSync, mkdirSync, writeFileSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { gzipSync } from "node:zlib";
import { restoreCloudWhatsAppAuth, isWhatsAppConfigured } from "../src/services/whatsappService.js";

describe("Cloud WhatsApp Session Restoration Suite", () => {
  const testAuthDir = resolve(process.cwd(), "data", "test_cloud_restore_auth");

  beforeEach(() => {
    process.env.WHATSAPP_AUTH_DIR = testAuthDir;
    delete process.env.WHATSAPP_AUTH_BASE64;
    delete process.env.WHATSAPP_AUTH_FILE;
    delete process.env.WHATSAPP_CREDS_JSON;
    delete process.env.WHATSAPP_CREDS_BASE64;

    if (existsSync(testAuthDir)) {
      rmSync(testAuthDir, { recursive: true, force: true });
    }
  });

  afterEach(() => {
    delete process.env.WHATSAPP_AUTH_DIR;
    delete process.env.WHATSAPP_AUTH_BASE64;
    delete process.env.WHATSAPP_AUTH_FILE;
    delete process.env.WHATSAPP_CREDS_JSON;
    delete process.env.WHATSAPP_CREDS_BASE64;

    if (existsSync(testAuthDir)) {
      rmSync(testAuthDir, { recursive: true, force: true });
    }
  });

  it("restores credentials from WHATSAPP_AUTH_BASE64 gzipped bundle", () => {
    const bundleMap = {
      "creds.json": JSON.stringify({ me: { name: "Parth Test" }, registrationId: 101 }),
      "test-session.json": JSON.stringify({ key: "val" }),
    };

    const gzipped = gzipSync(Buffer.from(JSON.stringify(bundleMap)));
    process.env.WHATSAPP_AUTH_BASE64 = gzipped.toString("base64");

    expect(isWhatsAppConfigured()).toBe(true);
    expect(existsSync(resolve(testAuthDir, "creds.json"))).toBe(true);
    expect(existsSync(resolve(testAuthDir, "test-session.json"))).toBe(true);

    const parsedCreds = JSON.parse(readFileSync(resolve(testAuthDir, "creds.json"), "utf-8"));
    expect(parsedCreds.me.name).toBe("Parth Test");
  });

  it("restores credentials from Secret File path (WHATSAPP_AUTH_FILE)", () => {
    const secretFilePath = resolve(testAuthDir, "..", "test_secret_file.json");
    const bundleMap = {
      "creds.json": JSON.stringify({ me: { name: "Parth Secret File" } }),
    };
    writeFileSync(secretFilePath, JSON.stringify(bundleMap), "utf-8");

    process.env.WHATSAPP_AUTH_FILE = secretFilePath;

    expect(restoreCloudWhatsAppAuth()).toBe(true);
    expect(existsSync(resolve(testAuthDir, "creds.json"))).toBe(true);

    rmSync(secretFilePath, { force: true });
  });

  it("restores credentials from minimal WHATSAPP_CREDS_BASE64", () => {
    const credsObj = { me: { id: "917400082627:46@s.whatsapp.net", name: "Parth" } };
    const b64 = Buffer.from(JSON.stringify(credsObj)).toString("base64");
    process.env.WHATSAPP_CREDS_BASE64 = b64;

    expect(restoreCloudWhatsAppAuth()).toBe(true);
    expect(existsSync(resolve(testAuthDir, "creds.json"))).toBe(true);
    const parsed = JSON.parse(readFileSync(resolve(testAuthDir, "creds.json"), "utf-8"));
    expect(parsed.me.name).toBe("Parth");
  });

  it("returns false if no credentials or variables are supplied", () => {
    expect(isWhatsAppConfigured()).toBe(false);
  });
});
