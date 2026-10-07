import { generateCompletion } from "../agent/modelClient.js";
import { getEnv } from "../config/env.js";

export interface AcademicSemanticEvaluation {
  isStudyOrAcademic: boolean;
  confidence: number;
  reasoning: string;
  category: "coursework_task" | "study_resource" | "academic_announcement" | "unrelated";
  subject: string;
  title: string;
  isPhysicalSubmission: boolean;
  requiresPrint: boolean;
  requiresHandwritten: boolean;
  inferredDeadlineDays: number;
  isSelfNote?: boolean;
}

const SYSTEM_SEMANTIC_REASONING_PROMPT = `
You are the Lead Academic Intelligence & Semantic Reasoning Engine for Parth Varekar, a Computer Engineering student at K.C. College of Engineering & Management Studies & Research (KCCEMSR), Thane (Mumbai University curriculum).

Your job is to perform in-depth semantic reasoning on messages received from WhatsApp (both college groups, friend DMs, and Parth's own self-reminders) to strictly determine whether the content is GENUINE ACADEMIC STUDY MATERIAL / COURSEWORK or UNRELATED NOISE.

--- CATEGORIES OF GENUINE ACADEMIC MATERIAL (ACCEPT) ---
1. Coursework & Lab Tasks:
   - Lab experiments, assignments, practical turns, journals, writeups, code printouts, submissions, viva preparation.
   - Deadlines, turn schedules, defaulter lists, assignment sheets.
2. Academic Announcements:
   - Professor/CR notices regarding exams, IA1/IA2, university circulars, timetable changes, practical schedules.
3. Curriculum Study Resources:
   - Google Drive links to lecture slides, syllabus PPTs, textbook PDFs, question banks (QB/PYQ), formula sheets.
   - GitHub repositories containing lab practical code, experiment implementations, or college project repos.
4. Self-Pasted Reminders by Parth:
   - Parth posting notes, code snippets, topics to study ("need to finish AOA tree algorithms", "revise paging in OS", "DSP assignment 2").

--- CATEGORIES OF UNRELATED MATERIAL (STRICTLY REJECT) ---
1. Commercial Deals & Shopping:
   - Amazon/Flipkart links, discounts, coupons, clothing, gadgets, sales ("Neostreak Men's sweatshirt", "Skipping rope", "Loot deal").
2. General / Tech News & Commentary:
   - General industry news (e.g., news about Hanzo, general AI product announcements, funding news) that is NOT a college curriculum resource or university coursework.
3. Casual Social Banter & Logistics:
   - "where are you", "see you tomorrow", "ok done", "let's eat", birthday wishes, memes, stickers.

Analyze the message carefully. Return a JSON object with:
{
  "isStudyOrAcademic": boolean (strictly true ONLY if genuine study material, task, or academic notice),
  "confidence": number (between 0.0 and 1.0),
  "reasoning": string (clear, concise explanation of why this is or is not relevant to engineering coursework),
  "category": "coursework_task" | "study_resource" | "academic_announcement" | "unrelated",
  "subject": string (e.g. "Operating Systems", "AOA", "Computer Networks", "DWM", "AISC", "Microprocessors", "Mathematics", "General Engineering", or "None"),
  "title": string (concise actionable title summarizing the academic task or resource),
  "isPhysicalSubmission": boolean (true if requires physical journal, hard copy, xerox print, or lab turn),
  "requiresPrint": boolean (true if mentions printout, code print, screenshots),
  "requiresHandwritten": boolean (true if mentions handwritten writeup or journal),
  "inferredDeadlineDays": number (days until due, default 5)
}
Only output valid JSON matching this schema.
`;

