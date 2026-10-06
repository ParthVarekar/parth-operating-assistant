import { getEnv } from "../config/env.js";
import { getUserProfile, setUserProfile } from "../db/repositories/habitRepository.js";
import { insertTask } from "../db/repositories/taskRepository.js";
import type { Task } from "../types/index.js";

export interface GitHubRepo {
  id: number;
  name: string;
  fullName: string;
  description: string | null;
  language: string | null;
  stars: number;
  forks: number;
  openIssues: number;
  htmlUrl: string;
  pushedAt: string;
  updatedAt: string;
  isPrivate: boolean;
}

export interface GitHubCommitEvent {
  repoName: string;
  message: string;
  timestamp: string;
}

export interface GitHubActivitySummary {
  username: string;
  avatarUrl?: string;
  htmlUrl: string;
  publicRepos: number;
  commitsToday: number;
  streakDays: number;
  recentRepos: GitHubRepo[];
  recentCommits: GitHubCommitEvent[];
  lastActiveAt: string | null;
}

/**
 * Gets configured or profile GitHub username.
 */
export function getActiveGitHubUsername(): string {
  const custom = getUserProfile<string>("github_username");
  if (custom && typeof custom === "string" && custom.trim().length > 0) {
    return custom.trim();
  }
  const env = getEnv();
  return env.GITHUB_USERNAME || "ParthVarekar";
}

/**
 * Sets custom GitHub username.
 */
export function setActiveGitHubUsername(username: string): void {
  setUserProfile("github_username", username.trim());
}

/**
 * Builds request headers for GitHub API.
 */
function getHeaders(): Record<string, string> {
  const env = getEnv();
  const headers: Record<string, string> = {
    "User-Agent": "Personal-AI-Assistant/1.0",
    Accept: "application/vnd.github.v3+json",
  };
  const token = env.GITHUB_TOKEN;
  if (token && token.trim().length > 0) {
    headers["Authorization"] = `Bearer ${token.trim()}`;
  }
  return headers;
}

/**
 * Fetches GitHub user profile details.
 */
export async function fetchGitHubUser(username?: string): Promise<{
  login: string;
  name: string | null;
  avatarUrl: string;
  htmlUrl: string;
  publicRepos: number;
  bio: string | null;
} | null> {
  const targetUser = username || getActiveGitHubUsername();
  try {
    const res = await fetch(`https://api.github.com/users/${targetUser}`, {
      headers: getHeaders(),
      signal: AbortSignal.timeout(2000),
    });
    if (!res.ok) {
      return null;
    }
    const data = (await res.json()) as {
      login: string;
      name: string | null;
      avatar_url: string;
      html_url: string;
      public_repos: number;
      bio: string | null;
    };
    return {
      login: data.login,
      name: data.name,
      avatarUrl: data.avatar_url,
      htmlUrl: data.html_url,
      publicRepos: data.public_repos,
      bio: data.bio,
    };
  } catch (err) {
    console.error("Error fetching GitHub user:", err);
    return null;
  }
}

/**
 * Fetches recent repositories for user.
 */
export async function fetchUserRepositories(
  username?: string,
  limit: number = 8
): Promise<GitHubRepo[]> {
  const targetUser = username || getActiveGitHubUsername();
  try {
    const res = await fetch(
      `https://api.github.com/users/${targetUser}/repos?sort=pushed&direction=desc&per_page=${limit}`,
      { headers: getHeaders(), signal: AbortSignal.timeout(2000) }
    );
    if (!res.ok) {
      return [];
    }
    const data = (await res.json()) as Array<{
      id: number;
      name: string;
      full_name: string;
      description: string | null;
      language: string | null;
      stargazers_count: number;
      forks_count: number;
      open_issues_count: number;
      html_url: string;
      pushed_at: string;
      updated_at: string;
      private: boolean;
    }>;

    return data.map((r) => ({
      id: r.id,
      name: r.name,
      fullName: r.full_name,
      description: r.description,
      language: r.language,
      stars: r.stargazers_count,
      forks: r.forks_count,
      openIssues: r.open_issues_count,
      htmlUrl: r.html_url,
      pushedAt: r.pushed_at,
      updatedAt: r.updated_at,
      isPrivate: r.private,
    }));
  } catch (err) {
    console.error("Error fetching GitHub repositories:", err);
    return [];
  }
}

/**
 * Fetches recent user events to parse push activity & commit streak.
 */
