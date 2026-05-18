import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const tempDir = mkdtempSync(join(tmpdir(), "chat-xvc-feature-task-management-"));

try {
  execFileSync(
    "npx",
    [
      "esbuild",
      "src/services/task-service.ts",
      "--bundle",
      "--format=esm",
      `--outfile=${join(tempDir, "task-service.mjs")}`
    ],
    { stdio: "inherit" }
  );

  const testFile = join(tempDir, "test.mjs");
  writeFileSync(
    testFile,
    `
import { TaskService } from "./task-service.mjs";

const tasks = [];
const requirements = [];
let logicalClock = 0;

function now() {
  logicalClock += 1;
  return "2026-05-17T00:00:" + String(logicalClock).padStart(2, "0") + "Z";
}

function createDb() {
  return {
    prepare(sql) {
      return {
        values: [],
        bind(...values) {
          this.values = values;
          return this;
        },
        async run() {
          if (sql.startsWith("INSERT INTO tasks")) {
            const [id, userId, title, detail, priority, dueAt] = this.values;
            const timestamp = now();
            tasks.push({
              id,
              user_id: userId,
              title,
              detail,
              status: "todo",
              priority,
              due_at: dueAt,
              created_at: timestamp,
              updated_at: timestamp
            });
            return {};
          }

          if (sql.startsWith("UPDATE tasks SET")) {
            const userId = this.values[this.values.length - 2];
            const taskId = this.values[this.values.length - 1];
            const task = tasks.find((item) => item.user_id === userId && item.id === taskId);
            if (task) {
              let index = 0;
              if (sql.includes("title = ?")) task.title = this.values[index++];
              if (sql.includes("detail = ?")) task.detail = this.values[index++];
              if (sql.includes("status = ?")) task.status = this.values[index++];
              if (sql.includes("priority = ?")) task.priority = this.values[index++];
              if (sql.includes("due_at = ?")) task.due_at = this.values[index++];
              task.updated_at = now();
            }
            return {};
          }

          if (sql === "DELETE FROM task_requirements WHERE task_id = ?") {
            const [taskId] = this.values;
            for (let index = requirements.length - 1; index >= 0; index -= 1) {
              if (requirements[index].task_id === taskId) requirements.splice(index, 1);
            }
            return {};
          }

          if (sql === "DELETE FROM tasks WHERE user_id = ? AND id = ?") {
            const [userId, taskId] = this.values;
            const index = tasks.findIndex((item) => item.user_id === userId && item.id === taskId);
            if (index >= 0) tasks.splice(index, 1);
            return {};
          }

          if (sql.startsWith("INSERT INTO task_requirements")) {
            const [id, taskId, content] = this.values;
            const timestamp = now();
            requirements.push({ id, task_id: taskId, content, created_at: timestamp, updated_at: timestamp });
            return {};
          }

          if (sql.startsWith("UPDATE task_requirements")) {
            const [content, taskId, requirementId] = this.values;
            const requirement = requirements.find((item) => item.task_id === taskId && item.id === requirementId);
            if (requirement) {
              requirement.content = content;
              requirement.updated_at = now();
            }
            return {};
          }

          if (sql === "DELETE FROM task_requirements WHERE task_id = ? AND id = ?") {
            const [taskId, requirementId] = this.values;
            const index = requirements.findIndex((item) => item.task_id === taskId && item.id === requirementId);
            if (index >= 0) requirements.splice(index, 1);
            return {};
          }

          throw new Error("Unexpected run SQL: " + sql);
        },
        async first() {
          if (sql === "SELECT * FROM tasks WHERE user_id = ? AND id = ?") {
            const [userId, taskId] = this.values;
            return tasks.find((task) => task.user_id === userId && task.id === taskId) ?? null;
          }

          if (sql.includes("FROM tasks WHERE user_id = ? AND title LIKE ?")) {
            const [userId, titlePattern] = this.values;
            const target = titlePattern.replaceAll("%", "");
            return [...tasks].reverse().find((task) => task.user_id === userId && task.title.includes(target)) ?? null;
          }

          if (sql === "SELECT * FROM task_requirements WHERE id = ?") {
            const [requirementId] = this.values;
            return requirements.find((requirement) => requirement.id === requirementId) ?? null;
          }

          if (sql === "SELECT * FROM task_requirements WHERE task_id = ? AND id = ?") {
            const [taskId, requirementId] = this.values;
            return requirements.find((item) => item.task_id === taskId && item.id === requirementId) ?? null;
          }

          throw new Error("Unexpected first SQL: " + sql);
        },
        async all() {
          if (sql === "SELECT * FROM tasks WHERE user_id = ? ORDER BY status ASC, updated_at DESC") {
            const [userId] = this.values;
            return {
              results: [...tasks]
                .filter((task) => task.user_id === userId)
                .sort((a, b) => a.status.localeCompare(b.status) || b.updated_at.localeCompare(a.updated_at))
            };
          }

          if (sql === "SELECT * FROM task_requirements WHERE task_id = ? ORDER BY created_at ASC") {
            const [taskId] = this.values;
            return {
              results: requirements
                .filter((requirement) => requirement.task_id === taskId)
                .sort((a, b) => a.created_at.localeCompare(b.created_at))
            };
          }

          throw new Error("Unexpected all SQL: " + sql);
        }
      };
    }
  };
}

function decision(intent, entities = {}) {
  return {
    intent,
    confidence: 0.99,
    entities,
    requiredTools: [],
    promptTemplate: "task",
    needsClarification: false,
    needsRag: false,
    needsWebSearch: false,
    shouldWriteMemory: false,
    source: "llm"
  };
}

const service = new TaskService(createDb());
const userId = "feature-user";

const createdA = await service.execute({
  userId,
  message: "创建任务：整理项目计划",
  decision: decision("task.create", { title: "整理项目计划", detail: "梳理项目总体方案", priority: "medium" }),
  recentMessages: []
});
if (!createdA.handled || createdA.uiTasks?.[0]?.title !== "整理项目计划") throw new Error("Expected first task creation");

const createdB = await service.execute({
  userId,
  message: "创建任务：准备周会材料",
  decision: decision("task.create", { title: "准备周会材料", detail: "整理本周进展", priority: "low" }),
  recentMessages: []
});
if (!createdB.handled || createdB.uiTasks?.[0]?.title !== "准备周会材料") throw new Error("Expected second task creation");

const listed = await service.execute({
  userId,
  message: "列出任务列表",
  decision: decision("task.list"),
  recentMessages: []
});
if (listed.mode !== "direct" || listed.uiTasks?.length !== 2) throw new Error("Expected two listed tasks");
if (listed.uiTasks[0].title !== "准备周会材料" || listed.uiTasks[1].title !== "整理项目计划") {
  throw new Error("Expected visible list order to be stable for index-based operations");
}

const updatedByIndex = await service.execute({
  userId,
  message: "把第2个任务改成整理最终项目计划，优先级调高",
  decision: decision("task.update", { targetIndex: 2, title: "整理最终项目计划", priority: "high" }),
  recentMessages: []
});
if (updatedByIndex.functionName !== "update_task") throw new Error("Expected update_task");
if (updatedByIndex.uiTasks?.[0]?.title !== "整理最终项目计划") throw new Error("Expected index-based task update");
if (updatedByIndex.uiTasks[0].priority !== "high") throw new Error("Expected priority update");

const addedRequirement = await service.execute({
  userId,
  message: "给第1个任务补充要求：包含风险和后续计划",
  decision: decision("task.add_requirement", { targetIndex: 1, requirement: "包含风险和后续计划" }),
  recentMessages: []
});
if (addedRequirement.functionName !== "add_task_requirement") throw new Error("Expected add requirement");
if (addedRequirement.uiTasks?.[0]?.requirements?.[0]?.content !== "包含风险和后续计划") {
  throw new Error("Expected requirement on indexed task");
}

const completedByIndex = await service.execute({
  userId,
  message: "把第2个完成掉",
  decision: decision("task.complete", { targetIndex: 2 }),
  recentMessages: []
});
if (completedByIndex.functionName !== "update_task") throw new Error("Expected complete as update_task");
if (completedByIndex.uiTasks?.[0]?.status !== "done") throw new Error("Expected index-based task completion");

const deletedByIndex = await service.execute({
  userId,
  message: "把第2个删除掉吧",
  decision: decision("task.delete", { targetIndex: 2 }),
  recentMessages: []
});
if (deletedByIndex.functionName !== "delete_task") throw new Error("Expected delete_task");
if (deletedByIndex.uiTasks?.[0]?.title !== "整理最终项目计划") throw new Error("Expected index-based delete target");

const finalList = await service.execute({
  userId,
  message: "再列一下任务",
  decision: decision("task.list"),
  recentMessages: []
});
if (finalList.uiTasks?.length !== 1) throw new Error("Expected one remaining task");
if (finalList.uiTasks[0].title !== "准备周会材料" || finalList.uiTasks[0].status !== "done") {
  throw new Error("Expected completed task to remain after delete");
}

console.log("feature task management ok");
`
  );

  execFileSync("node", [testFile], { stdio: "inherit" });
} finally {
  rmSync(tempDir, { recursive: true, force: true });
}