const ACADEMIC_SUBJECT_PATTERNS: Array<{ subject: string; regex: RegExp }> = [
  { subject: "Operating Systems", regex: /\b(operating\s+systems?|kernel|paging|segmentation|semaphore|mutex|round\s+robin|deadlock)\b|\b(os)\b/i },
  { subject: "AOA", regex: /\b(aoa|analysis\s+of\s+algorithms?|dynamic\s+programming|dijkstra|greedy\s+algorithm|asymptotic\s+notation|knapsack|divide\s+and\s+conquer)\b/i },
  { subject: "Computer Networks", regex: /\b(computer\s+networks?|networking|tcp\/?ip|osi\s+model|subnetting|routing\s+protocol|packet\s+tracer|wireshark|socket\s+programming)\b|\b(cn)\b/i },
  { subject: "DWM", regex: /\b(dwm|data\s+warehous(e|ing)|data\s+mining|olap|etl|association\s+rules?|apriori|clustering|k-means)\b/i },
  { subject: "AISC", regex: /\b(aisc|soft\s+computing|fuzzy\s+logic|neural\s+network|genetic\s+algorithm|artificial\s+intelligence)\b/i },
  { subject: "Wireless & Mobile Communication", regex: /\b(wireless|mobile\s+communication|wmc|cellular|gsm|cdma|lte|5g)\b/i },
  { subject: "Microprocessors", regex: /\b(microprocessors?|8086|assembly\s+language|registers?|interfacing|masm|emu8086)\b|\b(mp)\b/i },
  { subject: "Database Systems", regex: /\b(dbms|database\s+systems?|sql|normalization|acid|erd|relational\s+algebra)\b/i },
  { subject: "Distributed Systems", regex: /\b(distributed\s+systems?|rpc|rmi|clock\s+synchronization|chord|mapreduce)\b|\b(ds)\b/i },
  { subject: "Cloud Computing", regex: /\b(cloud\s+computing|aws|azure|virtualization|docker|kubernetes|iaas|paas|saas)\b/i },
  { subject: "Software Engineering", regex: /\b(software\s+engineering|sdlc|agile|scrum|uml|testing|se)\b/i },
  { subject: "Cryptography & Network Security", regex: /\b(cryptography|network\s+security|cns|rsa|aes|des|cybersecurity|hash)\b/i },
];

const COMMERCIAL_TERMS = [
  "amazon.", "flipkart.", "bitli.in", "fktr.in", "coupon", "discount", "sale",
  "price :", "reg price", "buy qnty", "cashback", "loot", "off -", "87% off",
  "at rs.", "deals", "promo code", "free shipping", "sweatshirt", "backpack",
  "skipping rope", "wash basin", "gamepad", "order now"
];

const CASUAL_BANTER_REGEX = /^(hi|hello|hey|ok|k|kk|haan|ha|hnn|cool|nice|lol|lmao|good morning|gm|good night|gn|bye|see you|done|thanks|thank you|thx|sure|np|great|yes|no|bro|dude)[.!?\s]*$/i;

/**
 * Deterministic heuristic semantic fallback when LLM is in offline/mock mode.
 */
