import { TaskService, type TaskExecutionResult } from "../services/task-service";
import type { IntentDecision, RecentIntentMessage } from "../types/intent";

export class TaskTools {
  private readonly taskService: TaskService;

  constructor(db: D1Database) {
    this.taskService = new TaskService(db);
  }

  async executeTaskIntent(input: {
    userId: string;
    message: string;
    decision: IntentDecision;
    recentMessages: RecentIntentMessage[];
  }): Promise<TaskExecutionResult> {
    return this.taskService.execute(input);
  }
}
