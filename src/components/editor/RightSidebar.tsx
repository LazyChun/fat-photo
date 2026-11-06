/*
 * 右侧栏:属性面板
 * 根据活动图层类型显示对应的属性：
 * - 文本图层: 字号/加粗/颜色
 * - 形状图层: 形状类型/描边/填充/颜色
 * - 普通图层: 变换/调整/色彩/信息
 */
import React from "react";
import {
  ChevronDown,
  ChevronRight,
  Link,
  Repeat,
  Bold,
  Italic,
  Underline,
  Strikethrough,
  Square,
  Circle,
  Triangle,
  Hexagon,
  Star,
  Minus,
} from "lucide-react";
import { useEditor, actions } from "store";
import type { ShapeKind } from "store";
import { TEXT_FONTS } from "../../editor/engine";

const SHAPE_ICON: Record<string, React.FC<{ size?: number; color?: string }>> = {
  rect: Square,
  ellipse: Circle,
  circle: Circle,
  triangle: Triangle,
  polygon: Hexagon,
  star: Star,
  line: Minus,
};

const SHAPE_LABELS: Record<string, string> = {
  rect: "矩形",
  ellipse: "椭圆",
  circle: "圆形",
  triangle: "三角形",
  polygon: "多边形",
  star: "星形",
  line: "直线",
};

/* 颜色 hex → {r,g,b,h,s,l} 解析 */
const hexToRgb = (hex: string): { r: number; g: number; b: number } => {
  const m = /^#?([0-9a-fA-F]{6})$/.exec(hex.trim());
  if (!m) return { r: 0, g: 0, b: 0 };
  const n = parseInt(m[1], 16);
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
};
const rgbToHsl = (r: number, g: number, b: number): { h: number; s: number; l: number } => {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  let h = 0;
  let s = 0;
  const l = (max + min) / 2;
  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    switch (max) {
      case r: h = (g - b) / d + (g < b ? 6 : 0); break;
      case g: h = (b - r) / d + 2; break;
      default: h = (r - g) / d + 4;
    }
    h /= 6;
  }
  return { h: Math.round(h * 360), s: Math.round(s * 100), l: Math.round(l * 100) };
};

const RightSidebar: React.FC = () => {
  const s = useEditor();
  const activeLayer = s.layers.find((l) => l.id === s.activeLayerId);
  const layerKind = activeLayer?.kind ?? "image";

  return (
    <div
      className="pe-editor"
      style={{
        display: "flex",
        flexDirection: "column",
        width: 260,
        flexShrink: 0,
        background: "var(--pe-sidebar)",
        borderLeft: "1px solid var(--pe-sidebar-border)",
        minHeight: 0,
        overflow: "hidden",
      }}
    >
      <div
        style={{
          height: 24,
          background: "var(--pe-panel-header)",
          borderBottom: "1px solid var(--pe-sidebar-border)",
          display: "flex",
          alignItems: "center",
          padding: "0 8px",
          flexShrink: 0,
          cursor: "pointer",
          userSelect: "none",
        }}
        onClick={() => actions.toggleRightSidebarCollapsed()}
        title={s.rightSidebarCollapsed ? "展开属性面板" : "折叠属性面板"}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
          {s.rightSidebarCollapsed ? <ChevronRight size={12} color="var(--pe-panel-header-fg)" /> : <ChevronDown size={12} color="var(--pe-panel-header-fg)" />}
          <span style={{ fontSize: "var(--pe-font-size-md)", fontWeight: 600, color: "var(--pe-panel-header-fg)" }}>属性</span>
        </div>
      </div>
      {!s.rightSidebarCollapsed && (
      <div className="pe-scroll" data-scroll-region="primary" style={{ flex: 1, overflowY: "auto" }}>
        {layerKind === "text" && (
          <TextLayerSection />
        )}
        {layerKind === "shape" && (
          <ShapeLayerSection />
        )}
        {layerKind === "image" && (
          <>
            <TransformSection />
            <AdjustSection />
            <ColorSection fg={s.fgColor} bg={s.bgColor} />
          </>
        )}
        <InfoSection />
      </div>
      )}
    </div>
  );
};

