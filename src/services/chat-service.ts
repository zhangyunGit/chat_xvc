import { ChatAgent } from "../agents/chat-agent";
import { IntentRouter } from "../agents/intent-router";
import { ProfileIntakeAgent, type ProfileIntakeResult } from "../agents/profile-intake-agent";
import { createChatProvider } from "../providers/chat-provider-factory";
import {
  createProfileUpdatedPrefix
} from "../tools/profile-tools";
import type { ChatInput, ChatServiceResult } from "../types/chat";
import { TaskTools } from "../tools/task-tools";
import type { IntentDecision } from "../types/intent";
import type { SearchResult } from "../types/search";
import { ConversationService } from "./conversation-service";
import { LlmLogService } from "./llm-log-service";
import { SearchTools } from "../tools/search-tools";
import { UserService } from "./user-service";

export class ChatService {
  private readonly chatAgent: ChatAgent;
  private readonly conversationService: ConversationService;
  private readonly intentRouter: IntentRouter;
  private readonly llmLogService: LlmLogService;
  private readonly profileIntakeAgent: ProfileIntakeAgent;
  private readonly searchTools: SearchTools;
  private readonly taskTools: TaskTools;
  private readonly userService: UserService;

  constructor(env: Env) {
    const chatProvider = createChatProvider(env);
    this.chatAgent = new ChatAgent(chatProvider);
    this.intentRouter = new IntentRouter(chatProvider);
    this.profileIntakeAgent = new ProfileIntakeAgent(chatProvider);
    this.userService = new UserService(env.DB);
    this.conversationService = new ConversationService(env.DB);
    this.llmLogService = new LlmLogService(env);
    this.searchTools = new SearchTools(env);
    this.taskTools = new TaskTools(env.DB);
  }

  async createAssistantReply(input: ChatInput): Promise<ChatServiceResult> {
    const initialUserResolution = await this.userService.resolveUser({
      userId: input.userId,
      message: input.message,
      skipProfileExtraction: isConfirmationMessage(input.message)
    });

    const conversation = await this.conversationService.resolveConversation({
      conversationId: input.conversationId,
      userId: initialUserResolution.user.id,
      firstMessage: input.message
    });

    const recentMessages = input.conversationId
      ? await this.conversationService.getRecentMessages(conversation.id, 10)
      : [];

    const intake = await this.resolvePendingProfileIntake({
      user: initialUserResolution.user,
      message: input.message,
      conversationId: conversation.id,
      recentMessages
    });

    if (intake.reply) {
      return {
        reply: intake.reply,
        userId: intake.user.id,
        conversationId: conversation.id
      };
    }

    const intentRoute = await this.intentRouter.route({
      message: input.message,
      recentMessages,
      userName: intake.user.name,
      userEmail: intake.user.email,
      aiNickname: intake.user.aiNickname,
      profileChanged: intake.profileChanged,
      profileReset: initialUserResolution.profileReset,
      missingProfileFields: []
    });

    const shouldExecuteProfileReset =
      intentRoute.decision.intent === "profile.reset" &&
      intentRoute.decision.entities.confirmed === true;

    const { user, profileChanged, profileReset } = shouldExecuteProfileReset
      ? await this.userService.resolveUser({
          message: input.message,
          forceNewUser: true,
          skipProfileExtraction: true
        })
      : {
          user: intake.user,
          profileChanged: intake.profileChanged,
          profileReset: initialUserResolution.profileReset
        };

    const activeConversation =
      shouldExecuteProfileReset
        ? await this.conversationService.resolveConversation({
            userId: user.id,
            firstMessage: input.message
          })
        : conversation;

    if (intentRoute.llmCall) {
      await this.llmLogService.logCall({
        user,
        queryText: input.message,
        responseText: intentRoute.llmCall.responseText,
        promptMessages: intentRoute.llmCall.promptMessages
      });
    }

    await this.conversationService.saveUserMessage({
      conversationId: activeConversation.id,
      content: input.message,
      intent: intentRoute.decision.intent
    });

    const reply = await this.createReply({
      input,
      decision: intentRoute.decision,
      profileChanged,
      profileReset,
      user,
      recentMessages
    });

    await this.conversationService.saveAssistantMessage({
      conversationId: activeConversation.id,
      content: reply,
      intent: intentRoute.decision.intent
    });

    return {
      reply,
      userId: user.id,
      conversationId: activeConversation.id
    };
  }

