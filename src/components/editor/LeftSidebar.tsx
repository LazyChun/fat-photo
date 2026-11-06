/*
 * 左侧栏:工具条 + 图层面板 + 历史记录面板
 * 作为主侧边栏(ControlMenusPage)的内容，与设计稿左侧栏一致
 */
import React, { useEffect, useRef, useState } from "react";
import ReactDOM from "react-dom";
import {
  Move,
  Hand,
  Crop,
  Paintbrush,
  Eraser,
  Type,
  Square,
  Circle,
  Minus,
  Pipette,
  Crosshair,
  Ruler,
  Stamp,
  ChevronDown,
  Plus,
  Eye,
  EyeOff,
  Unlock,
  Lock,
  Copy,
  Trash2,
  Lasso,
  Spline,
  Magnet,
  Wand2,
  SquareDashedMousePointer,
  Brush,
  Triangle,
  Hexagon,
  Star,
  PaintBucket,
  type LucideIcon,
} from "lucide-react";
import {
  useEditor,
  actions,
  TOOLS,
  TOOL_GROUP_ORDER,
  toolsInGroup,
  type ToolGroupId,
  type ToolMeta,
  BLEND_MODES,
} from "store";

const ICON_SIZE = 16;

const LeftSidebar: React.FC = () => {
  const s = useEditor();

  // 图层右键菜单状态：null 表示关闭，否则记录菜单坐标与目标图层 id
  const [ctxMenu, setCtxMenu] = useState<{
    x: number;
    y: number;
    layerId: string;
  } | null>(null);
  const ctxMenuRef = useRef<HTMLDivElement>(null);

  // 拖拽排序状态：dragLayerId = 正在拖动的图层；dropTarget/dropPosition 用于绘制指示线
  const [dragLayerId, setDragLayerId] = useState<string | null>(null);
  const [dropTarget, setDropTarget] = useState<{
    id: string;
    position: "before" | "after";
  } | null>(null);

  // 计算放置位置：根据光标在目标条目上半/下半决定 before/after
  const computeDropPosition = (
    e: React.DragEvent,
  ): "before" | "after" => {
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    return e.clientY - rect.top < rect.height / 2 ? "before" : "after";
  };

  const handleLayerDragStart = (
    e: React.DragEvent,
    layerId: string,
  ) => {
    setDragLayerId(layerId);
    e.dataTransfer.effectAllowed = "move";
    // 必须 set data 才能在某些浏览器触发 drop
    try {
      e.dataTransfer.setData("text/plain", layerId);
    } catch {
      // ignore
    }
  };

  const handleLayerDragOver = (
    e: React.DragEvent,
    layerId: string,
  ) => {
    if (!dragLayerId || dragLayerId === layerId) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    setDropTarget({ id: layerId, position: computeDropPosition(e) });
  };

  const handleLayerDragLeave = (layerId: string) => {
    // 仅在离开当前目标时清除,避免子元素切换导致闪烁
    setDropTarget((prev) => (prev && prev.id === layerId ? null : prev));
  };

  const handleLayerDrop = (
    e: React.DragEvent,
    layerId: string,
  ) => {
    e.preventDefault();
    e.stopPropagation();
    if (!dragLayerId || dragLayerId === layerId) {
      setDragLayerId(null);
      setDropTarget(null);
      return;
    }
    const position = computeDropPosition(e);
    actions.reorderLayer(dragLayerId, layerId, position);
    setDragLayerId(null);
    setDropTarget(null);
  };

  const handleLayerDragEnd = () => {
    setDragLayerId(null);
    setDropTarget(null);
  };

  // 外部点击 / ESC 关闭右键菜单
  useEffect(() => {
    if (!ctxMenu) return;
    const onDown = (e: MouseEvent) => {
      if (ctxMenuRef.current?.contains(e.target as Node)) return;
      setCtxMenu(null);
    };
    const onEsc = (e: KeyboardEvent) => {
      if (e.key === "Escape") setCtxMenu(null);
    };
    window.addEventListener("mousedown", onDown);
    window.addEventListener("keydown", onEsc);
    return () => {
      window.removeEventListener("mousedown", onDown);
      window.removeEventListener("keydown", onEsc);
    };
  }, [ctxMenu]);

  const handleLayerContextMenu = (
    e: React.MouseEvent,
    layerId: string,
  ) => {
    e.preventDefault();
    e.stopPropagation();
    // 避免菜单超出视口右下角
    const menuWidth = 160;
    const menuHeight = 40;
    const x = Math.min(e.clientX, window.innerWidth - menuWidth - 4);
    const y = Math.min(e.clientY, window.innerHeight - menuHeight - 4);
    setCtxMenu({ x, y, layerId });
  };

  const handleDeleteLayer = () => {
    if (ctxMenu && s.layers.length > 1) {
      actions.removeLayer(ctxMenu.layerId);
    }
    setCtxMenu(null);
  };

  return (
    <div
      className="pe-editor"
      style={{
        display: "flex",
        flexDirection: "column",
        height: "100%",
        width: "100%",
        background: "var(--pe-sidebar)",
        borderRight: "1px solid var(--pe-sidebar-border)",
        overflow: "hidden",
      }}
    >
      {/* ===== 水平工具条 ===== */}
      <div
        className="no-scrollbar"
        style={{
          minHeight: 36,
          background: "var(--pe-toolbar-bg)",
          borderBottom: "1px solid var(--pe-sidebar-border)",
          display: "flex",
          alignItems: "center",
          gap: 4,
          padding: "4px 8px",
          flexShrink: 0,
          overflowX: "auto",
          flexWrap: "wrap",
          position: "relative",
          zIndex: 10,
        }}
      >
        {TOOL_GROUP_ORDER.map((gid) => (
          <ToolGroupButton key={gid} groupId={gid} activeTool={s.activeTool} />
        ))}
      </div>

      {/* ===== 图层面板 ===== */}
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          minHeight: 0,
          flex: "1 1 0",
        }}
      >
        <div
          style={{
            height: 24,
            background: "var(--pe-panel-header)",
            borderBottom: "1px solid var(--pe-sidebar-border)",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            padding: "0 8px",
            flexShrink: 0,
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
            <ChevronDown size={12} color="var(--pe-panel-header-fg)" />
            <span
              style={{
                fontSize: "var(--pe-font-size-md)",
                fontWeight: 600,
                color: "var(--pe-panel-header-fg)",
              }}
            >
              图层
            </span>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 2 }}>
            <button
              className="tb-icon-btn"
              style={{ width: 18, height: 18 }}
              title="复制当前图层"
              disabled={!s.hasDocument}
              onClick={() =>
                s.activeLayerId && actions.duplicateLayer(s.activeLayerId)
              }
            >
              <Copy size={13} />
            </button>
            <button
              className="tb-icon-btn"
              style={{ width: 18, height: 18 }}
              title="删除当前图层"
              disabled={!s.hasDocument || s.layers.length <= 1}
              onClick={() =>
                s.activeLayerId && actions.removeLayer(s.activeLayerId)
              }
            >
              <Trash2 size={13} />
            </button>
            <button
              className="tb-icon-btn"
              style={{ width: 18, height: 18 }}
              title="新建图层"
              disabled={!s.hasDocument}
              onClick={() => actions.addLayer()}
            >
              <Plus size={14} />
            </button>
          </div>
        </div>
        <div
          className="pe-scroll"
          data-scroll-region="primary"
          style={{ flex: 1, overflowY: "auto" }}
        >
          {!s.hasDocument ? (
            <div
              style={{
                padding: "16px 12px",
                fontSize: "var(--pe-font-size-sm)",
                color: "var(--pe-muted-foreground)",
                textAlign: "center",
              }}
            >
              请先打开或新建文档
            </div>
          ) : (
            s.layers.map((layer) => {
              // 文字/形状图层显示对应矢量图标，普通像素图层显示缩略图
              const isVector = layer.kind === "text" || layer.kind === "shape";
              // 形状图层的子类型图标(按图层名匹配)
              const shapeIcon =
                layer.kind === "shape"
                  ? SHAPE_LAYER_ICON[layer.name] ?? Square
                  : null;
              const VectorIcon =
                layer.kind === "text" ? Type : shapeIcon;
              const isDragging = dragLayerId === layer.id;
              const dropPos =
                dropTarget && dropTarget.id === layer.id
                  ? dropTarget.position
                  : null;
              return (
              <div
                key={layer.id}
                className={
                  `layer-item${s.activeLayerId === layer.id ? " active-layer" : ""}` +
                  `${isDragging ? " layer-dragging" : ""}` +
                  `${dropPos === "before" ? " layer-drop-before" : ""}` +
                  `${dropPos === "after" ? " layer-drop-after" : ""}`
                }
                draggable
                onDragStart={(e) => handleLayerDragStart(e, layer.id)}
                onDragOver={(e) => handleLayerDragOver(e, layer.id)}
                onDragLeave={() => handleLayerDragLeave(layer.id)}
                onDrop={(e) => handleLayerDrop(e, layer.id)}
                onDragEnd={handleLayerDragEnd}
                onClick={() => actions.selectLayer(layer.id)}
                onContextMenu={(e) => handleLayerContextMenu(e, layer.id)}
                onDoubleClick={() => {
                  // 双击文字图层 → 进入就地编辑;双击形状图层 → 选中并切换到形状工具
                  if (layer.kind === "text") {
                    actions.requestTextEdit(layer.id);
                  } else if (layer.kind === "shape") {
                    actions.requestShapeEdit(layer.id);
                  }
                }}
                title={
                  isVector
                    ? `${layer.name} · 双击编辑`
                    : layer.name
                }
              >
                {isVector && VectorIcon ? (
                  <div
                    className="layer-thumb"
                    style={{
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      background: "var(--pe-card)",
                      border: "1px solid var(--pe-sidebar-border)",
                    }}
                  >
                    <VectorIcon size={13} color="var(--pe-foreground)" />
                  </div>
                ) : (
                  <div
                    className="layer-thumb"
                    style={{ background: layer.thumb }}
                  />
                )}
                <span
                  className="layer-name"
                  style={
                    s.activeLayerId === layer.id
                      ? { fontWeight: 500 }
                      : undefined
                  }
                >
                  {layer.name}
                </span>
                <button
                  className={`layer-icon-btn${layer.visible ? "" : " hidden-eye"}`}
                  title={layer.visible ? "隐藏" : "显示"}
                  draggable={false}
                  onClick={(e) => {
                    e.stopPropagation();
                    actions.toggleLayerVisible(layer.id);
                  }}
                >
                  {layer.visible ? <Eye size={13} /> : <EyeOff size={13} />}
                </button>
                <button
                  className="layer-icon-btn"
                  title={layer.locked ? "解锁" : "锁定"}
                  draggable={false}
                  onClick={(e) => {
                    e.stopPropagation();
                    actions.toggleLayerLock(layer.id);
                  }}
                >
                  {layer.locked ? <Lock size={13} /> : <Unlock size={13} />}
                </button>
              </div>
              );
            })
          )}
        </div>
        <div
          style={{
            borderTop: "1px solid var(--pe-sidebar-border)",
            padding: "6px 10px",
            flexShrink: 0,
          }}
        >
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              marginBottom: 4,
            }}
          >
            <span
              style={{
                fontSize: "var(--pe-font-size-sm)",
                color: "var(--pe-sidebar-fg)",
              }}
            >
              不透明度:
            </span>
            <span
              style={{
                fontSize: "var(--pe-font-size-sm)",
                color: "var(--pe-foreground)",
                fontFamily: "var(--pe-font-mono)",
              }}
            >
              {s.layerOpacity}%
            </span>
          </div>
          <input
            type="range"
            min={0}
            max={100}
            value={s.layerOpacity}
            className="pe-range"
            style={{ width: "100%" }}
            onChange={(e) => actions.setLayerOpacity(Number(e.target.value))}
          />
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              marginTop: 8,
            }}
          >
            <span
              style={{
                fontSize: "var(--pe-font-size-sm)",
                color: "var(--pe-sidebar-fg)",
              }}
            >
              模式:
            </span>
            <select
              className="sb-select"
              value={s.layerBlendMode}
              onChange={(e) => actions.setLayerBlendMode(e.target.value)}
            >
              {BLEND_MODES.map((m) => (
                <option key={m} value={m}>
                  {m}
                </option>
              ))}
            </select>
          </div>
        </div>
      </div>

      {/* ===== 可拖拽分隔条(视觉) ===== */}
      <div
        style={{
          height: 4,
          background: "var(--pe-sidebar-border)",
          cursor: "row-resize",
          flexShrink: 0,
        }}
      />

      {/* ===== 历史记录面板 ===== */}
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          flex: "0 0 200px",
          minHeight: 120,
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
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
            <ChevronDown size={12} color="var(--pe-panel-header-fg)" />
            <span
              style={{
                fontSize: "var(--pe-font-size-md)",
                fontWeight: 600,
                color: "var(--pe-panel-header-fg)",
              }}
            >
              历史记录
            </span>
          </div>
        </div>
        <div
          className="pe-scroll"
          data-scroll-region="primary"
          style={{ flex: 1, overflowY: "auto" }}
        >
          {s.history.length === 0 ? (
            <div
              style={{
                padding: "16px 12px",
                fontSize: "var(--pe-font-size-sm)",
                color: "var(--pe-muted-foreground)",
                textAlign: "center",
              }}
            >
              暂无历史记录
            </div>
          ) : (
            s.history.slice().reverse().map((h) => (
              <div
                key={h.id}
                className={`history-item${s.currentHistoryId === h.id ? " current-state" : ""}`}
                onClick={() => actions.selectHistory(h.id)}
              >
                <span className="history-step">{h.step}</span>
                <span className="history-label">{h.label}</span>
              </div>
            ))
          )}
        </div>
      </div>

      {/* ===== 图层右键菜单(Portal 渲染到 body) ===== */}
      {ctxMenu &&
        ReactDOM.createPortal(
          <div
            className="pe-editor"
            style={{
              position: "fixed",
              top: ctxMenu.y,
              left: ctxMenu.x,
              zIndex: 99999,
              height: "auto",
              width: "auto",
            }}
          >
            <div
              ref={ctxMenuRef}
              className="tool-flyout"
              role="menu"
              style={{ minWidth: 140 }}
            >
              <button
                className="tool-flyout-item"
                disabled={s.layers.length <= 1}
                title={
                  s.layers.length <= 1
                    ? "至少保留一个图层"
                    : "删除该图层"
                }
                onClick={handleDeleteLayer}
              >
                <Trash2 size={14} />
                <span>删除图层</span>
              </button>
            </div>
          </div>,
          document.body,
        )}
    </div>
  );
};

