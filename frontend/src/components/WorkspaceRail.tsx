import { FileCard, List, ListItem, Notice, Progress, Step, Stepper } from "@chatui/core";

const demoFile = new File(["Chat XVC architecture"], "project-plan.md", {
  type: "text/markdown"
});

export function WorkspaceRail() {
  return (
    <aside className="workspace-rail" aria-label="工作区状态">
      <Notice content="已接入 Cloudflare AI Gateway，当前默认模型为 DeepSeek。" closable={false} />

      <section className="rail-card">
        <div className="rail-card__header">
          <span>阶段进度</span>
          <strong>62%</strong>
        </div>
        <Progress value={62} status="active" />
        <Stepper current={1} className="rail-stepper">
          <Step title="后端" desc="Workers / D1 / Vectorize" />
          <Step title="前端" desc="ChatUI 工作台" />
          <Step title="RAG" desc="文件与引用" />
        </Stepper>
      </section>

      <section className="rail-card">
        <h2>快捷能力</h2>
        <List bordered>
          <ListItem content="创建 / 查询 / 更新任务" />
          <ListItem content="资料识别与昵称更新" />
          <ListItem content="Serper.dev Web Search" />
          <ListItem content="Vectorize RAG 预留" />
        </List>
      </section>

      <section className="rail-card">
        <h2>文件区</h2>
        <FileCard file={demoFile}>
          <span>准备接入 R2 上传与文档 RAG。</span>
        </FileCard>
      </section>
    </aside>
  );
}
