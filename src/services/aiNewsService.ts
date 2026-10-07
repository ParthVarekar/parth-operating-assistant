import { checkContentDuplicate, recordIngestedContent } from "./contentDeduplicationService.js";
import { recordMemory } from "./memoryService.js";
import { broadcastAiNewsToSlack, isSlackConfigured } from "./slackService.js";
import { getUserProfile, setUserProfile } from "../db/repositories/habitRepository.js";

export interface AiNewsItem {
  id: string;
  title: string;
  url: string;
  source: string;
  score?: number;
  summary: string;
  category: "ai_model" | "research_paper" | "systems_gpu" | "developer_tool" | "industry";
  publishedAt: string;
}

const AI_KEYWORDS = [
  "ai",
  "llm",
  "gpt",
  "claude",
  "anthropic",
  "deepmind",
  "gemini",
  "openai",
  "mistral",
  "transformer",
  "neural",
  "agent",
  "rag",
  "gpu",
  "cuda",
  "deep learning",
  "machine learning",
  "inference",
  "compiler",
  "benchmark",
  "reasoning",
  "open-source",
  "huggingface",
  "diffusion",
  "vision",
  "quantum",
];

// Fallback curated deep-tech and AI radar items in case external network times out
const INITIAL_CURATED_AI_RADAR: AiNewsItem[] = [
  {
    id: "radar-deepseek-r1",
    title: "DeepSeek-R1 & Open-Source Reasoning Paradigms",
    url: "https://github.com/deepseek-ai/DeepSeek-R1",
    source: "Research / Open Source",
    summary: "Large-scale reinforcement learning without pure supervised fine-tuning pushes frontier reasoning parity at 1/10th inference training expenditure.",
    category: "ai_model",
    publishedAt: new Date().toISOString(),
  },
  {
    id: "radar-flashattention-3",
    title: "FlashAttention-3: Fast and Accurate Attention on Hopper GPUs",
    url: "https://github.com/Dao-AILab/flash-attention",
    source: "Systems / Architecture",
    summary: "Asynchronous memory copies and warp specialization harness FP8 tensor cores to yield 75% FLOPs utilization on H100s.",
    category: "systems_gpu",
    publishedAt: new Date().toISOString(),
  },
  {
    id: "radar-mcp-anthropic",
    title: "Model Context Protocol (MCP) Standardizes Agent Tool Interfaces",
    url: "https://modelcontextprotocol.io",
    source: "Industry / Dev Tools",
    summary: "Open specification connecting AI agents directly with local and remote development environments, databases, and enterprise workspaces.",
    category: "developer_tool",
    publishedAt: new Date().toISOString(),
  },
  {
    id: "radar-vllm-speculative",
    title: "vLLM Speculative Decoding & Multi-LoRA Batching Optimization",
    url: "https://vllm.ai",
    source: "Inference Systems",
    summary: "High-throughput serving architecture incorporating draft-model verification to double tokens/sec output per GPU node.",
    category: "systems_gpu",
    publishedAt: new Date().toISOString(),
  },
];

/**
 * Retrieves the stored AI news items from memory/profile.
 */
export function getSavedAiNews(): AiNewsItem[] {
  const saved = getUserProfile<AiNewsItem[]>("saved_ai_news_radar");
  if (Array.isArray(saved) && saved.length > 0) {
    return saved;
  }
  return INITIAL_CURATED_AI_RADAR;
}

/**
 * Saves updated AI news items to profile.
 */
export function saveAiNews(items: AiNewsItem[]): void {
  setUserProfile("saved_ai_news_radar", items.slice(0, 50));
}

/**
 * Fetches top stories from Hacker News and filters for frontier AI and systems engineering news.
 */