/* 可折叠分组容器 */
const Section: React.FC<{ title: string; sectionKey: string; children: React.ReactNode }> = ({ title, sectionKey, children }) => {
  const s = useEditor();
  const collapsed = !!s.collapsedSections[sectionKey];
  return (
    <div className="prop-section">
      <div className="prop-section-header" onClick={() => actions.toggleSection(sectionKey)}>
        <span>{title}</span>
        {collapsed ? <ChevronRight size={12} color="var(--pe-muted-foreground)" /> : <ChevronDown size={12} color="var(--pe-muted-foreground)" />}
      </div>
      {!collapsed && <div className="prop-section-content">{children}</div>}
    </div>
  );
};

/* 文本图层属性 */
const TextLayerSection: React.FC = () => {
  const s = useEditor();
  const t = s.text;
  const color = s.fgColor;
  const rgb = hexToRgb(color);
  const hsl = rgbToHsl(rgb.r, rgb.g, rgb.b);
  return (
    <>
      <Section title="文本" sectionKey="text">
        <div className="prop-row">
          <span className="prop-label" style={{ minWidth: 36 }}>字体</span>
          <select
            className="sb-select"
            style={{ flex: 1, fontFamily: t.fontFamily }}
            value={t.fontFamily}
            disabled={!s.hasDocument}
            onChange={(e) => actions.updateActiveTextLayer({ fontFamily: e.target.value })}
          >
            {TEXT_FONTS.map((f) => (
              <option key={f.label} value={f.value} style={{ fontFamily: f.value }}>
                {f.label}
              </option>
            ))}
          </select>
        </div>
        <div className="prop-row" style={{ marginTop: 6 }}>
          <span className="prop-label" style={{ minWidth: 36 }}>字号</span>
          <input
            type="range"
            min={8}
            max={200}
            className="pe-range"
            style={{ flex: 1 }}
            value={t.fontSize}
            disabled={!s.hasDocument}
            onChange={(e) => actions.updateActiveTextLayer({ fontSize: Number(e.target.value) })}
          />
          <span className="prop-value">{t.fontSize}px</span>
        </div>
        <div className="prop-row" style={{ marginTop: 6 }}>
          <span className="prop-label" style={{ minWidth: 36 }}>样式</span>
          <button
            className="tb-icon-btn"
            title="加粗"
            style={t.bold ? { background: "var(--pe-active)" } : undefined}
            disabled={!s.hasDocument}
            onClick={() => actions.updateActiveTextLayer({ bold: !t.bold })}
          >
            <Bold
              size={14}
              color={t.bold ? "var(--pe-icon-active-color)" : "var(--pe-icon-color)"}
            />
          </button>
          <button
            className="tb-icon-btn"
            title="斜体"
            style={{ marginLeft: 4, ...(t.italic ? { background: "var(--pe-active)" } : undefined) }}
            disabled={!s.hasDocument}
            onClick={() => actions.updateActiveTextLayer({ italic: !t.italic })}
          >
            <Italic
              size={14}
              color={t.italic ? "var(--pe-icon-active-color)" : "var(--pe-icon-color)"}
            />
          </button>
          <button
            className="tb-icon-btn"
            title="下划线"
            style={{ marginLeft: 4, ...(t.underline ? { background: "var(--pe-active)" } : undefined) }}
            disabled={!s.hasDocument}
            onClick={() => actions.updateActiveTextLayer({ underline: !t.underline })}
          >
            <Underline
              size={14}
              color={t.underline ? "var(--pe-icon-active-color)" : "var(--pe-icon-color)"}
            />
          </button>
          <button
            className="tb-icon-btn"
            title="删除线"
            style={{ marginLeft: 4, ...(t.strikethrough ? { background: "var(--pe-active)" } : undefined) }}
            disabled={!s.hasDocument}
            onClick={() => actions.updateActiveTextLayer({ strikethrough: !t.strikethrough })}
          >
            <Strikethrough
              size={14}
              color={t.strikethrough ? "var(--pe-icon-active-color)" : "var(--pe-icon-color)"}
            />
          </button>
        </div>
        <div className="prop-row" style={{ marginTop: 6, alignItems: "center" }}>
          <span className="prop-label" style={{ minWidth: 36 }}>颜色</span>
          <input
            type="color"
            style={{ width: 28, height: 28, padding: 0, border: "1px solid var(--pe-sidebar-border)", borderRadius: 2, cursor: "pointer", background: "transparent" }}
            value={/^#[0-9a-fA-F]{6}$/.test(color) ? color : "#000000"}
            disabled={!s.hasDocument}
            onChange={(e) => actions.updateActiveTextLayer({ color: e.target.value.toUpperCase() })}
          />
          <input
            type="text"
            className="prop-input"
            style={{ width: 76, fontFamily: "var(--pe-font-mono)", textAlign: "left", paddingLeft: 4 }}
            value={color}
            disabled={!s.hasDocument}
            onChange={(e) => actions.updateActiveTextLayer({ color: e.target.value.toUpperCase() })}
          />
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 16, marginTop: 6, fontSize: "var(--pe-font-size-sm)", fontFamily: "var(--pe-font-mono)", color: "var(--pe-foreground)" }}>
          <span>R: <strong style={{ color: "var(--pe-danger)" }}>{rgb.r}</strong></span>
          <span>G: <strong style={{ color: "var(--pe-success)" }}>{rgb.g}</strong></span>
          <span>B: <strong style={{ color: "var(--pe-info)" }}>{rgb.b}</strong></span>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 12, fontSize: "var(--pe-font-size-sm)", fontFamily: "var(--pe-font-mono)", color: "var(--pe-foreground)" }}>
          <span>H: <strong>{hsl.h}</strong></span>
          <span>S: <strong>{hsl.s}%</strong></span>
          <span>L: <strong>{hsl.l}%</strong></span>
        </div>
      </Section>
      <TransformSection />
    </>
  );
};

