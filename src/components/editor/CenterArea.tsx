/*
 * 中间区:标签栏 + 工具栏 + 画布(标尺 + 棋盘格 + 图片 + 选区)
 * 作为工作区(WorkPage)的中心列
 *
 * 画布交互(参考 Photoshop):
 * - 移动工具(V): 拖动移动当前图层；抓手(H)/空格/中键: 平移视图
 * - 画笔(B)/橡皮(E): 软笔刷(硬度/流量)，笔刷圆圈光标
 * - 文字(T): 画布内就地编辑，Ctrl+Enter/失焦提交，Esc 取消
 * - 形状(U): 矩形/椭圆/圆形/三角形/多边形/星形/直线，支持填充
 * - 吸管(I): 拾取前景色；滚轮缩放；快捷键切换工具
 *
 * 吸管工具组(I): 重复按 I 循环切换
 * - 吸管(I): 点击画布拾取前景色
 * - 颜色取样器(I): 点击放置取样点(最多 4 个)，Alt+点击删除；overlay 显示标记
 * - 标尺(I): 拖动测量距离/角度/W/H；overlay 显示测量线
 *
 * 仿制图章(S):
 * - Alt+点击设置源点，拖动仿制
 * - 支持: 大小/硬度/不透明度/流量/对齐/所有图层取样
 * - overlay: 源点十字标记 + 笔刷圆圈光标
 *
 * 选区工具组(L/W):
 * - 套索(L): 自由拖拽轨迹 → 闭合多边形选区
 * - 多边形套索(L): 单击加点，双击/Enter/回到起点 闭合
 * - 磁性套索(L): 拖拽轨迹沿边缘对齐自动取点
 * - 对象选择(W): 矩形/套索拖拽（按 lassoMode 切换）
 * - 快速选择(W): 笔刷涂抹添加选区
 * - 魔棒(W): 点击同色区域 flood fill
 * 修饰键: Shift=添加 / Alt=减去 / Shift+Alt=交集
 */
import React, {
  useCallback,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import {
  Image as ImageIcon,
  FileImage,
  X,
  Plus,
  PanelRight,
  Undo2,
  Redo2,
  RotateCcw,
  FolderOpen,
  Download,
  Crop as CropIcon,
  FilePlus,
  ZoomIn,
  ZoomOut,
  Maximize,
  Bold,
  Save,
  FileJson,
  ImagePlus,
} from "lucide-react";
import {
  useEditor,
  actions,
  BRUSH_MODES,
  ZOOM_OPTIONS,
  isShapeTool,
  SHAPE_KIND_TOOL,
  type Adjustments,
  type ToolId,
  type SelectionOp,
  type ShapeKind,
} from "store";
import { cursorActions } from "../../store/cursorStore";
import {
  engine,
  buildFilterString,
  TEXT_FONTS,
  type SampleSource,
  type EngineLayer,
} from "../../editor/engine";

/* 计算图片 CSS filter：基于调整值 */
const buildFilter = (a: Adjustments): string => buildFilterString(a);

interface Pt {
  x: number;
  y: number;
}

const TRANSFORM_HANDLES: Array<{
  name: string;
  cursor: string;
  local: (
    bbox: { x: number; y: number; w: number; h: number },
    center: { x: number; y: number },
  ) => { x: number; y: number };
}> = [
  {
    name: "nw",
    cursor: "nwse-resize",
    local: (bbox, c) => ({ x: bbox.x, y: bbox.y }),
  },
  {
    name: "n",
    cursor: "ns-resize",
    local: (bbox, c) => ({ x: c.x, y: bbox.y }),
  },
  {
    name: "ne",
    cursor: "nesw-resize",
    local: (bbox, c) => ({ x: bbox.x + bbox.w, y: bbox.y }),
  },
  {
    name: "e",
    cursor: "ew-resize",
    local: (bbox, c) => ({ x: bbox.x + bbox.w, y: c.y }),
  },
  {
    name: "se",
    cursor: "nwse-resize",
    local: (bbox, c) => ({ x: bbox.x + bbox.w, y: bbox.y + bbox.h }),
  },
  {
    name: "s",
    cursor: "ns-resize",
    local: (bbox, c) => ({ x: c.x, y: bbox.y + bbox.h }),
  },
  {
    name: "sw",
    cursor: "nesw-resize",
    local: (bbox, c) => ({ x: bbox.x, y: bbox.y + bbox.h }),
  },
  {
    name: "w",
    cursor: "ew-resize",
    local: (bbox, c) => ({ x: bbox.x, y: c.y }),
  },
];

/* 文字编辑框的 8 个拉伸手柄(相对编辑框容器定位) */
const TEXT_BOX_HANDLES: Array<{
  name: string;
  cursor: string;
  style: React.CSSProperties;
}> = [
  { name: "nw", cursor: "nwse-resize", style: { left: -4, top: -4 } },
  {
    name: "n",
    cursor: "ns-resize",
    style: { left: "50%", top: -4, marginLeft: -4 },
  },
  { name: "ne", cursor: "nesw-resize", style: { right: -4, top: -4 } },
  {
    name: "e",
    cursor: "ew-resize",
    style: { right: -4, top: "50%", marginTop: -4 },
  },
  { name: "se", cursor: "nwse-resize", style: { right: -4, bottom: -4 } },
  {
    name: "s",
    cursor: "ns-resize",
    style: { left: "50%", bottom: -4, marginLeft: -4 },
  },
  { name: "sw", cursor: "nesw-resize", style: { left: -4, bottom: -4 } },
  {
    name: "w",
    cursor: "ew-resize",
    style: { left: -4, top: "50%", marginTop: -4 },
  },
];

interface TextEditState {
  id: number;
  /** 编辑中的文字图层 id；null = 新建文字图层 */
  layerId: string | null;
  /** 文本框左上角(未旋转)在文档坐标系中的位置 */
  x: number;
  y: number;
  /** 文本框宽/高(文档 px)，可拖拽手柄调整 */
  w: number;
  h: number;
  /** 旋转角度(度, 绕文本框中心) */
  rotation: number;
  value: string;
}

const CenterArea: React.FC = () => {
  const s = useEditor();
  return (
    <div
      className="pe-editor"
      style={{
        display: "flex",
        flexDirection: "column",
        flex: 1,
        minWidth: 0,
        minHeight: 0,
      }}
    >
      <TabBar />
      <EditorToolbar />
      <CanvasArea filter={buildFilter(s.adjustments)} zoom={s.zoom} />
    </div>
  );
};

/* ============ 标签栏 ============ */
const TabBar: React.FC = () => {
  const s = useEditor();
  return (
    <div
      style={{
        height: 35,
        background: "var(--pe-tab-inactive-bg)",
        borderBottom: "1px solid var(--pe-tab-border)",
        display: "flex",
        alignItems: "flex-end",
        flexShrink: 0,
      }}
    >
      {s.tabs.map((tab) => {
        const active = tab.id === s.activeTabId;
        const Icon = tab.icon === "image" ? ImageIcon : FileImage;
        return (
          <div
            key={tab.id}
            className="tab-row"
            style={{
              height: active ? 35 : 34,
              background: active
                ? "var(--pe-tab-active-bg)"
                : "var(--pe-tab-inactive-bg)",
              borderTop: active ? "2px solid var(--pe-primary)" : "none",
              borderRight: "1px solid var(--pe-tab-border)",
              padding: "0 12px",
              display: "flex",
              alignItems: "center",
              gap: 6,
              cursor: "pointer",
              position: "relative",
            }}
            onClick={() => actions.selectTab(tab.id)}
          >
            <Icon
              size={14}
              color={
                active ? "var(--pe-tab-active-fg)" : "var(--pe-tab-inactive-fg)"
              }
            />
            <span
              style={{
                fontSize: "var(--pe-font-size-md)",
                color: active
                  ? "var(--pe-tab-active-fg)"
                  : "var(--pe-tab-inactive-fg)",
                whiteSpace: "nowrap",
                display: "flex",
                alignItems: "center",
                gap: 4,
              }}
            >
              {tab.name}
              {tab.dirty && (
                <span
                  title="有未保存的修改"
                  style={{
                    color: "#E53935",
                    fontWeight: 700,
                    fontSize: "var(--pe-font-size-md)",
                    lineHeight: 1,
                    userSelect: "none",
                  }}
                >
                  *
                </span>
              )}
            </span>
            <button
              className="tab-close-btn"
              style={{ opacity: active ? 0.5 : 0 }}
              onClick={(e) => {
                e.stopPropagation();
                actions.closeTab(tab.id);
              }}
            >
              <X
                size={12}
                color={
                  active
                    ? "var(--pe-tab-active-fg)"
                    : "var(--pe-tab-inactive-fg)"
                }
              />
            </button>
          </div>
        );
      })}
      <div
        style={{
          height: 35,
          width: 35,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          cursor: "pointer",
        }}
        title="打开文件"
        onClick={() => actions.openFileDialog()}
      >
        <Plus size={14} color="var(--pe-tab-inactive-fg)" />
      </div>
      <div style={{ flex: 1 }} />
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 4,
          paddingRight: 8,
          paddingBottom: 4,
        }}
      >
        <button
          className="tb-icon-btn"
          title="打开图片"
          onClick={() => actions.openFileDialog()}
        >
          <FolderOpen size={14} color="var(--pe-muted-foreground)" />
        </button>
        <button
          className="tb-icon-btn"
          title="打开工程文件 (.fpproj)"
          onClick={() => actions.openProjectFile()}
        >
          <FileJson size={14} color="var(--pe-muted-foreground)" />
        </button>
        <button
          className="tb-icon-btn"
          title="导入图片为新图层 (支持拖拽 / Ctrl+V 粘贴)"
          onClick={() => actions.importImageFileDialog()}
          disabled={!s.hasDocument}
        >
          <ImagePlus size={14} color="var(--pe-muted-foreground)" />
        </button>
        <button
          className="tb-icon-btn"
          title="新建空白文档"
          onClick={() => actions.newBlankDocument()}
        >
          <FilePlus size={14} color="var(--pe-muted-foreground)" />
        </button>
        <button
          className="tb-icon-btn"
          title="保存工程文件 (.fpproj) — 含图层/历史/选区"
          onClick={() => actions.saveProject()}
          disabled={!s.hasDocument}
        >
          <Save size={14} color="var(--pe-muted-foreground)" />
        </button>
        <button
          className="tb-icon-btn"
          title="导出图片"
          onClick={() => actions.exportCurrent()}
          disabled={!s.hasDocument}
        >
          <Download size={14} color="var(--pe-muted-foreground)" />
        </button>
        <select
          className="sb-select"
          style={{ width: 72, marginLeft: 4, fontSize: 12 }}
          value={s.exportFormat}
          onChange={(e) => actions.setExportFormat(e.target.value as "png" | "jpeg" | "webp" | "svg")}
          disabled={!s.hasDocument}
          title="导出格式"
        >
          <option value="png">PNG</option>
          <option value="jpeg">JPEG</option>
          <option value="webp">WebP</option>
          <option value="svg">SVG</option>
        </select>
        <select
          className="sb-select"
          style={{ width: 64, marginLeft: 4 }}
          value={ZOOM_OPTIONS.includes(s.zoom) ? String(s.zoom) : ""}
          onChange={(e) => {
            const v = e.target.value;
            if (v === "适合") actions.zoomFit();
            else actions.setZoom(Number(v));
          }}
        >
          {ZOOM_OPTIONS.map((z) => (
            <option key={z} value={z}>
              {z}%
            </option>
          ))}
          {!ZOOM_OPTIONS.includes(s.zoom) && (
            <option value={s.zoom}>{s.zoom}%</option>
          )}
          <option value="适合">适合</option>
        </select>
        <button
          className="tb-icon-btn"
          title={s.rightSidebarVisible ? "隐藏右侧面板" : "显示右侧面板"}
          onClick={() => actions.toggleRightSidebar()}
          style={!s.rightSidebarVisible ? { background: "var(--pe-toolbar-active)" } : undefined}
        >
          <PanelRight size={14} color="var(--pe-muted-foreground)" />
        </button>
      </div>
    </div>
  );
};

