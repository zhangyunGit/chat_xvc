import type { ChatMessage } from "../types/chat";
import type { UserProfile } from "../types/domain";
import type { RecentIntentMessage } from "../types/intent";

export function createProfileIntakeMessages(input: {
  user: UserProfile;
  message: string;
  recentMessages: RecentIntentMessage[];
}): ChatMessage[] {
  return [
    {
      role: "system",
      content: [
        "你是 Chat XVC 的用户资料收集解析器。",
        "你只做结构化信息抽取，不生成面向用户的回复。",
        "任务：判断用户当前输入是否提供、拒绝提供、或忽略姓名/邮箱收集请求。",
        "只输出 JSON，不要输出 Markdown，不要解释。",
        "JSON 字段：name, email, aiNickname, refused, ignored, shouldContinueNormalChat, confidence。",
        "字段定义：",
        "- name: 用户明确提供或可从当前输入自然识别出的姓名；没有则为 null。",
        "- email: 用户提供的邮箱；没有则为 null。",
        "- aiNickname: 用户希望给 AI 助手设置的新名字；例如“你叫豆豆”“以后叫你豆豆”应提取为“豆豆”；没有则为 null。",
        "- refused: 用户明确表示不想提供姓名/邮箱。",
        "- ignored: 用户没有提供姓名/邮箱，也没有拒绝，而是在进行其他正常对话或任务请求。",
        "- shouldContinueNormalChat: 用户输入包含后续任务/问题/普通聊天，需要继续处理原始输入。",
        "- confidence: 0 到 1。",
        "规则：",
        "1. 如果当前正在收集姓名，用户只回复一个短中文姓名，如“张云”，应提取为 name。",
        "2. 如果用户输入类似“张云,666@qq.com”，应同时提取 name 和 email。",
        "3. 如果用户说“不想说/先不提供/跳过/随便叫我”，refused=true。",
        "4. 如果用户直接说“帮我创建任务/查一下/解释一下”等，不包含资料，ignored=true 且 shouldContinueNormalChat=true。",
        "5. 不要把普通问题、任务内容或长句误判为姓名。",
        "6. 区分用户姓名和助手名字：用户说“我叫张云”是 name；用户说“你叫豆豆/以后叫你豆豆”是 aiNickname。"
      ].join("\n")
    },
    {
      role: "user",
      content: JSON.stringify(
        {
          currentProfile: {
            userId: input.user.id,
            name: input.user.name,
            email: input.user.email,
            profileStatus: input.user.profileStatus
          },
          recentMessages: input.recentMessages.map((message) => ({
            role: message.role,
            content: message.content,
            intent: message.intent
          })),
          message: input.message
        },
        null,
        2
      )
    }
  ];
}
