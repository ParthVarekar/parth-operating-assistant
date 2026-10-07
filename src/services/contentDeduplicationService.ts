import crypto from "node:crypto";
import { getUserProfile, setUserProfile } from "../db/repositories/habitRepository.js";
import { findPendingTasks } from "../db/repositories/taskRepository.js";

export interface ContentRecord {
  id: string;
  hash: string;
  normalizedSnippet: string;
  urls: string[];
  tokens: string[];
  category: "academic_announcement" | "study_resource" | "coursework_task";
  firstSeenAt: string;
  firstSeenIn: string; // Group name or Friend DM
  firstSeenFrom: string; // Sender name
  duplicateCount: number;
  duplicateSources: Array<{ chatName: string; sender: string; timestamp: string }>;
}

export interface StudyResource {
  id: string;
  title: string;
  subject: string;
  url?: string;
  resourceType: "drive_link" | "github_repo" | "pdf_document" | "web_resource" | "notes_text";
  sourceChat: string;
  sourceSender: string;
  extractedAt: string;
  rawTextSnippet: string;
}

export interface DuplicateCheckResult {
  isDuplicate: boolean;
  duplicateOf?: ContentRecord;
  similarityScore?: number;
  reason?: "exact_hash" | "shared_url" | "token_similarity" | "existing_pending_task";
}

const COMMON_STOP_WORDS = new Set([
  "the", "and", "for", "with", "from", "this", "that", "have", "will", "your",
  "been", "they", "what", "were", "when", "there", "about", "which", "are", "you",
  "all", "our", "their", "can", "has", "not", "but", "also", "into", "more", "please",
  "kindly", "today", "tomorrow", "students", "everyone", "here", "just", "send", "give"
]);

const ACADEMIC_OR_RESOURCE_KEYWORDS = [
  "submission", "assignment", "journal", "experiment", "lab manual", "printout",
  "print out", "hard copy", "xerox", "defaulter", "due date", "deadline", "practical turn",
  "practical", "turn", "writeup", "unit test", "viva", "black book", "synopsis",
  "ia1", "ia2", "timetable", "attendance", "exam", "practicals", "syllabus",
  "announcement", "notice", "cr notice", "notes", "question bank", "qb", "pyq",
  "slides", "drive.google", "github.com", "notion.so", "drive", "pdf", "solution",
  "study", "lecture", "module", "reference", "material", "project", "presentation"
];

const CASUAL_GREETINGS = new Set([
  "hi", "hello", "hey", "ok", "k", "kk", "haan", "ha", "hnn", "cool", "nice", "lol",
  "lmao", "good morning", "gm", "good night", "gn", "bye", "cya", "see you", "done",
  "thanks", "thank you", "thx", "sure", "np", "great", "yes", "no", "yo", "hmm", "hm"
]);

/**
 * Normalizes message text by stripping forward headers, timestamps, phone numbers,
 * emoji spam, and redundant whitespace.
 */
export function normalizeText(text: string): string {
  if (!text || typeof text !== "string") {
    return "";
  }
  // Cap at 15,000 chars to prevent ReDoS on massive pastes
  const safeText = text.slice(0, 15000);

  let cleaned = safeText
    .replace(/^fwd:?\s*/i, "")
    .replace(/^\[?forwarded(?:\s+message|\s+from[^\]]*)?\]?:?\s*/i, "")
    .replace(/^-{5,}\s*forwarded message\s*-{5,}/i, "")
    .replace(/\[\d{1,2}:\d{2}(?::\d{2})?(?:\s*[ap]m)?(?:,\s*\d{1,2}[/-]\d{1,2}[/-]\d{2,4})?\]/gi, "")
    .replace(/\+?\d{1,3}[-.\s]?\d{9,12}/g, "") // phone numbers
    .replace(/[\u{1F600}-\u{1F64F}\u{1F300}-\u{1F5FF}\u{1F680}-\u{1F6FF}\u{1F700}-\u{1F77F}\u{1F780}-\u{1F7FF}\u{1F800}-\u{1F8FF}\u{1F900}-\u{1F9FF}\u{1FA00}-\u{1FA6F}\u{1FA70}-\u{1FAFF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}]/gu, " ")
    .toLowerCase();

  // Replace whitespace sequences
  cleaned = cleaned.replace(/\s+/g, " ").trim();
  return cleaned;
}

/**
 * Extracts and cleans valid URLs from message content, stripping tracking parameters.
 */