/* ============ 工具栏(随工具切换的上下文选项) ============ */
const EditorToolbar: React.FC = () => {
  const s = useEditor();
  const tool = s.activeTool;
  const sep = {
    width: 1,
    height: 16,
    background: "var(--pe-toolbar-border)",
    flexShrink: 0,
  };
  const hint = (text: string) => (
    <span
      style={{
        fontSize: "var(--pe-font-size-sm)",
        color: "var(--pe-muted-foreground)",
        whiteSpace: "nowrap",
      }}
    >
      {text}
    </span>
  );
  return (
    <div
      className="no-scrollbar"
      style={{
        height: 32,
        background: "var(--pe-toolbar-bg)",
        borderBottom: "1px solid var(--pe-toolbar-border)",
        display: "flex",
        alignItems: "center",
        gap: 12,
        padding: "0 12px",
        flexShrink: 0,
        overflowX: "auto",
      }}
    >
      {/* ---- 画笔 / 橡皮 ---- */}
      {(tool === "paintbrush" || tool === "eraser") && (
        <>
          <SliderGroup
            label="大小:"
            min={1}
            max={300}
            value={s.brush.size}
            width={72}
            suffix="px"
            onChange={(v) => actions.setBrush({ size: v })}
          />
          <div style={sep} />
          <SliderGroup
            label="硬度:"
            min={0}
            max={100}
            value={s.brush.hardness}
            width={56}
            suffix="%"
            onChange={(v) => actions.setBrush({ hardness: v })}
          />
          <div style={sep} />
          <SliderGroup
            label="不透明度:"
            min={0}
            max={100}
            value={s.brush.opacity}
            width={56}
            suffix="%"
            onChange={(v) => actions.setBrush({ opacity: v })}
          />
          <div style={sep} />
          <SliderGroup
            label="流量:"
            min={0}
            max={100}
            value={s.brush.flow}
            width={56}
            suffix="%"
            onChange={(v) => actions.setBrush({ flow: v })}
          />
          {tool === "paintbrush" && (
            <>
              <div style={sep} />
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 4,
                  flexShrink: 0,
                }}
              >
                <span
                  style={{
                    fontSize: "var(--pe-font-size-sm)",
                    color: "var(--pe-foreground)",
                    whiteSpace: "nowrap",
                  }}
                >
                  模式:
                </span>
                <select
                  className="sb-select"
                  value={s.brush.mode}
                  onChange={(e) => actions.setBrush({ mode: e.target.value })}
                >
                  {BRUSH_MODES.map((m) => (
                    <option key={m} value={m}>
                      {m}
                    </option>
                  ))}
                </select>
              </div>
            </>
          )}
        </>
      )}
      {/* ---- 文字 ---- */}
      {tool === "type" && (
        <>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 4,
              flexShrink: 0,
            }}
          >
            <span
              style={{
                fontSize: "var(--pe-font-size-sm)",
                color: "var(--pe-foreground)",
                whiteSpace: "nowrap",
              }}
            >
              字体:
            </span>
            <select
              className="sb-select"
              style={{ fontFamily: s.text.fontFamily, minWidth: 110 }}
              value={s.text.fontFamily}
              onChange={(e) => {
                const fontFamily = e.target.value;
                actions.setText({ fontFamily });
                actions.updateActiveTextLayer({ fontFamily });
              }}
            >
              {TEXT_FONTS.map((f) => (
                <option key={f.label} value={f.value} style={{ fontFamily: f.value }}>
                  {f.label}
                </option>
              ))}
            </select>
          </div>
          <div style={sep} />
          <SliderGroup
            label="字号:"
            min={8}
            max={200}
            value={s.text.fontSize}
            width={72}
            suffix="px"
            onChange={(v) => actions.setText({ fontSize: v })}
          />
          <div style={sep} />
          <button
            className="tb-icon-btn"
            title="加粗"
            style={s.text.bold ? { background: "var(--pe-active)" } : undefined}
            onClick={() => actions.setText({ bold: !s.text.bold })}
          >
            <Bold
              size={14}
              color={
                s.text.bold
                  ? "var(--pe-icon-active-color)"
                  : "var(--pe-icon-color)"
              }
            />
          </button>
          <div style={sep} />
          {hint(
            "点击画布输入文字；点击已有文字可重新编辑；Ctrl+Enter 或失焦提交，Esc 取消",
          )}
        </>
      )}
      {/* ---- 形状 ---- */}
      {isShapeTool(tool) && (
        <>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 4,
              flexShrink: 0,
            }}
          >
            <span
              style={{
                fontSize: "var(--pe-font-size-sm)",
                color: "var(--pe-foreground)",
                whiteSpace: "nowrap",
              }}
            >
              形状:
            </span>
            <select
              className="sb-select"
              value={s.shape.kind}
              onChange={(e) => {
                const kind = e.target.value as ShapeKind;
                actions.setActiveTool(SHAPE_KIND_TOOL[kind]);
              }}
            >
              <option value="rect">矩形</option>
              <option value="ellipse">椭圆</option>
              <option value="circle">圆形</option>
              <option value="triangle">三角形</option>
              <option value="polygon">多边形</option>
              <option value="star">星形</option>
              <option value="line">直线</option>
            </select>
          </div>
          <div style={sep} />
          {(s.shape.kind === "polygon" || s.shape.kind === "star") && (
            <>
              <SliderGroup
                label="边数:"
                min={3}
                max={12}
                value={s.shape.sides}
                width={56}
                suffix=""
                onChange={(v) => actions.setShape({ sides: v })}
              />
              <div style={sep} />
            </>
          )}
          <SliderGroup
            label="粗细:"
            min={1}
            max={100}
            value={s.shape.lineWidth}
            width={56}
            suffix="px"
            onChange={(v) => actions.setShape({ lineWidth: v })}
          />
          <div style={sep} />
          <label
            style={{
              display: "flex",
              alignItems: "center",
              gap: 4,
              flexShrink: 0,
              cursor: "pointer",
            }}
          >
            <input
              type="checkbox"
              checked={s.shape.fill}
              onChange={(e) => actions.setShape({ fill: e.target.checked })}
              style={{ margin: 0 }}
            />
            <span
              style={{
                fontSize: "var(--pe-font-size-sm)",
                color: "var(--pe-foreground)",
                whiteSpace: "nowrap",
              }}
            >
              填充
            </span>
          </label>
          <div style={sep} />
          {hint("拖动以绘制形状；点击已有形状图层可重新编辑")}
        </>
      )}
      {/* ---- 仿制图章 ---- */}
      {tool === "cloneStamp" && (
        <>
          <SliderGroup
            label="大小:"
            min={1}
            max={300}
            value={s.cloneStamp.size}
            width={72}
            suffix="px"
            onChange={(v) => actions.setCloneStamp({ size: v })}
          />
          <div style={sep} />
          <SliderGroup
            label="硬度:"
            min={0}
            max={100}
            value={s.cloneStamp.hardness}
            width={56}
            suffix="%"
            onChange={(v) => actions.setCloneStamp({ hardness: v })}
          />
          <div style={sep} />
          <SliderGroup
            label="不透明度:"
            min={0}
            max={100}
            value={s.cloneStamp.opacity}
            width={56}
            suffix="%"
            onChange={(v) => actions.setCloneStamp({ opacity: v })}
          />
          <div style={sep} />
          <SliderGroup
            label="流量:"
            min={0}
            max={100}
            value={s.cloneStamp.flow}
            width={56}
            suffix="%"
            onChange={(v) => actions.setCloneStamp({ flow: v })}
          />
          <div style={sep} />
          <label
            style={{
              display: "flex",
              alignItems: "center",
              gap: 4,
              flexShrink: 0,
              cursor: "pointer",
            }}
          >
            <input
              type="checkbox"
              checked={s.cloneStamp.aligned}
              onChange={(e) =>
                actions.setCloneStamp({ aligned: e.target.checked })
              }
              style={{ margin: 0 }}
            />
            <span
              style={{
                fontSize: "var(--pe-font-size-sm)",
                color: "var(--pe-foreground)",
                whiteSpace: "nowrap",
              }}
            >
              对齐
            </span>
          </label>
          <div style={sep} />
          <label
            style={{
              display: "flex",
              alignItems: "center",
              gap: 4,
              flexShrink: 0,
              cursor: "pointer",
            }}
          >
            <input
              type="checkbox"
              checked={s.cloneStamp.sampleAllLayers}
              onChange={(e) =>
                actions.setCloneStamp({ sampleAllLayers: e.target.checked })
              }
              style={{ margin: 0 }}
            />
            <span
              style={{
                fontSize: "var(--pe-font-size-sm)",
                color: "var(--pe-foreground)",
                whiteSpace: "nowrap",
              }}
            >
              所有图层
            </span>
          </label>
          {s.cloneSource && (
            <>
              <div style={sep} />
              <button
                className="tb-icon-btn"
                title="清除源点"
                onClick={() => actions.clearCloneSource()}
              >
                <X size={14} />
              </button>
            </>
          )}
          <div style={sep} />
          {hint(
            s.cloneSource
              ? `源点: (${s.cloneSource.x}, ${s.cloneSource.y}) · Alt+点击重设 · 拖动仿制`
              : "Alt+点击设置源点，然后拖动仿制",
          )}
        </>
      )}
      {/* ---- 油漆桶 ---- */}
      {tool === "paintBucket" && (
        <>
          <label
            style={{
              display: "flex",
              alignItems: "center",
              gap: 4,
              flexShrink: 0,
              cursor: "pointer",
            }}
          >
            <span
              style={{
                fontSize: "var(--pe-font-size-sm)",
                color: "var(--pe-foreground)",
                whiteSpace: "nowrap",
              }}
            >
              填充:
            </span>
            <input
              type="color"
              value={s.paintBucket.color}
              onChange={(e) =>
                actions.setPaintBucket({ color: e.target.value })
              }
              style={{
                width: 28,
                height: 20,
                padding: 0,
                border: "1px solid var(--pe-border)",
                borderRadius: 3,
                cursor: "pointer",
                background: "none",
              }}
            />
          </label>
          <div style={sep} />
          <SliderGroup
            label="容差:"
            min={0}
            max={255}
            value={s.paintBucket.tolerance}
            width={72}
            suffix=""
            onChange={(v) => actions.setPaintBucket({ tolerance: v })}
          />
          <div style={sep} />
          <label
            style={{
              display: "flex",
              alignItems: "center",
              gap: 4,
              flexShrink: 0,
              cursor: "pointer",
            }}
          >
            <input
              type="checkbox"
              checked={s.paintBucket.contiguous}
              onChange={(e) =>
                actions.setPaintBucket({ contiguous: e.target.checked })
              }
              style={{ margin: 0 }}
            />
            <span
              style={{
                fontSize: "var(--pe-font-size-sm)",
                color: "var(--pe-foreground)",
                whiteSpace: "nowrap",
              }}
            >
              连续
            </span>
          </label>
          <div style={sep} />
          <label
            style={{
              display: "flex",
              alignItems: "center",
              gap: 4,
              flexShrink: 0,
              cursor: "pointer",
            }}
          >
            <input
              type="checkbox"
              checked={s.paintBucket.allLayers}
              onChange={(e) =>
                actions.setPaintBucket({ allLayers: e.target.checked })
              }
              style={{ margin: 0 }}
            />
            <span
              style={{
                fontSize: "var(--pe-font-size-sm)",
                color: "var(--pe-foreground)",
                whiteSpace: "nowrap",
              }}
            >
              所有图层
            </span>
          </label>
          <div style={sep} />
          <SliderGroup
            label="不透明度:"
            min={0}
            max={100}
            value={s.paintBucket.opacity}
            width={56}
            suffix="%"
            onChange={(v) => actions.setPaintBucket({ opacity: v })}
          />
          <div style={sep} />
          {hint("点击画布填充颜色区域")}
        </>
      )}
      {/* ---- 颜色取样器 ---- */}
      {tool === "colorSampler" && (
        <>
          {hint("点击放置取样点(最多 4 个) · Alt+点击删除最近取样点")}
          {s.colorSamples.length > 0 && (
            <>
              <div style={sep} />
              {s.colorSamples.map((sm, i) => (
                <div
                  key={sm.id}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 4,
                    flexShrink: 0,
                  }}
                >
                  <span
                    style={{
                      fontSize: "var(--pe-font-size-sm)",
                      color: "var(--pe-muted-foreground)",
                    }}
                  >
                    {i + 1}:
                  </span>
                  <span
                    style={{
                      width: 12,
                      height: 12,
                      background: sm.color,
                      border: "1px solid var(--pe-border)",
                      borderRadius: 2,
                      flexShrink: 0,
                    }}
                  />
                  <span
                    style={{
                      fontSize: "var(--pe-font-size-sm)",
                      color: "var(--pe-foreground)",
                      fontFamily: "var(--pe-font-mono)",
                    }}
                  >
                    {sm.color}
                  </span>
                </div>
              ))}
              <div style={sep} />
              <button
                className="tb-icon-btn"
                title="清除所有取样点"
                onClick={() => actions.clearColorSamples()}
              >
                <X size={14} />
              </button>
            </>
          )}
        </>
      )}
      {/* ---- 标尺 ---- */}
      {tool === "ruler" && (
        <>
          {s.ruler ? (
            <>
              {hint(
                `距离: ${Math.round(s.ruler.distance)} px · 角度: ${s.ruler.angle.toFixed(1)}° · W: ${Math.round(s.ruler.w)} · H: ${Math.round(s.ruler.h)}`,
              )}
              <div style={sep} />
              <button
                className="tb-icon-btn"
                title="清除测量"
                onClick={() => actions.setRuler(null)}
              >
                <X size={14} />
              </button>
            </>
          ) : (
            hint("拖动以测量距离和角度")
          )}
        </>
      )}
      {/* ---- 套索 / 多边形套索 ---- */}
      {(tool === "lasso" || tool === "polygonal-lasso") && (
        <>
          {hint(
            tool === "lasso"
              ? "拖动绘制选区 · Shift=添加 Alt=减去 Shift+Alt=交集"
              : "单击加点，双击/Enter/回到起点闭合 · Backspace 删除上一点 · Esc 取消",
          )}
          <SelectionButtons />
        </>
      )}
      {/* ---- 磁性套索 ---- */}
      {tool === "magnetic-lasso" && (
        <>
          <SliderGroup
            label="宽度:"
            min={1}
            max={40}
            value={s.selection.magneticWidth}
            width={56}
            suffix="px"
            onChange={(v) => actions.setSelectionSettings({ magneticWidth: v })}
          />
          <div style={sep} />
          <SliderGroup
            label="对比:"
            min={1}
            max={100}
            value={s.selection.magneticContrast}
            width={56}
            suffix="%"
            onChange={(v) =>
              actions.setSelectionSettings({ magneticContrast: v })
            }
          />
          <div style={sep} />
          <SliderGroup
            label="频率:"
            min={1}
            max={100}
            value={s.selection.magneticFrequency}
            width={56}
            suffix=""
            onChange={(v) =>
              actions.setSelectionSettings({ magneticFrequency: v })
            }
          />
          <div style={sep} />
          <label
            style={{
              display: "flex",
              alignItems: "center",
              gap: 4,
              flexShrink: 0,
              cursor: "pointer",
            }}
          >
            <input
              type="checkbox"
              checked={s.selection.allLayers}
              onChange={(e) =>
                actions.setSelectionSettings({ allLayers: e.target.checked })
              }
              style={{ margin: 0 }}
            />
            <span
              style={{
                fontSize: "var(--pe-font-size-sm)",
                color: "var(--pe-foreground)",
                whiteSpace: "nowrap",
              }}
            >
              所有图层
            </span>
          </label>
          <div style={sep} />
          {hint("拖动沿边缘绘制 · Shift=添加 Alt=减去")}
          <SelectionButtons />
        </>
      )}
      {/* ---- 对象选择 ---- */}
      {tool === "object-select" && (
        <>
          <label
            style={{
              display: "flex",
              alignItems: "center",
              gap: 4,
              flexShrink: 0,
              cursor: "pointer",
            }}
          >
            <input
              type="checkbox"
              checked={s.selection.lassoMode}
              onChange={(e) =>
                actions.setSelectionSettings({ lassoMode: e.target.checked })
              }
              style={{ margin: 0 }}
            />
            <span
              style={{
                fontSize: "var(--pe-font-size-sm)",
                color: "var(--pe-foreground)",
                whiteSpace: "nowrap",
              }}
            >
              套索模式
            </span>
          </label>
          <div style={sep} />
          {hint(
            s.selection.lassoMode
              ? "拖动绘制自由套索选区 · Shift=添加 Alt=减去"
              : "拖动绘制矩形选区 · Shift=添加 Alt=减去",
          )}
          <SelectionButtons />
        </>
      )}
      {/* ---- 快速选择 ---- */}
      {tool === "quick-select" && (
        <>
          <SliderGroup
            label="大小:"
            min={1}
            max={300}
            value={s.selection.brushSize}
            width={72}
            suffix="px"
            onChange={(v) => actions.setSelectionSettings({ brushSize: v })}
          />
          <div style={sep} />
          <label
            style={{
              display: "flex",
              alignItems: "center",
              gap: 4,
              flexShrink: 0,
              cursor: "pointer",
            }}
          >
            <input
              type="checkbox"
              checked={s.selection.allLayers}
              onChange={(e) =>
                actions.setSelectionSettings({ allLayers: e.target.checked })
              }
              style={{ margin: 0 }}
            />
            <span
              style={{
                fontSize: "var(--pe-font-size-sm)",
                color: "var(--pe-foreground)",
                whiteSpace: "nowrap",
              }}
            >
              所有图层
            </span>
          </label>
          <div style={sep} />
          {hint("拖动涂抹添加选区 · Alt=减去")}
          <SelectionButtons />
        </>
      )}
      {/* ---- 魔棒 ---- */}
      {tool === "magic-wand" && (
        <>
          <SliderGroup
            label="容差:"
            min={0}
            max={255}
            value={s.selection.tolerance}
            width={72}
            suffix=""
            onChange={(v) => actions.setSelectionSettings({ tolerance: v })}
          />
          <div style={sep} />
          <label
            style={{
              display: "flex",
              alignItems: "center",
              gap: 4,
              flexShrink: 0,
              cursor: "pointer",
            }}
          >
            <input
              type="checkbox"
              checked={s.selection.contiguous}
              onChange={(e) =>
                actions.setSelectionSettings({ contiguous: e.target.checked })
              }
              style={{ margin: 0 }}
            />
            <span
              style={{
                fontSize: "var(--pe-font-size-sm)",
                color: "var(--pe-foreground)",
                whiteSpace: "nowrap",
              }}
            >
              连续
            </span>
          </label>
          <div style={sep} />
          <label
            style={{
              display: "flex",
              alignItems: "center",
              gap: 4,
              flexShrink: 0,
              cursor: "pointer",
            }}
          >
            <input
              type="checkbox"
              checked={s.selection.allLayers}
              onChange={(e) =>
                actions.setSelectionSettings({ allLayers: e.target.checked })
              }
              style={{ margin: 0 }}
            />
            <span
              style={{
                fontSize: "var(--pe-font-size-sm)",
                color: "var(--pe-foreground)",
                whiteSpace: "nowrap",
              }}
            >
              所有图层
            </span>
          </label>
          <div style={sep} />
          {hint("点击选择同色区域 · Shift=添加 Alt=减去")}
          <SelectionButtons />
        </>
      )}
      {/* ---- 其他工具提示 ---- */}
      {tool === "move" && hint("拖动以移动当前图层(空格/中键平移视图)")}
      {tool === "hand" && hint("拖动以平移画布，滚轮缩放")}
      {tool === "crop" && hint("拖动选区手柄调整范围，点击「应用裁剪」")}
      {tool === "pipette" && hint("点击画布拾取前景色")}

      {/* ---- 右侧: 缩放 + 撤销/重做 ---- */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 0,
          marginLeft: "auto",
          flexShrink: 0,
        }}
      >
        <button
          className="tb-icon-btn"
          title="缩小"
          onClick={() => actions.zoomOut()}
        >
          <ZoomOut size={14} />
        </button>
        <button
          className="tb-icon-btn"
          title="放大"
          onClick={() => actions.zoomIn()}
        >
          <ZoomIn size={14} />
        </button>
        <button
          className="tb-icon-btn"
          title="适合屏幕"
          onClick={() => actions.zoomFit()}
        >
          <Maximize size={14} />
        </button>
        <div style={{ ...sep, margin: "0 6px" }} />
        <button
          className="tb-icon-btn"
          title="撤销 (Ctrl+Z)"
          onClick={() => actions.undo()}
          disabled={!s.hasDocument}
        >
          <Undo2 size={14} />
        </button>
        <button
          className="tb-icon-btn"
          title="重做 (Ctrl+Shift+Z)"
          onClick={() => actions.redo()}
          disabled={!s.hasDocument}
        >
          <Redo2 size={14} />
        </button>
        {(tool === "paintbrush" || tool === "eraser") && (
          <button
            className="tb-icon-btn"
            title="重置画笔"
            onClick={() => actions.resetBrush()}
          >
            <RotateCcw size={14} />
          </button>
        )}
      </div>
    </div>
  );
};

