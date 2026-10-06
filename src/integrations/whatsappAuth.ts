import makeWASocket, {
  DisconnectReason,
  fetchLatestBaileysVersion,
  useMultiFileAuthState,
  type ConnectionState,
} from "@whiskeysockets/baileys";
import qrcode from "qrcode-terminal";
import pino from "pino";
import { existsSync, mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { setUserProfile } from "../db/repositories/habitRepository.js";
import { initDatabase } from "../db/database.js";

const AUTH_DIR = resolve(process.cwd(), "data", "whatsapp_auth");

/**
 * Interactive WhatsApp Web QR Code Authentication Runner.
 * Generates terminal QR code for phone scanning via WhatsApp Linked Devices.
 */
async function runWhatsAppAuth() {
  initDatabase();
  if (!existsSync(AUTH_DIR)) {
    mkdirSync(AUTH_DIR, { recursive: true });
  }

  console.log("\n==================================================");
  console.log("📲 WhatsApp Web Terminal Authenticator");
  console.log("==================================================");
  console.log("Initializing secure Baileys connection...\n");

  const { state, saveCreds } = await useMultiFileAuthState(AUTH_DIR);
  const { version } = await fetchLatestBaileysVersion();

  const sock = makeWASocket({
    version,
    auth: state,
    logger: pino({ level: "silent" }),
    printQRInTerminal: false,
    browser: ["Antigravity Assistant", "Chrome", "1.0.0"],
  });

  sock.ev.on("creds.update", saveCreds);

  sock.ev.on("connection.update", (update: Partial<ConnectionState>) => {
    const { connection, lastDisconnect, qr } = update;

    if (qr) {
      console.log("\n--------------------------------------------------");
      console.log("📱 SCAN QR CODE WITH WHATSAPP ON YOUR PHONE:");
      console.log("1. Open WhatsApp on your phone.");
      console.log("2. Tap Menu (⋮ on Android) or Settings (iOS) ➔ Linked Devices.");
      console.log("3. Tap 'Link a Device' and scan the QR code below:");
      console.log("--------------------------------------------------\n");
      qrcode.generate(qr, { small: true });
      console.log("\nWaiting for device scan approval...\n");
    }

    if (connection === "close") {
      const statusCode = (lastDisconnect?.error as { output?: { statusCode?: number } })?.output?.statusCode;
      const shouldReconnect = statusCode !== DisconnectReason.loggedOut;

      if (statusCode === DisconnectReason.loggedOut) {
        console.log("❌ Logged out from WhatsApp. Run again to re-authenticate.");
        process.exit(1);
      } else if (shouldReconnect) {
        console.log("🔄 Reconnecting to WhatsApp socket...");
        runWhatsAppAuth();
      }
    } else if (connection === "open") {
      const user = sock.user;
      const phone = user?.id ? user.id.split(":")[0] : "Connected";
      console.log("\n==================================================");
      console.log("🎉 WHATSAPP AUTHENTICATION SUCCESSFUL!");
      console.log(`📱 Linked Device: +${phone}`);
      console.log(`💾 Auth credentials saved in: ${AUTH_DIR}`);
      console.log("==================================================");
      console.log("The assistant background daemon will now monitor your");
      console.log("college groups and auto-ingest submission announcements!\n");

      setUserProfile("whatsapp_linked_phone", phone ?? "unknown");
      setUserProfile("whatsapp_linked_at", new Date().toISOString());

      setTimeout(() => {
        sock.end(undefined);
        process.exit(0);
      }, 1500);
    }
  });
}

runWhatsAppAuth().catch((err) => {
  console.error("WhatsApp auth error:", err);
  process.exit(1);
});