export async function fetchHackerNewsAiStories(limit = 15): Promise<AiNewsItem[]> {
  try {
    const topIdsRes = await fetch("https://hacker-news.firebaseio.com/v0/topstories.json", {
      signal: AbortSignal.timeout(4000),
    });
    if (!topIdsRes.ok) return [];

    const ids = (await topIdsRes.json()) as number[];
    const items: AiNewsItem[] = [];

    for (const id of ids.slice(0, 40)) {
      if (items.length >= limit) break;

      try {
        const itemRes = await fetch(`https://hacker-news.firebaseio.com/v0/item/${id}.json`, {
          signal: AbortSignal.timeout(2000),
        });
        if (!itemRes.ok) continue;

        const data = (await itemRes.json()) as any;
        if (!data || !data.title || !data.url) continue;

        const titleLower = data.title.toLowerCase();
        const isAiRelated = AI_KEYWORDS.some((kw) => titleLower.includes(kw));

        if (isAiRelated) {
          const isDuplicate = checkContentDuplicate(
            `${data.title} ${data.url}`,
            "Hacker News",
            "HN"
          );

          if (!isDuplicate.isDuplicate) {
            let category: AiNewsItem["category"] = "industry";
            if (titleLower.includes("gpu") || titleLower.includes("cuda") || titleLower.includes("system")) {
              category = "systems_gpu";
            } else if (titleLower.includes("paper") || titleLower.includes("arxiv")) {
              category = "research_paper";
            } else if (titleLower.includes("model") || titleLower.includes("llm") || titleLower.includes("claude") || titleLower.includes("gpt")) {
              category = "ai_model";
            } else if (titleLower.includes("tool") || titleLower.includes("framework") || titleLower.includes("sdk")) {
              category = "developer_tool";
            }

            const newsItem: AiNewsItem = {
              id: `hn-${data.id}`,
              title: data.title,
              url: data.url,
              source: `Hacker News (${data.score || 0} pts)`,
              score: data.score,
              summary: `Trending discussion among top software engineers and AI practitioners (${data.descendants || 0} comments).`,
              category,
              publishedAt: new Date(data.time * 1000).toISOString(),
            };

            items.push(newsItem);
            recordIngestedContent({
              text: `${data.title} ${data.url}`,
              chatName: "Hacker News",
              sender: "HN",
              category: "study_resource",
            });
          }
        }
      } catch {
        // Skip individual item errors
      }
    }

    return items;
  } catch (err) {
    console.warn("Could not fetch live Hacker News stories:", err);
    return [];
  }
}

/**
 * Fetches trending papers from Hugging Face Daily Papers API.
 */
export async function fetchHuggingFaceDailyPapers(limit = 5): Promise<AiNewsItem[]> {
  try {
    const res = await fetch("https://huggingface.co/api/daily_papers", {
      signal: AbortSignal.timeout(4000),
    });
    if (!res.ok) return [];

    const papers = (await res.json()) as any[];
    const items: AiNewsItem[] = [];

    for (const p of papers.slice(0, limit)) {
      if (!p || !p.title) continue;

      const title = p.title.replace(/\n/g, " ").trim();
      const url = `https://huggingface.co/papers/${p.id}`;

      const dup = checkContentDuplicate(`${title} ${url}`, "Hugging Face", "HF");
      if (!dup.isDuplicate) {
        items.push({
          id: `hf-${p.id}`,
          title,
          url,
          source: "Hugging Face Daily Papers",
          score: p.upvotes || 0,
          summary: p.summary ? p.summary.slice(0, 160) + "..." : "Frontier machine learning research paper.",
          category: "research_paper",
          publishedAt: p.publishedAt || new Date().toISOString(),
        });

        recordIngestedContent({
          text: `${title} ${url}`,
          chatName: "Hugging Face",
          sender: "HF",
          category: "study_resource",
        });
      }
    }

    return items;
  } catch (err) {
    console.warn("Could not fetch Hugging Face daily papers:", err);
    return [];
  }
}

/**
 * Runs the AI & Deep-Tech intelligence scan, stores insights in memory,
 * updates profile radar, and optionally broadcasts to Slack & Discord.
 */
export async function runAiIntelligenceScan(): Promise<{
  newItemsCount: number;
  totalRadarItems: number;
  items: AiNewsItem[];
}> {
  console.log("⚡ Scanning AI & Deep-Tech Radar (Hacker News & Frontier Research)...");

  const [hnItems, hfItems] = await Promise.all([
    fetchHackerNewsAiStories(8),
    fetchHuggingFaceDailyPapers(4),
  ]);

  const newItems = [...hnItems, ...hfItems];
  const existing = getSavedAiNews();

  // Deduplicate against existing list
  const combined = [...newItems];
  for (const item of existing) {
    if (!combined.some((c) => c.id === item.id || c.title.toLowerCase() === item.title.toLowerCase())) {
      combined.push(item);
    }
  }

  saveAiNews(combined);

  // Record top breakthroughs into persistent memory & Slack brain
  for (const item of newItems.slice(0, 3)) {
    await recordMemory(
      "ai_tech_insight",
      `[${item.category.toUpperCase()}] ${item.title} • ${item.summary} (${item.url})`,
      "ai_radar",
      {
        title: item.title,
        importance: 4,
        metadata: { url: item.url, source: item.source },
      }
    );

    if (isSlackConfigured()) {
      broadcastAiNewsToSlack(item.title, item.summary, item.url).catch(console.warn);
    }
  }

  console.log(`✅ AI Intelligence Radar completed: ${newItems.length} new insights discovered, ${combined.length} in radar.`);

  return {
    newItemsCount: newItems.length,
    totalRadarItems: combined.length,
    items: combined,
  };
}
