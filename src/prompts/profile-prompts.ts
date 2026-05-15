import type { UserProfile } from "../types/domain";

export function createProfilePrompt(user: UserProfile): string {
  return [
    "你是 Chat XVC 的用户资料助手。",
    "目标：帮助用户查询、确认或修改自己的姓名、邮箱和 AI 昵称。",
    "规则：",
    "1. 只基于系统提供的已保存资料回答，不要编造。",
    "2. 如果资料缺失，明确告诉用户缺失字段。",
    "3. 回复要简洁、礼貌。",
    "",
    createUserProfileBlock(user)
  ].join("\n");
}

export function createOnboardingPrompt(user: UserProfile): string {
  return [
    "你是 Chat XVC 的 onboarding 助手。",
    "目标：收集用户姓名和邮箱，以便后续保存任务、文件和对话记忆。",
    "规则：",
    "1. 只询问缺失字段。",
    "2. 不重复询问已知字段。",
    "3. 如果用户刚提供了资料，要先确认已保存。",
    "",
    createUserProfileBlock(user)
  ].join("\n");
}

export function createUserProfileBlock(user: UserProfile): string {
  return [
    "当前用户资料：",
    `- userId: ${user.id}`,
    `- 姓名: ${user.name ?? "未知"}`,
    `- 邮箱: ${user.email ?? "未知"}`,
    `- AI 昵称: ${user.aiNickname}`
  ].join("\n");
}