/* 工具栏紧凑滑块组 */
const SliderGroup: React.FC<{
  label: string;
  min: number;
  max: number;
  value: number;
  width: number;
  suffix: string;
  onChange: (v: number) => void;
}> = ({ label, min, max, value, width, suffix, onChange }) => {
  const display =
    suffix === "px" ? `${value}px` : suffix === "%" ? `${value}%` : `${value}`;
  return (
    <div
      style={{ display: "flex", alignItems: "center", gap: 4, flexShrink: 0 }}
    >
      <span
        style={{
          fontSize: "var(--pe-font-size-sm)",
          color: "var(--pe-foreground)",
          whiteSpace: "nowrap",
        }}
      >
        {label}
      </span>
      <input
        type="range"
        min={min}
        max={max}
        value={value}
        className="toolbar-range"
        style={{ width }}
        onChange={(e) => onChange(Number(e.target.value))}
      />
      <span
        style={{
          fontSize: "var(--pe-font-size-sm)",
          color: "var(--pe-foreground)",
          fontFamily: "var(--pe-font-mono)",
          minWidth: suffix === "px" ? 30 : 26,
        }}
      >
        {display}
      </span>
    </div>
  );
};

/* 选区工具栏按钮组：全选 / 取消 / 反选 */
const SelectionButtons: React.FC = () => (
  <>
    <div
      style={{
        width: 1,
        height: 16,
        background: "var(--pe-toolbar-border)",
        flexShrink: 0,
      }}
    />
    <button
      className="tb-icon-btn"
      title="全选 (Ctrl+A)"
      onClick={() => actions.selectAll()}
      style={{
        width: "auto",
        padding: "0 6px",
        fontSize: "var(--pe-font-size-sm)",
      }}
    >
      全选
    </button>
    <button
      className="tb-icon-btn"
      title="取消选择 (Ctrl+D)"
      onClick={() => actions.clearSelection()}
      style={{
        width: "auto",
        padding: "0 6px",
        fontSize: "var(--pe-font-size-sm)",
      }}
    >
      取消
    </button>
    <button
      className="tb-icon-btn"
      title="反选 (Ctrl+Shift+I)"
      onClick={() => actions.invertSelection()}
      style={{
        width: "auto",
        padding: "0 6px",
        fontSize: "var(--pe-font-size-sm)",
      }}
    >
      反选
    </button>
  </>
);