/* 工具图标名 → lucide 组件映射 */
const iconMap: Record<string, LucideIcon> = {
  Move,
  Hand,
  Crop,
  Paintbrush,
  Eraser,
  PaintBucket,
  Type,
  Square,
  Circle,
  Triangle,
  Hexagon,
  Star,
  Minus,
  Pipette,
  // 吸管工具组
  Crosshair,
  Ruler,
  // 仿制图章
  Stamp,
  // 套索工具组
  Lasso,
  Spline,
  Magnet,
  // 对象选择工具组
  ObjectSelect: SquareDashedMousePointer,
  BrushSelect: Brush,
  Wand2,
};

/** 形状图层名称 → lucide 图标(用于图层面板缩略图) */
const SHAPE_LAYER_ICON: Record<string, LucideIcon> = {
  矩形: Square,
  椭圆: Circle,
  圆形: Circle,
  三角形: Triangle,
  多边形: Hexagon,
  星形: Star,
  直线: Minus,
};

/**
 * 工具组按钮：
 * - 单工具组(group === undefined 或仅一个工具)：直接渲染为普通按钮
 * - 多工具组：渲染为带右下角小箭头的按钮
 *   - 左键单击：切换为组内「最近激活的工具」(即当前 activeTool 若在本组则不变，否则切到组首工具)
 *   - 长按 / 右键 / 点击箭头：弹出飞出菜单切换组内其他工具
 */
