/*
 * 底部状态栏:状态 + 工具名 | 画布尺寸 + 光标 | 缩放 + 色彩模式
 */
import React from "react";
import { useEditor, getActiveToolStatusName } from "store";
import { useCursor } from "../../store/cursorStore";

const StatusBar: React.FC = () => {
  const s = useEditor();
  const cursor = useCursor();
  const toolName = getActiveToolStatusName();
  const sizeText = s.hasDocument ? `${s.transform.w} x ${s.transform.h} px` : "无文档";
  const cursorText = s.hasDocument && cursor.visible ? `x: ${cursor.x}, y: ${cursor.y}` : "";
  return (
    <div
      style={{
        height: 22,
        background: "var(--pe-statusbar)",
        borderTop: "1px solid rgba(0,122,204,0.3)",
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        padding: "0 12px",
        flexShrink: 0,
        userSelect: "none",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
        <span style={{ fontSize: "var(--pe-font-size-sm)", color: "var(--pe-statusbar-fg)" }}>
          {s.hasDocument ? "就绪" : "请打开或新建文档"}
        </span>
        <span style={{ fontSize: "var(--pe-font-size-sm)", color: "var(--pe-statusbar-fg)" }}>{toolName}</span>
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
        <span style={{ fontSize: "var(--pe-font-size-sm)", color: "var(--pe-statusbar-fg)" }}>{sizeText}</span>
        {cursorText && (
          <span style={{ fontSize: "var(--pe-font-size-sm)", color: "var(--pe-statusbar-fg)", fontFamily: "var(--pe-font-mono)" }}>
            {cursorText}
          </span>
        )}
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
        <span style={{ fontSize: "var(--pe-font-size-sm)", color: "var(--pe-statusbar-fg)" }}>{s.zoom}%</span>
        <span style={{ fontSize: "var(--pe-font-size-sm)", color: "var(--pe-statusbar-fg)" }}>RGB / 8bit</span>
        <span style={{ fontSize: "var(--pe-font-size-sm)", color: "var(--pe-statusbar-fg)" }}>{s.layers.length} 图层</span>
      </div>
    </div>
  );
};

export default StatusBar;
