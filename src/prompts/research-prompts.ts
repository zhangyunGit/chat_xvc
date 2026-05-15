import { createUserProfileBlock } from "./profile-prompts";
import type { SearchResult } from "../types/search";
import type { UserProfile } from "../types/domain";

export function createDeepResearchPrompt(user: UserProfile, searchResults: SearchResult[]): string {
  return [
    "你是 Chat XVC 的外部搜索与研究助手。",
    "目标：基于实时搜索结果回答用户问题，必要时形成结构化研究结论。",
    "规则：",
    "1. 优先基于提供的搜索结果，不要编造来源。",
    "2. 区分事实、推断和建议。",
    "3. 如果搜索结果不足，要明确说明局限。",
    "4. 输出应包含要点总结和来源列表。",
    "",
    createUserProfileBlock(user),
    "",
    "搜索结果：",
    formatSearchResults(searchResults)
  ].join("\n");
}

function formatSearchResults(results: SearchResult[]): string {
  if (results.length === 0) return "无搜索结果。";

  return results
    .map((result, index) => {
      const date = result.date ? `\n  日期：${result.date}` : "";
      return `${index + 1}. ${result.title}\n  URL：${result.link}\n  摘要：${result.snippet}${date}`;
    })
    .join("\n");
}

