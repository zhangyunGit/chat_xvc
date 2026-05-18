import { ChatAgent } from "../agents/chat-agent";
import { IntentRouter } from "../agents/intent-router";
import { createIntentDecision } from "../agents/intent-utils";
import { ProfileIntakeAgent, type ProfileIntakeResult } from "../agents/profile-intake-agent";
import { createChatProvider } from "../providers/chat-provider-factory";
import type { LLMProvider } from "../providers/llm-provider";
import {
  createProfileUpdatedPrefix
} from "../tools/profile-tools";
import type {
  ChatInput,
  ChatMessage,
  ChatServiceResult,
  ChatStatusPhase,
  ChatUiFile,
  ChatUiPayload,
  ChatUiWebResult
} from "../types/chat";
import { TaskTools } from "../tools/task-tools";
import type { IntentDecision } from "../types/intent";
import type { SearchResult } from "../types/search";
import { AudioTranscriptionService } from "./audio-transcription-service";
import { ConversationService } from "./conversation-service";
import { FileService } from "./file-service";
import { ImageUnderstandingService } from "./image-understanding-service";
import { LlmLogService } from "./llm-log-service";
import { MemoryService, type RecalledMemory } from "./memory-service";
import { RagService } from "./rag-service";
import { ResearchService } from "./research-service";
import { SearchTools } from "../tools/search-tools";
import { UserService } from "./user-service";

const intentRecentMessageLimit = 12;
const replyRecentMessageLimit = 20;

export class ChatService {
  private readonly chatAgent: ChatAgent;
  private readonly chatProvider: LLMProvider;
  private readonly audioTranscriptionService: AudioTranscriptionService;
  private readonly conversationService: ConversationService;
  private readonly fileService: FileService;
  private readonly imageUnderstandingService: ImageUnderstandingService;
  private readonly intentRouter: IntentRouter;
  private readonly llmLogService: LlmLogService;
  private readonly memoryService: MemoryService;
  private readonly profileIntakeAgent: ProfileIntakeAgent;
  private readonly ragService: RagService;
  private readonly researchService: ResearchService;
  private readonly searchTools: SearchTools;
  private readonly taskTools: TaskTools;
  private readonly userService: UserService;

  constructor(private readonly env: Env) {
    const chatProvider = createChatProvider(env);
    this.chatProvider = chatProvider;
    this.audioTranscriptionService = new AudioTranscriptionService(env);
    this.chatAgent = new ChatAgent(chatProvider);
    this.intentRouter = new IntentRouter(chatProvider);
    this.profileIntakeAgent = new ProfileIntakeAgent(chatProvider);
    this.userService = new UserService(env.DB);
    this.conversationService = new ConversationService(env.DB);
    this.fileService = new FileService(env);
    this.imageUnderstandingService = new ImageUnderstandingService(env, chatProvider);
    this.llmLogService = new LlmLogService(env);
    this.memoryService = new MemoryService(env);
    this.ragService = new RagService(env);
    this.researchService = new ResearchService(env, chatProvider);
    this.searchTools = new SearchTools(env);
    this.taskTools = new TaskTools(env.DB);
  }