  private async createReply(input: {
    input: ChatInput;
    decision: IntentDecision;
    profileChanged: boolean;
    profileReset: boolean;
    user: Awaited<ReturnType<UserService["resolveUser"]>>["user"];
    recentMessages: Awaited<ReturnType<ConversationService["getRecentMessages"]>>;
  }): Promise<string> {
    if (input.decision.needsClarification) {
      return input.decision.clarificationQuestion ?? "你希望我执行什么操作？";
    }

    if (input.decision.intent === "profile.reset") {
      return input.profileReset
        ? "好的，我已为你开启一个新的用户资料。你可以告诉我你的姓名和邮箱；如果暂时不想提供，也可以直接开始使用。"
        : "你确定要重置用户资料吗？这会开启新的用户资料，并让当前浏览器切换到新的用户身份。请回复“确定”或“取消”。";
    }

    if (input.decision.intent === "profile.collect_user_info") {
      return createOnboardingReply(input.user.aiNickname);
    }

    if (
      input.decision.intent === "profile.update_user_info" ||
      input.decision.intent === "profile.update_ai_nickname"
    ) {
      const profileUpdate = await this.applyProfileUpdateFromLlm({
        user: input.user,
        message: input.input.message,
        recentMessages: input.recentMessages
      });
      if (input.decision.intent === "profile.update_ai_nickname") {
        return profileUpdate.user.aiNickname !== input.user.aiNickname
          ? `好的，以后你可以叫我${profileUpdate.user.aiNickname}。`
          : "我识别到你想更新我的名字，但没有提取到明确的新名字。你可以说“以后叫你豆豆”。";
      }
      return createProfileUpdatedPrefix(profileUpdate.user);
    }

    if (input.decision.intent === "profile.query") {
      return createProfileQueryReply(input.user, input.decision.entities.field);
    }

    if (input.decision.intent.startsWith("task.")) {
      const taskResult = await this.taskTools.executeTaskIntent({
        userId: input.user.id,
        message: input.input.message,
        decision: input.decision,
        recentMessages: input.recentMessages
      });

      if (taskResult.handled && taskResult.mode === "direct" && taskResult.reply) {
        return taskResult.reply;
      }

      if (taskResult.handled && taskResult.mode === "llm" && taskResult.toolResultText) {
        const llmResult = await this.chatAgent.respond({
          userMessage: input.input.message,
          user: input.user,
          decision: input.decision,
          toolResultText: taskResult.toolResultText
        });

        await this.llmLogService.logCall({
          user: input.user,
          queryText: input.input.message,
          responseText: llmResult.reply,
          promptMessages: llmResult.promptMessages
        });

        return llmResult.reply;
      }

      const llmResult = await this.chatAgent.respond({
        userMessage: input.input.message,
        user: input.user,
        decision: input.decision,
        toolResultText:
          "任务工具未执行：缺少可识别的任务操作。请询问用户是要创建、查看、查看详情、更新、完成、删除任务，还是管理任务要求。"
      });

      await this.llmLogService.logCall({
        user: input.user,
        queryText: input.input.message,
        responseText: llmResult.reply,
        promptMessages: llmResult.promptMessages
      });

      return llmResult.reply;
    }

    if (
      input.decision.intent === "conversation.help" ||
      input.decision.intent === "conversation.capability_intro"
    ) {
      return createCapabilityIntro(input.user.aiNickname);
    }

    const searchResults = input.decision.needsWebSearch
      ? await this.resolveSearchResults(input.input.message)
      : [];

    const llmResult = await this.chatAgent.respond({
      userMessage: input.input.message,
      user: input.user,
      decision: input.decision,
      searchResults
    });

    await this.llmLogService.logCall({
      user: input.user,
      queryText: input.input.message,
      responseText: llmResult.reply,
      promptMessages: llmResult.promptMessages
    });

    return llmResult.reply;
  }

  private async resolveSearchResults(query: string): Promise<SearchResult[]> {
    try {
      const response = await this.searchTools.webSearch(query);
      return response.results;
    } catch (error) {
      console.error("Search failed", error);
      return [];
    }
  }

  private async resolvePendingProfileIntake(input: {
    user: Awaited<ReturnType<UserService["resolveUser"]>>["user"];
    message: string;
    conversationId: string;
    recentMessages: Awaited<ReturnType<ConversationService["getRecentMessages"]>>;
  }): Promise<{
    user: Awaited<ReturnType<UserService["resolveUser"]>>["user"];
    profileChanged: boolean;
    reply?: string;
  }> {
    if (!shouldRunProfileIntake(input.user)) {
      return { user: input.user, profileChanged: false };
    }

    const intake = await this.profileIntakeAgent.extract({
      user: input.user,
      message: input.message,
      recentMessages: input.recentMessages
    });

    await this.llmLogService.logCall({
      user: input.user,
      queryText: input.message,
      responseText: intake.responseText,
      promptMessages: intake.promptMessages
    });

    const patch = createProfilePatchFromIntake(intake, input.user);
    let user = input.user;
    let profileChanged = false;

    if (Object.keys(patch).length > 0) {
      user = await this.userService.updateProfile(input.user.id, patch);
      profileChanged = true;
    }

    if (intake.decision.ignored && intake.decision.shouldContinueNormalChat) {
      return { user, profileChanged };
    }

    await this.conversationService.saveUserMessage({
      conversationId: input.conversationId,
      content: input.message,
      intent: "profile.collect_user_info"
    });

    const reply = createProfileIntakeReply(user, intake);

    await this.conversationService.saveAssistantMessage({
      conversationId: input.conversationId,
      content: reply,
      intent: "profile.collect_user_info"
    });

    return {
      user,
      profileChanged,
      reply
    };
  }