const ToolGroupButton: React.FC<{
  groupId: ToolGroupId;
  activeTool: string;
}> = ({ groupId, activeTool }) => {
  const tools = toolsInGroup(groupId);
  // 组内当前激活工具（若 activeTool 不在本组，回退到第一个）
  const current =
    tools.find((t) => t.id === activeTool) ?? tools[0];
  const isGroupActive = tools.some((t) => t.id === activeTool);
  const isMulti = tools.length > 1;

  const [open, setOpen] = useState(false);
  const btnRef = useRef<HTMLButtonElement>(null);
  const popRef = useRef<HTMLDivElement>(null);
  const pressTimer = useRef<number | null>(null);

  // 弹框位置（用于 Portal 渲染到 body）
  const [popStyle, setPopStyle] = useState<React.CSSProperties | null>(null);

  const openFlyout = () => {
    if (btnRef.current) {
      const rect = btnRef.current.getBoundingClientRect();
      setPopStyle({
        position: "fixed",
        top: rect.bottom + 2,
        left: rect.left,
        zIndex: 99999,
        minWidth: 160,
      });
    }
    setOpen(true);
  };

  // 外部点击关闭
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (
        btnRef.current?.contains(e.target as Node) ||
        popRef.current?.contains(e.target as Node)
      )
        return;
      setOpen(false);
    };
    const onEsc = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("mousedown", onDown);
    window.addEventListener("keydown", onEsc);
    return () => {
      window.removeEventListener("mousedown", onDown);
      window.removeEventListener("keydown", onEsc);
    };
  }, [open]);

  const Icon = iconMap[current.icon] ?? Move;

  const startPress = () => {
    if (!isMulti) return;
    pressTimer.current = window.setTimeout(() => {
      openFlyout();
    }, 350);
  };
  const cancelPress = () => {
    if (pressTimer.current !== null) {
      window.clearTimeout(pressTimer.current);
      pressTimer.current = null;
    }
  };

  const handleMainClick = () => {
    cancelPress();
    if (isMulti && !isGroupActive) {
      actions.setActiveTool(current.id);
    } else if (isGroupActive) {
      actions.setActiveTool(current.id);
    } else {
      actions.setActiveTool(current.id);
    }
  };

  const handleContextMenu = (e: React.MouseEvent) => {
    if (!isMulti) return;
    e.preventDefault();
    openFlyout();
  };

  const handleArrowClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (isMulti) openFlyout();
  };

  const pick = (t: ToolMeta) => {
    actions.setActiveTool(t.id);
    setOpen(false);
  };

  return (
    <div style={{ position: "relative", flexShrink: 0 }}>
      <button
        ref={btnRef}
        className={`tool-strip-btn${isGroupActive ? " active" : ""}`}
        style={{
          position: "relative",
          paddingRight: isMulti ? 10 : undefined,
        }}
        title={`${current.title} (${current.shortcut})${
          isMulti ? " · 长按或点箭头展开同组工具" : ""
        }`}
        onClick={handleMainClick}
        onContextMenu={handleContextMenu}
        onMouseDown={startPress}
        onMouseUp={cancelPress}
        onMouseLeave={cancelPress}
      >
        <Icon size={ICON_SIZE} />
        {isMulti && (
          <span
            className="tool-strip-group-arrow"
            onClick={handleArrowClick}
            title="展开同组工具"
            style={{
              position: "absolute",
              right: 0,
              bottom: 0,
              width: 10,
              height: 10,
              display: "flex",
              alignItems: "flex-end",
              justifyContent: "center",
              cursor: "pointer",
              color: isGroupActive
                ? "var(--pe-icon-active-color)"
                : "var(--pe-muted-foreground)",
            }}
          >
            <ChevronDown size={10} strokeWidth={2.5} />
          </span>
        )}
      </button>
      {isMulti && open && popStyle &&
        ReactDOM.createPortal(
          <div className="pe-editor" style={{ ...popStyle, height: "auto", width: "auto" }}>
            <div
              ref={popRef}
              className="tool-flyout"
              role="menu"
              style={{ minWidth: 160 }}
            >
              {tools.map((t) => {
                const TIcon = iconMap[t.icon] ?? Move;
                const active = t.id === activeTool;
                return (
                  <button
                    key={t.id}
                    className={`tool-flyout-item${active ? " active" : ""}`}
                    onClick={() => pick(t)}
                    title={`${t.title} (${t.shortcut})`}
                  >
                    <TIcon size={14} />
                    <span>{t.title}</span>
                    <span className="tool-flyout-shortcut">{t.shortcut}</span>
                  </button>
                );
              })}
            </div>
          </div>,
          document.body,
        )}
    </div>
  );
};

export default LeftSidebar;
