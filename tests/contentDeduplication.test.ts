import { beforeAll, describe, expect, it } from "vitest";
import { initDatabase } from "../src/db/database.js";
import { insertTask } from "../src/db/repositories/taskRepository.js";
import {
  checkContentDuplicate,
  computeJaccardSimilarity,
  extractStudyResources,
  extractTokens,
  extractUrls,
  isSubstantiveContent,
  listSavedStudyResources,
  normalizeText,
  recordIngestedContent,
} from "../src/services/contentDeduplicationService.js";
import type { Task } from "../src/types/index.js";

describe("WhatsApp Content Deduplication & Study Resource Engine Suite", () => {
  beforeAll(() => {
    process.env.DATABASE_PATH = ":memory:";
    initDatabase(":memory:");
  });

  describe("Text Normalization & Extraction", () => {
    it("strips WhatsApp forward headers, timestamps, phone numbers, and emojis", () => {
      const raw = `[Forwarded from CR Rahul] 📢 [12:30, 24/10/2026] +91 9876543210:
      Please complete the Microprocessors lab journal experiment 4 and bring printouts! 🚀🔥`;
      const normalized = normalizeText(raw);

      expect(normalized).not.toContain("forwarded");
      expect(normalized).not.toContain("+91");
      expect(normalized).not.toContain("🚀");
      expect(normalized).toContain("microprocessors lab journal experiment 4");
    });

    it("extracts clean URLs and strips tracking parameters", () => {
      const msg = `Here is the OS notes link: https://drive.google.com/file/d/1A2B3C4D/view?usp=sharing&authuser=0. Check it out!`;
      const urls = extractUrls(msg);

      expect(urls.length).toBe(1);
      expect(urls[0]).toBe("https://drive.google.com/file/d/1A2B3C4D/view");
      expect(urls[0]).not.toContain("usp=sharing");
      expect(urls[0]).not.toContain("authuser");
    });

    it("extracts informative keyword tokens without stop words", () => {
      const text = "please submit the operating systems lab assignment before friday";
      const tokens = extractTokens(normalizeText(text));

      expect(tokens).toContain("submit");
      expect(tokens).toContain("operating");
      expect(tokens).toContain("systems");
      expect(tokens).toContain("assignment");
      expect(tokens).toContain("friday");
      expect(tokens).not.toContain("the");
      expect(tokens).not.toContain("please");
    });
  });

  describe("Substantive Content Filter", () => {
    it("distinguishes substantive study materials and notices from casual chatter", () => {
      // Substantive cases
      expect(isSubstantiveContent("Submit CN experiment 5 code and graphs before Tuesday.")).toBe(true);
      expect(isSubstantiveContent("Drive notes link: https://drive.google.com/drive/folders/xyz")).toBe(true);
      expect(isSubstantiveContent("Question bank for DWM Module 3 has been uploaded by professor.")).toBe(true);

      // Casual chatter cases
      expect(isSubstantiveContent("ok")).toBe(false);
      expect(isSubstantiveContent("k")).toBe(false);
      expect(isSubstantiveContent("haan bhai")).toBe(false);
      expect(isSubstantiveContent("good morning")).toBe(false);
      expect(isSubstantiveContent("bye")).toBe(false);
      expect(isSubstantiveContent("cool")).toBe(false);
    });
  });

  describe("Deduplication & Similarity Detection", () => {
    it("identifies exact repeats forwarded across multiple friend DMs and groups", () => {
      const notice = "AISC Module 2 Assignment is due on 15th October. Submit handwritten copy to faculty.";

      // First encounter from CR in group
      const firstCheck = checkContentDuplicate(notice, "Important Announcements", "CR Rahul");
      expect(firstCheck.isDuplicate).toBe(false);

      recordIngestedContent({
        text: notice,
        chatName: "Important Announcements",
        sender: "CR Rahul",
      });

      // Second encounter forwarded by Friend Amit in personal DM
      const secondCheck = checkContentDuplicate(
        `Fwd: ${notice}`,
        "Amit (DM)",
        "Amit"
      );
      expect(secondCheck.isDuplicate).toBe(true);
      expect(secondCheck.reason).toBe("exact_hash");
      expect(secondCheck.duplicateOf?.firstSeenIn).toBe("Important Announcements");
    });

    it("detects shared study resource URLs forwarded by different friends", () => {
      const msg1 = "Check this Google Drive link for OS Question Bank: https://drive.google.com/file/d/os_qb_2026/view?usp=sharing";
      const msg2 = "Hey Parth, here are the OS questions: https://drive.google.com/file/d/os_qb_2026/view from Professor";

      recordIngestedContent({
        text: msg1,
        chatName: "Rohan (DM)",
        sender: "Rohan",
      });

      const check = checkContentDuplicate(msg2, "Study Group B", "Sneha");
      expect(check.isDuplicate).toBe(true);
      expect(check.reason).toBe("shared_url");
    });

    it("detects high token similarity for slightly reworded notices", () => {
      const noticeOriginal = "All students must submit Computer Networks assignment 3 with packet tracer diagrams before Thursday.";
      const noticeReworded = "All students please submit Computer Networks assignment 3 with packet tracer diagrams before Thursday sharp.";

      recordIngestedContent({
        text: noticeOriginal,
        chatName: "KCCEMSR Comps",
        sender: "CR",
      });

      const check = checkContentDuplicate(noticeReworded, "Friends Group", "Sahil");
      expect(check.isDuplicate).toBe(true);
      expect(check.reason).toBe("token_similarity");
      expect(check.similarityScore).toBeGreaterThanOrEqual(0.70);
    });

    it("identifies duplicates matching active pending tasks in backlog", () => {
      const existingTask: Task = {
        id: "task-existing-1",
        title: "[AOA] Dynamic Programming Knapsack Assignment",
        category: "assignment",
        status: "pending",
        priority: "high",
        estimatedMinutes: 60,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
      insertTask(existingTask);

      const incomingMsg = "Reminder: Complete Dynamic Programming Knapsack Assignment for AOA coursework.";
      const check = checkContentDuplicate(incomingMsg, "AOA Group", "Prof");

      expect(check.isDuplicate).toBe(true);
      expect(check.reason).toBe("existing_pending_task");
    });
  });

  describe("Study Resource Indexing", () => {
    it("extracts and persists study resources from WhatsApp messages", () => {
      const text = "Here are the Operating Systems notes and repo: https://github.com/parth/os-algorithms and https://drive.google.com/file/d/os-notes/view";
      const extracted = extractStudyResources(text, "Aryan (DM)", "Aryan");

      expect(extracted.length).toBe(2);
      expect(extracted.some((r) => r.resourceType === "github_repo")).toBe(true);
      expect(extracted.some((r) => r.resourceType === "drive_link")).toBe(true);
      expect(extracted[0]?.subject).toBe("Operating Systems");

      const saved = listSavedStudyResources();
      expect(saved.length).toBeGreaterThanOrEqual(2);
      expect(saved.some((r) => r.url?.includes("os-algorithms"))).toBe(true);
    });
  });
});
