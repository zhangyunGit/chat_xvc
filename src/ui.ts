export const html = `<!doctype html>
<html lang="zh-CN">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Chat XVC</title>
    <style>
      :root {
        color-scheme: light dark;
        font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      }
      body {
        margin: 0;
        min-height: 100vh;
        display: grid;
        place-items: center;
        background: radial-gradient(circle at top, #dbeafe, transparent 34rem), #f8fafc;
        color: #0f172a;
      }
      main {
        width: min(920px, calc(100vw - 32px));
        min-height: min(760px, calc(100vh - 32px));
        display: grid;
        grid-template-rows: auto 1fr auto;
        border: 1px solid #dbe3ef;
        border-radius: 24px;
        background: rgba(255, 255, 255, 0.88);
        box-shadow: 0 24px 80px rgba(15, 23, 42, 0.12);
        overflow: hidden;
      }
      header {
        padding: 22px 24px;
        border-bottom: 1px solid #e2e8f0;
      }
      h1 {
        margin: 0 0 6px;
        font-size: 22px;
      }
      p {
        margin: 0;
        color: #64748b;
      }
      #messages {
        padding: 24px;
        overflow: auto;
        display: flex;
        flex-direction: column;
        gap: 14px;
      }
      .message {
        max-width: 78%;
        padding: 13px 15px;
        border-radius: 18px;
        line-height: 1.65;
        white-space: pre-wrap;
      }
      .user {
        align-self: flex-end;
        background: #2563eb;
        color: white;
        border-bottom-right-radius: 6px;
      }
      .assistant {
        align-self: flex-start;
        background: #f1f5f9;
        color: #0f172a;
        border-bottom-left-radius: 6px;
      }
      form {
        display: flex;
        gap: 12px;
        padding: 18px;
        border-top: 1px solid #e2e8f0;
      }
      input {
        flex: 1;
        border: 1px solid #cbd5e1;
        border-radius: 999px;
        padding: 13px 16px;
        font-size: 16px;
      }
      button {
        border: 0;
        border-radius: 999px;
        padding: 0 22px;
        background: #0f172a;
        color: white;
        font-weight: 700;
        cursor: pointer;
      }
      button:disabled {
        cursor: not-allowed;
        opacity: 0.55;
      }
    </style>
  </head>
  <body>
    <main>
      <header>
        <h1>Chat XVC</h1>
        <p>Cloudflare-native 智能对话式任务管理助手</p>
      </header>
      <section id="messages">
        <div class="message assistant" id="greeting">你好，我是 XVC。你可以告诉我你的姓名和邮箱，方便我后续称呼你并保存你的任务；如果暂时不想提供，也可以直接开始使用。</div>
      </section>
      <form id="form">
        <input id="input" autocomplete="off" placeholder="输入你的需求，例如：帮我创建一个明天下午检查简历的任务" />
        <button id="send" type="submit">发送</button>
      </form>
    </main>
    <script>
      const form = document.querySelector("#form");
      const input = document.querySelector("#input");
      const send = document.querySelector("#send");
      const messages = document.querySelector("#messages");
      const storageKeys = {
        userId: "chat-xvc:user-id",
        conversationId: "chat-xvc:conversation-id"
      };

      let userId = localStorage.getItem(storageKeys.userId);
      let conversationId = localStorage.getItem(storageKeys.conversationId);
      const greeting = document.querySelector("#greeting");

      refreshGreeting();

      function addMessage(role, content = "") {
        const node = document.createElement("div");
        node.className = "message " + role;
        node.textContent = content;
        messages.appendChild(node);
        messages.scrollTop = messages.scrollHeight;
        return node;
      }

      async function refreshGreeting() {
        const query = userId ? "?userId=" + encodeURIComponent(userId) : "";
        try {
          const response = await fetch("/api/session" + query);
          const payload = await response.json();
          if (payload.greeting) greeting.textContent = payload.greeting;
        } catch {
          greeting.textContent = "你好，我是 XVC。需要我做什么吗~";
        }
      }

      form.addEventListener("submit", async (event) => {
        event.preventDefault();
        const text = input.value.trim();
        if (!text) return;

        addMessage("user", text);
        input.value = "";
        send.disabled = true;
        const assistant = addMessage("assistant", "");

        try {
          const response = await fetch("/api/chat", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ message: text, userId, conversationId })
          });

          const reader = response.body.getReader();
          const decoder = new TextDecoder();
          let buffer = "";

          while (true) {
            const { value, done } = await reader.read();
            if (done) break;
            buffer += decoder.decode(value, { stream: true });
            const events = buffer.split("\\n\\n");
            buffer = events.pop() || "";

            for (const eventText of events) {
              const line = eventText.split("\\n").find((item) => item.startsWith("data: "));
              if (!line) continue;
              const data = line.slice(6);
              if (data === "[DONE]") continue;
              const payload = JSON.parse(data);
              if (payload.type === "meta") {
                if (payload.userId) {
                  userId = payload.userId;
                  localStorage.setItem(storageKeys.userId, userId);
                }
                if (payload.conversationId) {
                  conversationId = payload.conversationId;
                  localStorage.setItem(storageKeys.conversationId, conversationId);
                }
              }
              if (payload.delta) assistant.textContent += payload.delta;
              if (payload.error) assistant.textContent += "\\n错误：" + payload.error;
              messages.scrollTop = messages.scrollHeight;
            }
          }
        } finally {
          send.disabled = false;
          input.focus();
        }
      });
    </script>
  </body>
</html>`;
