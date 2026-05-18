import { intentRegistry } from "../agents/intent-registry";
import type { ChatMessage } from "../types/chat";
import type { IntentRouteInput } from "../types/intent";

export function createIntentRouterMessages(input: IntentRouteInput): ChatMessage[] {
  return [
    {
      role: "system",
      content: [
        "你是 Chat XVC 的 Intent Router。",
        "你的任务是根据用户最近一条输入，从候选 intent 中选择最合适的一项。",
        "只输出 JSON，不要输出 Markdown，不要解释。",
        "如果信息不足或存在危险写操作不明确，设置 needsClarification=true 并给出 clarificationQuestion。",
        "任务类 intent 的 entities 尽量提取：target/taskTitle/title、detail、targetIndex、dueAt、priority、status、requirementContent、requirementIndex、requirementTarget、content。",
        "如果用户说“创建/新增/添加/提醒我/帮我记”一个任务，即使任务内容里包含“完成某事”，也必须识别为 task.create，而不是 task.complete。",
        "当 intent=task.create 时，必须尽量同时输出 title 和 detail：title 是 4-12 字的简短任务名；detail 是从用户原话和上下文提炼出的具体任务内容，保留关键要求、对象、动作和约束。",
        "如果用户明确要求“记住/记一下/以后记得/我的偏好是”等长期偏好、事实或回答习惯，应识别为 memory.write；如果是提醒、待办、截止时间或需要完成的事项，应识别为 task.create。",
        "如果用户询问“你记住了什么/你还记得吗/列出记忆”，应识别为 memory.list 或 memory.recall；如果用户说“忘记/删除某条记忆”，应识别为 memory.delete。",
        "如果已完成 onboarding 后用户主动提供或修改姓名/邮箱，应识别为 profile.update_user_info，并在 entities 中保留原始表达即可，具体抽取由资料解析器完成。",
        "多轮对话中，必须结合 recentMessages；例如用户刚看过唯一任务后问“具体内容是什么”，应识别为 task.detail。",
        "任务删除、任务修改、任务完成、任务要求修改/删除必须结合 recentMessages 解析指代。用户说“第2个/第二个/上面那个/这个任务”时，在 entities 中输出 targetIndex 或 target。",
        "文件删除必须结合 recentMessages 和文件卡片/文件名解析目标。用户说“删掉第二个文件/删除刚才上传的 PDF/把这个文档删掉”时，识别为 document.delete，并在 entities 中输出 target、targetIndex 或 filename。",
        "不要把依赖指代的任务/文件写操作降级为 conversation.chitchat 或 conversation.general_qa。",
        "confidence 必须是 0 到 1 之间的小数。",
        "JSON 字段必须包含：intent, confidence, entities, needsClarification, clarificationQuestion。"
      ].join("\n")
    },
    {
      role: "user",
      content: JSON.stringify(
        {
          userProfile: {
            name: input.userName,
            email: input.userEmail,
            aiNickname: input.aiNickname
          },
          recentMessages: input.recentMessages.map((message) => ({
            role: message.role,
            content: message.content
          })),
          message: input.message,
          availableIntents: intentRegistry.map((item) => ({
            intent: item.intent,
            description: item.description,
            requiredTools: item.requiredTools,
            promptTemplate: item.promptTemplate
          }))
        },
        null,
        2
      )
    }
  ];
}
