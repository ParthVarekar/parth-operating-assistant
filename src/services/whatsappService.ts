import makeWASocket, {
  DisconnectReason,
  fetchLatestBaileysVersion,
  useMultiFileAuthState,
  type WASocket,
  type ConnectionState,
} from "@whiskeysockets/baileys";
import pino from "pino";
import { existsSync, rmSync } from "node:fs";
import { resolve } from "node:path";
import { getUserProfile, setUserProfile } from "../db/repositories/habitRepository.js";
import { ingestProfessorAnnouncement } from "./announcementParser.js";

const AUTH_DIR = resolve(process.cwd(), "data", "whatsapp_auth");

export interface WhatsAppAcademicAlert {
  id: string;
  sender: string;
  chatName: string;
  text: string;
  timestamp: string;
  tasksCount: number;
  physicalSubmissionsCount: number;
}

const ACADEMIC_KEYWORDS = [
  "submission",
  "assignment",
  "journal",
  "experiment",
  "lab manual",
  "printout",
  "print out",
  "hard copy",
  "xerox",
  "defaulter",
  "due date",
  "deadline",
  "practical turn",
  "writeup",
  "unit test",
  "viva",
  "black book",
  "synopsis",
];

let activeSocket: WASocket | null = null;
let isSocketConnected = false;
let alertListeners: Array<(alert: WhatsAppAcademicAlert) => Promise<void>> = [];

/**
 * Checks if WhatsApp has valid saved authentication credentials on disk.
 */
export function isWhatsAppConfigured(): boolean {
  return existsSync(resolve(AUTH_DIR, "creds.json"));
}

/**
 * Checks if a message text contains actionable college academic keywords.
 */
export function isAcademicMessage(text: string): boolean {
  if (!text || text.length < 15) return false;
  const lower = text.toLowerCase();
  return ACADEMIC_KEYWORDS.some((kw) => lower.includes(kw));
}

/**
 * Registers a listener callback when an academic alert is parsed from WhatsApp.
 */
export function onWhatsAppAcademicNotice(
  listener: (alert: WhatsAppAcademicAlert) => Promise<void>
): void {
  alertListeners.push(listener);
}

/**
 * Retrieves the current status of the WhatsApp integration.
 */
export function getWhatsAppStatus(): {
  isConfigured: boolean;
  isConnected: boolean;
  phoneNumber: string | null;
  linkedAt: string | null;
  alertsCount: number;
} {
  const isConfigured = isWhatsAppConfigured();
  const rawPhone = getUserProfile<string>("whatsapp_linked_phone");
  const phoneNumber = rawPhone && rawPhone.trim().length > 0 ? rawPhone.trim() : null;
  const linkedAt = getUserProfile<string>("whatsapp_linked_at");
  const recentAlerts = getUserProfile<WhatsAppAcademicAlert[]>("whatsapp_recent_alerts") ?? [];

  return {
    isConfigured,
    isConnected: isSocketConnected,
    phoneNumber,
    linkedAt: linkedAt ?? null,
    alertsCount: recentAlerts.length,
  };
}

/**
 * Starts the background WhatsApp listener socket if credentials are configured.
 */
export async function startWhatsAppClient(): Promise<boolean> {
  if (!isWhatsAppConfigured()) {
    return false;
  }

  if (activeSocket && isSocketConnected) {
    return true;
  }

  try {
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
      const { connection, lastDisconnect } = update;

      if (connection === "open") {
        isSocketConnected = true;
        activeSocket = sock;
        const phone = sock.user?.id ? sock.user.id.split(":")[0] : undefined;
        if (phone) {
          setUserProfile("whatsapp_linked_phone", phone);
        }
      } else if (connection === "close") {
        isSocketConnected = false;
        activeSocket = null;
        const statusCode = (lastDisconnect?.error as { output?: { statusCode?: number } })?.output?.statusCode;
        const shouldReconnect = statusCode !== DisconnectReason.loggedOut;
        if (shouldReconnect) {
          setTimeout(() => {
            startWhatsAppClient().catch(console.error);
          }, 5000);
        }
      }
    });

    // Listen to incoming messages
    sock.ev.on("messages.upsert", async ({ messages, type }) => {
      if (type !== "notify") return;

      for (const msg of messages) {
        if (msg.key.fromMe) continue; // Ignore own outgoing messages

        const conversationText =
          msg.message?.conversation ||
          msg.message?.extendedTextMessage?.text ||
          msg.message?.imageMessage?.caption ||
          "";

        if (!isAcademicMessage(conversationText)) {
          continue;
        }

        const senderJid = msg.key.remoteJid ?? "unknown";
        const senderName = msg.pushName || senderJid.split("@")[0] || "College Chat";
        const isGroup = senderJid.endsWith("@g.us");

        try {
          const ingestion = await ingestProfessorAnnouncement(conversationText);

          if (ingestion.tasksCreated.length > 0 || ingestion.physicalSubmissionsCount > 0) {
            const alert: WhatsAppAcademicAlert = {
              id: crypto.randomUUID(),
              sender: senderName,
              chatName: isGroup ? "Class Group" : senderName,
              text: conversationText,
              timestamp: new Date().toISOString(),
              tasksCount: ingestion.tasksCreated.length,
              physicalSubmissionsCount: ingestion.physicalSubmissionsCount,
            };

            const existing = getUserProfile<WhatsAppAcademicAlert[]>("whatsapp_recent_alerts") ?? [];
            const updated = [alert, ...existing.slice(0, 19)];
            setUserProfile("whatsapp_recent_alerts", updated);

            // Broadcast to listeners (Telegram push)
            for (const listener of alertListeners) {
              try {
                await listener(alert);
              } catch (listenerErr) {
                console.error("Error in alert listener:", listenerErr);
              }
            }
          }
        } catch (err) {
          console.error("Error ingesting WhatsApp announcement:", err);
        }
      }
    });

    return true;
  } catch (err) {
    console.error("Error starting WhatsApp client:", err);
    return false;
  }
}