export async function fetchUserEvents(
  username?: string,
  perPage: number = 30
): Promise<{
  commitsToday: number;
  streakDays: number;
  recentCommits: GitHubCommitEvent[];
  lastActiveAt: string | null;
}> {
  const targetUser = username || getActiveGitHubUsername();
  try {
    const res = await fetch(
      `https://api.github.com/users/${targetUser}/events?per_page=${perPage}`,
      { headers: getHeaders(), signal: AbortSignal.timeout(2000) }
    );
    if (!res.ok) {
      return { commitsToday: 0, streakDays: 0, recentCommits: [], lastActiveAt: null };
    }
    const events = (await res.json()) as Array<{
      type: string;
      created_at: string;
      repo: { name: string };
      payload?: {
        commits?: Array<{ message: string; sha: string }>;
      };
    }>;

    const todayStr = new Date().toISOString().slice(0, 10);
    const activeDates = new Set<string>();
    const recentCommits: GitHubCommitEvent[] = [];
    let commitsToday = 0;
    let lastActiveAt: string | null = null;

    for (const evt of events) {
      const dateStr = evt.created_at.slice(0, 10);
      if (!lastActiveAt) {
        lastActiveAt = evt.created_at;
      }

      if (evt.type === "PushEvent") {
        activeDates.add(dateStr);
        const commits = evt.payload?.commits ?? [];
        if (dateStr === todayStr) {
          commitsToday += commits.length > 0 ? commits.length : 1;
        }

        for (const c of commits) {
          if (recentCommits.length < 5) {
            recentCommits.push({
              repoName: evt.repo.name.replace(`${targetUser}/`, ""),
              message: c.message.split("\n")[0] ?? "Commit update",
              timestamp: evt.created_at,
            });
          }
        }
      } else if (evt.type === "CreateEvent" || evt.type === "PullRequestEvent") {
        activeDates.add(dateStr);
      }
    }

    // Calculate streak
    let streakDays = 0;
    const checkDate = new Date();
    // Check up to 30 past days
    for (let i = 0; i < 30; i++) {
      const dStr = checkDate.toISOString().slice(0, 10);
      if (activeDates.has(dStr)) {
        streakDays++;
      } else if (i === 0) {
        // Today has no commits yet, check if yesterday was active
        // to maintain an in-progress streak
        continue;
      } else {
        break;
      }
      checkDate.setDate(checkDate.getDate() - 1);
    }

    return {
      commitsToday,
      streakDays,
      recentCommits,
      lastActiveAt,
    };
  } catch (err) {
    console.error("Error fetching GitHub events:", err);
    return { commitsToday: 0, streakDays: 0, recentCommits: [], lastActiveAt: null };
  }
}

/**
 * Calculates complete activity summary.
 */
export async function getGitHubActivitySummary(
  username?: string
): Promise<GitHubActivitySummary> {
  const targetUser = username || getActiveGitHubUsername();
  const [userProfile, repos, events] = await Promise.all([
    fetchGitHubUser(targetUser),
    fetchUserRepositories(targetUser, 8),
    fetchUserEvents(targetUser, 30),
  ]);

  return {
    username: targetUser,
    avatarUrl: userProfile?.avatarUrl,
    htmlUrl: userProfile?.htmlUrl ?? `https://github.com/${targetUser}`,
    publicRepos: userProfile?.publicRepos ?? repos.length,
    commitsToday: events.commitsToday,
    streakDays: events.streakDays,
    recentRepos: repos,
    recentCommits: events.recentCommits,
    lastActiveAt: events.lastActiveAt,
  };
}

/**
 * Formats a clean Telegram markdown digest of GitHub engineering stats & projects.
 */
export function formatGitHubDigest(summary: GitHubActivitySummary): string {
  const lines: string[] = [
    `🐙 *GitHub & Hackathon Engineering Activity*\n`,
    `👤 *User:* [${summary.username}](${summary.htmlUrl}) (${summary.publicRepos} Public Repos)`,
    `🔥 *Commit Streak:* ${summary.streakDays > 0 ? `${summary.streakDays} day(s) streak!` : "0 days (Push today to start!)"}`,
    `💻 *Commits Today:* ${summary.commitsToday > 0 ? `*${summary.commitsToday} commits pushed* 🔥` : "No pushes yet today"}`,
  ];

  if (summary.lastActiveAt) {
    const lastDate = new Date(summary.lastActiveAt).toLocaleString("en-IN", {
      day: "numeric",
      month: "short",
      hour: "2-digit",
      minute: "2-digit",
    });
    lines.push(`🕒 *Last Active:* ${lastDate}\n`);
  } else {
    lines.push("");
  }

  if (summary.recentRepos.length > 0) {
    lines.push(`🚀 *Active Projects & Hackathons:*`);
    for (let i = 0; i < Math.min(summary.recentRepos.length, 5); i++) {
      const r = summary.recentRepos[i]!;
      const lang = r.language ? `\`${r.language}\`` : "Project";
      lines.push(`${i + 1}. *[${r.name}](${r.htmlUrl})* (${lang})`);
      if (r.description) {
        lines.push(`   _${r.description.slice(0, 60)}${r.description.length > 60 ? "..." : ""}_`);
      }
    }
    lines.push("");
  }

  if (summary.recentCommits.length > 0) {
    lines.push(`📝 *Recent Commits:*`);
    for (const c of summary.recentCommits.slice(0, 3)) {
      lines.push(`• *\`${c.repoName}\`*: ${c.message}`);
    }
  }

  return lines.join("\n");
}

/**
 * Converts a GitHub project repository into a scheduled 45-minute deep-work task
 * for Parth's 11 PM – 4:30 AM night engineering block.
 */
export function convertRepoToTask(repoName: string, minutes: number = 45): Task {
  const taskId = crypto.randomUUID();
  const today = new Date().toISOString().slice(0, 10);

  return insertTask({
    id: taskId,
    title: `Code: ${repoName} sprint`,
    description: `Deep-work engineering session for GitHub repository https://github.com/${getActiveGitHubUsername()}/${repoName}`,
    category: "coding",
    status: "pending",
    priority: "high",
    estimatedMinutes: minutes,
    deadline: `${today}T23:59:00Z`,
  });
}
