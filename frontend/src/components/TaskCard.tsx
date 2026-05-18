type TaskCardProps = {
  id?: string;
  title: string;
  detail: string;
  statusLabel?: string;
  dueAt: string;
};

export function TaskCard({
  id,
  title,
  detail,
  statusLabel = "未开始",
  dueAt
}: TaskCardProps) {
  return (
    <section className="task-card" aria-label={id ? `任务 ${id.slice(0, 8)}` : "任务卡片"}>
      <div className="task-card__main">
        <h3>{title}</h3>
        <span className="task-card__status">{statusLabel}</span>
      </div>
      <p className="task-card__meta">时间：{dueAt || "无截止时间"}</p>
      <p className="task-card__detail">内容：{detail || "暂无具体内容"}</p>
    </section>
  );
}
