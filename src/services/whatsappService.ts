import makeWASocket, {
  DisconnectReason,
  fetchLatestBaileysVersion,
  useMultiFileAuthState,
  type WASocket,
  type ConnectionState,
} from "@whiskeysockets/baileys";
import pino from "pino";
import { existsSync, rmSync, writeFileSync, mkdirSync, readFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import { resolve } from "node:path";
import { getUserProfile, setUserProfile } from "../db/repositories/habitRepository.js";
import { ingestProfessorAnnouncement } from "./announcementParser.js";
import { broadcastAcademicNoticeToDiscord } from "./discordService.js";
import { appendChatMessage } from "../agent/chatHandler.js";

import {
  checkContentDuplicate,
  extractStudyResources,
  isSubstantiveContent,
  recordIngestedContent,
  listSavedStudyResources,
} from "./contentDeduplicationService.js";
import { evaluateAcademicContentSemantic } from "./academicSemanticClassifier.js";
import { recordMemory } from "./memoryService.js";
import { insertTask } from "../db/repositories/taskRepository.js";
import type { Task } from "../types/index.js";

export function getWhatsAppAuthDir(): string {
  return process.env.WHATSAPP_AUTH_DIR || resolve(process.cwd(), "data", "whatsapp_auth");
}

export interface WhatsAppAcademicAlert {
  id: string;
  sender: string;
  chatName: string;
  text: string;
  timestamp: string;
  tasksCount: number;
  physicalSubmissionsCount: number;
  studyResourcesCount?: number;
  isDirectMessage?: boolean;
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
  "turn",
  "writeup",
  "unit test",
  "viva",
  "black book",
  "synopsis",
  "ia1",
  "ia2",
  "timetable",
  "attendance",
  "exam",
  "practicals",
  "syllabus",
  "announcement",
  "notice",
  "cr notice",
];

const DEFAULT_MONITORED_GROUPS = [
  "important announcements",
  "important announcement",
  "announcements",
  "announcement",
  "kccemsr",
  "kc college",
  "comps",
  "computer engineering",
  "cr notice",
  "class representative",
  "be comps",
  "te comps",
  "se comps",
];

let activeSocket: WASocket | null = null;
let isSocketConnected = false;
let alertListeners: Array<(alert: WhatsAppAcademicAlert) => Promise<void>> = [];

// Group subject metadata cache (jid -> { subject, cachedAt })
const groupMetadataCache = new Map<string, { subject: string; cachedAt: number }>();

/**
 * Checks if a group name matches priority college announcement channels.
 */
export function isMonitoredAcademicGroup(groupName: string): boolean {
  if (!groupName) return false;
  const lower = groupName.toLowerCase().trim();

  // Check default patterns
  if (DEFAULT_MONITORED_GROUPS.some((pattern) => lower.includes(pattern))) {
    return true;
  }

  // Check user-configured custom group list
  const customGroups = getUserProfile<string[]>("whatsapp_monitored_groups") ?? [];
  return customGroups.some((g) => lower.includes(g.toLowerCase().trim()));
}

/**
 * Resolves the subject/title of a WhatsApp group using Baileys with caching.
 */
export async function resolveGroupSubject(sock: WASocket, groupJid: string): Promise<string> {
  const cached = groupMetadataCache.get(groupJid);
  const now = Date.now();
  if (cached && now - cached.cachedAt < 3600000) {
    return cached.subject;
  }

  try {
    const meta = await sock.groupMetadata(groupJid);
    const subject = meta?.subject || "College Group";
    groupMetadataCache.set(groupJid, { subject, cachedAt: now });
    return subject;
  } catch {
    return "Class Group";
  }
}

/**
 * Restores WhatsApp authentication files in ephemeral cloud environments (e.g. Render, Railway).
 * Checks WHATSAPP_AUTH_BASE64, WHATSAPP_CREDS_JSON, WHATSAPP_CREDS_BASE64, or secret file paths.
 */
export function restoreCloudWhatsAppAuth(): boolean {
  const authDir = getWhatsAppAuthDir();

  // If creds.json already exists on disk, nothing to restore
  if (existsSync(resolve(authDir, "creds.json"))) {
    return true;
  }

  // Ensure target directory exists
  mkdirSync(authDir, { recursive: true });

  // 1. Check for full gzipped base64 bundle (WHATSAPP_AUTH_BASE64)
  const bundleBase64 = process.env.WHATSAPP_AUTH_BASE64;
  if (bundleBase64 && bundleBase64.trim().length > 0) {
    try {
      const buffer = Buffer.from(bundleBase64.trim(), "base64");
      const decompressed = gunzipSync(buffer).toString("utf-8");
      const fileMap = JSON.parse(decompressed);
      if (typeof fileMap === "object" && fileMap !== null) {
        for (const [filename, content] of Object.entries(fileMap)) {
          const safeName = resolve(authDir, filename);
          if (safeName.startsWith(authDir)) {
            writeFileSync(safeName, content as string, "utf-8");
          }
        }
        if (existsSync(resolve(authDir, "creds.json"))) {
          console.log(`📦 Successfully restored WhatsApp session files from WHATSAPP_AUTH_BASE64 into ${authDir}`);
          return true;
        }
      }
    } catch (err: any) {
      console.warn("⚠️ Failed to unpack WHATSAPP_AUTH_BASE64:", err?.message || err);
    }
  }

  // 2. Check for secret file path (Render Secret File, e.g. /etc/secrets/whatsapp_auth.json or WHATSAPP_AUTH_FILE)
  const authFilePath = process.env.WHATSAPP_AUTH_FILE || (existsSync("/etc/secrets/whatsapp_auth.json") ? "/etc/secrets/whatsapp_auth.json" : null);
  if (authFilePath && existsSync(authFilePath)) {
    try {
      const content = readFileSync(authFilePath, "utf-8");
      const fileMap = JSON.parse(content);
      if (typeof fileMap === "object" && fileMap !== null) {
        for (const [filename, fileContent] of Object.entries(fileMap)) {
          const safeName = resolve(authDir, filename);
          if (safeName.startsWith(authDir)) {
            writeFileSync(safeName, fileContent as string, "utf-8");
          }
        }
        if (existsSync(resolve(authDir, "creds.json"))) {
          console.log(`📦 Successfully restored WhatsApp session files from Secret File ${authFilePath}`);
          return true;
        }
      }
    } catch (err: any) {
      console.warn(`⚠️ Failed to unpack secret file ${authFilePath}:`, err?.message || err);
    }
  }

  // 3. Check for standalone creds.json environment variable
  const credsJson = process.env.WHATSAPP_CREDS_JSON || (process.env.WHATSAPP_CREDS_BASE64 ? Buffer.from(process.env.WHATSAPP_CREDS_BASE64, "base64").toString("utf-8") : null);
  if (credsJson && credsJson.trim().length > 0) {
    try {
      JSON.parse(credsJson); // Validate JSON format
      writeFileSync(resolve(authDir, "creds.json"), credsJson.trim(), "utf-8");
      console.log(`📦 Successfully restored WhatsApp creds.json into ${authDir}`);
      return true;
    } catch (err: any) {
      console.warn("⚠️ Failed to parse WHATSAPP_CREDS_JSON:", err?.message || err);
    }
  }

  return false;
}

/**
 * Checks if WhatsApp has valid saved authentication credentials on disk.
 */
export function isWhatsAppConfigured(): boolean {
  if (existsSync(resolve(getWhatsAppAuthDir(), "creds.json"))) {
    return true;
  }
  return restoreCloudWhatsAppAuth();
}

/**
 * Checks if a message text contains actionable college academic keywords.
 */
export function isAcademicMessage(text: string): boolean {
  if (!text || text.length < 10) return false;
  const lower = text.toLowerCase();
  return ACADEMIC_KEYWORDS.some((kw) => lower.includes(kw));
}

/**
 * Extracts complete text from various Baileys message structures.
 */
export function extractWhatsAppMessageText(msg: any): string {
  if (!msg || !msg.message) return "";

  const m = msg.message;
  return (
    m.conversation ||
    m.extendedTextMessage?.text ||
    m.imageMessage?.caption ||
    m.documentMessage?.caption ||
    m.documentMessage?.fileName ||
    m.documentWithCaptionMessage?.message?.documentMessage?.caption ||
    m.documentWithCaptionMessage?.message?.documentMessage?.fileName ||
    m.videoMessage?.caption ||
    ""
  );
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
    const { state, saveCreds } = await useMultiFileAuthState(getWhatsAppAuthDir());
    const { version } = await fetchLatestBaileysVersion();

    const sock = makeWASocket({
      version,
      auth: state,
      logger: pino({ level: "silent" }),
      printQRInTerminal: false,
      browser: ["Antigravity Assistant", "Chrome", "1.0.0"],
      syncFullHistory: false,
      generateHighQualityLinkPreview: false,
    });

    // 🛡️ STRICT READ-ONLY SECURITY GUARD:
    // Completely neuter all outgoing message and chat mutation capabilities.
    // The assistant CANNOT write, reply, relay, or send messages to any WhatsApp chat,
    // group, contact, or status under any circumstance.
    sock.sendMessage = async () => {
      console.warn("🛡️ Security Guard: WhatsApp write operations are strictly disabled. Outgoing message blocked.");
      throw new Error("WHATSAPP_READ_ONLY: The assistant is strictly configured in read-only mode and cannot send messages.");
    };
    sock.relayMessage = async () => {
      console.warn("🛡️ Security Guard: WhatsApp relayMessage is strictly disabled.");
      throw new Error("WHATSAPP_READ_ONLY: relayMessage disabled.");
    };
    sock.chatModify = async () => {
      console.warn("🛡️ Security Guard: WhatsApp chatModify is strictly disabled.");
      throw new Error("WHATSAPP_READ_ONLY: chatModify disabled.");
    };
    sock.sendPresenceUpdate = async () => {};

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
        console.log("📲 WhatsApp socket connected in STRICT READ-ONLY mode. Monitoring class groups.");
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

    // Listen to incoming messages across ALL chats (personal DMs and groups)
    sock.ev.on("messages.upsert", async ({ messages, type }) => {
      if (type !== "notify") return;

      for (const msg of messages) {
        const conversationText = extractWhatsAppMessageText(msg).trim();
        if (!conversationText) continue;

        const senderJid = msg.key.remoteJid ?? "unknown";

        // Ignore public channels / newsletters, status broadcasts, and system streams
        if (
          senderJid.endsWith("@newsletter") ||
          senderJid.endsWith("@broadcast") ||
          senderJid === "status@broadcast" ||
          senderJid === "0@s.whatsapp.net"
        ) {
          continue;
        }

        const isFromSelf = Boolean(msg.key.fromMe);
        const isGroup = senderJid.endsWith("@g.us");

        let senderName = isFromSelf
          ? "Parth (Self-Note)"
          : msg.pushName || senderJid.split("@")[0] || "Contact";

        let chatName = senderName;
        let isPriorityGroup = false;

        if (isGroup) {
          chatName = await resolveGroupSubject(sock, senderJid);
          isPriorityGroup = isMonitoredAcademicGroup(chatName);
        } else {
          chatName = isFromSelf ? "Self-Notes / Reminders" : `${senderName} (DM)`;
        }

        // 1. Substantive content filter: ignore casual chit-chat ("ok", "k", "haan", "cool", "see you")
        // Allow priority groups and self-notes to pass directly to semantic evaluation
        if (!isPriorityGroup && !isFromSelf && !isSubstantiveContent(conversationText)) {
          continue;
        }

        // 2. In-Depth Semantic Reasoning Verification:
        // Evaluates whether the content is actual engineering study material, coursework, or self-reminder,
        // rigorously rejecting commercial deals, shopping links, unrelated tech commentary, or casual banter.
        const semanticEval = await evaluateAcademicContentSemantic(
          conversationText,
          chatName,
          senderName
        );

        if (!semanticEval.isStudyOrAcademic || semanticEval.category === "unrelated") {
          console.log(
            `🛡️ Semantic Filter: Discarded non-academic content from [${chatName}] by ${senderName} (Reasoning: ${semanticEval.reasoning})`
          );
          continue;
        }

        // 3. Deduplication Engine: Detect repeated notices, forwarded links, or redundant material
        const dupCheck = checkContentDuplicate(conversationText, chatName, senderName);
        if (dupCheck.isDuplicate) {
          recordIngestedContent({
            text: conversationText,
            chatName,
            sender: senderName,
          });
          const originalSource = dupCheck.duplicateOf?.firstSeenIn ?? "prior task";
          const matchPercent = Math.round((dupCheck.similarityScore ?? 1) * 100);
          console.log(
            `🔁 Duplicate ignored from [${chatName}] by ${senderName} (Reason: ${dupCheck.reason}, ${matchPercent}% match with [${originalSource}]). Not posting.`
          );
          continue;
        }

        console.log(
          `🎓 Ingesting verified academic material from [${chatName}] by ${senderName} (Category: ${semanticEval.category}, Subject: ${semanticEval.subject}, Confidence: ${Math.round(semanticEval.confidence * 100)}%): "${conversationText.slice(0, 60)}..."`
        );

        try {
          // Record content in deduplication index
          recordIngestedContent({
            text: conversationText,
            chatName,
            sender: senderName,
            category: semanticEval.category === "study_resource" ? "study_resource" : "academic_announcement",
          });

          // Extract study resources (Drive documents, GitHub repos, PDFs, lecture notes)
          const studyResources = extractStudyResources(conversationText, chatName, senderName);

          // Ingest academic tasks and physical submissions
          const ingestion = await ingestProfessorAnnouncement(conversationText);

          // If semantic evaluation found a coursework task or self-reminder but ingestion didn't create a task:
          // Ensure task is created directly using the semantic evaluation result!
          if (
            (semanticEval.category === "coursework_task" || isFromSelf) &&
            ingestion.tasksCreated.length === 0
          ) {
            const taskId = crypto.randomUUID();
            const deadlineDate = new Date();
            deadlineDate.setDate(deadlineDate.getDate() + (semanticEval.inferredDeadlineDays || 5));
            deadlineDate.setHours(23, 59, 0, 0);

            const newTask: Task = {
              id: taskId,
              title: isFromSelf
                ? `[Self-Task] ${semanticEval.title}`
                : `[${semanticEval.subject}] ${semanticEval.title}`,
              description: conversationText,
              category: semanticEval.isPhysicalSubmission ? "submission" : "assignment",
              status: "pending",
              priority: isFromSelf ? "high" : "medium",
              estimatedMinutes: 45,
              deadline: deadlineDate.toISOString(),
              createdAt: new Date().toISOString(),
              updatedAt: new Date().toISOString(),
            };

            insertTask(newTask);
            ingestion.tasksCreated.push(newTask);
            if (semanticEval.isPhysicalSubmission) {
              ingestion.physicalSubmissionsCount++;
            }
          }

          // Record memory of academic material
          recordMemory(
            "college",
            `${senderName} logged ${semanticEval.subject}: "${semanticEval.title}"`,
            "whatsapp",
            { metadata: { chatName, sender: senderName, isSelfNote: isFromSelf } }
          ).catch(console.warn);

          if (
            ingestion.tasksCreated.length > 0 ||
            ingestion.physicalSubmissionsCount > 0 ||
            studyResources.length > 0
          ) {
            const alert: WhatsAppAcademicAlert = {
              id: crypto.randomUUID(),
              sender: senderName,
              chatName,
              text: conversationText,
              timestamp: new Date().toISOString(),
              tasksCount: ingestion.tasksCreated.length,
              physicalSubmissionsCount: ingestion.physicalSubmissionsCount,
              studyResourcesCount: studyResources.length,
              isDirectMessage: !isGroup,
            };

            const existing = getUserProfile<WhatsAppAcademicAlert[]>("whatsapp_recent_alerts") ?? [];
            const updated = [alert, ...existing.slice(0, 24)];
            setUserProfile("whatsapp_recent_alerts", updated);

            // 1. Proactive Broadcast to Discord #college-announcements
            broadcastAcademicNoticeToDiscord(alert).catch((err) => {
              console.error("Failed to broadcast WhatsApp notice to Discord:", err);
            });

            // 2. Stream notice into Dashboard Chat stream
            const resourceSummary =
              studyResources.length > 0
                ? `\n📚 Indexed ${studyResources.length} study resource(s): ${studyResources.map((r) => r.title).join(", ")}`
                : "";

            appendChatMessage({
              id: crypto.randomUUID(),
              role: "system",
              text: `📢 **Academic Notice / Resource Captured from ${chatName}** (${senderName}):\n"${conversationText}"\n👉 Added ${ingestion.tasksCreated.length} task(s) and flagged ${ingestion.physicalSubmissionsCount} physical lab turn(s).${resourceSummary}`,
              timestamp: new Date().toISOString(),
              channel: "whatsapp",
            });

            // 3. Broadcast to Telegram push listeners
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
  const dir = getWhatsAppAuthDir();
  if (existsSync(dir)) {
    rmSync(dir, { recursive: true, force: true });
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

  lines.push(`🟢 *Status:* ${status.isConnected ? "Active & Monitoring Class Groups" : "Credentials Ready (Connecting...)"}`);
  if (status.phoneNumber) {
    lines.push(`📱 *Linked Device:* \`+${status.phoneNumber}\``);
  }
  if (status.linkedAt) {
    lines.push(`🕒 *Linked Since:* ${new Date(status.linkedAt).toLocaleDateString("en-IN")}`);
  }

  lines.push(`\n🔍 *Priority Monitored Channels:*`);
  lines.push(`• "Important Announcements" (All messages analyzed)`);
  lines.push(`• KCCEMSR CR & College Notice Groups`);
  lines.push(`• Keywords: \`submission\`, \`journal\`, \`experiment\`, \`printout\`, \`xerox\`, \`turn\`, \`viva\`, \`defaulter\``);

  if (recentAlerts.length > 0) {
    lines.push(`\n📑 *Recently Captured Academic Notices (${recentAlerts.length}):*`);
    for (let i = 0; i < Math.min(recentAlerts.length, 3); i++) {
      const a = recentAlerts[i]!;
      const timeStr = new Date(a.timestamp).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" });
      const snippet = a.text.length > 70 ? `${a.text.slice(0, 70)}...` : a.text;
      lines.push(`${i + 1}. *[${a.sender} in ${a.chatName}]* (${timeStr}):`);
      lines.push(`   "${snippet}"`);
      lines.push(`   👉 Added *${a.tasksCount} task(s)* | *${a.physicalSubmissionsCount} print(s)*`);
    }
  } else {
    lines.push(`\n✨ *Awaiting new notices from Important Announcements & college groups.*`);
  }

  return lines.join("\n");
}

export {
  checkContentDuplicate,
  recordIngestedContent,
  extractStudyResources,
  listSavedStudyResources,
  isSubstantiveContent,
};