export function evaluateAcademicContentHeuristics(
  text: string,
  chatName: string,
  sender: string
): AcademicSemanticEvaluation {
  const trimmed = text.trim();
  const lower = trimmed.toLowerCase();
  // Normalize punctuation/underscores to spaces so word-boundary regexes (\b) match file names like AISC_Module_4_Solutions.pdf
  const normalizedForMatching = trimmed.replace(/[_.\-\/]/g, " ");
  const lowerNormalized = normalizedForMatching.toLowerCase();
  const isFromSelf = sender.toLowerCase().includes("self-note") || sender.toLowerCase().includes("parth");

  // 1. Immediate rejection of commercial deals and shopping spam
  if (COMMERCIAL_TERMS.some((term) => lower.includes(term))) {
    return {
      isStudyOrAcademic: false,
      confidence: 0.99,
      reasoning: "Commercial shopping deal or product promotion. Zero engineering curriculum relevance.",
      category: "unrelated",
      subject: "None",
      title: "Commercial Promotion",
      isPhysicalSubmission: false,
      requiresPrint: false,
      requiresHandwritten: false,
      inferredDeadlineDays: 0,
      isSelfNote: isFromSelf,
    };
  }

  // 2. Immediate rejection of casual greetings and social chat
  if (CASUAL_BANTER_REGEX.test(trimmed) || (trimmed.length < 15 && !trimmed.includes("http"))) {
    return {
      isStudyOrAcademic: false,
      confidence: 0.95,
      reasoning: "Casual conversational message or brief affirmation without academic substance.",
      category: "unrelated",
      subject: "None",
      title: "Casual Message",
      isPhysicalSubmission: false,
      requiresPrint: false,
      requiresHandwritten: false,
      inferredDeadlineDays: 0,
      isSelfNote: isFromSelf,
    };
  }

  // 3. Subject identification using strict word boundaries
  let matchedSubject = "General Engineering";
  let hasSubjectMatch = false;
  for (const item of ACADEMIC_SUBJECT_PATTERNS) {
    if (item.regex.test(normalizedForMatching)) {
      matchedSubject = item.subject;
      hasSubjectMatch = true;
      break;
    }
  }

  // 4. Coursework / Lab Submission Indicators
  const hasSubmissionRequirement =
    lowerNormalized.includes("submit") ||
    lowerNormalized.includes("submission") ||
    lowerNormalized.includes("journal") ||
    lowerNormalized.includes("experiment") ||
    lowerNormalized.includes("practical turn") ||
    lowerNormalized.includes("lab manual") ||
    lowerNormalized.includes("defaulter") ||
    lowerNormalized.includes("writeup") ||
    lowerNormalized.includes("black book") ||
    lowerNormalized.includes("synopsis") ||
    lowerNormalized.includes("deadline") ||
    lowerNormalized.includes("due date");

  const isCoursework =
    hasSubmissionRequirement ||
    lowerNormalized.includes("assignment") ||
    lowerNormalized.includes("question bank") ||
    lowerNormalized.includes("unit test") ||
    lowerNormalized.includes("ia1") ||
    lowerNormalized.includes("ia2") ||
    lowerNormalized.includes("viva") ||
    lowerNormalized.includes("practical") ||
    lowerNormalized.includes("exam ready") ||
    lowerNormalized.includes("exam") ||
    lowerNormalized.includes("solution");

  // 5. Study Resource Indicators (Drive, GitHub, PDF notes, slides, question banks, solutions)
  const isStudyResource =
    lower.includes("drive.google.com") ||
    lower.includes("classroom.google.com") ||
    (lower.includes("github.com") && !lower.includes("amazon")) ||
    lower.includes(".pdf") ||
    lower.includes(".docx") ||
    lower.includes(".pptx") ||
    lowerNormalized.includes("notes") ||
    lowerNormalized.includes("pyq") ||
    lowerNormalized.includes("lecture slides") ||
    lowerNormalized.includes("slides") ||
    lowerNormalized.includes("syllabus") ||
    lowerNormalized.includes("question bank") ||
    lowerNormalized.includes("qb") ||
    lowerNormalized.includes("solution") ||
    lowerNormalized.includes("module") ||
    lowerNormalized.includes("reference material");

  // Academic announcement context
  const isAcademicAnnouncement =
    lowerNormalized.includes("timetable") ||
    lowerNormalized.includes("circular") ||
    lowerNormalized.includes("rescheduled") ||
    lowerNormalized.includes("notice to students") ||
    lowerNormalized.includes("dear students") ||
    lowerNormalized.includes("defaulter list");

  // 6. Self-reminder by Parth (e.g. "complete AOA", "read chapter", "prepare practical")
  if (isFromSelf) {
    const isSelfReminder =
      isCoursework ||
      isStudyResource ||
      hasSubjectMatch ||
      lower.includes("need to") ||
      lower.includes("have to") ||
      lower.includes("todo") ||
      lower.includes("study") ||
      lower.includes("revise") ||
      lower.includes("practice");

    if (isSelfReminder) {
      const selfCategory = isStudyResource && !hasSubmissionRequirement
        ? "study_resource"
        : isCoursework || hasSubmissionRequirement
        ? "coursework_task"
        : "study_resource";

      return {
        isStudyOrAcademic: true,
        confidence: 0.92,
        reasoning: "Self-reminder pasted by Parth for coursework, study notes, or academic revision.",
        category: selfCategory,
        subject: matchedSubject,
        title: `[Self-Reminder] ${trimmed.slice(0, 45).trim()}...`,
        isPhysicalSubmission: lower.includes("journal") || lower.includes("print") || lower.includes("xerox"),
        requiresPrint: lower.includes("print") || lower.includes("xerox"),
        requiresHandwritten: lower.includes("handwritten") || lower.includes("journal"),
        inferredDeadlineDays: 5,
        isSelfNote: true,
      };
    }
  }

  // 7. External messages: Must have coursework, study resource, or verified announcement indicators.
  // Mentioning a technical keyword (e.g. "artificial intelligence", "database") without coursework/academic resource context is considered general tech news/discussion, not university coursework.
  if (!isCoursework && !isStudyResource && !isAcademicAnnouncement) {
    return {
      isStudyOrAcademic: false,
      confidence: 0.90,
      reasoning: "Does not contain engineering coursework tasks, lab requirements, or verified study material resources.",
      category: "unrelated",
      subject: "None",
      title: "Non-Academic Message",
      isPhysicalSubmission: false,
      requiresPrint: false,
      requiresHandwritten: false,
      inferredDeadlineDays: 0,
      isSelfNote: isFromSelf,
    };
  }

  const isPhysical =
    lower.includes("handwritten") ||
    lower.includes("print") ||
    lower.includes("journal") ||
    lower.includes("hard copy") ||
    lower.includes("xerox") ||
    lower.includes("practical turn");

  const requiresPrint =
    lower.includes("print") ||
    lower.includes("xerox") ||
    lower.includes("screenshot") ||
    lower.includes("hard copy");

  const requiresHandwritten =
    lower.includes("handwritten") ||
    lower.includes("journal") ||
    lower.includes("writeup");

  let category: "coursework_task" | "study_resource" | "academic_announcement" = "academic_announcement";
  if (isStudyResource && !hasSubmissionRequirement) {
    category = "study_resource";
  } else if (hasSubmissionRequirement || isCoursework) {
    category = "coursework_task";
  } else if (isAcademicAnnouncement) {
    category = "academic_announcement";
  } else if (isStudyResource) {
    category = "study_resource";
  }

  return {
    isStudyOrAcademic: true,
    confidence: 0.90,
    reasoning: `Matches engineering curriculum (${matchedSubject}) with verifiable academic deliverables (${category}).`,
    category,
    subject: matchedSubject,
    title: `[${matchedSubject}] ${trimmed.slice(0, 45).trim()}...`,
    isPhysicalSubmission: isPhysical,
    requiresPrint,
    requiresHandwritten,
    inferredDeadlineDays: 5,
    isSelfNote: isFromSelf,
  };
}

