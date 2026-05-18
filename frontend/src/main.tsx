import React from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import "@chatui/core/dist/index.css";
import "./styles/theme.css";

function syncAppViewportHeight() {
  const userAgent = window.navigator.userAgent.toLowerCase();
  const isWeChat =
    /micromessenger|wechat|windowswechat|macwechat|weixin|xweb/u.test(userAgent) ||
    "WeixinJSBridge" in window;
  const viewportHeight =
    window.visualViewport?.height ||
    window.innerHeight ||
    document.documentElement.clientHeight ||
    0;
  const isMobileViewport =
    window.matchMedia?.("(max-width: 760px), (pointer: coarse)")?.matches ??
    window.innerWidth <= 760;
  const height = viewportHeight;

  document.documentElement.classList.toggle("xvc-mobile-viewport", isMobileViewport);
  document.documentElement.classList.toggle("xvc-wechat-desktop", isWeChat && !isMobileViewport);

  if (height > 0) {
    document.documentElement.style.setProperty("--xvc-app-height", `${Math.round(height)}px`);
  }
}

syncAppViewportHeight();
window.addEventListener("resize", syncAppViewportHeight);
window.addEventListener("orientationchange", syncAppViewportHeight);
window.visualViewport?.addEventListener("resize", syncAppViewportHeight);
window.visualViewport?.addEventListener("scroll", syncAppViewportHeight);
window.setTimeout(syncAppViewportHeight, 300);

createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