export function extractUrls(text: string): string[] {
  if (!text || typeof text !== "string") {
    return [];
  }
  const urlRegex = /(https?:\/\/[^\s<>"{}|\\^~\[\]`]+)/gi;
  const matches = text.match(urlRegex) ?? [];
  const cleanUrls: string[] = [];

  for (const raw of matches) {
    let clean = raw.replace(/[.,;:!?)+\]]+$/, "");
    try {
      const parsed = new URL(clean);
      if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
        continue;
      }
      // Remove common query tracking parameters for deduplication
      const paramsToRemove = ["usp", "utm_source", "utm_medium", "utm_campaign", "authuser", "fbclid", "igshid"];
      for (const p of paramsToRemove) {
        parsed.searchParams.delete(p);
      }
      clean = parsed.toString().replace(/\/$/, "");
      cleanUrls.push(clean);
    } catch {
      cleanUrls.push(clean);
    }
  }

  return Array.from(new Set(cleanUrls));
}

/**
 * Extracts meaningful keyword tokens from normalized text.
 */
export function extractTokens(normalizedText: string): string[] {
  const words = normalizedText.split(/[^a-z0-9]+/);
  return Array.from(
    new Set(
      words.filter((w) => w.length >= 3 && !COMMON_STOP_WORDS.has(w))
    )
  );
}

/**
 * Computes Jaccard token similarity (0.0 to 1.0) between two token sets.
 */
export function computeJaccardSimilarity(tokensA: string[], tokensB: string[]): number {
  if (tokensA.length === 0 || tokensB.length === 0) return 0;
  const setA = new Set(tokensA);
  const setB = new Set(tokensB);

  let intersection = 0;
  for (const t of setA) {
    if (setB.has(t)) intersection++;
  }

  const union = setA.size + setB.size - intersection;
  return union === 0 ? 0 : intersection / union;
}

const NON_ACADEMIC_DOMAINS = [
  "amazon.",
  "flipkart.",
  "bitli.in",
  "fktr.in",
  "myntra.",
  "ajio.",
  "meesho.",
  "zomato.",
  "swiggy.",
  "instagram.",
  "facebook.",
  "tiktok.",
  "snapchat.",
  "spotify.",
  "netflix.",
];

/**
 * Checks if a URL points to an academic, programming, or tech resource.
 */
export function isEducationalOrTechUrl(url: string): boolean {
  const lower = url.toLowerCase();
  if (NON_ACADEMIC_DOMAINS.some((d) => lower.includes(d))) {
    return false;
  }
  return (
    lower.includes("drive.google.") ||
    lower.includes("docs.google.") ||
    lower.includes("classroom.google.") ||
    lower.includes("github.com") ||
    lower.includes("gitlab.com") ||
    lower.includes("notion.so") ||
    lower.includes("notion.site") ||
    lower.includes("arxiv.org") ||
    lower.includes("kaggle.com") ||
    lower.includes("leetcode.com") ||
    lower.includes("geeksforgeeks.org") ||
    lower.includes("stackoverflow.com") ||
    lower.includes(".edu") ||
    lower.includes(".ac.in") ||
    lower.endsWith(".pdf") ||
    lower.includes("/pdf") ||
    lower.endsWith(".docx") ||
    lower.endsWith(".pptx") ||
    lower.endsWith(".zip")
  );
}

/**
 * Determines whether message text is substantive study material or an actionable notice,
 * rather than casual conversational chit-chat or shopping link spam.
 */
export function isSubstantiveContent(text: string): boolean {
  const trimmed = text.trim();
  if (trimmed.length < 5) return false;

  const lower = trimmed.toLowerCase();

  // Filter out pure greetings / affirmations
  if (CASUAL_GREETINGS.has(lower)) {
    return false;
  }

  // Filter out commercial shopping / coupon / sales deal spam
  const isCommercial =
    lower.includes("amazon.") ||
    lower.includes("flipkart.") ||
    lower.includes("bitli.in") ||
    lower.includes("fktr.in") ||
    lower.includes("coupon") ||
    lower.includes("discount") ||
    lower.includes("price :") ||
    lower.includes("reg price") ||
    lower.includes("loot") ||
    lower.includes("buy qnty");

  if (isCommercial) {
    return false;
  }

  // Check for academic or study resource keywords
  const hasKeyword = ACADEMIC_OR_RESOURCE_KEYWORDS.some((kw) => lower.includes(kw));
  if (hasKeyword) return true;

  // Check for study resource URLs
  const urls = extractUrls(text);
  if (urls.some((u) => isEducationalOrTechUrl(u))) return true;

  // Length check: substantial detailed academic messages (> 75 chars with >= 10 words)
  const words = trimmed.split(/\s+/);
  if (words.length >= 10 && trimmed.length >= 75) {
    return true;
  }

  return false;
}