/**
 * Performs in-depth semantic reasoning to evaluate if text from WhatsApp is genuine study material or coursework.
 * Uses LLM structured evaluation when available, falling back to rigorous heuristic reasoning.
 */
export async function evaluateAcademicContentSemantic(
  text: string,
  chatName: string = "WhatsApp Chat",
  sender: string = "Contact"
): Promise<AcademicSemanticEvaluation> {
  const env = getEnv();
  const trimmed = text.trim();
  const isFromSelf = sender.toLowerCase().includes("self-note") || sender.toLowerCase().includes("parth");

  // Fast heuristic pre-check: if it's blatant commercial deals or pure 1-word greetings, skip LLM call
  const quickLower = trimmed.toLowerCase();
  if (COMMERCIAL_TERMS.some((term) => quickLower.includes(term))) {
    return evaluateAcademicContentHeuristics(trimmed, chatName, sender);
  }
  if (CASUAL_BANTER_REGEX.test(trimmed)) {
    return evaluateAcademicContentHeuristics(trimmed, chatName, sender);
  }

  if (env.AI_PROVIDER !== "mock" && env.AI_API_KEY) {
    try {
      const userPrompt = `
SENDER: "${sender}" (${isFromSelf ? "SENDER IS PARTH HIMSELF (SELF-REMINDER)" : "External Sender"})
CHAT/GROUP: "${chatName}"
MESSAGE CONTENT:
"""
${trimmed}
"""
`;
      const rawJson = await generateCompletion({
        systemPrompt: SYSTEM_SEMANTIC_REASONING_PROMPT,
        userPrompt,
        responseFormat: "json_object",
      });

      const parsed = JSON.parse(rawJson);
      if (typeof parsed === "object" && parsed !== null && typeof parsed.isStudyOrAcademic === "boolean") {
        return {
          isStudyOrAcademic: parsed.isStudyOrAcademic,
          confidence: Number(parsed.confidence) || 0.85,
          reasoning: parsed.reasoning || "Evaluated by semantic reasoning engine.",
          category: parsed.category || (parsed.isStudyOrAcademic ? "coursework_task" : "unrelated"),
          subject: parsed.subject || "General Engineering",
          title: parsed.title || trimmed.slice(0, 50),
          isPhysicalSubmission: Boolean(parsed.isPhysicalSubmission),
          requiresPrint: Boolean(parsed.requiresPrint),
          requiresHandwritten: Boolean(parsed.requiresHandwritten),
          inferredDeadlineDays: Number(parsed.inferredDeadlineDays) || 5,
          isSelfNote: isFromSelf,
        };
      }
    } catch (err: any) {
      console.warn("LLM semantic reasoning failed, falling back to heuristics:", err?.message || err);
    }
  }

  return evaluateAcademicContentHeuristics(trimmed, chatName, sender);
}