  async createAssistantReply(
    input: ChatInput,
    observer: {
      onStatus?: (status: { phase: ChatStatusPhase; label: string }) => void;
      onUi?: (ui: ChatUiPayload) => void;
      onDelta?: (delta: string) => void | Promise<void>;
    } = {}
  ): Promise<ChatServiceResult> {
    const requestId = crypto.randomUUID();

    observer.onStatus?.({
      phase: "intent_routing",
      label: "识别意图中"
    });

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

    const replyRecentMessages = input.conversationId
      ? await this.conversationService.getRecentMessages(conversation.id, replyRecentMessageLimit)
      : [];
    const intentRecentMessages = replyRecentMessages.slice(-intentRecentMessageLimit);

    const intake = await this.resolvePendingProfileIntake({
      user: initialUserResolution.user,
      message: input.message,
      conversationId: conversation.id,
      recentMessages: intentRecentMessages,
      requestId
    });

    if (intake.reply) {
      return {
        reply: intake.reply,
        userId: intake.user.id,
        conversationId: conversation.id
      };
    }

    let intentRoute: Awaited<ReturnType<IntentRouter["route"]>>;
    try {
      intentRoute = input.audios?.length
        ? {
            decision: createForcedAudioTranscriptionDecision(input.message, input.audios.length)
          }
        : input.videos?.length
        ? {
            decision: createForcedVideoKeyframeDecision(input.message, input.videos.length)
          }
        : input.images?.length
        ? {
            decision: createForcedImageUnderstandingDecision(input.message, input.images.length)
          }
        : input.forceDeepResearch
        ? {
            decision: createForcedDeepResearchDecision(input.message)
          }
        : input.forceWebSearch
        ? {
            decision: createForcedSearchDecision(input.message)
          }
        : await this.intentRouter.route({
            message: input.message,
            recentMessages: intentRecentMessages,
            userName: intake.user.name,
            userEmail: intake.user.email,
            aiNickname: intake.user.aiNickname,
            profileChanged: intake.profileChanged,
            profileReset: initialUserResolution.profileReset,
            missingProfileFields: []
          });
    } catch (error) {
      await this.llmLogService.logCall({
        user: intake.user,
        requestId,
        conversationId: conversation.id,
        stage: "intent.error",
        intent: "conversation.clarify",
        status: "error",
        errorText: error instanceof Error ? error.message : "Unknown intent routing error",
        queryText: input.message,
        responseText: ""
      });
      throw error;
    }

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
        requestId,
        conversationId: activeConversation.id,
        stage: "intent.llm",
        intent: intentRoute.decision.intent,
        queryText: input.message,
        responseText: intentRoute.llmCall.responseText,
        promptMessages: intentRoute.llmCall.promptMessages
      });
    } else {
      await this.llmLogService.logCall({
        user,
        requestId,
        conversationId: activeConversation.id,
        stage: getIntentLogStage(intentRoute.decision),
        intent: intentRoute.decision.intent,
        provider: "rule",
        modelName: "rule",
        queryText: input.message,
        responseText: JSON.stringify(intentRoute.decision),
        promptMessages: []
      });
    }

    const savedUserMessage = await this.conversationService.saveUserMessage({
      conversationId: activeConversation.id,
      content: createPersistedUserMessage(input),
      intent: intentRoute.decision.intent
    });

    let replyResult;
    try {
      replyResult = await this.createReply({
        input,
        decision: intentRoute.decision,
        profileChanged,
        profileReset,
        user,
        requestId,
        conversationId: activeConversation.id,
        sourceMessageId: savedUserMessage.id,
        recentMessages: replyRecentMessages,
        observer
      });
    } catch (error) {
      await this.llmLogService.logCall({
        user,
        requestId,
        conversationId: activeConversation.id,
        stage: "reply.error",
        intent: intentRoute.decision.intent,
        status: "error",
        errorText: error instanceof Error ? error.message : "Unknown reply generation error",
        queryText: input.message,
        responseText: ""
      });
      throw error;
    }

    const savedAssistantMessage = await this.conversationService.saveAssistantMessage({
      conversationId: activeConversation.id,
      content: replyResult.reply,
      intent: intentRoute.decision.intent
    });

    if (shouldPersistConversationMemory(intentRoute.decision.intent)) {
      await this.memoryService.writeConversationMemory({
        userId: user.id,
        userMessage: input.message,
        assistantReply: replyResult.reply,
        sourceMessageId: savedUserMessage.id
      }).catch((error) => console.error("Conversation memory write failed", error));
    }

    await this.maybeWriteConversationStageSummary({
      requestId,
      conversationId: activeConversation.id,
      userId: user.id,
      sourceMessageId: savedAssistantMessage.id,
      user
    }).catch((error) => console.error("Conversation stage summary write failed", error));

    return {
      reply: replyResult.reply,
      userId: user.id,
      conversationId: activeConversation.id,
      requestId,
      ui: replyResult.ui,
      streamed: replyResult.streamed
    };
  }

  private async createReply(input: {
    input: ChatInput;
    decision: IntentDecision;
    profileChanged: boolean;
    profileReset: boolean;
    user: Awaited<ReturnType<UserService["resolveUser"]>>["user"];
    requestId: string;
    conversationId: string;
    sourceMessageId: string;
    recentMessages: Awaited<ReturnType<ConversationService["getRecentMessages"]>>;
    observer: {
      onStatus?: (status: { phase: ChatStatusPhase; label: string }) => void;
      onUi?: (ui: ChatUiPayload) => void;
      onDelta?: (delta: string) => void | Promise<void>;
    };
  }): Promise<{ reply: string; ui?: ChatUiPayload; streamed?: boolean }> {
    if (input.decision.needsClarification) {
      return { reply: input.decision.clarificationQuestion ?? "你希望我执行什么操作？" };
    }

    if (input.decision.intent === "profile.reset") {
      return {
        reply: input.profileReset
          ? "好的，我已为你开启一个新的用户资料。你可以告诉我你的姓名和邮箱；如果暂时不想提供，也可以直接开始使用。"
          : "你确定要重置用户资料吗？这会开启新的用户资料，并让当前浏览器切换到新的用户身份。请回复“确定”或“取消”。"
      };
    }

    if (input.decision.intent === "profile.collect_user_info") {
      return { reply: createOnboardingReply(input.user.aiNickname) };
    }

    if (
      input.decision.intent === "profile.update_user_info" ||
      input.decision.intent === "profile.update_ai_nickname"
    ) {
      const profileUpdate = await this.applyProfileUpdateFromLlm({
        user: input.user,
        message: input.input.message,
        recentMessages: input.recentMessages,
        requestId: input.requestId,
        conversationId: input.conversationId,
        intent: input.decision.intent
      });
      if (input.decision.intent === "profile.update_ai_nickname") {
        return {
          reply: profileUpdate.user.aiNickname !== input.user.aiNickname
            ? `好的，以后你可以叫我${profileUpdate.user.aiNickname}。`
            : "我识别到你想更新我的名字，但没有提取到明确的新名字。你可以说“以后叫你豆豆”。"
        };
      }
      return { reply: createProfileUpdatedPrefix(profileUpdate.user) };
    }

    if (input.decision.intent === "profile.query") {
      return { reply: createProfileQueryReply(input.user, input.decision.entities.field) };
    }

    if (input.input.audios?.length) {
      return this.createAudioTranscriptionReply(input);
    }

    if (input.input.videos?.length) {
      return this.createVideoKeyframeReply(input);
    }

    if (input.input.images?.length) {
      return this.createImageUnderstandingReply(input);
    }

    if (input.decision.intent.startsWith("memory.")) {
      input.observer.onStatus?.({
        phase: "tool_running",
        label: "记忆工具执行中"
      });

      if (input.decision.intent === "memory.write") {
        const memory = await this.memoryService.writeMemory({
          userId: input.user.id,
          message: input.input.message,
          sourceMessageId: input.sourceMessageId
        });

        return {
          reply: `我已记住：${memory.content}`
        };
      }

      if (input.decision.intent === "memory.list") {
        const memories = await this.memoryService.listMemories(input.user.id);
        return {
          reply: memories.length > 0
            ? ["我当前记住了这些内容：", formatMemories(memories)].join("\n")
            : "我还没有保存任何长期记忆。"
        };
      }

      if (input.decision.intent === "memory.delete") {
        const deleted = await this.memoryService.deleteMemories({
          userId: input.user.id,
          query: input.input.message
        });

        return {
          reply: deleted.length > 0
            ? ["我已忘记这些内容：", formatMemories(deleted)].join("\n")
            : "我没有找到明确可删除的相关记忆。你可以说“忘记关于……的内容”。"
        };
      }

      const memories = await this.memoryService.recall({
        userId: input.user.id,
        query: input.input.message,
        topK: 8,
        types: ["memory", "conversation_memory", "conversation_summary"]
      });
      const fallbackMemories = memories.length > 0
        ? []
        : await this.memoryService.listMemories(input.user.id);
      const recalledMemories = memories.length > 0
        ? memories
        : fallbackMemories.map((memory) => ({ ...memory, score: 0 }));

      if (recalledMemories.length > 0) {
        input.observer.onStatus?.({
          phase: "model_thinking",
          label: "基于记忆回答中"
        });

        const llmResult = await this.chatAgent.respond({
          userMessage: input.input.message,
          user: input.user,
          decision: input.decision,
          memories: recalledMemories,
          recentMessages: input.recentMessages,
          onDelta: input.observer.onDelta
        });

        await this.llmLogService.logCall({
          user: input.user,
          requestId: input.requestId,
          conversationId: input.conversationId,
          stage: "reply.memory_recall",
          intent: input.decision.intent,
          queryText: input.input.message,
          responseText: llmResult.reply,
          promptMessages: llmResult.promptMessages
        });

        return {
          reply: llmResult.reply,
          streamed: llmResult.streamed
        };
      }

      return {
        reply: "我没有找到相关的长期记忆。"
      };
    }

    if (input.decision.intent.startsWith("task.")) {
      input.observer.onStatus?.({
        phase: "tool_running",
        label: "任务工具执行中"
      });

      const taskResult = await this.taskTools.executeTaskIntent({
        userId: input.user.id,
        message: input.input.message,
        decision: input.decision,
        recentMessages: input.recentMessages
      });

      if (taskResult.handled && taskResult.mode === "direct" && taskResult.reply) {
        return {
          reply: taskResult.reply,
          ui: { tasks: taskResult.uiTasks ?? [] }
        };
      }

      if (taskResult.handled && taskResult.mode === "llm" && taskResult.toolResultText) {
        input.observer.onStatus?.({
          phase: "model_thinking",
          label: "输入中"
        });

        const llmResult = await this.chatAgent.respond({
          userMessage: input.input.message,
          user: input.user,
          decision: input.decision,
          toolResultText: taskResult.toolResultText,
          recentMessages: input.recentMessages,
          onDelta: input.observer.onDelta
        });

        await this.llmLogService.logCall({
          user: input.user,
          requestId: input.requestId,
          conversationId: input.conversationId,
          stage: "reply.task_tool_result",
          intent: input.decision.intent,
          queryText: input.input.message,
          responseText: llmResult.reply,
          promptMessages: llmResult.promptMessages
        });

        return {
          reply: llmResult.reply,
          ui: taskResult.uiTasks ? { tasks: taskResult.uiTasks } : undefined,
          streamed: llmResult.streamed
        };
      }

      input.observer.onStatus?.({
        phase: "model_thinking",
        label: "输入中"
      });

      const llmResult = await this.chatAgent.respond({
        userMessage: input.input.message,
        user: input.user,
        decision: input.decision,
        recentMessages: input.recentMessages,
        onDelta: input.observer.onDelta,
        toolResultText:
          "任务工具未执行：缺少可识别的任务操作。请询问用户是要创建、查看、查看详情、更新、完成、删除任务，还是管理任务要求。"
      });

      await this.llmLogService.logCall({
        user: input.user,
        requestId: input.requestId,
        conversationId: input.conversationId,
        stage: "reply.task_clarify",
        intent: input.decision.intent,
        queryText: input.input.message,
        responseText: llmResult.reply,
        promptMessages: llmResult.promptMessages
      });

      return { reply: llmResult.reply, streamed: llmResult.streamed };
    }

    if (
      input.decision.intent === "conversation.help" ||
      input.decision.intent === "conversation.capability_intro"
    ) {
      return { reply: createCapabilityIntro(input.user.aiNickname) };
    }

    if (input.decision.intent === "research.deep_report") {
      const researchResult = await this.researchService.runDeepResearch({
        message: input.input.message,
        user: input.user,
        recentMessages: input.recentMessages,
        observer: input.observer
      });

      for (const llmCall of researchResult.llmCalls) {
        await this.llmLogService.logCall({
          user: input.user,
          requestId: input.requestId,
          conversationId: input.conversationId,
          stage: llmCall.stage,
          intent: input.decision.intent,
          provider: llmCall.provider,
          modelName: llmCall.modelName,
          queryText: input.input.message,
          responseText: llmCall.responseText,
          promptMessages: llmCall.promptMessages
        });
      }

      return {
        reply: researchResult.reply,
        streamed: researchResult.streamed,
        ui: {
          webResults: researchResult.webResults.map(toChatUiWebResult),
          researchSteps: researchResult.steps,
          thinks: researchResult.thinks
        }
      };
    }

    if (input.decision.intent === "document.upload_help") {
      return {
        reply:
          "你可以点击输入框右下角的附件按钮，或直接拖入文件、粘贴图片。当前阶段会先把原始文件保存到 R2，并把文件名、大小、类型和状态写入 D1。下一阶段会接入解析、分块、embedding 和 Vectorize 检索。"
      };
    }

    if (input.decision.intent === "document.list") {
      const files = await this.fileService.listFiles(input.user.id);
      if (files.length === 0) {
        return { reply: "你当前还没有上传文件。可以点击输入框右下角的附件按钮，或直接拖入文件。" };
      }

      return {
        reply: `你当前共有 ${files.length} 个上传文件，信息如下：`,
        ui: {
          files: files.map(toChatUiFile)
        }
      };
    }

    if (input.decision.intent === "document.delete") {
      input.observer.onStatus?.({
        phase: "tool_running",
        label: "删除文件中"
      });

      const files = await this.fileService.listFiles(input.user.id);
      if (files.length === 0) {
        return { reply: "你当前没有可删除的文件。" };
      }

      const matchedFiles = resolveFileDeleteMatches({
        message: input.input.message,
        entities: input.decision.entities,
        files
      });
      if (matchedFiles.length !== 1) {
        return {
          reply:
            matchedFiles.length > 1
              ? "我匹配到了多个文件。请直接说要删除的完整文件名。"
              : `请告诉我要删除哪个文件。你当前有：${files.map((file) => file.filename).join("、")}。`,
          ui: {
            files: files.map(toChatUiFile)
          }
        };
      }

      const deletedFile = await this.fileService.deleteFile({
        userId: input.user.id,
        fileId: matchedFiles[0].id
      });

      return {
        reply: `已删除文件：${deletedFile.filename}。我已同步删除 R2 原文件、D1 chunk 记录和 Vectorize 向量，并把文件状态标记为 deleted。`
      };
    }

    if (input.decision.intent === "document.summarize") {
      input.observer.onStatus?.({
        phase: "tool_running",
        label: "读取文档中"
      });

      const targetFile = await this.resolveSummarizeTargetFile({
        userId: input.user.id,
        message: input.input.message
      });

      if (!targetFile) {
        const files = await this.fileService.listFiles(input.user.id);
        return {
          reply: files.length > 0
            ? `请告诉我要总结哪个文件。你当前有：${files.map((file) => file.filename).join("、")}。`
            : "你当前还没有可总结的文件。可以先上传 PDF、DOCX、TXT、Markdown、JSON 或 CSV 文件。",
          ui: files.length > 0 ? { files: files.map(toChatUiFile) } : undefined
        };
      }

      const indexedFile = await this.waitForIndexedFile({
        userId: input.user.id,
        fileId: targetFile.id
      });

      if (!indexedFile || indexedFile.status !== "indexed") {
        return {
          reply: `文件 ${targetFile.filename} 还在解析或索引中。请稍等几秒后再让我总结。当前状态：${indexedFile?.status ?? targetFile.status}。`,
          ui: { files: [toChatUiFile(indexedFile ?? targetFile)] }
        };
      }

      const ragResult = await this.ragService.summarizeFile({
        userId: input.user.id,
        fileId: indexedFile.id
      });

      input.observer.onStatus?.({
        phase: "model_thinking",
        label: "生成摘要中"
      });

      const llmResult = await this.chatAgent.respond({
        userMessage: input.input.message,
        user: input.user,
        decision: input.decision,
        recentMessages: input.recentMessages,
        onDelta: input.observer.onDelta,
        toolResultText: [
          `请总结文件：${ragResult.file.filename}`,
          "摘要要求：",
          "1. 先用 2-4 句话概括整体内容。",
          "2. 再列出 4-8 个关键要点。",
          "3. 如果文档包含行动项或决策，单独列出。",
          "4. 只能基于下面的文件片段，不要引入外部信息。",
          "",
          ragResult.contextText
        ].join("\n")
      });

      await this.llmLogService.logCall({
        user: input.user,
        requestId: input.requestId,
        conversationId: input.conversationId,
        stage: "reply.document_summary",
        intent: input.decision.intent,
        queryText: input.input.message,
        responseText: llmResult.reply,
        promptMessages: llmResult.promptMessages
      });

      return {
        reply: llmResult.reply,
        streamed: llmResult.streamed,
        ui: {
          sources: ragResult.chunks.slice(0, 8).map(toChatUiSource)
        }
      };
    }

    if (input.decision.intent.startsWith("document.")) {
      input.observer.onStatus?.({
        phase: "tool_running",
        label: "文档检索中"
      });

      const uploadedFileIds = extractUploadedFileIds(input.input.message);
      if (uploadedFileIds.length > 0) {
        const indexedFiles = await Promise.all(
          uploadedFileIds.map((fileId) =>
            this.waitForIndexedFile({
              userId: input.user.id,
              fileId
            })
          )
        );
        const pendingOrFailed = indexedFiles.find((file) => !file || file.status !== "indexed");
        if (pendingOrFailed || indexedFiles.some((file) => !file)) {
          const filename = pendingOrFailed?.filename ?? uploadedFileIds[0];
          const status = pendingOrFailed?.status ?? "not_found";
          return {
            reply: `文件 ${filename} 还没有完成解析或索引，暂时不能基于内容回答。请稍等几秒后再试。当前状态：${status}。`,
            ui: pendingOrFailed ? { files: [toChatUiFile(pendingOrFailed)] } : undefined
          };
        }
      }

      const ragResult = await this.ragService.search({
        userId: input.user.id,
        query: input.input.message
      });

      if (ragResult.chunks.length === 0) {
        return {
          reply: "我没有在你已索引的文件中找到相关内容。可以换个关键词，或先确认文件状态是否已经变为 indexed。"
        };
      }

      if (input.decision.intent === "document.search") {
        return {
          reply: createDocumentSearchReply(ragResult.chunks),
          ui: {
            sources: ragResult.chunks.map(toChatUiSource)
          }
        };
      }

      input.observer.onStatus?.({
        phase: "model_thinking",
        label: "输入中"
      });

      const llmResult = await this.chatAgent.respond({
        userMessage: input.input.message,
        user: input.user,
        decision: input.decision,
        recentMessages: input.recentMessages,
        onDelta: input.observer.onDelta,
        toolResultText: [
          "以下是从用户已上传并索引的文件中检索到的片段。回答必须基于这些片段；如果片段不足以回答，明确说明没有找到充分依据。",
          "",
          ragResult.contextText
        ].join("\n")
      });

      await this.llmLogService.logCall({
        user: input.user,
        requestId: input.requestId,
        conversationId: input.conversationId,
        stage: "reply.document_qa",
        intent: input.decision.intent,
        queryText: input.input.message,
        responseText: llmResult.reply,
        promptMessages: llmResult.promptMessages
      });

      return {
        reply: llmResult.reply,
        streamed: llmResult.streamed,
        ui: {
          sources: ragResult.chunks.map(toChatUiSource)
        }
      };
    }

    const searchResult = input.decision.needsWebSearch
      ? await this.resolveSearchResults(input.input.message, input.decision, input.observer)
      : { results: [] as SearchResult[], error: null };

    if (searchResult.error) {
      return {
        reply: createSearchFailureReply(searchResult.error)
      };
    }

    const searchResults = searchResult.results;
    const memories = input.decision.intent === "conversation.general_qa" ||
      input.decision.intent === "conversation.chitchat"
      ? await this.recallConversationContext({
          userId: input.user.id,
          message: input.input.message
        })
      : [];

    input.observer.onStatus?.({
      phase: "model_thinking",
      label: "输入中"
    });

    const llmResult = await this.chatAgent.respond({
      userMessage: input.input.message,
      user: input.user,
      decision: input.decision,
      searchResults,
      memories,
      recentMessages: input.recentMessages,
      onDelta: input.observer.onDelta
    });

    await this.llmLogService.logCall({
      user: input.user,
      requestId: input.requestId,
      conversationId: input.conversationId,
      stage: input.decision.needsWebSearch ? "reply.web_answer" : "reply.general",
      intent: input.decision.intent,
      queryText: input.input.message,
      responseText: llmResult.reply,
      promptMessages: llmResult.promptMessages
    });

    return {
      reply: llmResult.reply,
      streamed: llmResult.streamed,
      ui: searchResults.length > 0
        ? { webResults: searchResults.map(toChatUiWebResult) }
        : undefined
    };
  }

  private async createImageUnderstandingReply(input: {
    input: ChatInput;
    decision: IntentDecision;
    user: Awaited<ReturnType<UserService["resolveUser"]>>["user"];
    requestId: string;
    conversationId: string;
    observer: {
      onStatus?: (status: { phase: ChatStatusPhase; label: string }) => void;
      onDelta?: (delta: string) => void | Promise<void>;
    };
  }): Promise<{ reply: string; streamed?: boolean }> {
    input.observer.onStatus?.({
      phase: "model_thinking",
      label: "识别图片中"
    });

    try {
      const result = await this.imageUnderstandingService.analyze({
        message: input.input.message,
        images: input.input.images ?? [],
        onDelta: input.observer.onDelta
      });

      await this.llmLogService.logCall({
        user: input.user,
        requestId: input.requestId,
        conversationId: input.conversationId,
        stage: "reply.image_understanding",
        intent: input.decision.intent,
        provider: result.provider,
        modelName: result.modelName,
        durationMs: result.durationMs,
        queryText: input.input.message,
        responseText: result.reply,
        promptMessages: result.redactedPromptMessages
      });

      return { reply: result.reply, streamed: result.streamed };
    } catch (error) {
      await this.llmLogService.logCall({
        user: input.user,
        requestId: input.requestId,
        conversationId: input.conversationId,
        stage: "reply.image_understanding",
        intent: input.decision.intent,
        provider: "google-ai-studio",
        modelName: this.env.GEMINI_LITE_MODEL?.trim() || "gemini-3.1-flash-lite",
        status: "error",
        errorText: error instanceof Error ? error.message : "Unknown image understanding error",
        queryText: input.input.message,
        responseText: "",
        promptMessages: []
      });
      throw error;
    }
  }

  private async createAudioTranscriptionReply(input: {
    input: ChatInput;
    decision: IntentDecision;
    user: Awaited<ReturnType<UserService["resolveUser"]>>["user"];
    requestId: string;
    conversationId: string;
    observer: {
      onStatus?: (status: { phase: ChatStatusPhase; label: string }) => void;
    };
  }): Promise<{ reply: string }> {
    input.observer.onStatus?.({
      phase: "model_thinking",
      label: "转写音频中"
    });

    try {
      const result = await this.audioTranscriptionService.transcribe({
        message: input.input.message,
        audios: input.input.audios ?? []
      });

      await this.llmLogService.logCall({
        user: input.user,
        requestId: input.requestId,
        conversationId: input.conversationId,
        stage: "reply.audio_transcription",
        intent: input.decision.intent,
        provider: result.provider,
        modelName: result.modelName,
        durationMs: result.durationMs,
        queryText: input.input.message,
        responseText: result.reply,
        promptMessages: result.promptMessages
      });

      return { reply: result.reply };
    } catch (error) {
      await this.llmLogService.logCall({
        user: input.user,
        requestId: input.requestId,
        conversationId: input.conversationId,
        stage: "reply.audio_transcription",
        intent: input.decision.intent,
        provider: "google-ai-studio",
        modelName: this.env.GEMINI_LITE_MODEL?.trim() || "gemini-3.1-flash-lite",
        status: "error",
        errorText: error instanceof Error ? error.message : "Unknown audio transcription error",
        queryText: input.input.message,
        responseText: "",
        promptMessages: []
      });
      throw error;
    }
  }

  private async createVideoKeyframeReply(input: {
    input: ChatInput;
    decision: IntentDecision;
    user: Awaited<ReturnType<UserService["resolveUser"]>>["user"];
    requestId: string;
    conversationId: string;
    observer: {
      onStatus?: (status: { phase: ChatStatusPhase; label: string }) => void;
      onDelta?: (delta: string) => void | Promise<void>;
    };
  }): Promise<{ reply: string; streamed?: boolean }> {
    input.observer.onStatus?.({
      phase: "model_thinking",
      label: "分析视频关键帧中"
    });

    try {
      const result = await this.imageUnderstandingService.analyzeVideoKeyframes({
        message: input.input.message,
        videos: input.input.videos ?? [],
        onDelta: input.observer.onDelta
      });

      await this.llmLogService.logCall({
        user: input.user,
        requestId: input.requestId,
        conversationId: input.conversationId,
        stage: "reply.video_keyframe_understanding",
        intent: input.decision.intent,
        provider: result.provider,
        modelName: result.modelName,
        durationMs: result.durationMs,
        queryText: input.input.message,
        responseText: result.reply,
        promptMessages: result.redactedPromptMessages
      });

      return { reply: result.reply, streamed: result.streamed };
    } catch (error) {
      await this.llmLogService.logCall({
        user: input.user,
        requestId: input.requestId,
        conversationId: input.conversationId,
        stage: "reply.video_keyframe_understanding",
        intent: input.decision.intent,
        provider: "google-ai-studio",
        modelName: this.env.GEMINI_LITE_MODEL?.trim() || "gemini-3.1-flash-lite",
        status: "error",
        errorText: error instanceof Error ? error.message : "Unknown video keyframe understanding error",
        queryText: input.input.message,
        responseText: "",
        promptMessages: []
      });
      throw error;
    }
  }

  private async resolveSearchResults(
    query: string,
    decision: IntentDecision,
    observer: {
      onStatus?: (status: { phase: ChatStatusPhase; label: string }) => void;
    }
  ): Promise<{ results: SearchResult[]; error: string | null }> {
    try {
      observer.onStatus?.({
        phase: "external_search",
        label: "外部搜索中"
      });
      const response = await this.searchTools.webSearch(createWebSearchQuery(query), {
        num: decision.intent === "research.deep_report" ? 10 : 8,
        kind: "search"
      });
      return { results: response.results, error: null };
    } catch (error) {
      console.error("Search failed", error);
      return {
        results: [],
        error: createSearchFailureMessage(error)
      };
    }
  }

  private async recallConversationContext(input: {
    userId: string;
    message: string;
  }): Promise<RecalledMemory[]> {
    const recalled = await this.memoryService.recall({
      userId: input.userId,
      query: input.message,
      topK: 6,
      types: ["memory", "conversation_memory", "conversation_summary"]
    });
    if (recalled.length > 0 || !shouldUseConversationMemoryFallback(input.message)) {
      return recalled;
    }

    const memories = await this.memoryService.listMemories(input.userId);
    return memories
      .filter((memory) => memory.kind === "conversation" || memory.kind === "conversation_summary")
      .slice(0, 3)
      .map((memory) => ({
        ...memory,
        score: 0
      }));
  }

  private async maybeWriteConversationStageSummary(input: {
    requestId: string;
    conversationId: string;
    userId: string;
    sourceMessageId: string;
    user: Awaited<ReturnType<UserService["resolveUser"]>>["user"];
  }): Promise<void> {
    const turnCount = await this.conversationService.countCompletedTurns(input.conversationId);
    if (!shouldCreateConversationStageSummary(turnCount)) {
      return;
    }

    const messages = await this.conversationService.getRecentMessages(input.conversationId, 20);
    if (messages.length < 2) {
      return;
    }

    const promptMessages = createConversationStageSummaryPrompt({
      messages,
      turnCount
    });
    const summary = await this.chatProvider.chat(promptMessages);
    const content = createConversationStageSummaryContent({
      summary,
      turnCount
    });

    await this.llmLogService.logCall({
      user: input.user,
      requestId: input.requestId,
      conversationId: input.conversationId,
      stage: "memory.stage_summary",
      intent: "memory.recall",
      queryText: `conversation_stage_summary:${input.conversationId}:${turnCount}`,
      responseText: content,
      promptMessages
    });

    await this.memoryService.writeConversationSummaryMemory({
      userId: input.userId,
      summary: content,
      sourceMessageId: input.sourceMessageId
    });
  }

  private async resolveSummarizeTargetFile(input: {
    userId: string;
    message: string;
  }) {
    const files = await this.fileService.listFiles(input.userId);
    if (files.length === 0) return null;

    const uploadedFileIds = extractUploadedFileIds(input.message);
    const uploadedMatches = files.filter((file) => uploadedFileIds.includes(file.id));
    if (uploadedMatches.length === 1) return uploadedMatches[0];

    const namedMatches = files.filter((file) => messageMentionsFile(input.message, file));
    if (namedMatches.length === 1) return namedMatches[0];

    if (/该文档|这个文档|这份文档|刚(刚)?上传|上传的(文件|文档)/u.test(input.message)) {
      return files[0];
    }

    return null;
  }

  private async waitForIndexedFile(input: {
    userId: string;
    fileId: string;
  }) {
    const attempts = [0, 400, 900, 1400, 2200];
    let current = null;

    for (const delay of attempts) {
      if (delay > 0) {
        await sleep(delay);
      }

      const files = await this.fileService.listFiles(input.userId);
      current = files.find((file) => file.id === input.fileId) ?? null;
      if (!current || current.status === "indexed" || current.status === "failed") {
        return current;
      }
    }

    return current;
  }

  private async resolvePendingProfileIntake(input: {
    user: Awaited<ReturnType<UserService["resolveUser"]>>["user"];
    message: string;
    conversationId: string;
    requestId: string;
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
      requestId: input.requestId,
      conversationId: input.conversationId,
      stage: "profile.intake",
      intent: "profile.collect_user_info",
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
    requestId: string;
    conversationId: string;
    intent: IntentDecision["intent"];
  }): Promise<{
    user: Awaited<ReturnType<UserService["resolveUser"]>>["user"];
    intake: ProfileIntakeResult;
  }> {
    const intake = await this.profileIntakeAgent.extract(input);

    await this.llmLogService.logCall({
      user: input.user,
      requestId: input.requestId,
      conversationId: input.conversationId,
      stage: "profile.update",
      intent: input.intent,
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
    "4. 上传文件并进行文档问答、搜索和总结。",
    "5. 使用外部搜索和深度研究整理公开资料。",
    "6. 记住你的长期偏好、背景信息和回答习惯，也可以列出或删除这些记忆。",
    "你也可以通过“重新开始”开启新的用户资料。"
  ].join("\n");
}

function toChatUiFile(file: {
  id: string;
  filename: string;
  contentType: string | null;
  size: number;
  status: string;
  createdAt: string;
  updatedAt: string;
}): ChatUiFile {
  return {
    id: file.id,
    filename: file.filename,
    contentType: file.contentType,
    size: file.size,
    status: file.status,
    createdAt: file.createdAt,
    updatedAt: file.updatedAt
  };
}

function toChatUiSource(item: Awaited<ReturnType<RagService["search"]>>["chunks"][number]) {
  return {
    chunkId: item.chunk.id,
    fileId: item.chunk.fileId,
    filename: item.filename ?? item.chunk.fileId,
    sectionPath: item.chunk.sectionPath,
    chunkIndex: item.chunk.chunkIndex,
    score: Number(item.finalScore.toFixed(4)),
    preview: createPreview(item.chunk.content)
  };
}

function formatMemories(memories: Array<{ content: string; kind: string }>): string {
  return memories
    .map((memory, index) => `${index + 1}. [${memory.kind}] ${memory.content}`)
    .join("\n");
}

function shouldPersistConversationMemory(intent: IntentDecision["intent"]): boolean {
  return intent === "conversation.general_qa" || intent === "conversation.chitchat";
}

function getIntentLogStage(decision: IntentDecision): string {
  const forcedBy = decision.entities.forcedBy;
  if (forcedBy === "smart_search") return "intent.forced_web_search";
  if (forcedBy === "deep_thinking") return "intent.forced_deep_research";
  if (forcedBy === "image_understanding") return "intent.forced_image_understanding";
  if (forcedBy === "video_keyframes") return "intent.forced_video_keyframes";
  if (forcedBy === "audio_transcription") return "intent.forced_audio_transcription";
  return "intent.rule";
}

function createPersistedUserMessage(input: ChatInput): string {
  if (!input.images?.length && !input.videos?.length && !input.audios?.length) return input.message;

  const imageSummary = (input.images ?? [])
    .map((image, index) => {
      const name = image.name?.trim() || `image-${index + 1}`;
      const type = image.contentType?.trim() || "image/*";
      const size = typeof image.size === "number" ? `, ${image.size} bytes` : "";
      return `- ${name} (${type}${size})`;
    })
    .join("\n");
  const videoSummary = (input.videos ?? [])
    .map((video, index) => {
      const name = video.name?.trim() || `video-${index + 1}`;
      const type = video.contentType?.trim() || "video/*";
      const size = typeof video.size === "number" ? `, ${video.size} bytes` : "";
      const duration = typeof video.durationSec === "number" ? `, ${Math.round(video.durationSec)}s` : "";
      return `- ${name} (${type}${size}${duration}, ${video.frames.length} frames)`;
    })
    .join("\n");
  const audioSummary = (input.audios ?? [])
    .map((audio, index) => {
      const name = audio.name?.trim() || `audio-${index + 1}`;
      const type = audio.contentType?.trim() || "audio/*";
      const size = typeof audio.size === "number" ? `, ${audio.size} bytes` : "";
      return `- ${name} (${type}${size})`;
    })
    .join("\n");

  return [
    input.message,
    "",
    input.audios?.length
      ? `[已附加 ${input.audios.length} 段音频，音频内容未写入对话存储]`
      : "",
    audioSummary,
    input.images?.length
      ? `[已附加 ${input.images.length} 张图片，图片内容未写入对话存储]`
      : "",
    imageSummary,
    input.videos?.length
      ? `[已附加 ${input.videos.length} 个视频，关键帧图片内容未写入对话存储]`
      : "",
    videoSummary
  ].filter(Boolean).join("\n");
}

function shouldCreateConversationStageSummary(turnCount: number): boolean {
  return turnCount >= 10 && (turnCount - 10) % 8 === 0;
}

function shouldUseConversationMemoryFallback(message: string): boolean {
  return /刚才|之前|上次|前面|我们.*(说|提到|讨论|聊)|项目叫什么|目标是什么/u.test(message);
}

function createConversationStageSummaryPrompt(input: {
  messages: Awaited<ReturnType<ConversationService["getRecentMessages"]>>;
  turnCount: number;
}): ChatMessage[] {
  const startTurn = Math.max(1, input.turnCount - 9);

  return [
    {
      role: "system",
      content: [
        "你是对话阶段摘要器。你的任务是把最近 10 轮对话压缩成可用于长期语义召回的阶段摘要。",
        "只保留未来对话可能需要回忆的信息：项目/产品/人名/偏好/决策/约束/待办/关键技术方案。",
        "不要编造；不要加入寒暄；不要输出推理过程。",
        "输出中文，控制在 220-420 字。"
      ].join("\n")
    },
    {
      role: "user",
      content: [
        `请总结第 ${startTurn}-${input.turnCount} 轮对话。相邻阶段摘要会重叠 2 轮，因此要让本摘要自包含。`,
        "",
        "建议格式：",
        "阶段主题：...",
        "关键事实/决策：",
        "- ...",
        "用户偏好/约束：",
        "- ...",
        "后续可能需要记住：",
        "- ...",
        "",
        "原始对话：",
        formatMessagesForStageSummary(input.messages)
      ].join("\n")
    }
  ];
}

function createConversationStageSummaryContent(input: {
  summary: string;
  turnCount: number;
}): string {
  const startTurn = Math.max(1, input.turnCount - 9);

  return [
    `阶段摘要（第 ${startTurn}-${input.turnCount} 轮，窗口 10 轮，与上一阶段重叠 2 轮）：`,
    input.summary.trim()
  ].join("\n");
}

function formatMessagesForStageSummary(
  messages: Awaited<ReturnType<ConversationService["getRecentMessages"]>>
): string {
  return messages
    .map((message) => {
      const role = message.role === "user" ? "用户" : message.role === "assistant" ? "助手" : "系统";
      return `${role}：${compactForSummary(message.content, 700)}`;
    })
    .join("\n");
}

function compactForSummary(content: string, maxLength: number): string {
  const compacted = content.replace(/\s+/g, " ").trim();
  return compacted.length > maxLength ? `${compacted.slice(0, maxLength - 1)}…` : compacted;
}

function createForcedSearchDecision(message: string): IntentDecision {
  return createIntentDecision({
    intent: /最新|最近|实时|今天|今日|当前|现在/u.test(message)
      ? "research.latest_info"
      : "research.quick_search",
    confidence: 1,
    entities: {
      query: message,
      forcedBy: "smart_search"
    },
    source: "rule"
  });
}

function createForcedDeepResearchDecision(message: string): IntentDecision {
  return createIntentDecision({
    intent: "research.deep_report",
    confidence: 1,
    entities: {
      query: message,
      forcedBy: "deep_thinking"
    },
    source: "rule"
  });
}

function createForcedImageUnderstandingDecision(message: string, imageCount: number): IntentDecision {
  return createIntentDecision({
    intent: "conversation.general_qa",
    confidence: 1,
    entities: {
      query: message,
      imageCount,
      forcedBy: "image_understanding"
    },
    source: "rule"
  });
}

function createForcedAudioTranscriptionDecision(message: string, audioCount: number): IntentDecision {
  return createIntentDecision({
    intent: "conversation.general_qa",
    confidence: 1,
    entities: {
      query: message,
      audioCount,
      forcedBy: "audio_transcription"
    },
    source: "rule"
  });
}

function createForcedVideoKeyframeDecision(message: string, videoCount: number): IntentDecision {
  return createIntentDecision({
    intent: "conversation.general_qa",
    confidence: 1,
    entities: {
      query: message,
      videoCount,
      forcedBy: "video_keyframes"
    },
    source: "rule"
  });
}

function createSearchFailureMessage(error: unknown): string {
  if (!(error instanceof Error)) return "未知错误";
  if (error.message.includes("SERPER_API_KEY")) return "SERPER_API_KEY 未配置";
  if (error.message.includes("Serper search failed")) return error.message;
  return "搜索服务请求失败";
}

export function createSearchFailureReply(reason: string): string {
  return [
    "外部搜索暂时不可用，我没有拿到实时搜索结果。",
    `原因：${reason}`,
    "你可以稍后重试，或先让我基于已有知识回答。"
  ].join("\n");
}

function toChatUiWebResult(result: SearchResult): ChatUiWebResult {
  return {
    title: result.title,
    link: result.link,
    snippet: result.snippet,
    source: result.source ?? getHostname(result.link),
    date: result.date ?? null,
    position: result.position ?? 0
  };
}

function createDocumentSearchReply(chunks: Awaited<ReturnType<RagService["search"]>>["chunks"]): string {
  return [
    `我在已索引文档中找到 ${chunks.length} 个相关片段：`,
    ...chunks.slice(0, 5).map((item, index) => {
      const section = item.chunk.sectionPath ? `（${item.chunk.sectionPath}）` : "";
      return `${index + 1}. ${item.filename ?? "未知文件"}${section}：${createPreview(item.chunk.content)}`;
    })
  ].join("\n");
}

function createWebSearchQuery(message: string): string {
  return message
    .replace(/^(帮我|请|麻烦)?(查一下|搜索|搜一下|检索|找一下|调研|研究|核实|看看)\s*/u, "")
    .replace(/(最新|实时)(信息|资料|情况)?$/u, "$1")
    .trim() || message.trim();
}

function getHostname(link: string): string | null {
  try {
    return new URL(link).hostname.replace(/^www\./, "");
  } catch {
    return null;
  }
}

function createPreview(content: string): string {
  return content.replace(/\s+/g, " ").trim().slice(0, 180);
}

function messageMentionsFile(message: string, file: { id: string; filename: string }): boolean {
  const normalizedMessage = normalizeForMatch(message);
  const normalizedFilename = normalizeForMatch(file.filename);
  const basename = normalizeForMatch(file.filename.replace(/\.[^.]+$/, ""));

  return (
    normalizedMessage.includes(normalizedFilename) ||
    (basename.length >= 2 && normalizedMessage.includes(basename)) ||
    normalizedMessage.includes(file.id)
  );
}

function resolveFileDeleteMatches(input: {
  message: string;
  entities: Record<string, unknown>;
  files: Array<{ id: string; filename: string }>;
}) {
  const targetIndex = getEntityNumber(input.entities, ["targetIndex", "index", "fileIndex", "fileNumber"]) ??
    extractOrdinal(input.message);
  if (targetIndex !== undefined) {
    const indexedFile = input.files[targetIndex - 1];
    return indexedFile ? [indexedFile] : [];
  }

  const targetText = getEntityString(input.entities, ["target", "filename", "fileName", "document", "documentName"]) ??
    input.message;

  return input.files.filter((file) =>
    messageMentionsFile(targetText, file) ||
    (targetText !== input.message && messageMentionsFile(input.message, file))
  );
}

function normalizeForMatch(value: string): string {
  return value.toLowerCase().replace(/\s+/g, "");
}

function getEntityString(entities: Record<string, unknown>, keys: string[]): string | undefined {
  for (const key of keys) {
    const value = entities[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }

  return undefined;
}

function getEntityNumber(entities: Record<string, unknown>, keys: string[]): number | undefined {
  for (const key of keys) {
    const value = entities[key];
    if (typeof value === "number" && Number.isInteger(value) && value > 0) return value;
    if (typeof value === "string") {
      const numeric = Number(value.trim());
      if (Number.isInteger(numeric) && numeric > 0) return numeric;
    }
  }

  return undefined;
}

function extractOrdinal(message: string): number | undefined {
  const digit = message.match(/第\s*(\d+)\s*(?:个|条|项|份)?/u)?.[1] ??
    message.match(/(\d+)\s*(?:号|个|条|项|份)/u)?.[1];
  if (digit) {
    const value = Number(digit);
    return Number.isInteger(value) && value > 0 ? value : undefined;
  }

  const chinese = message.match(/第?\s*([一二三四五六七八九十])\s*(?:个|条|项|份)?/u)?.[1];
  return chinese ? chineseOrdinalToNumber(chinese) : undefined;
}

function chineseOrdinalToNumber(value: string): number | undefined {
  const digits: Record<string, number> = {
    一: 1,
    二: 2,
    三: 3,
    四: 4,
    五: 5,
    六: 6,
    七: 7,
    八: 8,
    九: 9,
    十: 10
  };

  return digits[value];
}

function extractUploadedFileIds(message: string): string[] {
  return [...message.matchAll(/\[fileId:([^\]\s]+)\]/g)].map((match) => match[1]);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