/* 形状图层属性 */
const ShapeLayerSection: React.FC = () => {
  const s = useEditor();
  const sp = s.shape;
  const color = s.fgColor;
  const rgb = hexToRgb(color);
  const hsl = rgbToHsl(rgb.r, rgb.g, rgb.b);

  const shapeKinds: ShapeKind[] = ["rect", "ellipse", "circle", "triangle", "polygon", "star", "line"];

  return (
    <>
      <Section title="形状" sectionKey="shape">
        <div className="prop-row">
          <span className="prop-label" style={{ minWidth: 36 }}>类型</span>
          <div style={{ display: "flex", gap: 2, flexWrap: "wrap", flex: 1 }}>
            {shapeKinds.map((kind) => {
              const Icon = SHAPE_ICON[kind] || Square;
              const active = sp.kind === kind;
              return (
                <button
                  key={kind}
                  className={`tb-icon-btn${active ? " active" : ""}`}
                  style={active ? { background: "var(--pe-active)" } : undefined}
                  title={SHAPE_LABELS[kind]}
                  disabled={!s.hasDocument}
                  onClick={() => actions.updateActiveShapeLayer({ kind })}
                >
                  <Icon size={13} color={active ? "var(--pe-icon-active-color)" : "var(--pe-icon-color)"} />
                </button>
              );
            })}
          </div>
        </div>
        {(sp.kind === "polygon" || sp.kind === "star") && (
          <div className="prop-row" style={{ marginTop: 6 }}>
            <span className="prop-label" style={{ minWidth: 36 }}>边数</span>
            <input
              type="range"
              min={3}
              max={12}
              className="pe-range"
              style={{ flex: 1 }}
              value={sp.sides}
              disabled={!s.hasDocument}
              onChange={(e) => actions.updateActiveShapeLayer({ sides: Number(e.target.value) })}
            />
            <span className="prop-value">{sp.sides}</span>
          </div>
        )}
        <div className="prop-row" style={{ marginTop: 6 }}>
          <span className="prop-label" style={{ minWidth: 36 }}>描边</span>
          <input
            type="range"
            min={1}
            max={100}
            className="pe-range"
            style={{ flex: 1 }}
            value={sp.lineWidth}
            disabled={!s.hasDocument}
            onChange={(e) => actions.updateActiveShapeLayer({ lineWidth: Number(e.target.value) })}
          />
          <span className="prop-value">{sp.lineWidth}px</span>
        </div>
        <div className="prop-row" style={{ marginTop: 6, alignItems: "center" }}>
          <span className="prop-label" style={{ minWidth: 36 }}>填充</span>
          <label style={{ display: "flex", alignItems: "center", gap: 4, cursor: "pointer" }}>
            <input
              type="checkbox"
              checked={sp.fill}
              disabled={!s.hasDocument}
              onChange={(e) => actions.updateActiveShapeLayer({ fill: e.target.checked })}
              style={{ margin: 0 }}
            />
          </label>
          <span style={{ fontSize: "var(--pe-font-size-sm)", color: "var(--pe-foreground)" }}>
            {sp.fill ? "已开启" : "未开启"}
          </span>
        </div>
        <div className="prop-row" style={{ marginTop: 6, alignItems: "center" }}>
          <span className="prop-label" style={{ minWidth: 36 }}>颜色</span>
          <input
            type="color"
            style={{ width: 28, height: 28, padding: 0, border: "1px solid var(--pe-sidebar-border)", borderRadius: 2, cursor: "pointer", background: "transparent" }}
            value={/^#[0-9a-fA-F]{6}$/.test(color) ? color : "#000000"}
            disabled={!s.hasDocument}
            onChange={(e) => actions.updateActiveShapeLayer({ color: e.target.value.toUpperCase() })}
          />
          <input
            type="text"
            className="prop-input"
            style={{ width: 76, fontFamily: "var(--pe-font-mono)", textAlign: "left", paddingLeft: 4 }}
            value={color}
            disabled={!s.hasDocument}
            onChange={(e) => actions.updateActiveShapeLayer({ color: e.target.value.toUpperCase() })}
          />
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 16, marginTop: 6, fontSize: "var(--pe-font-size-sm)", fontFamily: "var(--pe-font-mono)", color: "var(--pe-foreground)" }}>
          <span>R: <strong style={{ color: "var(--pe-danger)" }}>{rgb.r}</strong></span>
          <span>G: <strong style={{ color: "var(--pe-success)" }}>{rgb.g}</strong></span>
          <span>B: <strong style={{ color: "var(--pe-info)" }}>{rgb.b}</strong></span>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 12, fontSize: "var(--pe-font-size-sm)", fontFamily: "var(--pe-font-mono)", color: "var(--pe-foreground)" }}>
          <span>H: <strong>{hsl.h}</strong></span>
          <span>S: <strong>{hsl.s}%</strong></span>
          <span>L: <strong>{hsl.l}%</strong></span>
        </div>
      </Section>
      <TransformSection />
    </>
  );
};

