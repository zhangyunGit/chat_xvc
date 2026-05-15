import type { IntentName, IntentRegistryItem } from "../types/intent";

export const intentRegistry: IntentRegistryItem[] = [
  item("profile.collect_user_info", "Collect missing user name or email.", [], "onboarding"),
  item("profile.update_user_info", "Update user name or email.", ["save_user_profile"], "profile"),
  item("profile.update_ai_nickname", "更新助手的名字，例如用户说“你叫豆豆”，“以后叫你豆豆”。", ["save_user_profile"], "profile"),
  item("profile.reset", "Start a new user profile.", ["reset_profile"], "onboarding"),
  item("profile.query", "Answer questions about saved profile fields.", [], "profile"),
  item("task.create", "Create a task from natural language with title and detail.", ["create_task"], "task_manager"),
  item("task.list", "List user's tasks.", ["list_tasks"], "task_manager"),
  item("task.detail", "Show task details and requirements.", ["list_tasks"], "task_manager"),
  item("task.update", "Update title, due date, priority, or status of a task.", ["update_task"], "task_manager"),
  item("task.complete", "Mark a task as complete.", ["update_task"], "task_manager"),
  item("task.delete", "Delete a task.", ["delete_task"], "task_manager"),
  item("task.add_requirement", "Add a requirement to a task.", ["add_task_requirement"], "task_manager"),
  item("task.update_requirement", "Update an existing task requirement.", ["update_task_requirement"], "task_manager"),
  item("task.delete_requirement", "Delete an existing task requirement.", ["delete_task_requirement"], "task_manager"),
  item("task.extract_from_text", "Extract tasks from pasted text.", ["create_task"], "task_manager"),
  item("document.upload_help", "Explain how to upload files.", [], "general_chat"),
  item("document.list", "List uploaded files.", ["list_documents"], "rag_answer", true),
  item("document.delete", "Delete uploaded files.", ["delete_document"], "rag_answer", true),
  item("document.search", "Search uploaded documents.", ["search_user_documents"], "rag_answer", true),
  item("document.summarize", "Summarize uploaded documents.", ["search_user_documents"], "rag_answer", true),
  item("document.qa", "Answer questions using uploaded documents.", ["search_user_documents"], "rag_answer", true),
  item("document.extract_tasks", "Extract tasks from uploaded documents.", ["search_user_documents", "create_task"], "rag_answer", true),
  item("document.compare", "Compare uploaded documents.", ["search_user_documents"], "rag_answer", true),
  item("memory.write", "Save user preference or long-term memory.", ["write_memory"], "general_chat", false, false, true),
  item("memory.recall", "Recall saved memories.", ["recall_memory"], "general_chat"),
  item("memory.delete", "Delete saved memories.", ["delete_memory"], "general_chat"),
  item("memory.list", "List saved memories.", ["list_memory"], "general_chat"),
  item("research.quick_search", "Run a quick public web search.", ["web_search"], "deep_research", false, true),
  item("research.deep_report", "Research a complex topic and produce a structured report.", ["web_search"], "deep_research", false, true),
  item("research.compare_options", "Compare external options using web research.", ["web_search"], "deep_research", false, true),
  item("research.fact_check", "Fact-check a claim using web search.", ["web_search"], "deep_research", false, true),
  item("research.latest_info", "Find latest public information.", ["web_search"], "deep_research", false, true),
  item("conversation.smalltalk", "Small talk and greetings.", [], "general_chat"),
  item("conversation.clarify", "Ask a clarification question.", [], "clarification"),
  item("conversation.general_qa", "General conversation or explanation.", [], "general_chat"),
  item("conversation.help", "Explain how to use the assistant.", [], "general_chat"),
  item("conversation.capability_intro", "Introduce assistant capabilities.", [], "general_chat")
];

export const knownIntentNames = new Set<IntentName>(intentRegistry.map((item) => item.intent));

export function getIntentRegistryItem(intent: IntentName): IntentRegistryItem {
  return intentRegistry.find((item) => item.intent === intent) ?? intentRegistry[intentRegistry.length - 1];
}

function item(
  intent: IntentName,
  description: string,
  requiredTools: string[],
  promptTemplate: IntentRegistryItem["promptTemplate"],
  needsRag = false,
  needsWebSearch = false,
  shouldWriteMemory = false
): IntentRegistryItem {
  return {
    intent,
    description,
    requiredTools,
    promptTemplate,
    needsRag,
    needsWebSearch,
    shouldWriteMemory
  };
}