/**
 * Checks if incoming WhatsApp text is a duplicate of a previously ingested notice,
 * study resource, or active pending task.
 */
export function checkContentDuplicate(
  text: string,
  currentChat: string,
  currentSender: string
): DuplicateCheckResult {
  const normalized = normalizeText(text);
  if (!normalized) {
    return { isDuplicate: true };
  }

  const hash = crypto.createHash("sha256").update(normalized).digest("hex");
  const urls = extractUrls(text);
  const tokens = extractTokens(normalized);

  const history = getUserProfile<ContentRecord[]>("seen_content_records") ?? [];

  // 1. Exact Normalized Hash Match
  const exactMatch = history.find((r) => r.hash === hash);
  if (exactMatch) {
    return {
      isDuplicate: true,
      duplicateOf: exactMatch,
      similarityScore: 1.0,
      reason: "exact_hash",
    };
  }

  // 2. Shared URL Match (e.g. Drive assignment link forwarded across multiple friends/groups)
  if (urls.length > 0) {
    for (const record of history) {
      const hasUrlOverlap = record.urls.some((rUrl) => urls.includes(rUrl));
      if (hasUrlOverlap) {
        return {
          isDuplicate: true,
          duplicateOf: record,
          similarityScore: 0.95,
          reason: "shared_url",
        };
      }
    }
  }

  // 3. High Token Similarity (>= 70% word overlap for substantive notices)
  if (tokens.length >= 5) {
    for (const record of history) {
      if (record.tokens.length >= 5) {
        const sim = computeJaccardSimilarity(tokens, record.tokens);
        if (sim >= 0.70) {
          return {
            isDuplicate: true,
            duplicateOf: record,
            similarityScore: sim,
            reason: "token_similarity",
          };
        }
      }
    }
  }

  // 4. Compare with active pending tasks in backlog
  const pendingTasks = findPendingTasks();
  for (const task of pendingTasks) {
    const taskTokens = extractTokens(normalizeText(task.title + " " + (task.description ?? "")));
    if (taskTokens.length >= 3 && tokens.length >= 3) {
      const jaccard = computeJaccardSimilarity(tokens, taskTokens);
      // Containment: fraction of task tokens contained in the incoming message
      let matchCount = 0;
      const tokenSet = new Set(tokens);
      for (const t of taskTokens) {
        if (tokenSet.has(t)) matchCount++;
      }
      const containment = matchCount / taskTokens.length;

      if (jaccard >= 0.60 || containment >= 0.75) {
        return {
          isDuplicate: true,
          similarityScore: Math.max(jaccard, containment),
          reason: "existing_pending_task",
        };
      }
    }
  }

  return { isDuplicate: false };
}

/**
 * Records newly ingested or repeated content in the persistent deduplication index.
 */
export function recordIngestedContent(params: {
  text: string;
  chatName: string;
  sender: string;
  category?: "academic_announcement" | "study_resource" | "coursework_task";
}): ContentRecord {
  const normalized = normalizeText(params.text);
  const hash = crypto.createHash("sha256").update(normalized).digest("hex");
  const urls = extractUrls(params.text);
  const tokens = extractTokens(normalized);
  const category = params.category ?? (urls.length > 0 ? "study_resource" : "academic_announcement");

  const history = getUserProfile<ContentRecord[]>("seen_content_records") ?? [];
  const existingIdx = history.findIndex((r) => r.hash === hash);

  const now = new Date().toISOString();

  if (existingIdx !== -1) {
    const existing = history[existingIdx]!;
    existing.duplicateCount = (existing.duplicateCount || 1) + 1;
    existing.duplicateSources = existing.duplicateSources ?? [];
    existing.duplicateSources.push({
      chatName: params.chatName,
      sender: params.sender,
      timestamp: now,
    });
    // Keep max 20 sources per item
    if (existing.duplicateSources.length > 20) {
      existing.duplicateSources = existing.duplicateSources.slice(-20);
    }
    history[existingIdx] = existing;
    setUserProfile("seen_content_records", history);
    return existing;
  }

  const newRecord: ContentRecord = {
    id: crypto.randomUUID(),
    hash,
    normalizedSnippet: normalized.slice(0, 120),
    urls,
    tokens,
    category,
    firstSeenAt: now,
    firstSeenIn: params.chatName,
    firstSeenFrom: params.sender,
    duplicateCount: 1,
    duplicateSources: [],
  };

  // Keep max 500 recent content records
  const updated = [newRecord, ...history].slice(0, 500);
  setUserProfile("seen_content_records", updated);
  return newRecord;
}