/* 变换 */
const TransformSection: React.FC = () => {
  const s = useEditor();
  const t = s.transform;
  return (
    <Section title="变换" sectionKey="transform">
      <div style={{ display: "flex", alignItems: "flex-start", gap: 12 }}>
        <div style={{ display: "flex", flexDirection: "column", gap: 4, flex: 1 }}>
          <div className="prop-row">
            <span className="prop-label">X:</span>
            <input type="number" className="prop-input" value={t.x} disabled={!s.hasDocument} onChange={(e) => actions.setTransform({ x: Number(e.target.value) })} />
            <span style={{ fontSize: "var(--pe-font-size-sm)", color: "var(--pe-muted-foreground)" }}>px</span>
          </div>
          <div className="prop-row">
            <span className="prop-label">Y:</span>
            <input type="number" className="prop-input" value={t.y} disabled={!s.hasDocument} onChange={(e) => actions.setTransform({ y: Number(e.target.value) })} />
            <span style={{ fontSize: "var(--pe-font-size-sm)", color: "var(--pe-muted-foreground)" }}>px</span>
          </div>
        </div>
        <div style={{ width: 1, alignSelf: "stretch", background: "var(--pe-sidebar-border)", margin: "0 4px" }} />
        <div style={{ display: "flex", flexDirection: "column", gap: 4, flex: 1 }}>
          <div className="prop-row">
            <span className="prop-label">W:</span>
            <input type="number" className="prop-input" style={{ width: 52 }} value={t.w} disabled={!s.hasDocument} onChange={(e) => actions.setTransform({ w: Number(e.target.value) })} />
            <span style={{ fontSize: "var(--pe-font-size-sm)", color: "var(--pe-muted-foreground)" }}>px</span>
          </div>
          <div className="prop-row">
            <span className="prop-label">H:</span>
            <input type="number" className="prop-input" style={{ width: 52 }} value={t.h} disabled={!s.hasDocument} onChange={(e) => actions.setTransform({ h: Number(e.target.value) })} />
            <span style={{ fontSize: "var(--pe-font-size-sm)", color: "var(--pe-muted-foreground)" }}>px</span>
          </div>
        </div>
        <button
          className="tb-icon-btn"
          style={{ marginTop: 4, flexShrink: 0 }}
          title="锁定比例"
          onClick={() => actions.toggleLockRatio()}
        >
          <Link size={14} color={t.lockRatio ? "var(--pe-icon-active-color)" : "var(--pe-icon-color)"} />
        </button>
      </div>
      <div className="prop-row" style={{ marginTop: 6 }}>
        <span className="prop-label">旋转:</span>
        <input type="number" step={0.1} min={-360} max={360} className="prop-input" style={{ width: 56 }} value={t.rotation} disabled={!s.hasDocument} onChange={(e) => actions.setTransform({ rotation: Math.max(-360, Math.min(360, Number(e.target.value))) })} />
        <span style={{ fontSize: "var(--pe-font-size-sm)", color: "var(--pe-muted-foreground)" }}>deg</span>
        <div style={{ flex: 1 }} />
        <button className="prop-link-btn" disabled={!s.hasDocument} onClick={() => actions.setTransform({ rotation: 0 })}>重置</button>
      </div>
      <div className="prop-row" style={{ paddingLeft: 34 }}>
        <input type="range" min={-360} max={360} step={0.1} className="pe-range" style={{ flex: 1 }} value={t.rotation} disabled={!s.hasDocument} onChange={(e) => actions.setTransform({ rotation: Number(e.target.value) })} />
      </div>
    </Section>
  );
};

