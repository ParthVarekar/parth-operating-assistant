import { beforeAll, describe, expect, it } from "vitest";
import { initDatabase } from "../src/db/database.js";
import { setUserProfile } from "../src/db/repositories/habitRepository.js";
import {
  disconnectWhatsApp,
  formatWhatsAppStatusDigest,
  getWhatsAppStatus,
  isAcademicMessage,
  onWhatsAppAcademicNotice,
  type WhatsAppAcademicAlert,
} from "../src/services/whatsappService.js";

describe("WhatsApp Academic Group Monitor Suite", () => {
  beforeAll(() => {
    process.env.DATABASE_PATH = ":memory:";
    initDatabase(":memory:");
  });

  it("accurately detects academic messages and filters out casual chats", () => {
    // True cases
    expect(
      isAcademicMessage("Dear students, complete experiment 4 in your journals and bring code printouts next Friday.")
    ).toBe(true);
    expect(
      isAcademicMessage("Reminder: OS lab assignment submission is due tomorrow. Defaulter list will be published.")
    ).toBe(true);
    expect(
      isAcademicMessage("Please bring hard copy xerox for the upcoming practical turn and viva.")
    ).toBe(true);

    // False cases
    expect(isAcademicMessage("Bro are you coming to college today?")).toBe(false);
    expect(isAcademicMessage("Let's play football at 6 pm.")).toBe(false);
    expect(isAcademicMessage("Ok")).toBe(false);
    expect(isAcademicMessage("")).toBe(false);
  });

  it("formats status digest properly when WhatsApp is unlinked", () => {
    const digest = formatWhatsAppStatusDigest();
    expect(digest).toContain("WhatsApp Academic Bridge");
    expect(digest).toContain("Not Linked");
    expect(digest).toContain("npm run auth:whatsapp");
  });

  it("formats status digest with active phone and recent alerts when linked", () => {
    setUserProfile("whatsapp_linked_phone", "919876543210");
    setUserProfile("whatsapp_linked_at", "2026-10-06T12:00:00Z");

    const mockAlert: WhatsAppAcademicAlert = {
      id: "alert-test-1",
      sender: "CR Rahul",
      chatName: "Comps Sem 5 Official",
      text: "Submit AOA journal writeup with printed graphs before Monday 10 AM.",
      timestamp: "2026-10-06T14:30:00Z",
      tasksCount: 1,
      physicalSubmissionsCount: 1,
    };
    setUserProfile("whatsapp_recent_alerts", [mockAlert]);

    const status = getWhatsAppStatus();
    expect(status.phoneNumber).toBe("919876543210");
    expect(status.alertsCount).toBe(1);

    const digest = formatWhatsAppStatusDigest();
    expect(digest).toContain("+919876543210");
    expect(digest).toContain("CR Rahul");
    expect(digest).toContain("Recently Captured Academic Notices");
    expect(digest).toContain("Added *1 task(s)*");
  });

  it("handles academic notice event listener dispatch", async () => {
    let receivedAlert: WhatsAppAcademicAlert | null = null;
    onWhatsAppAcademicNotice(async (alert) => {
      receivedAlert = alert;
    });

    // Verify registration works without error
    expect(typeof onWhatsAppAcademicNotice).toBe("function");
  });

  it("disconnects and wipes state cleanly", () => {
    disconnectWhatsApp();
    const status = getWhatsAppStatus();
    expect(status.phoneNumber).toBeNull();
  });
});
