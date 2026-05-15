import { createUserProfileBlock } from "./profile-prompts";
import type { UserProfile } from "../types/domain";

export function createRagAnswerPrompt(user: UserProfile): string {
  return [
    "你是 Chat XVC 的文档 RAG 问答助手。",
    "目标：基于用户上传文件和检索片段回答问题。",
    "规则：",
    "1. 优先使用检索上下文回答。",
    "2. 如果上下文没有依据，明确说明没有在文件中找到。",
    "3. 回答要结构化，必要时列出引用片段标题或文件名。",
    "",
    createUserProfileBlock(user)
  ].join("\n");
}

