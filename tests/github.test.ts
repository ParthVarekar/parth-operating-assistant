import { beforeAll, describe, expect, it } from "vitest";
import { initDatabase } from "../src/db/database.js";
import { findPendingTasks } from "../src/db/repositories/taskRepository.js";
import {
  convertRepoToTask,
  formatGitHubDigest,
  getActiveGitHubUsername,
  setActiveGitHubUsername,
  type GitHubActivitySummary,
} from "../src/services/githubService.js";

describe("GitHub / Hackathon Engineering Activity Suite", () => {
  beforeAll(() => {
    process.env.DATABASE_PATH = ":memory:";
    initDatabase(":memory:");
  });

  it("handles GitHub username preference retrieval and update", () => {
    expect(getActiveGitHubUsername()).toBe("ParthVarekar");

    setActiveGitHubUsername("parth-dev-custom");
    expect(getActiveGitHubUsername()).toBe("parth-dev-custom");

    // Reset back
    setActiveGitHubUsername("ParthVarekar");
    expect(getActiveGitHubUsername()).toBe("ParthVarekar");
  });

  it("formats GitHub engineering digest with streak, repos, and commits", () => {
    const mockSummary: GitHubActivitySummary = {
      username: "ParthVarekar",
      htmlUrl: "https://github.com/ParthVarekar",
      publicRepos: 27,
      commitsToday: 3,
      streakDays: 5,
      lastActiveAt: new Date().toISOString(),
      recentRepos: [
        {
          id: 1,
          name: "Susurrus",
          fullName: "ParthVarekar/Susurrus",
          description: "Smart voice and AI assistant workspace",
          language: "TypeScript",
          stars: 2,
          forks: 0,
          openIssues: 0,
          htmlUrl: "https://github.com/ParthVarekar/Susurrus",
          pushedAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          isPrivate: false,
        },
        {
          id: 2,
          name: "SIH_Files",
          fullName: "ParthVarekar/SIH_Files",
          description: "Smart India Hackathon backend and ML files",
          language: "Python",
          stars: 1,
          forks: 0,
          openIssues: 1,
          htmlUrl: "https://github.com/ParthVarekar/SIH_Files",
          pushedAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          isPrivate: false,
        },
      ],
      recentCommits: [
        {
          repoName: "Susurrus",
          message: "feat: add multi-agent orchestration",
          timestamp: new Date().toISOString(),
        },
        {
          repoName: "SIH_Files",
          message: "fix: update model inference endpoint",
          timestamp: new Date().toISOString(),
        },
      ],
    };

    const text = formatGitHubDigest(mockSummary);
    expect(text).toContain("GitHub & Hackathon Engineering Activity");
    expect(text).toContain("ParthVarekar");
    expect(text).toContain("27 Public Repos");
    expect(text).toContain("5 day(s) streak!");
    expect(text).toContain("3 commits pushed");
    expect(text).toContain("Susurrus");
    expect(text).toContain("SIH_Files");
    expect(text).toContain("feat: add multi-agent orchestration");
  });

  it("converts a GitHub repository into a scheduled engineering task for night deep work", () => {
    const task = convertRepoToTask("Susurrus", 45);

    expect(task.id).toBeDefined();
    expect(task.title).toBe("Code: Susurrus sprint");
    expect(task.category).toBe("coding");
    expect(task.priority).toBe("high");
    expect(task.estimatedMinutes).toBe(45);
    expect(task.description).toContain("https://github.com/ParthVarekar/Susurrus");

    const pending = findPendingTasks();
    const stored = pending.find((t) => t.id === task.id);
    expect(stored).toBeDefined();
    expect(stored?.title).toBe("Code: Susurrus sprint");
  });
});