/* ============ 画布区域 ============ */
const CanvasArea: React.FC<{ filter: string; zoom: number }> = ({
  filter,
  zoom,
}) => {
  const s = useEditor();
  const containerRef = useRef<HTMLDivElement>(null);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const overlayRef = useRef<HTMLCanvasElement>(null);
  const textAreaRef = useRef<HTMLTextAreaElement>(null);

  /* 引擎像素版本号(笔画进行中只 bump 版本，不刷新 store) */
  const version = useSyncExternalStore(
    (cb) => engine.subscribeCanvas(cb),
    () => engine.getVersion(),
    () => engine.getVersion(),
  );

  // 选区(相对图片的百分比 0-100)，用于裁剪工具
  const [sel, setSel] = useState({ top: 10, left: 10, width: 80, height: 80 });
  const dragging = useRef<{
    mode: string;
    startX: number;
    startY: number;
    base: { top: number; left: number; width: number; height: number };
  } | null>(null);

  // 画布平移(抓手/空格/中键)
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [spaceDown, setSpaceDown] = useState(false);

  // 文字就地编辑
  const [textEdit, setTextEdit] = useState<TextEditState | null>(null);
  const textEditRef = useRef<TextEditState | null>(null);
  textEditRef.current = textEdit;
  const editSeq = useRef(0);
  // 已提交/取消的编辑 id(防止 blur 与 click 重复触发)
  const finishedEditId = useRef<number>(-1);

  // 笔刷光标 / 形状预览(绘制在 overlay 画布上，不进 React 状态)
  const hoverPt = useRef<Pt | null>(null);
  const shapeDrag = useRef<
    | { mode: "create"; from: Pt; to: Pt }
    | { mode: "edit"; layerId: string; from: Pt; to: Pt }
    | null
  >(null);

  /* === 选区工具进行中的状态(不进 React 状态，避免每帧重渲染) === */
  // 套索/磁性套索：拖拽中收集的轨迹点(文档像素坐标)
  const lassoPathRef = useRef<Pt[]>([]);
  const lassoActiveRef = useRef(false);
  // 多边形套索：已落点的顶点(跨多次点击)
  const polyPointsRef = useRef<Pt[]>([]);
  const polyActiveRef = useRef(false);
  // 对象选择(矩形模式) / 拖拽预览
  const rectDragRef = useRef<{ from: Pt; to: Pt } | null>(null);
  // 快速选择：上一笔位置(用于插值)
  const quickSelLastRef = useRef<Pt | null>(null);
  // 鼠标当前是否按下(用于 mousemove 中判断是否在拖拽)
  const mouseDownRef = useRef(false);
  // 当前 mousedown 时的选区操作模式(修饰键决定)
  const curOpRef = useRef<SelectionOp>("new");
  // 选区轮廓的预生成 ImageData(每次版本变化时重新生成)
  const selOutlineRef = useRef<ImageData | null>(null);
  // 蚂蚁线动画相位
  const selAnimPhaseRef = useRef(0);
  // 标尺工具拖动中的起止点(文档像素坐标)
  const rulerDragRef = useRef<{ from: Pt; to: Pt } | null>(null);
  // 旋转手柄拖拽中: 记录图层 id / 起始角度 / 基准旋转角
  const rotateDragRef = useRef<{
    layerId: string;
    startAngle: number;
    baseRotation: number;
  } | null>(null);
  // 拉伸控制点拖拽中
  const resizeDragRef = useRef<{
    layerId: string;
    handle: string;
    center: { x: number; y: number };
  } | null>(null);
  // 鼠标是否悬停在旋转手柄上(用于切换光标)
  const [hoveringHandle, setHoveringHandle] = useState(false);
  // 鼠标悬停在哪个拉伸控制点上
  const [hoveringResizeHandle, setHoveringResizeHandle] = useState<
    string | null
  >(null);
  // 当前工具的引用(供键盘事件闭包读取最新值，避免 stale closure)
  const activeToolRef = useRef(s.activeTool);
  activeToolRef.current = s.activeTool;
  // 当前 tab 的引用(同上)
  const activeTabIdRef = useRef(s.activeTabId);
  activeTabIdRef.current = s.activeTabId;

  const doc = s.activeTabId ? engine.get(s.activeTabId) : undefined;
  const hasDoc = !!doc;

  /* 把 composite 绘制到显示画布 */
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !doc) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    if (canvas.width !== doc.width) canvas.width = doc.width;
    if (canvas.height !== doc.height) canvas.height = doc.height;
    ctx.clearRect(0, 0, doc.width, doc.height);
    ctx.drawImage(doc.composite, 0, 0);
    const ov = overlayRef.current;
    if (ov) {
      if (ov.width !== doc.width) ov.width = doc.width;
      if (ov.height !== doc.height) ov.height = doc.height;
    }
  }, [version, doc]);

  /* 「适合屏幕」信号 */
  const fitSignal = s.fitSignal;
  useEffect(() => {
    if (!fitSignal || !doc || !containerRef.current) return;
    const r = containerRef.current.getBoundingClientRect();
    const zx = ((r.width - 60) / doc.width) * 100;
    const zy = ((r.height - 60) / doc.height) * 100;
    actions.setZoom(Math.max(10, Math.floor(Math.min(zx, zy))));
    setPan({ x: 0, y: 0 });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fitSignal]);

  /* 切换 tab: 重置平移 / 丢弃未提交文字 */
  useEffect(() => {
    setPan({ x: 0, y: 0 });
    setTextEdit(null);
    hoverPt.current = null;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [s.activeTabId]);

  /* 切换工具: 提交未完成的文字 / 取消多边形套索 */
  useEffect(() => {
    if (s.activeTool !== "type" && textEditRef.current) {
      commitEdit(textEditRef.current);
    }
    // 离开多边形套索工具时丢弃未完成的顶点
    if (s.activeTool !== "polygonal-lasso" && polyActiveRef.current) {
      polyPointsRef.current = [];
      polyActiveRef.current = false;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [s.activeTool]);

  /* 监听图层面板双击文字图层 → 进入就地编辑 */
  useEffect(() => {
    if (!s.textEditSignal) return;
    if (!doc) return;
    const layerId = s.requestTextEditLayerId;
    if (layerId) {
      const layer = engine.getLayer(doc, layerId);
      if (layer && layer.kind === "text" && layer.textData) {
        if (textEditRef.current) commitEdit(textEditRef.current);
        startTextEditExisting(layer);
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [s.textEditSignal]);

  /* 监听图层面板双击形状图层 → 选中并切换到形状工具(便于在画布上点击重编辑) */
  useEffect(() => {
    if (!s.shapeEditSignal || !doc) return;
    const layerId = s.requestShapeEditLayerId;
    if (layerId) {
      const layer = engine.getLayer(doc, layerId);
      if (layer && layer.kind === "shape" && layer.shapeData) {
        engine.setActiveLayer(doc, layerId);
        // 同步工具栏参数(含 sides，多边形/星形使用)
        actions.setShape({
          kind: layer.shapeData.kind,
          lineWidth: layer.shapeData.size,
          fill: layer.shapeData.fill,
          sides: layer.shapeData.sides,
        });
        actions.setFgColor(layer.shapeData.color);
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [s.shapeEditSignal]);

  /* 文字编辑自动聚焦 */
  useEffect(() => {
    if (textEdit) textAreaRef.current?.focus();
  }, [textEdit]);

  /* 提交一段文字编辑(按 id 防止失焦事件误关新编辑框) */
  const commitEdit = (edit: TextEditState) => {
    if (finishedEditId.current === edit.id) return; // 已提交/取消
    finishedEditId.current = edit.id;
    setTextEdit((cur) => (cur && cur.id === edit.id ? null : cur));
    if (!doc) return;
    const value = edit.value;
    const opts = {
      color: s.fgColor,
      size: s.text.fontSize,
      bold: s.text.bold,
      italic: s.text.italic,
      underline: s.text.underline,
      strikethrough: s.text.strikethrough,
      opacity: s.brush.opacity,
      fontFamily: s.text.fontFamily,
      boxWidth: Math.round(edit.w),
      rotation: edit.rotation,
    };
    if (edit.layerId) {
      // 编辑已有文字图层：内容为空则删除该图层
      if (!value.trim()) {
        engine.removeLayer(doc, edit.layerId);
      } else {
        engine.updateTextLayer(doc, edit.layerId, value, opts);
      }
    } else {
      // 新建文字图层：内容为空则放弃
      if (!value.trim()) return;
      engine.addTextLayer(doc, { x: edit.x, y: edit.y }, value, opts);
    }
  };

  /* 取消编辑(Esc)：若是编辑已有图层，恢复其画布像素 */
  const cancelEdit = (edit: TextEditState) => {
    if (finishedEditId.current === edit.id) return; // 已提交/取消
    finishedEditId.current = edit.id;
    setTextEdit((cur) => (cur && cur.id === edit.id ? null : cur));
    if (!doc || !edit.layerId) return;
    engine.restoreTextLayerCanvas(doc, edit.layerId);
  };

  /* 进入已有文字图层的就地编辑：选中图层、同步工具栏设置、清空画布、打开 textarea */
  const startTextEditExisting = (layer: EngineLayer) => {
    if (!doc || !layer.textData) return;
    engine.setActiveLayer(doc, layer.id);
    // 若图层带缩放，先把缩放烘焙进字号/框宽，编辑框以未缩放状态显示
    engine.normalizeTextLayerScale(doc, layer.id);
    const td = layer.textData;
    // 把该文字图层的字号/粗体/字体/颜色同步到工具栏(便于编辑后应用)
    actions.setText({
      fontSize: td.fontSize,
      bold: td.bold,
      italic: td.italic,
      underline: td.underline,
      strikethrough: td.strikethrough,
      fontFamily: td.fontFamily,
    });
    actions.setFgColor(td.color);
    // 清空该图层画布，避免 textarea 与底层像素重影
    engine.clearTextLayerCanvas(doc, layer.id);
    const bbox = engine.getLayerBBoxLocal(layer, doc);
    const id = ++editSeq.current;
    setTextEdit({
      id,
      layerId: layer.id,
      x: td.x + layer.offsetX,
      y: td.y + layer.offsetY,
      w: bbox.w,
      h: bbox.h,
      rotation: layer.rotation,
      value: td.text,
    });
  };

  /* 文字编辑框：拖拽手柄调整宽高(在编辑框旋转坐标系下计算，对边固定) */
  const startEditResize = (handle: string) => (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const edit = textEditRef.current;
    if (!edit) return;
    const start = { ...edit };
    const cx = start.x + start.w / 2;
    const cy = start.y + start.h / 2;
    const rad = (-start.rotation * Math.PI) / 180;
    const cos = Math.cos(rad);
    const sin = Math.sin(rad);
    const rad2 = (start.rotation * Math.PI) / 180;
    const cos2 = Math.cos(rad2);
    const sin2 = Math.sin(rad2);
    const MIN = 8;
    const move = (ev: MouseEvent) => {
      const cur = coordsFromClient(ev.clientX, ev.clientY);
      if (!cur) return;
      // 文档坐标 → 编辑框未旋转局部坐标(相对中心)
      const dx = cur.x - cx;
      const dy = cur.y - cy;
      const lx = dx * cos - dy * sin;
      const ly = dx * sin + dy * cos;
      let left = -start.w / 2;
      let right = start.w / 2;
      let top = -start.h / 2;
      let bottom = start.h / 2;
      if (handle.includes("e")) right = Math.max(lx, left + MIN);
      if (handle.includes("w")) left = Math.min(lx, right - MIN);
      if (handle.includes("s")) bottom = Math.max(ly, top + MIN);
      if (handle.includes("n")) top = Math.min(ly, bottom - MIN);
      const newW = right - left;
      const newH = bottom - top;
      // 新中心(局部) → 旋回文档坐标
      const ncx = (left + right) / 2;
      const ncy = (top + bottom) / 2;
      const newCx = cx + ncx * cos2 - ncy * sin2;
      const newCy = cy + ncx * sin2 + ncy * cos2;
      setTextEdit((prev) =>
        prev && prev.id === start.id
          ? {
              ...prev,
              x: newCx - newW / 2,
              y: newCy - newH / 2,
              w: newW,
              h: newH,
            }
          : prev,
      );
    };
    const up = () => {
      window.removeEventListener("mousemove", move);
      window.removeEventListener("mouseup", up);
    };
    window.addEventListener("mousemove", move);
    window.addEventListener("mouseup", up);
  };

  /* 文字编辑框：拖拽旋转手柄(绕编辑框中心，Shift 吸附 15°) */
  const startEditRotate = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const edit = textEditRef.current;
    if (!edit) return;
    const cx = edit.x + edit.w / 2;
    const cy = edit.y + edit.h / 2;
    const pt0 = coordsFromClient(e.clientX, e.clientY);
    if (!pt0) return;
    const startAngle = (Math.atan2(pt0.y - cy, pt0.x - cx) * 180) / Math.PI;
    const baseRot = edit.rotation;
    const move = (ev: MouseEvent) => {
      const cur = coordsFromClient(ev.clientX, ev.clientY);
      if (!cur) return;
      const ang = (Math.atan2(cur.y - cy, cur.x - cx) * 180) / Math.PI;
      let r = baseRot + (ang - startAngle);
      if (ev.shiftKey) r = Math.round(r / 15) * 15;
      while (r > 180) r -= 360;
      while (r <= -180) r += 360;
      setTextEdit((prev) =>
        prev && prev.id === edit.id ? { ...prev, rotation: r } : prev,
      );
    };
    const up = () => {
      window.removeEventListener("mousemove", move);
      window.removeEventListener("mouseup", up);
    };
    window.addEventListener("mousemove", move);
    window.addEventListener("mouseup", up);
  };

  /* 快捷键: 工具切换 / 撤销重做 / 笔刷大小 / 空格平移 / 选区 Ctrl+D / 多边形套索 Enter/Esc/Del */
  useEffect(() => {
    const isEditable = (t: EventTarget | null) =>
      t instanceof HTMLElement &&
      !!t.closest("input,textarea,select,[contenteditable='true']");
    const onKeyDown = (e: KeyboardEvent) => {
      // Ctrl+S 保存工程文件 — 全局快捷键，无视焦点位置(含 input/textarea)
      // silent=true：有句柄则直写原位置，无句柄则静默跳过，不弹任何对话框
      if (
        (e.ctrlKey || e.metaKey) &&
        (e.key === "s" || e.key === "S")
      ) {
        e.preventDefault();
        actions.saveProject(true);
        return;
      }
      if (isEditable(e.target)) return;
      if (e.code === "Space") {
        e.preventDefault();
        setSpaceDown(true);
        return;
      }
      if (e.ctrlKey || e.metaKey) {
        const k = e.key.toLowerCase();
        if (k === "z") {
          e.preventDefault();
          if (e.shiftKey) actions.redo();
          else actions.undo();
        } else if (k === "y") {
          e.preventDefault();
          actions.redo();
        } else if (k === "d") {
          // Ctrl+D 取消选区（Photoshop 行为）
          e.preventDefault();
          actions.clearSelection();
        } else if (k === "a") {
          // Ctrl+A 全选
          e.preventDefault();
          actions.selectAll();
        } else if (k === "i" && e.shiftKey) {
          // Ctrl+Shift+I 反选
          e.preventDefault();
          actions.invertSelection();
        }
        return;
      }
      // 多边形套索进行中：Enter 闭合 / Esc 取消 / Backspace,Delete 删除最后一点
      if (
        activeToolRef.current === "polygonal-lasso" &&
        polyActiveRef.current
      ) {
        if (e.key === "Enter") {
          e.preventDefault();
          const doc = engine.get(activeTabIdRef.current);
          if (doc && polyPointsRef.current.length >= 3) {
            engine.selectPolygon(doc, polyPointsRef.current, curOpRef.current);
            engine.commitSelection(doc, "多边形套索选区");
            polyPointsRef.current = [];
            polyActiveRef.current = false;
            redrawOverlay();
          }
          return;
        }
        if (e.key === "Escape") {
          e.preventDefault();
          polyPointsRef.current = [];
          polyActiveRef.current = false;
          redrawOverlay();
          return;
        }
        if (e.key === "Backspace" || e.key === "Delete") {
          e.preventDefault();
          polyPointsRef.current.pop();
          if (polyPointsRef.current.length === 0) polyActiveRef.current = false;
          redrawOverlay();
          return;
        }
      }
      const k = e.key.toLowerCase();
      // 吸管组: 重复按 I 循环 pipette → colorSampler → ruler → pipette
      if (k === "i") {
        const group: ToolId[] = ["pipette", "colorSampler", "ruler"];
        const idx = group.indexOf(activeToolRef.current);
        const next = idx >= 0 ? group[(idx + 1) % group.length] : "pipette";
        actions.setActiveTool(next);
        return;
      }
      // 套索组: 重复按 L 循环 lasso → polygonal-lasso → magnetic-lasso → lasso
      if (k === "l") {
        const group: ToolId[] = ["lasso", "polygonal-lasso", "magnetic-lasso"];
        const idx = group.indexOf(activeToolRef.current);
        const next = idx >= 0 ? group[(idx + 1) % group.length] : "lasso";
        actions.setActiveTool(next);
        return;
      }
      // 对象选择组: 重复按 W 循环 object-select → quick-select → magic-wand → object-select
      if (k === "w") {
        const group: ToolId[] = ["object-select", "quick-select", "magic-wand"];
        const idx = group.indexOf(activeToolRef.current);
        const next =
          idx >= 0 ? group[(idx + 1) % group.length] : "object-select";
        actions.setActiveTool(next);
        return;
      }
      // 形状组: 重复按 U 循环 矩形 → 椭圆 → 圆形 → 三角形 → 多边形 → 星形 → 直线 → 矩形
      if (k === "u") {
        const group: ToolId[] = [
          "shape-rect",
          "shape-ellipse",
          "shape-circle",
          "shape-triangle",
          "shape-polygon",
          "shape-star",
          "shape-line",
        ];
        const idx = group.indexOf(activeToolRef.current);
        const next = idx >= 0 ? group[(idx + 1) % group.length] : "shape-rect";
        actions.setActiveTool(next);
        return;
      }
      const TOOL_KEYS: Record<string, ToolId> = {
        v: "move",
        h: "hand",
        c: "crop",
        b: "paintbrush",
        e: "eraser",
        g: "paintBucket",
        t: "type",
        s: "cloneStamp",
      };
      if (TOOL_KEYS[k]) {
        actions.setActiveTool(TOOL_KEYS[k]);
        return;
      }
      if (k === "[")
        actions.setBrush({ size: Math.max(1, Math.round(s.brush.size / 1.2)) });
      if (k === "]")
        actions.setBrush({
          size: Math.min(300, Math.max(2, Math.round(s.brush.size * 1.2))),
        });
    };
    const onKeyUp = (e: KeyboardEvent) => {
      if (e.code === "Space") setSpaceDown(false);
    };
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [s.brush.size]);

  /* client 坐标 → 文档像素坐标 */
  const coordsFromClient = useCallback(
    (clientX: number, clientY: number): Pt | null => {
      const canvas = canvasRef.current;
      if (!canvas) return null;
      const rect = canvas.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) return null;
      return {
        x: ((clientX - rect.left) / rect.width) * canvas.width,
        y: ((clientY - rect.top) / rect.height) * canvas.height,
      };
    },
    [],
  );

  const toCanvasCoords = useCallback(
    (e: React.MouseEvent): Pt | null => coordsFromClient(e.clientX, e.clientY),
    [coordsFromClient],
  );

  /* 重绘 overlay(笔刷圆圈 + 形状预览 + 选区蚂蚁线 + 套索预览)，以文档像素为单位绘制 */
  const redrawOverlay = useCallback(() => {
    const ov = overlayRef.current;
    if (!ov || !doc) return;
    const ctx = ov.getContext("2d");
    if (!ctx) return;
    ctx.clearRect(0, 0, ov.width, ov.height);
    const lw = 100 / zoom; // 1 屏幕像素对应的文档像素

    /* === 选区蚂蚁线(已提交的选区) ===
     * 流程：先画半透明蓝色填充(选中区域)，再用 putImageData 画 1px 轮廓
     * 注意 putImageData 不参与合成、直接覆盖像素，所以轮廓只覆盖 1px 边缘，
     * 不影响大面积的蓝色填充视觉效果。
     */
    const outline = selOutlineRef.current;
    if (outline) {
      const mask = engine.getSelectionMask(doc);
      if (mask) {
        // 半透明蓝填充：用 mask 自身的 alpha 作为剪切
        ctx.save();
        ctx.globalAlpha = 0.12;
        ctx.drawImage(mask, 0, 0);
        ctx.globalCompositeOperation = "source-in";
        ctx.fillStyle = "#0078D4";
        ctx.fillRect(0, 0, ov.width, ov.height);
        ctx.restore();
      }
      // 蚂蚁线：基于相位把轮廓像素以黑白两色 dash 方式绘制
      const phase = selAnimPhaseRef.current;
      const od = outline.data;
      const w = ov.width;
      const dash = ctx.createImageData(w, ov.height);
      const dd = dash.data;
      for (let i = 0; i < od.length; i += 4) {
        if (od[i + 3] === 0) continue;
        const pIdx = i / 4;
        const px = pIdx % w;
        const py = Math.floor(pIdx / w);
        // 8 步循环：(x+y+phase) % 8 < 4 显白，否则显黑
        const m = (px + py + phase) % 8;
        if (m < 4) {
          dd[i] = 255;
          dd[i + 1] = 255;
          dd[i + 2] = 255;
          dd[i + 3] = 255;
        } else {
          dd[i] = 0;
          dd[i + 1] = 0;
          dd[i + 2] = 0;
          dd[i + 3] = 255;
        }
      }
      ctx.putImageData(dash, 0, 0);
    }

    /* === 形状拖拽预览 === */
    const sd = shapeDrag.current;
    if (sd) {
      ctx.save();
      ctx.strokeStyle = "#0078D4";
      ctx.lineWidth = lw;
      ctx.setLineDash([4 * lw, 3 * lw]);
      const x = Math.min(sd.from.x, sd.to.x);
      const y = Math.min(sd.from.y, sd.to.y);
      const w = Math.abs(sd.to.x - sd.from.x);
      const h = Math.abs(sd.to.y - sd.from.y);
      const x1 = sd.from.x;
      const y1 = sd.from.y;
      const x2 = sd.to.x;
      const y2 = sd.to.y;
      const kind = s.shape.kind;
      if (kind === "rect") {
        ctx.strokeRect(x, y, w, h);
      } else if (kind === "ellipse") {
        ctx.beginPath();
        ctx.ellipse(
          x + w / 2,
          y + h / 2,
          Math.max(0.5, w / 2),
          Math.max(0.5, h / 2),
          0,
          0,
          Math.PI * 2,
        );
        ctx.stroke();
      } else if (kind === "circle") {
        const r = Math.max(0.5, Math.min(w, h) / 2);
        ctx.beginPath();
        ctx.arc(x + w / 2, y + h / 2, r, 0, Math.PI * 2);
        ctx.stroke();
      } else if (kind === "triangle") {
        const pts = engine.polygonPoints(x1, y1, x2, y2, 3);
        ctx.beginPath();
        ctx.moveTo(pts[0].x, pts[0].y);
        for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
        ctx.closePath();
        ctx.stroke();
      } else if (kind === "polygon") {
        const pts = engine.polygonPoints(x1, y1, x2, y2, s.shape.sides);
        ctx.beginPath();
        ctx.moveTo(pts[0].x, pts[0].y);
        for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
        ctx.closePath();
        ctx.stroke();
      } else if (kind === "star") {
        const pts = engine.starPoints(x1, y1, x2, y2, s.shape.sides);
        ctx.beginPath();
        ctx.moveTo(pts[0].x, pts[0].y);
        for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
        ctx.closePath();
        ctx.stroke();
      } else {
        // line
        ctx.beginPath();
        ctx.moveTo(x1, y1);
        ctx.lineTo(x2, y2);
        ctx.stroke();
      }
      ctx.restore();
    }

    /* === 套索(自由/磁性)拖拽中预览 === */
    if (lassoActiveRef.current && lassoPathRef.current.length > 1) {
      const pts = lassoPathRef.current;
      ctx.save();
      ctx.strokeStyle = "#0078D4";
      ctx.lineWidth = lw;
      ctx.setLineDash([]);
      ctx.beginPath();
      ctx.moveTo(pts[0].x, pts[0].y);
      for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
      // 闭合预览(虚线回到起点)
      ctx.stroke();
      ctx.setLineDash([4 * lw, 3 * lw]);
      ctx.lineTo(pts[0].x, pts[0].y);
      ctx.stroke();
      ctx.restore();
    }

    /* === 多边形套索 已落点 + 鼠标预览线 === */
    if (polyActiveRef.current && polyPointsRef.current.length > 0) {
      const pts = polyPointsRef.current;
      const hp = hoverPt.current;
      ctx.save();
      ctx.strokeStyle = "#0078D4";
      ctx.lineWidth = lw;
      ctx.setLineDash([]);
      ctx.beginPath();
      ctx.moveTo(pts[0].x, pts[0].y);
      for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
      ctx.stroke();
      // 到鼠标的预览线(虚线)
      if (hp) {
        ctx.setLineDash([4 * lw, 3 * lw]);
        ctx.beginPath();
        ctx.moveTo(pts[pts.length - 1].x, pts[pts.length - 1].y);
        ctx.lineTo(hp.x, hp.y);
        ctx.stroke();
        // 起点高亮(双击或靠近即闭合)
        ctx.setLineDash([]);
        ctx.fillStyle = "#fff";
        ctx.strokeStyle = "#0078D4";
        ctx.lineWidth = lw;
        ctx.beginPath();
        ctx.arc(pts[0].x, pts[0].y, 3 * lw, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
      }
      // 各顶点小圆点
      ctx.setLineDash([]);
      ctx.fillStyle = "#0078D4";
      for (const p of pts) {
        ctx.beginPath();
        ctx.arc(p.x, p.y, 2 * lw, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.restore();
    }

    /* === 对象选择(矩形/套索)拖拽预览 === */
    const rd = rectDragRef.current;
    if (rd) {
      ctx.save();
      ctx.strokeStyle = "#0078D4";
      ctx.lineWidth = lw;
      ctx.setLineDash([4 * lw, 3 * lw]);
      const x = Math.min(rd.from.x, rd.to.x);
      const y = Math.min(rd.from.y, rd.to.y);
      const w = Math.abs(rd.to.x - rd.from.x);
      const h = Math.abs(rd.to.y - rd.from.y);
      ctx.strokeRect(x, y, w, h);
      ctx.restore();
    }

    /* === 笔刷圆圈光标 (画笔/橡皮/快速选择/仿制图章) === */
    const hp = hoverPt.current;
    const isBrushCursor =
      s.activeTool === "paintbrush" ||
      s.activeTool === "eraser" ||
      s.activeTool === "quick-select" ||
      s.activeTool === "cloneStamp";
    if (hp && isBrushCursor) {
      const r =
        s.activeTool === "quick-select"
          ? Math.max(0.5, s.selection.brushSize / 2)
          : s.activeTool === "cloneStamp"
            ? Math.max(0.5, s.cloneStamp.size / 2)
            : Math.max(0.5, s.brush.size / 2);
      ctx.save();
      ctx.setLineDash([]);
      ctx.lineWidth = lw;
      ctx.strokeStyle = "rgba(255,255,255,0.85)";
      ctx.beginPath();
      ctx.arc(hp.x, hp.y, r + lw, 0, Math.PI * 2);
      ctx.stroke();
      ctx.strokeStyle = "rgba(0,0,0,0.85)";
      ctx.beginPath();
      ctx.arc(hp.x, hp.y, r, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    }

    /* === 颜色取样器标记(始终显示已放置的取样点) === */
    if (s.colorSamples.length > 0) {
      const sz = Math.max(3, 7 / zoom); // 标记半径(文档像素)
      const fontSize = Math.max(8, 12 / zoom);
      ctx.save();
      ctx.lineWidth = lw;
      ctx.setLineDash([]);
      ctx.textAlign = "left";
      ctx.textBaseline = "middle";
      ctx.font = `${fontSize}px sans-serif`;
      for (let i = 0; i < s.colorSamples.length; i++) {
        const sm = s.colorSamples[i];
        // 空心圆 + 内部填色
        ctx.fillStyle = sm.color;
        ctx.beginPath();
        ctx.arc(sm.x, sm.y, sz, 0, Math.PI * 2);
        ctx.fill();
        // 白色外圈
        ctx.strokeStyle = "#FFFFFF";
        ctx.lineWidth = lw * 1.5;
        ctx.beginPath();
        ctx.arc(sm.x, sm.y, sz, 0, Math.PI * 2);
        ctx.stroke();
        // 黑色细内圈
        ctx.strokeStyle = "#000000";
        ctx.lineWidth = lw * 0.5;
        ctx.beginPath();
        ctx.arc(sm.x, sm.y, sz, 0, Math.PI * 2);
        ctx.stroke();
        // 索引编号(白底黑字)
        const label = `${i + 1}`;
        const lx = sm.x + sz + 2 / zoom;
        const ly = sm.y;
        ctx.lineWidth = lw * 2.5;
        ctx.strokeStyle = "#FFFFFF";
        ctx.strokeText(label, lx, ly);
        ctx.fillStyle = "#000000";
        ctx.fillText(label, lx, ly);
      }
      ctx.restore();
    }

    /* === 标尺工具: 拖动中或已测量 === */
    const rulerDrag = rulerDragRef.current;
    const rulerM = s.ruler;
    if (rulerDrag || rulerM) {
      const from = rulerDrag ? rulerDrag.from : rulerM!.from;
      const to = rulerDrag ? rulerDrag.to : rulerM!.to;
      ctx.save();
      ctx.setLineDash([]);
      // 白底粗线
      ctx.strokeStyle = "#FFFFFF";
      ctx.lineWidth = lw * 2;
      ctx.beginPath();
      ctx.moveTo(from.x, from.y);
      ctx.lineTo(to.x, to.y);
      ctx.stroke();
      // 黑色细线
      ctx.strokeStyle = "#000000";
      ctx.lineWidth = lw * 0.6;
      ctx.beginPath();
      ctx.moveTo(from.x, from.y);
      ctx.lineTo(to.x, to.y);
      ctx.stroke();
      // 端点十字标记
      ctx.strokeStyle = "#FFFFFF";
      ctx.lineWidth = lw * 1.5;
      const tick = Math.max(2, 5 / zoom);
      for (const p of [from, to]) {
        ctx.beginPath();
        ctx.moveTo(p.x - tick, p.y);
        ctx.lineTo(p.x + tick, p.y);
        ctx.moveTo(p.x, p.y - tick);
        ctx.lineTo(p.x, p.y + tick);
        ctx.stroke();
      }
      ctx.restore();
    }

    /* === 仿制图章: 源点十字标记(仅仿制图章工具激活时显示) === */
    if (s.activeTool === "cloneStamp" && s.cloneSource) {
      const cs = s.cloneSource;
      const t = Math.max(3, 8 / zoom);
      ctx.save();
      ctx.setLineDash([]);
      // 白底十字
      ctx.strokeStyle = "#FFFFFF";
      ctx.lineWidth = lw * 2;
      ctx.beginPath();
      ctx.moveTo(cs.x - t, cs.y);
      ctx.lineTo(cs.x + t, cs.y);
      ctx.moveTo(cs.x, cs.y - t);
      ctx.lineTo(cs.x, cs.y + t);
      ctx.stroke();
      // 黑色细十字
      ctx.strokeStyle = "#000000";
      ctx.lineWidth = lw * 0.6;
      ctx.beginPath();
      ctx.moveTo(cs.x - t, cs.y);
      ctx.lineTo(cs.x + t, cs.y);
      ctx.moveTo(cs.x, cs.y - t);
      ctx.lineTo(cs.x, cs.y + t);
      ctx.stroke();
      // 中心圆点
      ctx.fillStyle = "#FFFFFF";
      ctx.strokeStyle = "#000000";
      ctx.lineWidth = lw;
      ctx.beginPath();
      ctx.arc(cs.x, cs.y, Math.max(1.5, 2 / zoom), 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      ctx.restore();
    }

    /* === 变换手柄: 活动图层选框 + 拉伸控制点 + 旋转手柄 ===
     * move 工具: 任意活动图层; 文字工具: 活动文字图层(非编辑中); 形状工具: 活动形状图层 */
    const tfTarget = ((): EngineLayer | null => {
      if (!doc) return null;
      const l = engine.getLayer(doc, doc.activeLayerId);
      if (!l || !l.visible || l.locked) return null;
      if (s.activeTool === "move") return l;
      if (s.activeTool === "type" && l.kind === "text" && !textEdit) return l;
      if (isShapeTool(s.activeTool) && l.kind === "shape") return l;
      return null;
    })();
    if (tfTarget) {
      const l = tfTarget;
      {
        const center = engine.getLayerCenter(l);
        const bbox = engine.getLayerBBoxLocal(l, doc);
        // 选框: 应用图层 transform 后在文档坐标系绘制
        ctx.save();
        ctx.translate(l.offsetX, l.offsetY);
        ctx.translate(center.x, center.y);
        if (l.rotation) ctx.rotate((l.rotation * Math.PI) / 180);
        if (l.scaleX !== 1 || l.scaleY !== 1) ctx.scale(l.scaleX, l.scaleY);
        ctx.translate(-center.x, -center.y);
        ctx.strokeStyle = "#0078D4";
        ctx.lineWidth = lw;
        ctx.setLineDash([4 * lw, 3 * lw]);
        ctx.strokeRect(bbox.x, bbox.y, bbox.w, bbox.h);
        ctx.restore();

        // 拉伸控制点(8 个方向，不受图层缩放影响)
        const hs = 5 / zoom; // 半边长，总 10px
        for (const h of TRANSFORM_HANDLES) {
          const local = h.local(bbox, center);
          const dp = engine.layerLocalToDoc(l, local);
          ctx.save();
          ctx.setLineDash([]);
          ctx.fillStyle = "#FFFFFF";
          ctx.strokeStyle = "#0078D4";
          ctx.lineWidth = lw;
          ctx.fillRect(dp.x - hs, dp.y - hs, hs * 2, hs * 2);
          ctx.strokeRect(dp.x - hs, dp.y - hs, hs * 2, hs * 2);
          ctx.restore();
        }

        // 旋转手柄: 在文档坐标系绘制(不受图层缩放影响，保持稳定视觉大小)
        // 手柄位于 bbox 顶边中点上方 16 屏幕像素(=16/zoom 文档像素)
        const handleOffsetDoc = 16 / zoom;
        const topMidLocal = { x: center.x, y: bbox.y };
        const handleLocal = { x: center.x, y: bbox.y - handleOffsetDoc };
        const topMidDoc = engine.layerLocalToDoc(l, topMidLocal);
        const handleDoc = engine.layerLocalToDoc(l, handleLocal);
        ctx.save();
        ctx.setLineDash([]);
        ctx.strokeStyle = "#0078D4";
        ctx.lineWidth = lw;
        ctx.beginPath();
        ctx.moveTo(topMidDoc.x, topMidDoc.y);
        ctx.lineTo(handleDoc.x, handleDoc.y);
        ctx.stroke();
        // 手柄圆点(白底蓝边)
        const r = 5 / zoom;
        ctx.fillStyle = "#FFFFFF";
        ctx.strokeStyle = "#0078D4";
        ctx.lineWidth = lw;
        ctx.beginPath();
        ctx.arc(handleDoc.x, handleDoc.y, r, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
        ctx.restore();
      }
    }
  }, [
    doc,
    zoom,
    s.shape.kind,
    s.shape.sides,
    s.activeTool,
    s.brush.size,
    s.selection.brushSize,
    s.cloneStamp.size,
    s.colorSamples,
    s.ruler,
    s.cloneSource,
    hoveringResizeHandle,
    hoveringHandle,
    textEdit,
  ]);

  /* 笔刷大小变化时同步圆圈 */
  useEffect(() => {
    redrawOverlay();
  }, [redrawOverlay]);

  /* === 选区轮廓预生成：当画布版本/选区存在性变化时，重新计算 1px 边缘 === */
  useEffect(() => {
    if (!doc || !s.hasSelection) {
      selOutlineRef.current = null;
      return;
    }
    const mask = engine.getSelectionMask(doc);
    if (!mask) {
      selOutlineRef.current = null;
      return;
    }
    const mctx = mask.getContext("2d");
    if (!mctx) return;
    const w = doc.width;
    const h = doc.height;
    const md = mctx.getImageData(0, 0, w, h).data;
    const outline = new ImageData(w, h);
    const od = outline.data;
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const i = (y * w + x) * 4 + 3;
        const a = md[i];
        if (a === 0) continue;
        // 4 邻接任一为 0 即视为边缘
        const left = x > 0 ? md[i - 4] : 0;
        const right = x < w - 1 ? md[i + 4] : 0;
        const up = y > 0 ? md[i - w * 4] : 0;
        const down = y < h - 1 ? md[i + w * 4] : 0;
        if (left === 0 || right === 0 || up === 0 || down === 0) {
          const j = (y * w + x) * 4;
          od[j + 3] = 255;
        }
      }
    }
    selOutlineRef.current = outline;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [version, doc, s.hasSelection]);

  /* === 蚂蚁线动画循环(只在有选区或有进行中预览时运行) === */
  useEffect(() => {
    let raf = 0;
    let last = 0;
    const loop = (t: number) => {
      // 每 90ms 推进一帧
      if (t - last >= 90) {
        last = t;
        selAnimPhaseRef.current = (selAnimPhaseRef.current + 1) % 8;
        // 任何进行中的预览存在时也持续重绘
        const hasPreview =
          lassoActiveRef.current ||
          polyActiveRef.current ||
          rectDragRef.current ||
          shapeDrag.current ||
          rotateDragRef.current ||
          resizeDragRef.current ||
          hoverPt.current !== null;
        if (selOutlineRef.current || hasPreview) {
          redrawOverlay();
        }
      }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [redrawOverlay]);

  /* 开始平移视图 */
  const startPan = (clientX: number, clientY: number) => {
    const base = { ...pan };
    const move = (ev: MouseEvent) => {
      setPan({
        x: base.x + ev.clientX - clientX,
        y: base.y + ev.clientY - clientY,
      });
    };
    const up = () => {
      window.removeEventListener("mousemove", move);
      window.removeEventListener("mouseup", up);
    };
    window.addEventListener("mousemove", move);
    window.addEventListener("mouseup", up);
  };

  /* 选区手柄拖动(裁剪工具) — 以图片包裹层为基准计算百分比 */
  const onHandleDown = useCallback(
    (mode: string) => (e: React.MouseEvent) => {
      e.stopPropagation();
      e.preventDefault();
      dragging.current = {
        mode,
        startX: e.clientX,
        startY: e.clientY,
        base: { ...sel },
      };
      const move = (ev: MouseEvent) => {
        if (!dragging.current || !wrapperRef.current) return;
        const rect = wrapperRef.current.getBoundingClientRect();
        if (rect.width === 0 || rect.height === 0) return;
        const dx = ((ev.clientX - dragging.current.startX) / rect.width) * 100;
        const dy = ((ev.clientY - dragging.current.startY) / rect.height) * 100;
        const b = dragging.current.base;
        const next = { ...b };
        const m = dragging.current.mode;
        if (m === "move") {
          next.left = Math.min(100 - b.width, Math.max(0, b.left + dx));
          next.top = Math.min(100 - b.height, Math.max(0, b.top + dy));
        } else {
          if (m.includes("e"))
            next.width = Math.min(100 - b.left, Math.max(5, b.width + dx));
          if (m.includes("w")) {
            const nl = Math.min(b.left + b.width - 5, Math.max(0, b.left + dx));
            next.left = nl;
            next.width = b.width + (b.left - nl);
          }
          if (m.includes("s"))
            next.height = Math.min(100 - b.top, Math.max(5, b.height + dy));
          if (m.includes("n")) {
            const nt = Math.min(b.top + b.height - 5, Math.max(0, b.top + dy));
            next.top = nt;
            next.height = b.height + (b.top - nt);
          }
        }
        setSel(next);
      };
      const up = () => {
        dragging.current = null;
        window.removeEventListener("mousemove", move);
        window.removeEventListener("mouseup", up);
      };
      window.addEventListener("mousemove", move);
      window.addEventListener("mouseup", up);
    },
    [sel],
  );

  /* 当前应显示变换手柄的目标图层: move=活动图层; type=活动文字图层(非编辑中); 形状工具=活动形状图层 */
  const getTransformTarget = (): EngineLayer | null => {
    if (!doc) return null;
    const l = engine.getLayer(doc, doc.activeLayerId);
    if (!l || !l.visible || l.locked) return null;
    if (s.activeTool === "move") return l;
    if (s.activeTool === "type" && l.kind === "text" && !textEdit) return l;
    if (isShapeTool(s.activeTool) && l.kind === "shape") return l;
    return null;
  };

  /** 命中检测：pt 是否在某图层的拉伸控制点上，返回手柄名 */
  const hitTransformHandle = (l: EngineLayer, pt: Pt): string | null => {
    const center = engine.getLayerCenter(l);
    const bbox = engine.getLayerBBoxLocal(l, doc!);
    const handleHitRadius = 10 / zoom;
    for (const h of TRANSFORM_HANDLES) {
      const local = h.local(bbox, center);
      const docPt = engine.layerLocalToDoc(l, local);
      if (Math.hypot(pt.x - docPt.x, pt.y - docPt.y) <= handleHitRadius) {
        return h.name;
      }
    }
    return null;
  };

  /** 命中检测：pt 是否在某图层的旋转手柄上 */
  const hitRotateHandle = (l: EngineLayer, pt: Pt): boolean => {
    const center = engine.getLayerCenter(l);
    const bbox = engine.getLayerBBoxLocal(l, doc!);
    const handleOffsetDoc = 16 / zoom;
    const handleDoc = engine.layerLocalToDoc(l, {
      x: center.x,
      y: bbox.y - handleOffsetDoc,
    });
    return Math.hypot(pt.x - handleDoc.x, pt.y - handleDoc.y) <= 10 / zoom;
  };

  /** 启动图层缩放拖拽(scaleX/scaleY)。返回是否成功启动 */
  const startResizeDrag = (l: EngineLayer, handle: string): void => {
    if (!doc) return;
    const center = engine.getLayerCenter(l);
    resizeDragRef.current = { layerId: l.id, handle, center };
    const resizeMove = (ev: MouseEvent) => {
      if (!resizeDragRef.current) return;
      const cur = coordsFromClient(ev.clientX, ev.clientY);
      if (!cur) return;
      const rd = resizeDragRef.current;
      const layer = engine.getLayer(doc, rd.layerId);
      if (!layer) return;
      const lbbox = engine.getLayerBBoxLocal(layer, doc);
      // 逆向旋转：R^-1 * (cur - offset - center)
      const dx = cur.x - layer.offsetX - rd.center.x;
      const dy = cur.y - layer.offsetY - rd.center.y;
      const rad = (-layer.rotation * Math.PI) / 180;
      const cos = Math.cos(rad);
      const sin = Math.sin(rad);
      const rx = dx * cos - dy * sin;
      const ry = dx * sin + dy * cos;

      let newScaleX = layer.scaleX;
      let newScaleY = layer.scaleY;

      const dNW = { x: lbbox.x - rd.center.x, y: lbbox.y - rd.center.y };
      const dNE = {
        x: lbbox.x + lbbox.w - rd.center.x,
        y: lbbox.y - rd.center.y,
      };
      const dSE = {
        x: lbbox.x + lbbox.w - rd.center.x,
        y: lbbox.y + lbbox.h - rd.center.y,
      };
      const dSW = {
        x: lbbox.x - rd.center.x,
        y: lbbox.y + lbbox.h - rd.center.y,
      };

      switch (rd.handle) {
        case "nw":
          if (dNW.x !== 0) newScaleX = rx / dNW.x;
          if (dNW.y !== 0) newScaleY = ry / dNW.y;
          break;
        case "n":
          if (dNW.y !== 0) newScaleY = ry / dNW.y;
          break;
        case "ne":
          if (dNE.x !== 0) newScaleX = rx / dNE.x;
          if (dNE.y !== 0) newScaleY = ry / dNE.y;
          break;
        case "e":
          if (dNE.x !== 0) newScaleX = rx / dNE.x;
          break;
        case "se":
          if (dSE.x !== 0) newScaleX = rx / dSE.x;
          if (dSE.y !== 0) newScaleY = ry / dSE.y;
          break;
        case "s":
          if (dSE.y !== 0) newScaleY = ry / dSE.y;
          break;
        case "sw":
          if (dSW.x !== 0) newScaleX = rx / dSW.x;
          if (dSW.y !== 0) newScaleY = ry / dSW.y;
          break;
        case "w":
          if (dSW.x !== 0) newScaleX = rx / dSW.x;
          break;
      }

      // Shift 等比例约束
      if (ev.shiftKey) {
        const maxScale = Math.max(Math.abs(newScaleX), Math.abs(newScaleY));
        newScaleX = (newScaleX < 0 ? -1 : 1) * maxScale;
        newScaleY = (newScaleY < 0 ? -1 : 1) * maxScale;
      }

      const MIN_SCALE = 0.01;
      if (Math.abs(newScaleX) < MIN_SCALE)
        newScaleX = MIN_SCALE * Math.sign(newScaleX || 1);
      if (Math.abs(newScaleY) < MIN_SCALE)
        newScaleY = MIN_SCALE * Math.sign(newScaleY || 1);

      engine.setLayerTransformLive(doc, rd.layerId, {
        scaleX: newScaleX,
        scaleY: newScaleY,
      });
      redrawOverlay();
    };
    const resizeUp = () => {
      if (resizeDragRef.current) {
        engine.commitTransform(doc, "缩放图层");
        resizeDragRef.current = null;
      }
      window.removeEventListener("mousemove", resizeMove);
      window.removeEventListener("mouseup", resizeUp);
    };
    window.addEventListener("mousemove", resizeMove);
    window.addEventListener("mouseup", resizeUp);
  };

  /** 启动图层旋转拖拽。 */
  const startRotateDrag = (l: EngineLayer, pt: Pt): void => {
    if (!doc) return;
    const center = engine.getLayerCenter(l);
    const centerDoc = engine.layerLocalToDoc(l, center);
    const startAngle =
      (Math.atan2(pt.y - centerDoc.y, pt.x - centerDoc.x) * 180) / Math.PI;
    rotateDragRef.current = {
      layerId: l.id,
      startAngle,
      baseRotation: l.rotation,
    };
    const rotMove = (ev: MouseEvent) => {
      if (!rotateDragRef.current) return;
      const cur = coordsFromClient(ev.clientX, ev.clientY);
      if (!cur) return;
      const ang =
        (Math.atan2(cur.y - centerDoc.y, cur.x - centerDoc.x) * 180) / Math.PI;
      let newRot =
        rotateDragRef.current.baseRotation +
        (ang - rotateDragRef.current.startAngle);
      // Shift 吸附到 15° 倍数
      if (ev.shiftKey) newRot = Math.round(newRot / 15) * 15;
      // 归一化到 (-180, 180]
      while (newRot > 180) newRot -= 360;
      while (newRot <= -180) newRot += 360;
      engine.setLayerTransformLive(doc, rotateDragRef.current.layerId, {
        rotation: newRot,
      });
      redrawOverlay();
    };
    const rotUp = () => {
      if (rotateDragRef.current) {
        engine.commitTransform(doc, "旋转图层");
        rotateDragRef.current = null;
      }
      window.removeEventListener("mousemove", rotMove);
      window.removeEventListener("mouseup", rotUp);
    };
    window.addEventListener("mousemove", rotMove);
    window.addEventListener("mouseup", rotUp);
  };

  /** 形状图层专用：启动手柄拖拽修改 from/to(保持描边宽度不变)。返回是否命中手柄 */
  const startShapeResizeDrag = (l: EngineLayer, pt: Pt): boolean => {
    if (!doc || !l.shapeData) return false;
    const handle = hitTransformHandle(l, pt);
    if (!handle) return false;
    const bbox = engine.getLayerBBoxLocal(l, doc);
    const start = {
      x1: bbox.x,
      y1: bbox.y,
      x2: bbox.x + bbox.w,
      y2: bbox.y + bbox.h,
    };
    const MIN = 2;
    const move = (ev: MouseEvent) => {
      const cur = coordsFromClient(ev.clientX, ev.clientY);
      if (!cur) return;
      const local = engine.toLayerLocal(l, cur);
      let { x1, y1, x2, y2 } = start;
      if (handle.includes("w")) x1 = Math.min(local.x, x2 - MIN);
      if (handle.includes("e")) x2 = Math.max(local.x, x1 + MIN);
      if (handle.includes("n")) y1 = Math.min(local.y, y2 - MIN);
      if (handle.includes("s")) y2 = Math.max(local.y, y1 + MIN);
      engine.updateShapeGeometryLive(
        doc,
        l.id,
        { x: x1, y: y1 },
        { x: x2, y: y2 },
      );
      redrawOverlay();
    };
    const up = () => {
      engine.commitTransform(doc, "调整形状");
      window.removeEventListener("mousemove", move);
      window.removeEventListener("mouseup", up);
    };
    window.addEventListener("mousemove", move);
    window.addEventListener("mouseup", up);
    return true;
  };

  /* 画布主鼠标按下 — 根据工具分发 */
  const onCanvasMouseDown = (e: React.MouseEvent) => {
    if (!doc) return;
    // 中键 / 空格 / 抓手工具 → 平移视图
    if (e.button === 1 || spaceDown || s.activeTool === "hand") {
      e.preventDefault();
      startPan(e.clientX, e.clientY);
      return;
    }
    if (e.button !== 0) return;
    const pt = toCanvasCoords(e);
    if (!pt) return;
    const tool = s.activeTool;

    /* ---- 移动图层 ---- */
    if (tool === "move") {
      const layer = engine.getLayer(doc, doc.activeLayerId);
      if (!layer || layer.locked) return;

      // 先检测是否点击在拉伸控制点上
      const hitHandle = hitTransformHandle(layer, pt);
      if (hitHandle) {
        startResizeDrag(layer, hitHandle);
        return;
      }

      // 再检测是否点击在旋转手柄上
      if (hitRotateHandle(layer, pt)) {
        startRotateDrag(layer, pt);
        return;
      }
      // 否则执行图层移动
      const base = { x: layer.offsetX, y: layer.offsetY };
      let moved = false;
      const move = (ev: MouseEvent) => {
        const cur = coordsFromClient(ev.clientX, ev.clientY);
        if (!cur) return;
        moved = true;
        engine.moveLayerTo(
          doc,
          layer.id,
          base.x + cur.x - pt.x,
          base.y + cur.y - pt.y,
        );
      };
      const up = () => {
        if (moved) engine.commitMove(doc);
        window.removeEventListener("mousemove", move);
        window.removeEventListener("mouseup", up);
      };
      window.addEventListener("mousemove", move);
      window.addEventListener("mouseup", up);
      return;
    }

    /* ---- 画笔 / 橡皮 ---- */
    if (tool === "paintbrush" || tool === "eraser") {
      engine.beginStroke(doc, pt, {
        color: s.fgColor,
        size: s.brush.size,
        hardness: s.brush.hardness,
        opacity: s.brush.opacity,
        flow: s.brush.flow,
        eraser: tool === "eraser",
      });
      if (!engine.hasActiveStroke()) return; // 图层被锁定等
      const move = (ev: MouseEvent) => {
        const cur = coordsFromClient(ev.clientX, ev.clientY);
        if (cur) engine.strokeTo(doc, cur);
      };
      const up = () => {
        engine.endStroke(doc, tool === "eraser" ? "橡皮擦描边" : "画笔描边");
        window.removeEventListener("mousemove", move);
        window.removeEventListener("mouseup", up);
      };
      window.addEventListener("mousemove", move);
      window.addEventListener("mouseup", up);
      return;
    }

    /* ---- 形状 ---- */
    if (isShapeTool(tool)) {
      // 活动形状图层的手柄优先：拉伸(修改 from/to) / 旋转
      const active = engine.getLayer(doc, doc.activeLayerId);
      if (
        active &&
        active.kind === "shape" &&
        active.visible &&
        !active.locked
      ) {
        if (startShapeResizeDrag(active, pt)) return;
        if (hitRotateHandle(active, pt)) {
          startRotateDrag(active, pt);
          return;
        }
      }
      // 再命中检测：点击已有形状图层 → 进入重编辑(参考 Photoshop)
      const hit = engine.hitTestShapeLayer(doc, pt);
      if (hit && hit.shapeData) {
        engine.setActiveLayer(doc, hit.id);
        // 把该形状的参数同步到工具栏(便于编辑后应用)
        actions.setShape({
          kind: hit.shapeData.kind,
          lineWidth: hit.shapeData.size,
          fill: hit.shapeData.fill,
          sides: hit.shapeData.sides,
        });
        actions.setFgColor(hit.shapeData.color);
        // 清空该图层画布，进入预览拖拽(松手时提交)
        engine.clearShapeLayerCanvas(doc, hit.id);
        // 用原形状的 from/to 作为拖拽起点(允许直接拖拽手柄调整)
        shapeDrag.current = {
          mode: "edit",
          layerId: hit.id,
          from: {
            x: hit.shapeData.from.x + hit.offsetX,
            y: hit.shapeData.from.y + hit.offsetY,
          },
          to: {
            x: hit.shapeData.to.x + hit.offsetX,
            y: hit.shapeData.to.y + hit.offsetY,
          },
        };
      } else {
        // 新建形状：拖拽从当前点开始
        shapeDrag.current = { mode: "create", from: pt, to: pt };
      }
      redrawOverlay();
      const move = (ev: MouseEvent) => {
        const cur = coordsFromClient(ev.clientX, ev.clientY);
        if (!cur || !shapeDrag.current) return;
        shapeDrag.current.to = cur;
        redrawOverlay();
      };
      const up = (ev: MouseEvent) => {
        const drag = shapeDrag.current;
        shapeDrag.current = null;
        redrawOverlay();
        window.removeEventListener("mousemove", move);
        window.removeEventListener("mouseup", up);
        if (!drag) return;
        const to = coordsFromClient(ev.clientX, ev.clientY) || drag.to;
        const opts = {
          kind: s.shape.kind,
          color: s.fgColor,
          size: s.shape.lineWidth,
          opacity: s.brush.opacity,
          fill: s.shape.fill,
          sides: s.shape.sides,
        };
        if (drag.mode === "edit") {
          // 重编辑：若未拖动(点击即松开)，按原数据还原并保留选中
          const moved =
            Math.abs(to.x - drag.to.x) > 0.5 ||
            Math.abs(to.y - drag.to.y) > 0.5;
          if (moved) {
            engine.updateShapeLayer(doc, drag.layerId, drag.from, to, opts);
          } else {
            // 还原原画布
            engine.restoreShapeLayerCanvas(doc, drag.layerId);
          }
        } else {
          // 新建：过小则放弃
          const w = Math.abs(to.x - drag.from.x);
          const h = Math.abs(to.y - drag.from.y);
          if (w < 2 && h < 2) return;
          engine.addShapeLayer(doc, drag.from, to, opts);
        }
      };
      window.addEventListener("mousemove", move);
      window.addEventListener("mouseup", up);
      return;
    }

    /* ---- 文字 ---- */
    if (tool === "type") {
      // 阻止默认焦点转移，避免旧编辑框 blur 误关新编辑框(手动提交旧编辑)
      e.preventDefault();
      const wasEditing = !!textEditRef.current;
      if (textEditRef.current) commitEdit(textEditRef.current);
      // 活动文字图层的手柄优先：缩放 / 旋转(编辑会话中不触发)
      if (!wasEditing) {
        const active = engine.getLayer(doc, doc.activeLayerId);
        if (
          active &&
          active.kind === "text" &&
          active.visible &&
          !active.locked
        ) {
          const hitHandle = hitTransformHandle(active, pt);
          if (hitHandle) {
            startResizeDrag(active, hitHandle);
            return;
          }
          if (hitRotateHandle(active, pt)) {
            startRotateDrag(active, pt);
            return;
          }
        }
      }
      // 命中已有文字图层 → 进入编辑(参考 Photoshop：点击文字即可重编辑)
      const hit = engine.hitTestTextLayer(doc, pt);
      if (hit && hit.textData) {
        startTextEditExisting(hit);
        return;
      }
      // 否则新建文字编辑
      const id = ++editSeq.current;
      setTextEdit({
        id,
        layerId: null,
        x: pt.x,
        y: pt.y,
        w: Math.max(120, s.text.fontSize * 4),
        h: s.text.fontSize * 1.6,
        rotation: 0,
        value: "",
      });
      return;
    }

    /* ---- 吸管 ---- */
    if (tool === "pipette") {
      const hex = engine.pickColor(doc, pt.x, pt.y);
      if (hex) actions.setFgColor(hex);
      return;
    }

    /* ---- 颜色取样器 ---- */
    if (tool === "colorSampler") {
      if (e.altKey) {
        // Alt+点击: 删除最近的取样点(30px 范围内)
        if (s.colorSamples.length === 0) return;
        let nearestId = "";
        let nearestDist = Infinity;
        for (const sm of s.colorSamples) {
          const d = Math.hypot(sm.x - pt.x, sm.y - pt.y);
          if (d < nearestDist) {
            nearestDist = d;
            nearestId = sm.id;
          }
        }
        if (nearestId && nearestDist < 30) actions.removeColorSample(nearestId);
      } else {
        actions.addColorSample(pt.x, pt.y);
      }
      return;
    }

    /* ---- 标尺 ---- */
    if (tool === "ruler") {
      rulerDragRef.current = { from: pt, to: pt };
      redrawOverlay();
      const move = (ev: MouseEvent) => {
        const cur = coordsFromClient(ev.clientX, ev.clientY);
        if (!cur || !rulerDragRef.current) return;
        rulerDragRef.current.to = cur;
        const dx = cur.x - rulerDragRef.current.from.x;
        const dy = cur.y - rulerDragRef.current.from.y;
        actions.setRuler({
          from: rulerDragRef.current.from,
          to: cur,
          distance: Math.hypot(dx, dy),
          angle: (Math.atan2(dy, dx) * 180) / Math.PI,
          w: dx,
          h: dy,
        });
      };
      const up = () => {
        rulerDragRef.current = null;
        redrawOverlay();
        window.removeEventListener("mousemove", move);
        window.removeEventListener("mouseup", up);
      };
      window.addEventListener("mousemove", move);
      window.addEventListener("mouseup", up);
      return;
    }

    /* ---- 仿制图章 ---- */
    if (tool === "cloneStamp") {
      if (e.altKey) {
        // Alt+点击: 设置源点
        actions.setCloneSource(pt.x, pt.y);
        return;
      }
      if (!s.cloneSource) return; // 未设置源点
      engine.beginCloneStroke(
        doc,
        pt,
        s.cloneSource,
        {
          color: s.fgColor,
          size: s.cloneStamp.size,
          hardness: s.cloneStamp.hardness,
          opacity: s.cloneStamp.opacity,
          flow: s.cloneStamp.flow,
        },
        s.cloneStamp.aligned,
        s.cloneStamp.sampleAllLayers,
      );
      if (!engine.hasActiveCloneStroke()) return;
      const move = (ev: MouseEvent) => {
        const cur = coordsFromClient(ev.clientX, ev.clientY);
        if (cur) engine.cloneStrokeTo(doc, cur);
      };
      const up = () => {
        engine.endCloneStroke(doc, "仿制图章描边");
        window.removeEventListener("mousemove", move);
        window.removeEventListener("mouseup", up);
      };
      window.addEventListener("mousemove", move);
      window.addEventListener("mouseup", up);
      return;
    }

    /* ---- 选区工具：根据修饰键决定操作模式 ----
     * Shift=添加 / Alt=减去 / Shift+Alt=交集 / 无=新建
     */
    const isSelTool =
      tool === "lasso" ||
      tool === "polygonal-lasso" ||
      tool === "magnetic-lasso" ||
      tool === "object-select" ||
      tool === "quick-select" ||
      tool === "magic-wand";
    if (isSelTool) {
      curOpRef.current =
        e.shiftKey && e.altKey
          ? "intersect"
          : e.shiftKey
            ? "add"
            : e.altKey
              ? "subtract"
              : "new";
    }

    /* ---- 套索(自由拖拽) ---- */
    if (tool === "lasso") {
      lassoPathRef.current = [pt];
      lassoActiveRef.current = true;
      mouseDownRef.current = true;
      redrawOverlay();
      const move = (ev: MouseEvent) => {
        if (!mouseDownRef.current) return;
        const cur = coordsFromClient(ev.clientX, ev.clientY);
        if (!cur) return;
        const pts = lassoPathRef.current;
        const last = pts[pts.length - 1];
        if (Math.hypot(cur.x - last.x, cur.y - last.y) >= 2) {
          pts.push(cur);
          redrawOverlay();
        }
      };
      const up = () => {
        mouseDownRef.current = false;
        lassoActiveRef.current = false;
        const pts = lassoPathRef.current;
        lassoPathRef.current = [];
        redrawOverlay();
        window.removeEventListener("mousemove", move);
        window.removeEventListener("mouseup", up);
        if (pts.length >= 3) {
          engine.selectPolygon(doc, pts, curOpRef.current);
          engine.commitSelection(doc, "套索选区");
        }
      };
      window.addEventListener("mousemove", move);
      window.addEventListener("mouseup", up);
      return;
    }

    /* ---- 多边形套索(单击加点) ---- */
    if (tool === "polygonal-lasso") {
      // 若靠近起点且已有 ≥3 点 → 闭合
      if (polyActiveRef.current && polyPointsRef.current.length >= 3) {
        const start = polyPointsRef.current[0];
        const threshold = Math.max(6, (6 * 100) / zoom);
        if (Math.hypot(pt.x - start.x, pt.y - start.y) <= threshold) {
          engine.selectPolygon(doc, polyPointsRef.current, curOpRef.current);
          engine.commitSelection(doc, "多边形套索选区");
          polyPointsRef.current = [];
          polyActiveRef.current = false;
          redrawOverlay();
          return;
        }
      }
      polyActiveRef.current = true;
      polyPointsRef.current.push(pt);
      redrawOverlay();
      return;
    }

    /* ---- 磁性套索(拖拽采集 → 边缘对齐) ---- */
    if (tool === "magnetic-lasso") {
      lassoPathRef.current = [pt];
      lassoActiveRef.current = true;
      mouseDownRef.current = true;
      redrawOverlay();
      const move = (ev: MouseEvent) => {
        if (!mouseDownRef.current) return;
        const cur = coordsFromClient(ev.clientX, ev.clientY);
        if (!cur) return;
        const pts = lassoPathRef.current;
        const last = pts[pts.length - 1];
        if (Math.hypot(cur.x - last.x, cur.y - last.y) >= 2) {
          pts.push(cur);
          redrawOverlay();
        }
      };
      const up = () => {
        mouseDownRef.current = false;
        lassoActiveRef.current = false;
        const pts = lassoPathRef.current;
        lassoPathRef.current = [];
        redrawOverlay();
        window.removeEventListener("mousemove", move);
        window.removeEventListener("mouseup", up);
        if (pts.length >= 3) {
          const path = engine.buildMagneticPath(
            doc,
            pts,
            {
              width: s.selection.magneticWidth,
              contrast: s.selection.magneticContrast,
              frequency: s.selection.magneticFrequency,
            },
            s.selection.allLayers ? "all" : "active",
          );
          engine.selectPolygon(doc, path, curOpRef.current);
          engine.commitSelection(doc, "磁性套索选区");
        }
      };
      window.addEventListener("mousemove", move);
      window.addEventListener("mouseup", up);
      return;
    }

    /* ---- 对象选择(矩形/套索模式) ---- */
    if (tool === "object-select") {
      if (s.selection.lassoMode) {
        // 自由套索模式
        lassoPathRef.current = [pt];
        lassoActiveRef.current = true;
        mouseDownRef.current = true;
        redrawOverlay();
        const move = (ev: MouseEvent) => {
          if (!mouseDownRef.current) return;
          const cur = coordsFromClient(ev.clientX, ev.clientY);
          if (!cur) return;
          const pts = lassoPathRef.current;
          const last = pts[pts.length - 1];
          if (Math.hypot(cur.x - last.x, cur.y - last.y) >= 2) {
            pts.push(cur);
            redrawOverlay();
          }
        };
        const up = () => {
          mouseDownRef.current = false;
          lassoActiveRef.current = false;
          const pts = lassoPathRef.current;
          lassoPathRef.current = [];
          redrawOverlay();
          window.removeEventListener("mousemove", move);
          window.removeEventListener("mouseup", up);
          if (pts.length >= 3) {
            engine.selectPolygon(doc, pts, curOpRef.current);
            engine.commitSelection(doc, "对象选择(套索)");
          }
        };
        window.addEventListener("mousemove", move);
        window.addEventListener("mouseup", up);
      } else {
        // 矩形模式
        rectDragRef.current = { from: pt, to: pt };
        mouseDownRef.current = true;
        redrawOverlay();
        const move = (ev: MouseEvent) => {
          if (!mouseDownRef.current) return;
          const cur = coordsFromClient(ev.clientX, ev.clientY);
          if (!cur || !rectDragRef.current) return;
          rectDragRef.current.to = cur;
          redrawOverlay();
        };
        const up = (ev: MouseEvent) => {
          mouseDownRef.current = false;
          const drag = rectDragRef.current;
          rectDragRef.current = null;
          redrawOverlay();
          window.removeEventListener("mousemove", move);
          window.removeEventListener("mouseup", up);
          if (!drag) return;
          const to = coordsFromClient(ev.clientX, ev.clientY) || drag.to;
          const x = Math.min(drag.from.x, to.x);
          const y = Math.min(drag.from.y, to.y);
          const w = Math.abs(to.x - drag.from.x);
          const h = Math.abs(to.y - drag.from.y);
          if (w >= 2 && h >= 2) {
            engine.selectRect(doc, { x, y, w, h }, curOpRef.current);
            engine.commitSelection(doc, "对象选择(矩形)");
          }
        };
        window.addEventListener("mousemove", move);
        window.addEventListener("mouseup", up);
      }
      return;
    }

    /* ---- 快速选择(笔刷涂抹) ---- */
    if (tool === "quick-select") {
      const size = s.selection.brushSize;
      quickSelLastRef.current = pt;
      // 起点圆点
      engine.paintSelectionBrush(doc, pt, pt, size, curOpRef.current);
      redrawOverlay();
      const move = (ev: MouseEvent) => {
        if (!mouseDownRef.current) return;
        const cur = coordsFromClient(ev.clientX, ev.clientY);
        if (!cur) return;
        const last = quickSelLastRef.current;
        if (last) {
          engine.paintSelectionBrush(doc, last, cur, size, curOpRef.current);
        }
        quickSelLastRef.current = cur;
        redrawOverlay();
      };
      const up = () => {
        mouseDownRef.current = false;
        quickSelLastRef.current = null;
        window.removeEventListener("mousemove", move);
        window.removeEventListener("mouseup", up);
        engine.commitSelection(doc, "快速选择");
      };
      window.addEventListener("mousemove", move);
      window.addEventListener("mouseup", up);
      return;
    }

    /* ---- 魔棒(点击同色 flood fill) ---- */
    if (tool === "magic-wand") {
      engine.magicWand(
        doc,
        pt,
        {
          tolerance: s.selection.tolerance,
          contiguous: s.selection.contiguous,
          source: s.selection.allLayers ? "all" : "active",
        },
        curOpRef.current,
      );
      engine.commitSelection(doc, "魔棒选区");
      return;
    }

    /* ---- 油漆桶 ---- */
    if (tool === "paintBucket") {
      engine.paintBucket(doc, pt, {
        color: s.paintBucket.color,
        tolerance: s.paintBucket.tolerance,
        contiguous: s.paintBucket.contiguous,
        source: s.paintBucket.allLayers ? "all" : "active",
        opacity: s.paintBucket.opacity,
      });
      return;
    }
  };

  /* 多边形套索：双击闭合 */
  const onCanvasDoubleClick = (e: React.MouseEvent) => {
    if (s.activeTool !== "polygonal-lasso") return;
    if (!doc) return;
    if (polyPointsRef.current.length >= 3) {
      engine.selectPolygon(doc, polyPointsRef.current, curOpRef.current);
      engine.commitSelection(doc, "多边形套索选区");
      polyPointsRef.current = [];
      polyActiveRef.current = false;
      redrawOverlay();
    }
  };

  /* 鼠标移动 — 状态栏坐标 + 笔刷光标 + 控制点悬停检测 */
  const onCanvasMouseMove = (e: React.MouseEvent) => {
    const pt = toCanvasCoords(e);
    if (!pt) return;
    cursorActions.set(Math.floor(pt.x), Math.floor(pt.y));
    hoverPt.current = pt;
    if (
      s.activeTool === "paintbrush" ||
      s.activeTool === "eraser" ||
      s.activeTool === "cloneStamp" ||
      s.activeTool === "quick-select" ||
      s.activeTool === "polygonal-lasso" ||
      s.activeTool === "paintBucket"
    )
      redrawOverlay();
    // move 工具: 检测是否悬停在控制点上(拖拽中不更新)
    if (
      s.activeTool === "move" &&
      doc &&
      !rotateDragRef.current &&
      !resizeDragRef.current
    ) {
      const layer = engine.getLayer(doc, doc.activeLayerId);
      if (layer && layer.visible && !layer.locked) {
        const center = engine.getLayerCenter(layer);
        const bbox = engine.getLayerBBoxLocal(layer, doc);
        const handleHitRadius = 10 / zoom;

        // 先检测拉伸控制点
        let hitHandleName: string | null = null;
        for (const h of TRANSFORM_HANDLES) {
          const local = h.local(bbox, center);
          const docPt = engine.layerLocalToDoc(layer, local);
          if (Math.hypot(pt.x - docPt.x, pt.y - docPt.y) <= handleHitRadius) {
            hitHandleName = h.name;
            break;
          }
        }
        if (hitHandleName) {
          setHoveringResizeHandle(hitHandleName);
          setHoveringHandle(false);
        } else {
          setHoveringResizeHandle(null);
          // 再检测旋转手柄
          const handleOffsetDoc = 16 / zoom;
          const handleDoc = engine.layerLocalToDoc(layer, {
            x: center.x,
            y: bbox.y - handleOffsetDoc,
          });
          const dist = Math.hypot(pt.x - handleDoc.x, pt.y - handleDoc.y);
          setHoveringHandle(dist <= handleHitRadius);
        }
      } else {
        setHoveringResizeHandle(null);
        setHoveringHandle(false);
      }
    } else if (hoveringResizeHandle || hoveringHandle) {
      setHoveringResizeHandle(null);
      setHoveringHandle(false);
    }
  };
  const onCanvasMouseLeave = () => {
    cursorActions.hide();
    hoverPt.current = null;
    if (hoveringHandle) setHoveringHandle(false);
    if (hoveringResizeHandle) setHoveringResizeHandle(null);
    redrawOverlay();
  };

  /* 滚轮缩放 */
  const onWheel = (e: React.WheelEvent) => {
    if (!doc) return;
    const next = e.deltaY < 0 ? zoom * 1.15 : zoom / 1.15;
    actions.setZoom(Math.round(next));
  };

  /* 拖拽放置图片：仅允许文件类型，给 dropEffect 视觉提示 */
  const onCanvasDragOver = (e: React.DragEvent) => {
    if (e.dataTransfer.types.includes("Files")) {
      e.preventDefault();
      e.dataTransfer.dropEffect = "copy";
    }
  };

  /* 拖拽放置：把图片文件作为新图层导入到当前文档(无文档时自动新建) */
  const onCanvasDrop = async (e: React.DragEvent) => {
    if (!e.dataTransfer.files || e.dataTransfer.files.length === 0) return;
    const files = Array.from(e.dataTransfer.files).filter((f) =>
      f.type.startsWith("image/"),
    );
    if (files.length === 0) return;
    e.preventDefault();
    // 计算 drop 点对应的文档像素坐标(若有文档)，作为图片左上角
    let pos: { x: number; y: number } | undefined;
    if (hasDoc) {
      const p = coordsFromClient(e.clientX, e.clientY);
      if (p) pos = p;
    }
    for (const f of files) {
      await actions.importFileAsLayer(f, pos);
    }
  };

  /* 全局粘贴：从剪贴板提取图片作为新图层导入(文字编辑中不拦截) */
  useEffect(() => {
    const onPaste = async (e: ClipboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (
        t instanceof HTMLElement &&
        t.closest("input,textarea,[contenteditable='true']")
      ) {
        return;
      }
      const handled = await actions.pasteClipboardImage(e);
      if (handled) e.preventDefault();
    };
    window.addEventListener("paste", onPaste);
    return () => window.removeEventListener("paste", onPaste);
  }, []);

  /* 应用裁剪 */
  const applyCrop = () => {
    if (!doc) return;
    const x = (sel.left / 100) * doc.width;
    const y = (sel.top / 100) * doc.height;
    const w = (sel.width / 100) * doc.width;
    const h = (sel.height / 100) * doc.height;
    actions.cropToSelection({ x, y, w, h });
    setSel({ top: 10, left: 10, width: 80, height: 80 });
  };

  const cursorFor = (): string => {
    if (spaceDown || s.activeTool === "hand") return "grab";
    if (isShapeTool(s.activeTool)) return "crosshair";
    switch (s.activeTool) {
      case "move":
        if (hoveringResizeHandle) {
          const h = TRANSFORM_HANDLES.find(
            (x) => x.name === hoveringResizeHandle,
          );
          return h ? h.cursor : "default";
        }
        return hoveringHandle || rotateDragRef.current ? "grab" : "move";
      case "paintbrush":
      case "eraser":
      case "cloneStamp":
      case "quick-select":
        return "none"; // 用笔刷圆圈光标
      case "crop":
      case "colorSampler":
      case "ruler":
      case "lasso":
      case "polygonal-lasso":
      case "magnetic-lasso":
      case "object-select":
      case "magic-wand":
      case "paintBucket":
        return "crosshair";
      case "type":
        return "text";
      case "pipette":
        return "copy";
      default:
        return "default";
    }
  };

  const cssW = doc ? (doc.width * zoom) / 100 : 0;
  const cssH = doc ? (doc.height * zoom) / 100 : 0;

  return (
    <div
      style={{
        display: "flex",
        flex: 1,
        minHeight: 0,
        overflow: "hidden",
        background: "var(--pe-canvas-bg)",
      }}
    >
      {/* 垂直标尺 */}
      <div className="ruler-v" style={{ width: 20, flexShrink: 0 }}>
        <div
          style={{
            width: 20,
            height: 20,
            background: "#D4D4D4",
            position: "absolute",
            top: 0,
            left: 0,
            zIndex: 1,
          }}
        />
        <div className="ruler-ticks-v" />
        <div className="ruler-ticks-v-fine" />
      </div>
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          flex: 1,
          minWidth: 0,
          minHeight: 0,
        }}
      >
        {/* 水平标尺 */}
        <div className="ruler-h" style={{ height: 20, flexShrink: 0 }}>
          <div className="ruler-ticks-h" />
          <div className="ruler-ticks-h-fine" />
        </div>
        {/* 画布主区 */}
        <div
          className="checkerboard-bg"
          ref={containerRef}
          onWheel={onWheel}
          onDragOver={onCanvasDragOver}
          onDrop={onCanvasDrop}
          style={{
            flex: 1,
            minHeight: 0,
            overflow: "hidden",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            position: "relative",
          }}
        >
          {!hasDoc ? (
            <EmptyCanvas />
          ) : (
            <div
              ref={wrapperRef}
              style={{
                position: "relative",
                transform: `translate(${pan.x}px, ${pan.y}px)`,
                boxShadow: "0 2px 16px rgba(0,0,0,0.18)",
              }}
            >
              <canvas
                ref={canvasRef}
                onMouseDown={onCanvasMouseDown}
                onMouseMove={onCanvasMouseMove}
                onMouseLeave={onCanvasMouseLeave}
                onDoubleClick={onCanvasDoubleClick}
                style={{
                  display: "block",
                  filter,
                  cursor: cursorFor(),
                  width: `${cssW}px`,
                  height: `${cssH}px`,
                  imageRendering: zoom >= 200 ? "pixelated" : "auto",
                }}
              />
              {/* overlay: 笔刷光标 / 形状预览 */}
              <canvas
                ref={overlayRef}
                style={{
                  position: "absolute",
                  left: 0,
                  top: 0,
                  width: `${cssW}px`,
                  height: `${cssH}px`,
                  pointerEvents: "none",
                }}
              />
              {/* 文字就地编辑(支持手柄拖拽调整宽高 / 旋转) */}
              {textEdit && (
                <div
                  style={{
                    position: "absolute",
                    left: (textEdit.x * zoom) / 100,
                    top: (textEdit.y * zoom) / 100,
                    width: (textEdit.w * zoom) / 100,
                    height: (textEdit.h * zoom) / 100,
                    transform: `rotate(${textEdit.rotation}deg)`,
                    transformOrigin: "center center",
                    zIndex: 6,
                  }}
                >
                  <textarea
                    ref={textAreaRef}
                    value={textEdit.value}
                    placeholder="输入文字"
                    onChange={(e) =>
                      setTextEdit({ ...textEdit, value: e.target.value })
                    }
                    onKeyDown={(e) => {
                      e.stopPropagation();
                      if (e.key === "Escape") {
                        cancelEdit(textEdit);
                      } else if (
                        e.key === "Enter" &&
                        (e.ctrlKey || e.metaKey)
                      ) {
                        e.preventDefault();
                        commitEdit(textEdit);
                      }
                    }}
                    onBlur={() => commitEdit(textEdit)}
                    style={{
                      width: "100%",
                      height: "100%",
                      fontSize: (s.text.fontSize * zoom) / 100,
                      fontWeight: s.text.bold ? 700 : 400,
                      color: s.fgColor,
                      lineHeight: 1.25,
                      background: "transparent",
                      border: "1px dashed var(--pe-selection-border)",
                      outline: "none",
                      resize: "none",
                      overflow: "hidden",
                      padding: 0,
                      margin: 0,
                      fontFamily: s.text.fontFamily,
                      whiteSpace: "pre-wrap",
                      wordBreak: "break-word",
                      boxSizing: "border-box",
                    }}
                  />
                  {/* 旋转手柄(连接线 + 圆点) */}
                  <div
                    style={{
                      position: "absolute",
                      left: "50%",
                      top: -14,
                      width: 1,
                      height: 14,
                      background: "#0078D4",
                      pointerEvents: "none",
                    }}
                  />
                  <div
                    onMouseDown={startEditRotate}
                    title="拖拽旋转"
                    style={{
                      position: "absolute",
                      left: "50%",
                      top: -26,
                      marginLeft: -6,
                      width: 12,
                      height: 12,
                      borderRadius: "50%",
                      background: "#FFFFFF",
                      border: "1px solid #0078D4",
                      boxSizing: "border-box",
                      cursor: "grab",
                    }}
                  />
                  {/* 8 个拉伸手柄 */}
                  {TEXT_BOX_HANDLES.map((h) => (
                    <div
                      key={h.name}
                      onMouseDown={startEditResize(h.name)}
                      style={{
                        position: "absolute",
                        width: 8,
                        height: 8,
                        background: "#FFFFFF",
                        border: "1px solid #0078D4",
                        boxSizing: "border-box",
                        cursor: h.cursor,
                        ...h.style,
                      }}
                    />
                  ))}
                </div>
              )}
              {/* 选区框(仅裁剪工具显示) */}
              {s.activeTool === "crop" && (
                <>
                  <div
                    className="selection-rect"
                    style={{
                      top: `${sel.top}%`,
                      left: `${sel.left}%`,
                      width: `${sel.width}%`,
                      height: `${sel.height}%`,
                      cursor: "move",
                    }}
                    onMouseDown={onHandleDown("move")}
                  >
                    <div
                      className="sel-handle"
                      style={{ top: -3, left: -3, cursor: "nwse-resize" }}
                      onMouseDown={onHandleDown("nw")}
                    />
                    <div
                      className="sel-handle"
                      style={{ top: -3, right: -3, cursor: "nesw-resize" }}
                      onMouseDown={onHandleDown("ne")}
                    />
                    <div
                      className="sel-handle"
                      style={{ bottom: -3, left: -3, cursor: "nesw-resize" }}
                      onMouseDown={onHandleDown("sw")}
                    />
                    <div
                      className="sel-handle"
                      style={{ bottom: -3, right: -3, cursor: "nwse-resize" }}
                      onMouseDown={onHandleDown("se")}
                    />
                    <div
                      className="sel-handle"
                      style={{
                        top: -3,
                        left: "50%",
                        marginLeft: -3,
                        cursor: "ns-resize",
                      }}
                      onMouseDown={onHandleDown("n")}
                    />
                    <div
                      className="sel-handle"
                      style={{
                        bottom: -3,
                        left: "50%",
                        marginLeft: -3,
                        cursor: "ns-resize",
                      }}
                      onMouseDown={onHandleDown("s")}
                    />
                    <div
                      className="sel-handle"
                      style={{
                        left: -3,
                        top: "50%",
                        marginTop: -3,
                        cursor: "ew-resize",
                      }}
                      onMouseDown={onHandleDown("w")}
                    />
                    <div
                      className="sel-handle"
                      style={{
                        right: -3,
                        top: "50%",
                        marginTop: -3,
                        cursor: "ew-resize",
                      }}
                      onMouseDown={onHandleDown("e")}
                    />
                  </div>
                  {/* 裁剪应用按钮 */}
                  <button
                    onClick={applyCrop}
                    style={{
                      position: "absolute",
                      top: `${Math.min(98, sel.top + sel.height + 1)}%`,
                      left: `${sel.left}%`,
                      display: "flex",
                      alignItems: "center",
                      gap: 4,
                      padding: "2px 8px",
                      background: "var(--pe-primary)",
                      color: "#fff",
                      border: "none",
                      borderRadius: 2,
                      fontSize: 11,
                      cursor: "pointer",
                      zIndex: 5,
                    }}
                  >
                    <CropIcon size={11} /> 应用裁剪
                  </button>
                </>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

/* 空画布占位 */
const EmptyCanvas: React.FC = () => {
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        gap: 12,
        color: "var(--pe-muted-foreground)",
        fontSize: "var(--pe-font-size-md)",
        userSelect: "none",
        textAlign: "center",
      }}
    >
      <ImageIcon
        size={56}
        color="var(--pe-muted-foreground)"
        style={{ opacity: 0.4 }}
      />
      <span>暂未加载图片</span>
      <div style={{ display: "flex", gap: 8, marginTop: 4 }}>
        <button
          onClick={() => actions.openFileDialog()}
          style={{
            display: "flex",
            alignItems: "center",
            gap: 6,
            padding: "6px 14px",
            background: "var(--pe-primary)",
            color: "#fff",
            border: "none",
            borderRadius: 3,
            cursor: "pointer",
            fontSize: 12,
          }}
        >
          <FolderOpen size={14} /> 打开图片
        </button>
        <button
          onClick={() => actions.newBlankDocument()}
          style={{
            display: "flex",
            alignItems: "center",
            gap: 6,
            padding: "6px 14px",
            background: "var(--pe-card)",
            color: "var(--pe-foreground)",
            border: "1px solid var(--pe-border)",
            borderRadius: 3,
            cursor: "pointer",
            fontSize: 12,
          }}
        >
          <FilePlus size={14} /> 新建空白
        </button>
      </div>
      <span style={{ fontSize: 11, opacity: 0.7 }}>
        支持 JPG / PNG / GIF / WebP / BMP
      </span>
      <span style={{ fontSize: 11, opacity: 0.7 }}>
        也可拖拽 / Ctrl+V 粘贴图片到此处
      </span>
    </div>
  );
};

export default CenterArea;