/* 调整 */
const AdjustSection: React.FC = () => {
  const s = useEditor();
  const a = s.adjustments;
  const fmt = (v: number) => (v > 0 ? `+${v}` : `${v}`);
  const hasAdj = a.brightness !== 0 || a.contrast !== 0 || a.saturation !== 0 || a.temperature !== 0;
  return (
    <Section title="调整" sectionKey="adjust">
      <div className="prop-row">
        <span className="prop-label" style={{ minWidth: 36 }}>亮度</span>
        <input type="range" min={-100} max={100} className="pe-range" style={{ flex: 1 }} value={a.brightness} disabled={!s.hasDocument} onChange={(e) => actions.setAdjustment({ brightness: Number(e.target.value) })} />
        <span className="prop-value">{fmt(a.brightness)}</span>
      </div>
      <div className="prop-row">
        <span className="prop-label" style={{ minWidth: 36 }}>对比度</span>
        <input type="range" min={-100} max={100} className="pe-range" style={{ flex: 1 }} value={a.contrast} disabled={!s.hasDocument} onChange={(e) => actions.setAdjustment({ contrast: Number(e.target.value) })} />
        <span className="prop-value">{fmt(a.contrast)}</span>
      </div>
      <div className="prop-row">
        <span className="prop-label" style={{ minWidth: 36 }}>饱和度</span>
        <input type="range" min={-100} max={100} className="pe-range" style={{ flex: 1 }} value={a.saturation} disabled={!s.hasDocument} onChange={(e) => actions.setAdjustment({ saturation: Number(e.target.value) })} />
        <span className="prop-value">{fmt(a.saturation)}</span>
      </div>
      <div className="prop-row">
        <span className="prop-label" style={{ minWidth: 36 }}>色温</span>
        <input type="range" min={-100} max={100} className="pe-range" style={{ flex: 1 }} value={a.temperature} disabled={!s.hasDocument} onChange={(e) => actions.setAdjustment({ temperature: Number(e.target.value) })} />
        <span className="prop-value">{fmt(a.temperature)}</span>
      </div>
      <div className="prop-row" style={{ marginTop: 6, justifyContent: "flex-end" }}>
        <button
          className="prop-link-btn"
          style={{ opacity: hasAdj ? 1 : 0.4, pointerEvents: hasAdj ? "auto" : "none" }}
          onClick={() => actions.bakeAdjustments()}
        >
          应用到像素
        </button>
        <button
          className="prop-link-btn"
          style={{ marginRight: 6, opacity: hasAdj ? 1 : 0.4, pointerEvents: hasAdj ? "auto" : "none" }}
          onClick={() => actions.setAdjustment({ brightness: 0, contrast: 0, saturation: 0, temperature: 0 })}
        >
          重置
        </button>
      </div>
    </Section>
  );
};