/**
 * Parses study material or resources from WhatsApp text and indexes them.
 */
export function extractStudyResources(
  text: string,
  chatName: string,
  sender: string
): StudyResource[] {
  const urls = extractUrls(text);
  const lower = text.toLowerCase();
  const resources: StudyResource[] = [];

  // Subject identification heuristic with word boundaries
  let subject = "General";
  if (/\b(os|operating\s+systems?)\b/i.test(text)) subject = "Operating Systems";
  else if (/\b(aoa|algorithms?)\b/i.test(text)) subject = "AOA";
  else if (/\b(cn|computer\s+networks?|networking)\b/i.test(text)) subject = "Computer Networks";
  else if (/\b(dwm|data\s+warehouse|data\s+mining)\b/i.test(text)) subject = "DWM";
  else if (/\b(aisc|soft\s+computing|artificial\s+intelligence)\b/i.test(text)) subject = "AISC";
  else if (/\b(microprocessors?|mp)\b/i.test(text)) subject = "Microprocessors";

  const cleanSnippet = text.replace(/\s+/g, " ").trim().slice(0, 160);

  if (urls.length > 0) {
    for (const u of urls) {
      if (!isEducationalOrTechUrl(u)) {
        continue;
      }
      let resourceType: StudyResource["resourceType"] = "web_resource";
      if (u.includes("drive.google.com")) resourceType = "drive_link";
      else if (u.includes("github.com")) resourceType = "github_repo";
      else if (u.endsWith(".pdf") || u.includes("/pdf")) resourceType = "pdf_document";

      let title = `[${subject}] Study Material from ${sender}`;
      if (lower.includes("notes")) title = `[${subject}] Lecture Notes`;
      else if (lower.includes("qb") || lower.includes("question bank")) title = `[${subject}] Question Bank`;
      else if (lower.includes("pyq")) title = `[${subject}] Previous Year Questions`;
      else if (lower.includes("assignment")) title = `[${subject}] Assignment Reference`;
      else if (lower.includes("solution") || lower.includes("sol")) title = `[${subject}] Solutions`;

      resources.push({
        id: crypto.randomUUID(),
        title,
        subject,
        url: u,
        resourceType,
        sourceChat: chatName,
        sourceSender: sender,
        extractedAt: new Date().toISOString(),
        rawTextSnippet: cleanSnippet,
      });
    }
  } else if (
    lower.includes("notes") ||
    lower.includes("formula") ||
    lower.includes("important questions") ||
    lower.includes("pyq") ||
    lower.includes("question bank") ||
    lower.includes("qb") ||
    lower.includes("solution") ||
    lower.includes(".pdf")
  ) {
    let title = `[${subject}] Reference Notes from ${sender}`;
    if (lower.includes("qb") || lower.includes("question bank")) {
      title = `[${subject}] Question Bank Solution from ${sender}`;
    } else if (lower.includes("solution")) {
      title = `[${subject}] Solutions from ${sender}`;
    }

    resources.push({
      id: crypto.randomUUID(),
      title,
      subject,
      resourceType: "notes_text",
      sourceChat: chatName,
      sourceSender: sender,
      extractedAt: new Date().toISOString(),
      rawTextSnippet: cleanSnippet,
    });
  }

  // Save to persistent study resources store if non-empty
  if (resources.length > 0) {
    const existing = getUserProfile<StudyResource[]>("whatsapp_study_resources") ?? [];
    const filteredNew = resources.filter(
      (nr) => !existing.some((er) => er.url && nr.url && er.url === nr.url)
    );
    if (filteredNew.length > 0) {
      const updated = [...filteredNew, ...existing].slice(0, 200);
      setUserProfile("whatsapp_study_resources", updated);
    }
  }

  return resources;
}

/**
 * Retrieves stored study resources captured across all WhatsApp chats.
 */
export function listSavedStudyResources(): StudyResource[] {
  return getUserProfile<StudyResource[]>("whatsapp_study_resources") ?? [];
}
