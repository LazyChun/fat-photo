/*
 * 独立预览入口：无需 FatNotes 宿主，直接渲染完整编辑器壳
 * 用于本地开发与视觉验证。生产构建仍使用 MF 远程入口(src/bootstrap.ts)。
 */
import React from "react";
import { createRoot } from "react-dom/client";
import { LeftSidebar, CenterArea, RightSidebar, StatusBar } from "./components";
import "./styles/editor.css";

const PreviewApp: React.FC = () => {
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        height: "100vh",
        width: "100vw",
        overflow: "hidden",
      }}
    >
      <div style={{ display: "flex", flex: 1, minHeight: 0 }}>
        <div style={{ width: 240, flexShrink: 0 }}>
          <LeftSidebar />
        </div>
        <CenterArea />
        <RightSidebar />
      </div>
      <StatusBar />
    </div>
  );
};

const rootEl = document.getElementById("root");
if (rootEl) {
  createRoot(rootEl).render(
    <React.StrictMode>
      <PreviewApp />
    </React.StrictMode>,
  );
}
