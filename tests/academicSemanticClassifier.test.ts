import { describe, it, expect, beforeAll } from "vitest";
import {
  evaluateAcademicContentHeuristics,
  evaluateAcademicContentSemantic,
} from "../src/services/academicSemanticClassifier.js";

describe("Academic Semantic Reasoning & Self-Note Classifier Suite", () => {
  beforeAll(() => {
    process.env.AI_PROVIDER = "mock";
  });

  it("strictly rejects commercial shopping deals and sales spam", async () => {
    const deals = [
      "Neostreak Men's Cotton Round Neck Full Sleeve Sweatshirt @199 https://www.amazon.in/dp/B0CDSJKT9K",
      "Slovic Skipping Rope (Pack Of 1) @ ₹73 Apply 3% coupon https://www.amazon.in/dp/B0CF28NRQP",
      "87% Off - Plantex Wash Basin At Rs.2,399 https://www.amazon.in/dp/B0D847TZVZ",
      "Lowest : iQOO Gamepad @679 https://www.amazon.in/dp/B07WHQQ6KJ",
    ];

    for (const deal of deals) {
      const res = await evaluateAcademicContentSemantic(deal, "Deals Channel", "Bot");
      expect(res.isStudyOrAcademic).toBe(false);
      expect(res.category).toBe("unrelated");
      expect(res.confidence).toBeGreaterThanOrEqual(0.9);
    }
  });

  it("strictly rejects casual social banter, greetings, and sports chatter", async () => {
    const chats = [
      "bro are you coming to college today?",
      "let's play football at 6 pm",
      "ok done",
      "happy birthday man!",
      "where are you guys standing?",
    ];

    for (const chat of chats) {
      const res = await evaluateAcademicContentSemantic(chat, "Friends Group", "Aarav");
      expect(res.isStudyOrAcademic).toBe(false);
      expect(res.category).toBe("unrelated");
    }
  });

  it("strictly rejects general tech news / non-academic products", async () => {
    const news = "Hanzo just announced a new funding round and released an update to their web analytics tool.";
    const res = await evaluateAcademicContentSemantic(news, "Tech Chat", "Karan");
    expect(res.isStudyOrAcademic).toBe(false);
    expect(res.category).toBe("unrelated");
  });

  it("identifies genuine college coursework and lab journal submissions", async () => {
    const notice = `
Dear students,
Please complete Operating Systems Lab Experiment 4 on Paging and Segmentation in your journals.
Attach verified code outputs and screenshots.
Bring hard copy for submission during your scheduled practical turn next Friday.
    `.trim();

    const res = await evaluateAcademicContentSemantic(notice, "Comps Sem 5 Official", "Prof. Sharma");
    expect(res.isStudyOrAcademic).toBe(true);
    expect(res.category).toBe("coursework_task");
    expect(res.subject).toBe("Operating Systems");
    expect(res.isPhysicalSubmission).toBe(true);
    expect(res.requiresPrint).toBe(true);
    expect(res.requiresHandwritten).toBe(true);
  });

  it("identifies study material links like Google Drive notes and GitHub practical repos", async () => {
    const studyLink = "Here are the unit 3 lecture slides and question bank for AOA: https://drive.google.com/drive/folders/aoa-unit3";
    const res = await evaluateAcademicContentSemantic(studyLink, "CR Announcements", "CR Rahul");
    expect(res.isStudyOrAcademic).toBe(true);
    expect(res.category).toBe("study_resource");
    expect(res.subject).toBe("AOA");
  });

  it("accurately captures self-pasted reminders and notes sent by Parth himself", async () => {
    const selfReminders = [
      "Need to finish Computer Networks socket programming experiment before Tuesday turn",
      "Revise dynamic programming knapsack problem for AOA unit test tomorrow",
      "Prepare DWM assignment 2 question bank solutions",
    ];

    for (const msg of selfReminders) {
      const res = await evaluateAcademicContentSemantic(msg, "Self-Notes / Reminders", "Parth (Self-Note)");
      expect(res.isStudyOrAcademic).toBe(true);
      expect(res.isSelfNote).toBe(true);
      expect(res.subject).not.toBe("None");
      expect(["coursework_task", "study_resource"]).toContain(res.category);
    }
  });
});