  private async applyProfileUpdateFromLlm(input: {
    user: Awaited<ReturnType<UserService["resolveUser"]>>["user"];
    message: string;
    recentMessages: Awaited<ReturnType<ConversationService["getRecentMessages"]>>;
  }): Promise<{
    user: Awaited<ReturnType<UserService["resolveUser"]>>["user"];
    intake: ProfileIntakeResult;
  }> {
    const intake = await this.profileIntakeAgent.extract(input);

    await this.llmLogService.logCall({
      user: input.user,
      queryText: input.message,
      responseText: intake.responseText,
      promptMessages: intake.promptMessages
    });

    const patch = createProfilePatchFromIntake(intake, input.user, { allowCompletion: true });
    const user =
      Object.keys(patch).length > 0
        ? await this.userService.updateProfile(input.user.id, patch)
        : input.user;

    return { user, intake };
  }
}

function shouldRunProfileIntake(user: Awaited<ReturnType<UserService["resolveUser"]>>["user"]): boolean {
  return user.profileStatus === "pending";
}

function createProfilePatchFromIntake(
  intake: ProfileIntakeResult,
  user: Awaited<ReturnType<UserService["resolveUser"]>>["user"],
  options: { allowCompletion?: boolean } = {}
) {
  const patch: {
    name?: string;
    email?: string;
    aiNickname?: string;
    profileStatus?: "pending" | "completed" | "skipped";
  } = {};

  if (intake.decision.name && intake.decision.name !== user.name) {
    patch.name = intake.decision.name;
  }

  if (intake.decision.email && intake.decision.email !== user.email) {
    patch.email = intake.decision.email;
  }

  if (intake.decision.aiNickname && intake.decision.aiNickname !== user.aiNickname) {
    patch.aiNickname = intake.decision.aiNickname;
  }

  const finalName = patch.name ?? user.name;

  if (finalName && finalName !== "神秘用户") {
    patch.profileStatus = "completed";
  } else if (intake.decision.refused || intake.decision.ignored) {
    patch.name = "神秘用户";
    patch.profileStatus = "skipped";
  } else if (options.allowCompletion && finalName) {
    patch.profileStatus = "completed";
  }

  return patch;
}

function createProfileIntakeReply(
  user: Awaited<ReturnType<UserService["resolveUser"]>>["user"],
  intake: ProfileIntakeResult
): string {
  if (user.profileStatus === "skipped" || user.name === "神秘用户") {
    return "没问题，后续我先称呼你为“神秘用户”。需要我做什么吗~";
  }

  if (user.profileStatus === "completed" && user.name) {
    const emailPart = user.email ? `，邮箱 ${user.email}` : "";
    return `${user.name}，我已记录你的资料${emailPart}。需要我做什么吗~`;
  }

  if (intake.decision.email && !user.name) {
    return "我已记录你的邮箱。还需要你的姓名；如果暂时不想提供，也可以直接开始使用。";
  }

  return createOnboardingReply(user.aiNickname);
}

function createOnboardingReply(aiNickname: string): string {
  return `你好，我是 ${aiNickname}。你可以告诉我你的姓名和邮箱，方便我后续称呼你并保存你的任务；如果暂时不想提供，也可以直接开始使用。`;
}

function isConfirmationMessage(message: string): boolean {
  return /^(确定|确认|是的|是|对|对的|可以|继续|没错|好|好的|yes|y|ok|okay|取消|不用|不用了|不要|否|不是|算了|no|n)$/iu.test(
    message.trim()
  );
}

function createProfileQueryReply(
  user: Awaited<ReturnType<UserService["resolveUser"]>>["user"],
  field: unknown
): string {
  if (field === "email") {
    return user.email ? `你当前保存的邮箱是：${user.email}` : "我还没有保存你的邮箱。";
  }

  if (field === "name") {
    return user.name ? `你当前保存的姓名是：${user.name}` : "我还没有保存你的姓名。";
  }

  if (field === "aiNickname") {
    return `你当前给我的昵称是：${user.aiNickname}`;
  }

  return [
    "这是我当前保存的资料：",
    `姓名：${user.name ?? "未填写"}`,
    `邮箱：${user.email ?? "未填写"}`,
    `AI 昵称：${user.aiNickname}`
  ].join("\n");
}

function createCapabilityIntro(aiNickname: string): string {
  return [
    `我是 ${aiNickname}，一个 Cloudflare-native 智能对话式任务管理助手。`,
    "我现在可以帮你：",
    "1. 通过自然语言创建、查看、完成和删除任务。",
    "2. 记录任务的具体要求。",
    "3. 保存和查询你的姓名、邮箱以及我的昵称。",
    "4. 通过“重新开始”开启新的用户资料。",
    "后续还会接入文件 RAG、外部搜索和深度研究。"
  ].join("\n");
}