/* 色彩 */
const ColorSection: React.FC<{ fg: string; bg: string }> = ({ fg, bg }) => {
  const rgb = hexToRgb(fg);
  const hsl = rgbToHsl(rgb.r, rgb.g, rgb.b);
  return (
    <Section title="色彩" sectionKey="color">
      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 12 }}>
        <div
          className="pe-swatch-wrap"
          style={{ position: "relative", width: 30, height: 30, flexShrink: 0 }}
        >
          <div className="swatch-bg" style={{ background: bg }} title="背景色" />
          <div className="swatch-fg" style={{ background: fg }} title="前景色" />
          <input
            type="color"
            className="pe-color-input pe-color-input-bg"
            value={/^#[0-9a-fA-F]{6}$/.test(bg) ? bg : "#ffffff"}
            onChange={(e) => actions.setBgColor(e.target.value.toUpperCase())}
            title="点击选择背景色"
          />
          <input
            type="color"
            className="pe-color-input pe-color-input-fg"
            value={/^#[0-9a-fA-F]{6}$/.test(fg) ? fg : "#000000"}
            onChange={(e) => actions.setFgColor(e.target.value.toUpperCase())}
            title="点击选择前景色"
          />
        </div>
        <button className="tb-icon-btn" style={{ flexShrink: 0 }} title="交换前景/背景色" onClick={() => actions.swapColors()}>
          <Repeat size={14} color="var(--pe-muted-foreground)" />
        </button>
        <input
          type="text"
          className="prop-input"
          style={{ width: 76, fontFamily: "var(--pe-font-mono)", textAlign: "left", paddingLeft: 4 }}
          value={fg}
          onChange={(e) => actions.setFgColor(e.target.value)}
        />
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 16, marginBottom: 4, fontSize: "var(--pe-font-size-sm)", fontFamily: "var(--pe-font-mono)", color: "var(--pe-foreground)" }}>
        <span>R: <strong style={{ color: "var(--pe-danger)" }}>{rgb.r}</strong></span>
        <span>G: <strong style={{ color: "var(--pe-success)" }}>{rgb.g}</strong></span>
        <span>B: <strong style={{ color: "var(--pe-info)" }}>{rgb.b}</strong></span>
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 12, fontSize: "var(--pe-font-size-sm)", fontFamily: "var(--pe-font-mono)", color: "var(--pe-foreground)" }}>
        <span>H: <strong>{hsl.h}</strong></span>
        <span>S: <strong>{hsl.s}%</strong></span>
        <span>L: <strong>{hsl.l}%</strong></span>
      </div>
    </Section>
  );
};

/* 信息 */
const InfoSection: React.FC = () => {
  const s = useEditor();
  const sizeKB = s.hasDocument
    ? Math.round((s.docWidth * s.docHeight * 4) / 1024)
    : 0;
  const sizeText =
    sizeKB > 1024 ? `${(sizeKB / 1024).toFixed(2)} MB` : `${sizeKB} KB`;
  const rows: [string, string][] = s.hasDocument
    ? [
        ["文件", s.tabs.find((t) => t.id === s.activeTabId)?.name || "未命名"],
        ["尺寸", `${s.docWidth} x ${s.docHeight}`],
        ["图层数", `${s.layers.length}`],
        ["历史步数", `${s.history.length}`],
        ["色彩模式", "RGB / 8 bit"],
        ["原始大小", sizeText],
      ]
    : [
        ["文件", "未加载"],
        ["尺寸", "-"],
        ["色彩模式", "-"],
      ];
  return (
    <Section title="信息" sectionKey="info">
      {rows.map(([k, v]) => (
        <div className="info-row" key={k}>
          <span className="info-key">{k}</span>
          <span className="info-val" title={v}>{v}</span>
        </div>
      ))}
    </Section>
  );
};

export default RightSidebar;