/**
 * Stops the active WhatsApp client socket cleanly.
 */
export function stopWhatsAppClient(): void {
  if (activeSocket) {
    try {
      activeSocket.end(undefined);
    } catch {
      // Ignore cleanup error
    }
    activeSocket = null;
    isSocketConnected = false;
  }
}

/**
 * Disconnects WhatsApp and wipes saved credentials.
 */
export function disconnectWhatsApp(): void {
  stopWhatsAppClient();
  if (existsSync(AUTH_DIR)) {
    rmSync(AUTH_DIR, { recursive: true, force: true });
  }
  setUserProfile("whatsapp_linked_phone", "");
  setUserProfile("whatsapp_linked_at", "");
}

/**
 * Formats a clean Telegram markdown digest of the WhatsApp connection status.
 */
export function formatWhatsAppStatusDigest(): string {
  const status = getWhatsAppStatus();
  const recentAlerts = getUserProfile<WhatsAppAcademicAlert[]>("whatsapp_recent_alerts") ?? [];

  const lines: string[] = [`📱 *WhatsApp Academic Bridge*\n`];

  if (!status.isConfigured && !status.phoneNumber) {
    lines.push(`🔴 *Status:* Not Linked`);
    lines.push(
      `\nTo connect your WhatsApp and auto-monitor class groups for submissions:\n` +
      `1️⃣ Run \`npm run auth:whatsapp\` in your terminal.\n` +
      `2️⃣ Scan the terminal QR code with your phone (*WhatsApp > Linked Devices*).\n\n` +
      `Once linked, the bot will automatically detect coursework, lab deadlines, and CR notices in real-time!`
    );
    return lines.join("\n");
  }

  lines.push(`🟢 *Status:* ${status.isConnected ? "Active & Monitoring" : "Credentials Ready (Connecting...)"}`);
  if (status.phoneNumber) {
    lines.push(`📱 *Linked Device:* \`+${status.phoneNumber}\``);
  }
  if (status.linkedAt) {
    lines.push(`🕒 *Linked Since:* ${new Date(status.linkedAt).toLocaleDateString("en-IN")}`);
  }

  lines.push(`\n🔍 *Monitored Keywords:*`);
  lines.push(`\`submission\`, \`journal\`, \`experiment\`, \`printout\`, \`xerox\`, \`defaulter\`, \`deadline\``);

  if (recentAlerts.length > 0) {
    lines.push(`\n📑 *Recently Captured Academic Notices (${recentAlerts.length}):*`);
    for (let i = 0; i < Math.min(recentAlerts.length, 3); i++) {
      const a = recentAlerts[i]!;
      const timeStr = new Date(a.timestamp).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" });
      const snippet = a.text.length > 70 ? `${a.text.slice(0, 70)}...` : a.text;
      lines.push(`${i + 1}. *[${a.sender}]* (${timeStr}):`);
      lines.push(`   "${snippet}"`);
      lines.push(`   👉 Added *${a.tasksCount} task(s)* | *${a.physicalSubmissionsCount} print(s)*`);
    }
  } else {
    lines.push(`\n✨ *No academic notices captured yet.* Awaiting messages from your college groups.`);
  }

  return lines.join("\n");
}
