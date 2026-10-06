import { beforeAll, describe, expect, it } from "vitest";
import { initDatabase } from "../src/db/database.js";
import {
  formatClassroomStatusDigest,
  parseIcsFeed,
} from "../src/services/googleClassroomService.js";
import { findPendingTasks } from "../src/db/repositories/taskRepository.js";
import { setUserProfile } from "../src/db/repositories/habitRepository.js";

const SAMPLE_CLASSROOM_ICS = `
BEGIN:VCALENDAR
PRODID:-//Google Inc//Google Calendar 70.9054//EN
VERSION:2.0
CALSCALE:GREGORIAN
BEGIN:VEVENT
DTSTART:20261028T182900Z
DTEND:20261028T182900Z
DTSTAMP:20261006T134500Z
UID:assignment-os-lab-3@classroom.google.com
SUMMARY:Lab Experiment 3: Paging and Virtual Memory (Operating Systems)
DESCRIPTION:Please submit handwritten answers along with printed code and 
 terminal outputs. Bring hard copy to lab. https://classroom.google.com/c/123/a/456
STATUS:CONFIRMED
END:VEVENT
BEGIN:VEVENT
DTSTART:20261102T182900Z
DTEND:20261102T182900Z
DTSTAMP:20261006T134500Z
UID:assignment-cn-quiz-2@classroom.google.com
SUMMARY:[Computer Networks] Module 2 Numerical Problems
DESCRIPTION:Solve questions 1 through 10 from Tanenbaum textbook.
STATUS:CONFIRMED
END:VEVENT
END:VCALENDAR
`.trim();

describe("Google Classroom Service Suite", () => {
  beforeAll(() => {
    process.env.DATABASE_PATH = ":memory:";
    initDatabase(":memory:");
  });

  it("parses raw RFC 5545 iCal data from Google Classroom correctly", () => {
    const assignments = parseIcsFeed(SAMPLE_CLASSROOM_ICS);
    expect(assignments.length).toBe(2);

    const osAssignment = assignments[0]!;
    expect(osAssignment.title).toContain("Lab Experiment 3");
    expect(osAssignment.courseName).toBe("Operating Systems");
    expect(osAssignment.isPrintable).toBe(true);
    expect(osAssignment.dueDate).toBeDefined();
    expect(osAssignment.url).toContain("classroom.google.com");

    const cnAssignment = assignments[1]!;
    expect(cnAssignment.title).toContain("Module 2 Numerical Problems");
    expect(cnAssignment.courseName).toBe("Computer Networks");
  });

  it("accurately detects physical and printable submission requirements", () => {
    const assignments = parseIcsFeed(SAMPLE_CLASSROOM_ICS);
    const osAssignment = assignments.find((a) => a.courseName === "Operating Systems");
    expect(osAssignment?.isPrintable).toBe(true);
  });

  it("formats status digest properly for both unlinked and linked states", async () => {
    const unlinked = await formatClassroomStatusDigest();
    expect(unlinked).toContain("Google Classroom: Not Connected");

    setUserProfile("classroom_feed_url", "https://calendar.google.com/calendar/ical/test/basic.ics");
    const linked = await formatClassroomStatusDigest();
    expect(linked).toContain("Google Classroom Connected");
  });
});
