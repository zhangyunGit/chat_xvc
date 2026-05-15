import type {
  CreateTaskInput,
  Task,
  TaskPriority,
  TaskRequirement,
  TaskStatus,
  TaskWithRequirements,
  UpdateTaskInput
} from "../types/domain";

type TaskRow = {
  id: string;
  user_id: string;
  title: string;
  detail: string;
  status: TaskStatus;
  priority: TaskPriority;
  due_at: string | null;
  created_at: string;
  updated_at: string;
};

type TaskRequirementRow = {
  id: string;
  task_id: string;
  content: string;
  created_at: string;
  updated_at: string;
};

export class TaskRepository {
  constructor(private readonly db: D1Database) {}

  async createTask(input: CreateTaskInput): Promise<Task> {
    const id = crypto.randomUUID();

    await this.db
      .prepare(
        "INSERT INTO tasks (id, user_id, title, detail, priority, due_at) VALUES (?, ?, ?, ?, ?, ?)"
      )
      .bind(id, input.userId, input.title, input.detail, input.priority ?? "medium", input.dueAt ?? null)
      .run();

    const task = await this.findTaskById(input.userId, id);

    if (!task) {
      throw new Error("Failed to create task");
    }

    return task;
  }

  async findTaskById(userId: string, taskId: string): Promise<Task | null> {
    const row = await this.db
      .prepare("SELECT * FROM tasks WHERE user_id = ? AND id = ?")
      .bind(userId, taskId)
      .first<TaskRow>();

    return row ? toTask(row) : null;
  }

  async findTaskWithRequirementsById(userId: string, taskId: string): Promise<TaskWithRequirements | null> {
    const task = await this.findTaskById(userId, taskId);
    if (!task) return null;

    return {
      ...task,
      requirements: await this.listRequirements(task.id)
    };
  }

  async findTaskByTitle(userId: string, title: string): Promise<Task | null> {
    const row = await this.db
      .prepare(
        "SELECT * FROM tasks WHERE user_id = ? AND title LIKE ? ORDER BY updated_at DESC LIMIT 1"
      )
      .bind(userId, `%${title}%`)
      .first<TaskRow>();

    return row ? toTask(row) : null;
  }

  async findTaskWithRequirementsByTitle(userId: string, title: string): Promise<TaskWithRequirements | null> {
    const task = await this.findTaskByTitle(userId, title);
    if (!task) return null;

    return {
      ...task,
      requirements: await this.listRequirements(task.id)
    };
  }

  async listTasks(userId: string): Promise<TaskWithRequirements[]> {
    const taskRows = await this.db
      .prepare("SELECT * FROM tasks WHERE user_id = ? ORDER BY status ASC, updated_at DESC")
      .bind(userId)
      .all<TaskRow>();

    const tasks = taskRows.results.map(toTask);
    const taskRequirements = await Promise.all(
      tasks.map(async (task) => ({
        task,
        requirements: await this.listRequirements(task.id)
      }))
    );

    return taskRequirements.map(({ task, requirements }) => ({
      ...task,
      requirements
    }));
  }

  async updateTask(userId: string, taskId: string, input: UpdateTaskInput): Promise<Task> {
    const assignments: string[] = [];
    const values: Array<string | null> = [];

    if (input.title !== undefined) {
      assignments.push("title = ?");
      values.push(input.title);
    }

    if (input.detail !== undefined) {
      assignments.push("detail = ?");
      values.push(input.detail);
    }

    if (input.status !== undefined) {
      assignments.push("status = ?");
      values.push(input.status);
    }

    if (input.priority !== undefined) {
      assignments.push("priority = ?");
      values.push(input.priority);
    }

    if (input.dueAt !== undefined) {
      assignments.push("due_at = ?");
      values.push(input.dueAt);
    }

    if (assignments.length > 0) {
      assignments.push("updated_at = CURRENT_TIMESTAMP");
      await this.db
        .prepare(`UPDATE tasks SET ${assignments.join(", ")} WHERE user_id = ? AND id = ?`)
        .bind(...values, userId, taskId)
        .run();
    }

    const task = await this.findTaskById(userId, taskId);

    if (!task) {
      throw new Error("Task not found");
    }

    return task;
  }

  async deleteTask(userId: string, taskId: string): Promise<void> {
    await this.db.prepare("DELETE FROM task_requirements WHERE task_id = ?").bind(taskId).run();
    await this.db.prepare("DELETE FROM tasks WHERE user_id = ? AND id = ?").bind(userId, taskId).run();
  }

  async addRequirement(taskId: string, content: string): Promise<TaskRequirement> {
    const id = crypto.randomUUID();

    await this.db
      .prepare("INSERT INTO task_requirements (id, task_id, content) VALUES (?, ?, ?)")
      .bind(id, taskId, content)
      .run();

    const row = await this.db
      .prepare("SELECT * FROM task_requirements WHERE id = ?")
      .bind(id)
      .first<TaskRequirementRow>();

    if (!row) {
      throw new Error("Failed to add task requirement");
    }

    return toTaskRequirement(row);
  }

  async updateRequirement(taskId: string, requirementId: string, content: string): Promise<TaskRequirement> {
    await this.db
      .prepare("UPDATE task_requirements SET content = ?, updated_at = CURRENT_TIMESTAMP WHERE task_id = ? AND id = ?")
      .bind(content, taskId, requirementId)
      .run();

    const row = await this.db
      .prepare("SELECT * FROM task_requirements WHERE task_id = ? AND id = ?")
      .bind(taskId, requirementId)
      .first<TaskRequirementRow>();

    if (!row) {
      throw new Error("Task requirement not found");
    }

    return toTaskRequirement(row);
  }

  async deleteRequirement(taskId: string, requirementId: string): Promise<void> {
    await this.db
      .prepare("DELETE FROM task_requirements WHERE task_id = ? AND id = ?")
      .bind(taskId, requirementId)
      .run();
  }

  async listRequirements(taskId: string): Promise<TaskRequirement[]> {
    const rows = await this.db
      .prepare("SELECT * FROM task_requirements WHERE task_id = ? ORDER BY created_at ASC")
      .bind(taskId)
      .all<TaskRequirementRow>();

    return rows.results.map(toTaskRequirement);
  }
}

function toTask(row: TaskRow): Task {
  return {
    id: row.id,
    userId: row.user_id,
    title: row.title,
    detail: row.detail ?? "",
    status: row.status,
    priority: row.priority,
    dueAt: row.due_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function toTaskRequirement(row: TaskRequirementRow): TaskRequirement {
  return {
    id: row.id,
    taskId: row.task_id,
    content: row.content,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}
