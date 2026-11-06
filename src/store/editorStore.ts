/*
 * fat-photo 编辑器单例 store
 * ----------------------------------------------------------------------------
 * 两个独立 React 树(主侧边栏 ControlMenusPage / 工作区 WorkPage)共享此状态。
 * 用 useSyncExternalStore 订阅。
 *
 * 真正的画布/像素数据由 engine 持有(见 editor/engine.ts)；本 store 仅持有
 * 可序列化的元数据 + 版本号，并在 engine emit 后重新派生 active 文档的状态。
 *
 * 状态持久化：通过 sdk.config API 将 UI 状态保存到宿主配置文件，下次启动时恢复。
 */
import { useSyncExternalStore } from "react";
import type { FatNotesPluginSDK } from "fat-notes-sdk";
import {
  engine,
  DEFAULT_FONT_FAMILY,
  PROJECT_EXT,
  PROJECT_MIME,
  PROJECT_VERSION,
  type DocumentEngine,
  type EngineLayer,
  type ProjectJSON,
} from "../editor/engine";

/* ============ 工程文件句柄缓存 ============
 * 用 File System Access API 保留句柄，使「保存」可直写上次位置，
 * 不必每次都弹另存为对话框。key = docId，value = FileSystemFileHandle。
 * 注意：句柄不可进入 React state(不可变比较无意义)，故放在模块作用域。
 */
const projectHandles = new Map<string, FileSystemFileHandle>();

/* ============ 未保存修改标记缓存 ============
 * 记录每个文档最近一次保存时的 (history.length, currentHistoryIndex)。
 * deriveTabs 时与当前值比较：任一不一致 → tab 显示 * 未保存提示。
 * - pushHistory 会改变 history.length → dirty
 * - 撤销/重做 会改变 currentHistoryIndex → dirty
 * - 撤销后又重做回原位置 → 两值都恢复 → 不 dirty(符合预期)
 */
interface SavedMarker {
  len: number;
  idx: number;
}
const savedHistoryMarkers = new Map<string, SavedMarker>();

/** 标记某文档为「已保存」(记录当前历史指针与长度) */
const markProjectSaved = (docId: string) => {
  const doc = engine.get(docId);
  if (!doc) {
    savedHistoryMarkers.delete(docId);
    return;
  }
  savedHistoryMarkers.set(docId, {
    len: doc.history.length,
    idx: doc.currentHistoryIndex,
  });
};

/** 判断某文档是否有未保存的修改 */
const isProjectDirty = (docId: string): boolean => {
  const doc = engine.get(docId);
  if (!doc) return false;
  const marker = savedHistoryMarkers.get(docId);
  if (!marker) return true; // 无标记(从未保存过) → 视为有未保存修改
  return (
    doc.history.length !== marker.len ||
    doc.currentHistoryIndex !== marker.idx
  );
};

/* ============ 类型定义 ============ */
export type ToolId =
  | "move"
  | "hand"
  | "crop"
  | "paintbrush"
  | "eraser"
  | "paintBucket"
  | "type"
  // 形状工具组(每组对应一种 ShapeKind)
  | "shape-rect"
  | "shape-ellipse"
  | "shape-circle"
  | "shape-triangle"
  | "shape-polygon"
  | "shape-star"
  | "shape-line"
  | "pipette"
  // 吸管工具组
  | "colorSampler"
  | "ruler"
  // 仿制图章
  | "cloneStamp"
  // 套索工具组
  | "lasso"
  | "polygonal-lasso"
  | "magnetic-lasso"
  // 对象选择工具组
  | "object-select"
  | "quick-select"
  | "magic-wand";

/** 工具组：同组工具在工具条共享一个按钮位，长按/右键弹出子菜单切换 */
export type ToolGroupId =
  | "move"
  | "hand"
  | "crop"
  | "paintbrush"
  | "eraser"
  | "paintBucket"
  | "type"
  | "shape-group"
  | "eyedropper-group"
  | "cloneStamp"
  | "lasso-group"
  | "object-select-group";

export interface ToolMeta {
  id: ToolId;
  icon: string;
  title: string;
  shortcut: string;
  statusName: string;
  /** 所属工具组；省略表示独立按钮 */
  group?: ToolGroupId;
}

/** 选区操作模式（修饰键决定） */
export type SelectionOp = "new" | "add" | "subtract" | "intersect";

/** 颜色取样器：固定的拾色点(Photoshop 最多 4 个) */
export interface ColorSample {
  id: string;
  /** 文档像素坐标 */
  x: number;
  y: number;
  /** 取样时合成画布的颜色 #RRGGBB */
  color: string;
}

/** 标尺工具：一次拖动得到的测量结果 */
export interface RulerMeasurement {
  from: { x: number; y: number };
  to: { x: number; y: number };
  /** 像素距离 */
  distance: number;
  /** 角度(度, 0 = 水平向右, 顺时针为正) */
  angle: number;
  /** 水平分量 */
  w: number;
  /** 垂直分量 */
  h: number;
}

/** 仿制图章设置 */
export interface CloneStampSettings {
  size: number;
  hardness: number;
  opacity: number;
  flow: number;
  /** 对齐：开启时源点随笔触同步偏移；关闭时每次落笔都从原源点开始 */
  aligned: boolean;
  /** 是否对所有可见图层取样(否则仅当前图层) */
  sampleAllLayers: boolean;
}

/** 油漆桶设置 */
export interface PaintBucketSettings {
  /** 填充颜色 */
  color: string;
  /** 颜色容差 0-255 */
  tolerance: number;
  /** 是否仅填充连续区域 */
  contiguous: boolean;
  /** 是否对所有可见图层取样(否则仅当前图层) */
  allLayers: boolean;
  /** 填充不透明度 0-100 */
  opacity: number;
}

export interface Layer {
  id: string;
  name: string;
  /** 缩略图背景 CSS */
  thumb: string;
  visible: boolean;
  locked: boolean;
  /** 图层类型：普通像素 / 可编辑文字 / 可编辑形状 */
  kind: "image" | "text" | "shape";
}

export interface HistoryEntry {
  id: string;
  step: number;
  label: string;
}

export interface Tab {
  id: string;
  name: string;
  icon: "image" | "file-image";
  /** 是否有未保存的修改(显示 * 提示) */
  dirty: boolean;
}

export interface BrushState {
  size: number;
  hardness: number;
  opacity: number;
  flow: number;
  mode: string;
}

export type ShapeKind =
  | "rect"
  | "ellipse"
  | "line"
  | "circle"
  | "triangle"
  | "polygon"
  | "star";

export interface ShapeSettings {
  kind: ShapeKind;
  fill: boolean;
  /** 描边宽度 */
  lineWidth: number;
  /** 多边形/星星的边数(仅 polygon/star 使用) */
  sides: number;
}

export interface TextSettings {
  fontSize: number;
  bold: boolean;
  italic: boolean;
  underline: boolean;
  strikethrough: boolean;
  /** 字体(font-family 值，见 engine.TEXT_FONTS) */
  fontFamily: string;
}

/** 选区工具的通用设置（容差/笔刷大小/是否连续/是否对所有图层取样） */
export interface SelectionSettings {
  /** 魔棒/快速选择的颜色容差，0-255 */
  tolerance: number;
  /** 魔棒是否仅选择相邻像素 */
  contiguous: boolean;
  /** 快速选择笔刷大小 */
  brushSize: number;
  /** 是否对所有可见图层取样（否则仅当前图层） */
  allLayers: boolean;
  /** 对象选择是否启用「套索模式」（拖动为自由套索；否则为矩形） */
  lassoMode: boolean;
  /** 磁性套索：边缘对齐灵敏度（宽度 px + 频率 + 对比度阈值 0-100） */
  magneticWidth: number;
  magneticContrast: number;
  magneticFrequency: number;
}

export interface TransformState {
  x: number;
  y: number;
  w: number;
  h: number;
  rotation: number;
  lockRatio: boolean;
  /** 内容未缩放时的原始宽(用于 W→scaleX 换算) */
  origW: number;
  /** 内容未缩放时的原始高(用于 H→scaleY 换算) */
  origH: number;
}

export interface Adjustments {
  brightness: number;
  contrast: number;
  saturation: number;
  temperature: number;
}

export interface EditorState {
  activeTool: ToolId;
  zoom: number;
  layers: Layer[];
  activeLayerId: string;
  layerOpacity: number;
  layerBlendMode: string;
  history: HistoryEntry[];
  currentHistoryId: string;
  brush: BrushState;
  shape: ShapeSettings;
  text: TextSettings;
  /** 选区工具（套索/对象选择/快速选择/魔棒）的共用设置 */
  selection: SelectionSettings;
  /** 仿制图章设置 */
  cloneStamp: CloneStampSettings;
  /** 油漆桶设置 */
  paintBucket: PaintBucketSettings;
  transform: TransformState;
  adjustments: Adjustments;
  fgColor: string;
  bgColor: string;
  tabs: Tab[];
  activeTabId: string;
  collapsedSections: Record<string, boolean>;
  /** 当前是否有打开的文档 */
  hasDocument: boolean;
  /** 文档画布宽度(像素) — 用于信息面板显示，区别于活动图层变换的 w */
  docWidth: number;
  /** 文档画布高度(像素) */
  docHeight: number;
  /** 「适合屏幕」请求信号，自增触发画布重新适配 */
  fitSignal: number;
  /** 选区是否存在（仅在切换文档/清空时用于驱动视图刷新） */
  hasSelection: boolean;
  /** 颜色取样器点(每文档独立，切换 tab 时重置；最多 4 个) */
  colorSamples: ColorSample[];
  /** 标尺工具最近一次测量结果(切换 tab 时重置) */
  ruler: RulerMeasurement | null;
  /** 仿制图章源点(文档像素坐标, Alt+点击设置) */
  cloneSource: { x: number; y: number } | null;
  /** 请求进入文字就地编辑的信号(自增触发)；与 requestTextEditLayerId 配合 */
  textEditSignal: number;
  /** 配合 textEditSignal：要编辑的文字图层 id；null 表示新建 */
  requestTextEditLayerId: string | null;
  /** 请求进入形状重编辑的信号(自增触发)；与 requestShapeEditLayerId 配合 */
  shapeEditSignal: number;
  /** 配合 shapeEditSignal：要重编辑的形状图层 id */
  requestShapeEditLayerId: string | null;
  /** 导出格式 */
  exportFormat: "png" | "jpeg" | "webp" | "svg";
  /** 右侧属性面板是否可见 */
  rightSidebarVisible: boolean;
  /** 右侧属性面板内容是否折叠(仅折叠内容,保留标题栏) */
  rightSidebarCollapsed: boolean;
}

/* ============ 静态元数据 ============ */
export const TOOLS: ToolMeta[] = [
  {
    id: "move",
    icon: "Move",
    title: "移动工具",
    shortcut: "V",
    statusName: "移动工具",
  },
  {
    id: "hand",
    icon: "Hand",
    title: "抓手工具",
    shortcut: "H",
    statusName: "抓手工具",
  },
  {
    id: "crop",
    icon: "Crop",
    title: "裁剪工具",
    shortcut: "C",
    statusName: "裁剪工具",
  },
  {
    id: "paintbrush",
    icon: "Paintbrush",
    title: "画笔工具",
    shortcut: "B",
    statusName: "画笔工具",
  },
  {
    id: "eraser",
    icon: "Eraser",
    title: "橡皮擦",
    shortcut: "E",
    statusName: "橡皮擦工具",
  },
  {
    id: "paintBucket",
    icon: "PaintBucket",
    title: "油漆桶工具",
    shortcut: "G",
    statusName: "油漆桶工具",
  },
  {
    id: "type",
    icon: "Type",
    title: "文字工具",
    shortcut: "T",
    statusName: "文字工具",
  },
  /* ===== 形状工具组 (U) ===== */
  {
    id: "shape-rect",
    icon: "Square",
    title: "矩形工具",
    shortcut: "U",
    statusName: "矩形工具",
    group: "shape-group",
  },
  {
    id: "shape-ellipse",
    icon: "Circle",
    title: "椭圆工具",
    shortcut: "U",
    statusName: "椭圆工具",
    group: "shape-group",
  },
  {
    id: "shape-circle",
    icon: "Circle",
    title: "圆形工具",
    shortcut: "U",
    statusName: "圆形工具",
    group: "shape-group",
  },
  {
    id: "shape-triangle",
    icon: "Triangle",
    title: "三角形工具",
    shortcut: "U",
    statusName: "三角形工具",
    group: "shape-group",
  },
  {
    id: "shape-polygon",
    icon: "Hexagon",
    title: "多边形工具",
    shortcut: "U",
    statusName: "多边形工具",
    group: "shape-group",
  },
  {
    id: "shape-star",
    icon: "Star",
    title: "星形工具",
    shortcut: "U",
    statusName: "星形工具",
    group: "shape-group",
  },
  {
    id: "shape-line",
    icon: "Minus",
    title: "直线工具",
    shortcut: "U",
    statusName: "直线工具",
    group: "shape-group",
  },
  {
    id: "pipette",
    icon: "Pipette",
    title: "吸管工具",
    shortcut: "I",
    statusName: "吸管工具",
    group: "eyedropper-group",
  },
  /* ===== 吸管工具组 (I) ===== */
  {
    id: "colorSampler",
    icon: "Crosshair",
    title: "颜色取样器工具",
    shortcut: "I",
    statusName: "颜色取样器工具",
    group: "eyedropper-group",
  },
  {
    id: "ruler",
    icon: "Ruler",
    title: "标尺工具",
    shortcut: "I",
    statusName: "标尺工具",
    group: "eyedropper-group",
  },
  /* ===== 仿制图章 (S) ===== */
  {
    id: "cloneStamp",
    icon: "Stamp",
    title: "仿制图章工具",
    shortcut: "S",
    statusName: "仿制图章工具",
  },
  /* ===== 套索工具组 (L) ===== */
  {
    id: "lasso",
    icon: "Lasso",
    title: "套索工具",
    shortcut: "L",
    statusName: "套索工具",
    group: "lasso-group",
  },
  {
    id: "polygonal-lasso",
    icon: "Spline",
    title: "多边形套索工具",
    shortcut: "L",
    statusName: "多边形套索工具",
    group: "lasso-group",
  },
  {
    id: "magnetic-lasso",
    icon: "Magnet",
    title: "磁性套索工具",
    shortcut: "L",
    statusName: "磁性套索工具",
    group: "lasso-group",
  },
  /* ===== 对象选择工具组 (W) ===== */
  {
    id: "object-select",
    icon: "ObjectSelect",
    title: "对象选择工具",
    shortcut: "W",
    statusName: "对象选择工具",
    group: "object-select-group",
  },
  {
    id: "quick-select",
    icon: "BrushSelect",
    title: "快速选择工具",
    shortcut: "W",
    statusName: "快速选择工具",
    group: "object-select-group",
  },
  {
    id: "magic-wand",
    icon: "Wand2",
    title: "魔棒工具",
    shortcut: "W",
    statusName: "魔棒工具",
    group: "object-select-group",
  },
];

/**
 * 工具组锚点：在工具条上每个组只渲染一个按钮位，
 * 取该组中「最近一次激活的工具」作为代表。
 * 顺序即工具条上从左到右的展示顺序。
 */
export const TOOL_GROUP_ORDER: ToolGroupId[] = [
  "move",
  "lasso-group",
  "object-select-group",
  "crop",
  "paintbrush",
  "eraser",
  "paintBucket",
  "cloneStamp",
  "type",
  "shape-group",
  "eyedropper-group",
  "hand",
];

/** 取某工具组下的所有工具元数据 */
export const toolsInGroup = (g: ToolGroupId): ToolMeta[] =>
  TOOLS.filter((t) => (t.group || (t.id as ToolGroupId)) === g);

/** 形状工具 id → ShapeKind 映射 */
export const SHAPE_TOOL_KIND: Record<string, ShapeKind> = {
  "shape-rect": "rect",
  "shape-ellipse": "ellipse",
  "shape-circle": "circle",
  "shape-triangle": "triangle",
  "shape-polygon": "polygon",
  "shape-star": "star",
  "shape-line": "line",
};

/** ShapeKind → 形状工具 id 映射 */
export const SHAPE_KIND_TOOL: Record<ShapeKind, ToolId> = {
  rect: "shape-rect",
  ellipse: "shape-ellipse",
  circle: "shape-circle",
  triangle: "shape-triangle",
  polygon: "shape-polygon",
  star: "shape-star",
  line: "shape-line",
};

/** 判断工具 id 是否属于形状工具组 */
export const isShapeTool = (t: string): boolean => t in SHAPE_TOOL_KIND;

export const BLEND_MODES = ["正常", "正片叠底", "滤色", "叠加", "柔光"];
export const BRUSH_MODES = [
  "正常",
  "变暗",
  "变亮",
  "色相",
  "饱和度",
  "颜色",
  "明度",
];
export const ZOOM_OPTIONS = [100, 75, 50, 200, 25];

/* ============ 工具函数 ============ */
const THUMB_GRADIENTS = [
  "linear-gradient(135deg,#FF9800,#FFB74D)",
  "linear-gradient(135deg,#2196F3,#4CAF50)",
  "linear-gradient(135deg,#90A4AE,#B0BEC5)",
  "linear-gradient(135deg,#E91E63,#F06292)",
  "linear-gradient(135deg,#9C27B0,#BA68C8)",
  "linear-gradient(135deg,#00BCD4,#4DD0E1)",
  "linear-gradient(135deg,#FFC107,#FFD54F)",
  "linear-gradient(135deg,#795548,#A1887F)",
];

const thumbFor = (layer: EngineLayer, index: number): string => {
  // 用名字 hash + 索引生成稳定渐变；避免每帧生成 dataURL 的开销
  const hash = layer.name.split("").reduce((a, c) => a + c.charCodeAt(0), 0);
  return THUMB_GRADIENTS[(index + hash) % THUMB_GRADIENTS.length];
};

/** 从 engine 文档派生的可序列化字段(不含 UI 状态如 activeTool/zoom/颜色/折叠分组) */
interface DocDerived {
  layers: Layer[];
  activeLayerId: string;
  layerOpacity: number;
  layerBlendMode: string;
  history: HistoryEntry[];
  currentHistoryId: string;
  transform: TransformState;
  adjustments: Adjustments;
  hasDocument: boolean;
  hasSelection: boolean;
  docWidth: number;
  docHeight: number;
}

/** 从 engine 文档派生可序列化元数据 */
const deriveFromDoc = (doc: DocumentEngine | undefined): DocDerived => {
  if (!doc) {
    return {
      layers: [],
      activeLayerId: "",
      layerOpacity: 100,
      layerBlendMode: "正常",
      history: [],
      currentHistoryId: "",
      transform: {
        x: 0,
        y: 0,
        w: 0,
        h: 0,
        rotation: 0,
        lockRatio: true,
        origW: 0,
        origH: 0,
      },
      adjustments: {
        brightness: 0,
        contrast: 0,
        saturation: 0,
        temperature: 0,
      },
      hasDocument: false,
      hasSelection: false,
      docWidth: 0,
      docHeight: 0,
    };
  }
  const layers: Layer[] = doc.layers.map((l, i) => ({
    id: l.id,
    name: l.name,
    thumb: thumbFor(l, i),
    visible: l.visible,
    locked: l.locked,
    kind: l.kind,
  }));
  const activeLayer = doc.layers.find((l) => l.id === doc.activeLayerId);
  const history: HistoryEntry[] = doc.history.map((h, i) => ({
    id: h.id,
    step: i + 1,
    label: h.label,
  }));
  const current = doc.history[doc.currentHistoryIndex];
  // 派生活动图层的变换: X/Y/Rotation 直接取图层, W/H = 原始尺寸 * 缩放系数
  const orig = activeLayer
    ? engine.getLayerOrigSize(activeLayer, doc)
    : { w: doc.width, h: doc.height };
  const l = activeLayer;
  const sx = l ? l.scaleX : 1;
  const sy = l ? l.scaleY : 1;
  const rot = l ? l.rotation : 0;
  const ox = l ? l.offsetX : 0;
  const oy = l ? l.offsetY : 0;
  return {
    layers,
    activeLayerId: doc.activeLayerId,
    layerOpacity: activeLayer ? activeLayer.opacity : 100,
    layerBlendMode: activeLayer ? activeLayer.blendMode : "正常",
    history,
    currentHistoryId: current ? current.id : "",
    transform: {
      x: ox,
      y: oy,
      w: Math.round(orig.w * sx),
      h: Math.round(orig.h * sy),
      rotation: rot,
      lockRatio: true,
      origW: Math.round(orig.w),
      origH: Math.round(orig.h),
    },
    adjustments: { ...doc.adjustments },
    hasDocument: true,
    hasSelection: engine.hasSelection(doc),
    docWidth: doc.width,
    docHeight: doc.height,
  };
};

const deriveTabs = (): Tab[] => {
  return engine.list().map((id) => {
    const doc = engine.get(id)!;
    const ext = doc.name.split(".").pop()?.toLowerCase();
    const isImage = ["jpg", "jpeg", "png", "gif", "bmp", "webp"].includes(
      ext || "",
    );
    return {
      id,
      name: doc.name,
      icon: isImage ? "image" : "file-image",
      dirty: isProjectDirty(id),
    };
  });
};

/* ============ 默认状态 ============ */
const DEFAULT_BRUSH: BrushState = {
  size: 24,
  hardness: 80,
  opacity: 100,
  flow: 85,
  mode: "正常",
};
const DEFAULT_SHAPE: ShapeSettings = {
  kind: "rect",
  fill: false,
  lineWidth: 4,
  sides: 6,
};
const DEFAULT_TEXT: TextSettings = {
  fontSize: 32,
  bold: false,
  italic: false,
  underline: false,
  strikethrough: false,
  fontFamily: DEFAULT_FONT_FAMILY,
};
const DEFAULT_SELECTION: SelectionSettings = {
  tolerance: 32,
  contiguous: true,
  brushSize: 24,
  allLayers: false,
  lassoMode: false,
  magneticWidth: 10,
  magneticContrast: 50,
  magneticFrequency: 60,
};
const DEFAULT_CLONE_STAMP: CloneStampSettings = {
  size: 24,
  hardness: 80,
  opacity: 100,
  flow: 100,
  aligned: true,
  sampleAllLayers: false,
};
const DEFAULT_PAINT_BUCKET: PaintBucketSettings = {
  color: "#1A237E",
  tolerance: 32,
  contiguous: true,
  allLayers: false,
  opacity: 100,
};

/* ============ 状态持久化 ============
 * 通过 sdk.config API 将 UI 偏好保存到宿主配置(confs/bespokePlugins.json)，
 * 下次打开插件时自动恢复。
 *
 * 可持久化的状态：
 * - 工具选择、画笔/形状/文字/选区/仿制图章/油漆桶等设置
 * - 颜色、缩放、导出格式
 * - 右侧面板显隐/折叠、分组折叠
 * - 打开的文档列表 + 活动 tab + 每个文档的活动图层(按名字匹配)
 *
 * 不可持久化的状态(依赖运行时 engine)：
 * - 像素数据、历史记录、选区、变换、colorSamples、ruler、cloneSource 等
 */
interface TabLayerState {
  docName: string;
  activeLayerName: string;
}

interface PersistentState {
  activeTool: ToolId;
  zoom: number;
  fgColor: string;
  bgColor: string;
  brush: BrushState;
  shape: ShapeSettings;
  text: TextSettings;
  selection: SelectionSettings;
  cloneStamp: CloneStampSettings;
  paintBucket: PaintBucketSettings;
  exportFormat: "png" | "jpeg" | "webp" | "svg";
  collapsedSections: Record<string, boolean>;
  rightSidebarVisible: boolean;
  rightSidebarCollapsed: boolean;
  activeDocName: string;
  tabStates: TabLayerState[];
}

const PERSIST_KEY = "fatPhoto.editorState";
let sdkRef: FatNotesPluginSDK | null = null;
let saveTimer: number | null = null;
let savePending = false;
/** 保存的 tab/layer 状态(在 initStore 时加载，文档打开后用于匹配恢复) */
let savedTabStates: TabLayerState[] = [];
let savedActiveDocName: string = "";

/** 从当前 state 提取可持久化的部分 */
const extractPersistent = (s: EditorState): PersistentState => {
  const tabStates: TabLayerState[] = s.tabs.map((tab) => {
    const doc = engine.get(tab.id);
    const activeLayer = doc
      ? doc.layers.find((l) => l.id === doc.activeLayerId)
      : null;
    return {
      docName: tab.name,
      activeLayerName: activeLayer?.name || "",
    };
  });
  const activeTab = s.tabs.find((t) => t.id === s.activeTabId);
  return {
    activeTool: s.activeTool,
    zoom: s.zoom,
    fgColor: s.fgColor,
    bgColor: s.bgColor,
    brush: { ...s.brush },
    shape: { ...s.shape },
    text: { ...s.text },
    selection: { ...s.selection },
    cloneStamp: { ...s.cloneStamp },
    paintBucket: { ...s.paintBucket },
    exportFormat: s.exportFormat,
    collapsedSections: { ...s.collapsedSections },
    rightSidebarVisible: s.rightSidebarVisible,
    rightSidebarCollapsed: s.rightSidebarCollapsed,
    activeDocName: activeTab?.name || "",
    tabStates,
  };
};

/** 保存当前状态(防抖 300ms) */
const scheduleSave = () => {
  savePending = true;
  if (saveTimer !== null) return;
  saveTimer = window.setTimeout(() => {
    saveTimer = null;
    if (!savePending || !sdkRef) return;
    savePending = false;
    const persistent = extractPersistent(state);
    // sdk.config 是插件级别的整个配置对象，用 PERSIST_KEY 作为属性名存储
    const sdk = sdkRef;
    sdk.config
      .get()
      .then((config: Record<string, unknown>) =>
        sdk.config.set({
          ...config,
          [PERSIST_KEY]: persistent,
        }),
      )
      .catch(() => {/* 静默失败，不阻塞用户 */});
  }, 300);
};

/** 从保存的状态恢复 UI 偏好(不恢复 tabs/layers——这些依赖运行时 engine) */
const restorePersistent = (
  saved: Partial<PersistentState> | null | undefined,
): Partial<EditorState> => {
  if (!saved) return {};
  const patch: Partial<EditorState> = {};
  if (saved.activeTool) patch.activeTool = saved.activeTool;
  if (typeof saved.zoom === "number") patch.zoom = saved.zoom;
  if (saved.fgColor) patch.fgColor = saved.fgColor;
  if (saved.bgColor) patch.bgColor = saved.bgColor;
  if (saved.brush) patch.brush = { ...DEFAULT_BRUSH, ...saved.brush };
  if (saved.shape) patch.shape = { ...DEFAULT_SHAPE, ...saved.shape };
  if (saved.text) patch.text = { ...DEFAULT_TEXT, ...saved.text };
  if (saved.selection)
    patch.selection = { ...DEFAULT_SELECTION, ...saved.selection };
  if (saved.cloneStamp)
    patch.cloneStamp = { ...DEFAULT_CLONE_STAMP, ...saved.cloneStamp };
  if (saved.paintBucket)
    patch.paintBucket = { ...DEFAULT_PAINT_BUCKET, ...saved.paintBucket };
  if (saved.exportFormat) patch.exportFormat = saved.exportFormat;
  if (saved.collapsedSections)
    patch.collapsedSections = { ...saved.collapsedSections };
  if (typeof saved.rightSidebarVisible === "boolean")
    patch.rightSidebarVisible = saved.rightSidebarVisible;
  if (typeof saved.rightSidebarCollapsed === "boolean")
    patch.rightSidebarCollapsed = saved.rightSidebarCollapsed;
  return patch;
};

/** 初始化 store：加载持久化状态，设置 SDK 引用 */
export const initStore = async (
  sdk: FatNotesPluginSDK,
): Promise<void> => {
  sdkRef = sdk;
  try {
    const config = (await sdk.config.get()) as Record<string, unknown>;
    const saved = config?.[PERSIST_KEY] as
      | Partial<PersistentState>
      | undefined;
    if (saved) {
      // 缓存 tab/layer 状态，文档打开后通过 refresh() 自动匹配恢复
      savedTabStates = saved.tabStates || [];
      savedActiveDocName = saved.activeDocName || "";
      const patch = restorePersistent(saved);
      if (Object.keys(patch).length > 0) {
        state = { ...state, ...patch };
        emit();
      }
    }
  } catch {
    // 无保存记录或读取失败，使用默认状态
  }
};

/** 构建初始状态 */
const buildState = (): EditorState => {
  const tabs = deriveTabs();
  const activeTabId = tabs.length ? tabs[tabs.length - 1].id : "";
  const doc = activeTabId ? engine.get(activeTabId) : undefined;
  return {
    activeTool: "move",
    zoom: 100,
    fgColor: "#1A237E",
    bgColor: "#FFFFFF",
    brush: { ...DEFAULT_BRUSH },
    shape: { ...DEFAULT_SHAPE },
    text: { ...DEFAULT_TEXT },
    selection: { ...DEFAULT_SELECTION },
    cloneStamp: { ...DEFAULT_CLONE_STAMP },
    paintBucket: { ...DEFAULT_PAINT_BUCKET },
    fitSignal: 0,
    collapsedSections: {},
    tabs,
    activeTabId,
    colorSamples: [],
    ruler: null,
    cloneSource: null,
    textEditSignal: 0,
    requestTextEditLayerId: null,
    shapeEditSignal: 0,
    requestShapeEditLayerId: null,
    exportFormat: "png",
    rightSidebarVisible: true,
    rightSidebarCollapsed: false,
    ...deriveFromDoc(doc),
  };
};

let state: EditorState = buildState();
const listeners = new Set<() => void>();

const emit = () => {
  listeners.forEach((l) => l());
  // 状态变更时自动保存(防抖)
  if (sdkRef) scheduleSave();
};

const subscribe = (cb: () => void) => {
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
  };
};

const getSnapshot = (): EditorState => state;

/** 根据保存的 tab/layer 状态恢复选中状态 */
const applySavedTabState = (tabs: Tab[], activeTabId: string): {
  activeTabId: string;
  restored: boolean;
} => {
  if (!savedActiveDocName && savedTabStates.length === 0) {
    return { activeTabId, restored: false };
  }

  // 1. 如果当前 activeTabId 对应的文档名匹配 savedActiveDocName，保持该 tab
  //    否则，尝试找到 savedActiveDocName 对应的 tab
  let finalTabId = activeTabId;
  const currentTab = tabs.find((t) => t.id === activeTabId);
  if (savedActiveDocName && (!currentTab || currentTab.name !== savedActiveDocName)) {
    const matched = tabs.find((t) => t.name === savedActiveDocName);
    if (matched) {
      finalTabId = matched.id;
    }
  }

  // 2. 为所有匹配的 tab 恢复 activeLayerId（直接设置 doc.activeLayerId，
  //    避免调用 engine.setActiveLayer 触发递归 refresh）
  for (const ts of savedTabStates) {
    const tab = tabs.find((t) => t.name === ts.docName);
    if (tab && ts.activeLayerName) {
      const doc = engine.get(tab.id);
      if (doc) {
        const layer = doc.layers.find((l) => l.name === ts.activeLayerName);
        if (layer) {
          doc.activeLayerId = layer.id;
        }
      }
    }
  }

  return { activeTabId: finalTabId, restored: true };
};

/** 重新从 engine 派生状态并广播 */
const refresh = () => {
  // 保持 activeTabId 有效
  const tabs = deriveTabs();
  let activeTabId = state.activeTabId;
  if (!tabs.some((t) => t.id === activeTabId)) {
    activeTabId = tabs.length ? tabs[tabs.length - 1].id : "";
  }

  // 尝试恢复保存的 tab/layer 选中状态
  const { activeTabId: restoredTabId, restored } = applySavedTabState(
    tabs,
    activeTabId,
  );
  if (restored) {
    activeTabId = restoredTabId;
    // 清空已应用的保存状态，避免重复恢复
    savedTabStates = [];
    savedActiveDocName = "";
  }

  const doc = activeTabId ? engine.get(activeTabId) : undefined;
  state = {
    ...state,
    tabs,
    activeTabId,
    ...deriveFromDoc(doc),
  };
  emit();
};

/** 切换 active tab 后重新派生 */
const refreshForTab = (tabId: string) => {
  const doc = engine.get(tabId);
  state = {
    ...state,
    // 重新派生 tabs：打开文档场景下 markProjectSaved 在 engine.emit 之后才执行，
    // 此时 marker 已就位，需重新派生才能让 dirty 状态正确(否则会保留 emit 时误判的 dirty=true)
    tabs: deriveTabs(),
    activeTabId: tabId,
    // 吸管组/仿制图章的辅助标记是文档级状态，切 tab 时重置
    colorSamples: [],
    ruler: null,
    cloneSource: null,
    ...deriveFromDoc(doc),
  };
  emit();
};

/* ============ 引擎订阅 ============ */
// engine emit → refresh。store 内部已绑定，无需组件关心。
engine.subscribe(refresh);

/* ============ 文件 I/O ============ */
const readImageFile = (file: File): Promise<HTMLImageElement> => {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve(img);
    };
    img.onerror = (e) => {
      URL.revokeObjectURL(url);
      reject(e);
    };
    img.src = url;
  });
};

/* ============ Actions ============ */
export const actions = {
  /* ---- 工具 ---- */
  setActiveTool(tool: ToolId) {
    // 切换到形状工具时同步 shape.kind，使工具栏与画布预览一致
    const kind = SHAPE_TOOL_KIND[tool];
    if (kind) {
      state = { ...state, activeTool: tool, shape: { ...state.shape, kind } };
    } else {
      state = { ...state, activeTool: tool };
    }
    emit();
  },

  /* ---- 缩放 ---- */
  setZoom(zoom: number) {
    state = { ...state, zoom: Math.max(10, Math.min(800, zoom)) };
    emit();
  },
  zoomIn() {
    this.setZoom(Math.round(state.zoom * 1.25));
  },
  zoomOut() {
    this.setZoom(Math.round(state.zoom / 1.25));
  },
  zoomFit() {
    state = { ...state, fitSignal: state.fitSignal + 1 };
    emit();
  },

  /* ---- 形状设置 ---- */
  setShape(patch: Partial<ShapeSettings>) {
    state = { ...state, shape: { ...state.shape, ...patch } };
    emit();
  },

  /* ---- 文字设置 ---- */
  setText(patch: Partial<TextSettings>) {
    state = { ...state, text: { ...state.text, ...patch } };
    emit();
  },

  /** 请求进入文字就地编辑。layerId=null 表示新建文字图层 */
  requestTextEdit(layerId: string | null) {
    state = {
      ...state,
      activeTool: "type",
      requestTextEditLayerId: layerId,
      textEditSignal: state.textEditSignal + 1,
    };
    emit();
  },

  /** 请求对形状图层进入重编辑(从图层面板双击触发) */
  requestShapeEdit(layerId: string) {
    const doc = engine.get(state.activeTabId);
    const layer = doc ? engine.getLayer(doc, layerId) : undefined;
    const kind = layer?.shapeData?.kind;
    const tool: ToolId = kind ? SHAPE_KIND_TOOL[kind] : "shape-rect";
    state = {
      ...state,
      activeTool: tool,
      // 同步 shape.kind，使工具栏与画布预览一致
      shape: kind ? { ...state.shape, kind } : state.shape,
      requestShapeEditLayerId: layerId,
      shapeEditSignal: state.shapeEditSignal + 1,
    };
    emit();
  },

  /* ---- 选区工具设置 ---- */
  setSelectionSettings(patch: Partial<SelectionSettings>) {
    state = { ...state, selection: { ...state.selection, ...patch } };
    emit();
  },

  /* ---- 选区操作 ---- */
  /** 清除当前文档选区 */
  clearSelection() {
    const doc = engine.get(state.activeTabId);
    if (doc) {
      engine.clearSelection(doc);
      refresh();
    }
  },
  /** 全选当前文档 */
  selectAll() {
    const doc = engine.get(state.activeTabId);
    if (doc) {
      engine.selectAll(doc);
      refresh();
    }
  },
  /** 反选当前文档选区 */
  invertSelection() {
    const doc = engine.get(state.activeTabId);
    if (doc) {
      engine.invertSelection(doc);
      refresh();
    }
  },

  /* ---- 文件 ---- */
  /** 打开文件选择对话框，加载图片到新 tab */
  async openFileDialog(): Promise<void> {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = "image/*";
    input.multiple = true;
    const chosen = await new Promise<FileList | null>((resolve) => {
      input.onchange = () => resolve(input.files);
      input.click();
    });
    if (!chosen || chosen.length === 0) return;
    for (const f of Array.from(chosen)) {
      try {
        const img = await readImageFile(f);
        const doc = engine.createFromImage(f.name, img);
        // 新打开的图片初始状态视为「已保存」(尚未发生修改)
        markProjectSaved(doc.id);
        refreshForTab(doc.id);
      } catch {
        // ignore
      }
    }
  },

  /**
   * 把已加载的图片作为新图层导入到当前活动文档。
   * 若当前没有文档，则改为创建新文档(走 createFromImage 流程)。
   * pos 指定图片左上角在文档中的位置(文档像素)；省略则居中。
   */
  importImageAsLayer(
    img: HTMLImageElement,
    opts?: { name?: string; pos?: { x: number; y: number } },
  ): void {
    const doc = state.activeTabId ? engine.get(state.activeTabId) : undefined;
    if (!doc) {
      // 没有打开的文档 → 直接创建新文档
      const newDoc = engine.createFromImage(opts?.name || "粘贴.png", img);
      markProjectSaved(newDoc.id);
      refreshForTab(newDoc.id);
      return;
    }
    engine.addImageLayer(doc, img, opts);
    refresh();
  },

  /** 从 File 读取图片并导入为当前文档的新图层；无文档时创建新文档 */
  async importFileAsLayer(
    file: File,
    pos?: { x: number; y: number },
  ): Promise<void> {
    try {
      const img = await readImageFile(file);
      this.importImageAsLayer(img, { name: file.name, pos });
    } catch {
      // ignore
    }
  },

  /**
   * 处理剪贴板 paste 事件：从中提取图片并作为新图层导入。
   * 优先读取 items 中的 image/* blob，再回退到 files。
   * 返回是否成功处理了图片(供调用方决定是否阻止默认粘贴行为)。
   */
  async pasteClipboardImage(
    e: ClipboardEvent | ClipboardItems,
  ): Promise<boolean> {
    const collectImageFiles = async (): Promise<File[]> => {
      // 优先走 ClipboardItem(标准异步 API，支持 DOM 图片复制)
      const items =
        e instanceof ClipboardEvent
          ? (e.clipboardData?.items ?? [])
          : await navigator.clipboard.read();
      const files: File[] = [];
      for (const it of items as any) {
        if (it instanceof DataTransferItem) {
          if (it.kind === "file" && it.type.startsWith("image/")) {
            const f = it.getAsFile();
            if (f) files.push(f);
          }
        } else {
          // ClipboardItem: 找 image/* 类型
          const types: string[] = it.types || [];
          for (const t of types) {
            if (t.startsWith("image/")) {
              const blob = await it.getType(t);
              const name =
                t === "image/png"
                  ? "粘贴.png"
                  : t === "image/jpeg"
                    ? "粘贴.jpg"
                    : "粘贴." + t.split("/")[1];
              files.push(new File([blob], name, { type: t }));
            }
          }
        }
      }
      return files;
    };
    const files = await collectImageFiles();
    if (files.length === 0) return false;
    for (const f of files) {
      await this.importFileAsLayer(f);
    }
    return true;
  },

  /** 打开文件对话框，把所选图片作为新图层导入到当前文档 */
  async importImageFileDialog(): Promise<void> {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = "image/*";
    input.multiple = true;
    const chosen = await new Promise<FileList | null>((resolve) => {
      input.onchange = () => resolve(input.files);
      input.click();
    });
    if (!chosen || chosen.length === 0) return;
    for (const f of Array.from(chosen)) {
      await this.importFileAsLayer(f);
    }
  },

  /** 新建空白文档 */
  newBlankDocument(name?: string, w = 1920, h = 1280): void {
    const doc = engine.createBlank(
      name || `未命名-${state.tabs.length + 1}.png`,
      w,
      h,
    );
    // 新建文档初始状态视为「已保存」(尚未发生修改)
    markProjectSaved(doc.id);
    refreshForTab(doc.id);
  },

  /** 设置导出格式 */
  setExportFormat(format: "png" | "jpeg" | "webp" | "svg") {
    state = { ...state, exportFormat: format };
    emit();
  },

  /** 导出当前文档并触发下载，支持多种格式 */
  async exportCurrent(): Promise<void> {
    const doc = state.activeTabId ? engine.get(state.activeTabId) : undefined;
    if (!doc) return;

    const format = state.exportFormat;
    const baseName = doc.name.replace(/\.[^.]+$/, "") + "-edited";

    // 各格式对应的扩展名、MIME、data URL 生成方式
    const formatMap = {
      png: { ext: ".png", mime: "image/png", desc: "PNG 图片", exts: [".png"] },
      jpeg: { ext: ".jpg", mime: "image/jpeg", desc: "JPEG 图片", exts: [".jpg", ".jpeg"] },
      webp: { ext: ".webp", mime: "image/webp", desc: "WebP 图片", exts: [".webp"] },
      svg: { ext: ".svg", mime: "image/svg+xml", desc: "SVG 图片", exts: [".svg"] },
    } as const;

    const cfg = formatMap[format];

    // 生成 data URL 或文本内容
    let url: string;
    let svgText: string | null = null;
    if (format === "png") url = engine.exportPng(doc);
    else if (format === "jpeg") url = engine.exportJpeg(doc);
    else if (format === "webp") url = engine.exportWebp(doc);
    else {
      svgText = engine.exportSvg(doc);
      url = "data:" + cfg.mime + ";charset=utf-8," + encodeURIComponent(svgText);
    }

    // 优先使用 File System Access API 提供格式过滤和默认文件名
    if ("showSaveFilePicker" in window) {
      try {
        const handle = await (window as any).showSaveFilePicker({
          suggestedName: baseName + cfg.ext,
          types: [
            {
              description: cfg.desc,
              accept: { [cfg.mime]: cfg.exts },
            },
          ],
        });
        const blob =
          format === "svg"
            ? new Blob([svgText!], { type: cfg.mime })
            : await (await fetch(url)).blob();
        const writable = await handle.createWritable();
        await writable.write(blob);
        await writable.close();
        return;
      } catch (err: any) {
        if (err.name === "AbortError") return;
      }
    }

    // 回退方案
    const a = document.createElement("a");
    a.href = url;
    a.download = baseName + cfg.ext;
    document.body.appendChild(a);
    a.click();
    a.remove();
  },

  /* ---- 工程文件(.fpproj) 保存/读取 ---- */
  /**
   * 保存当前文档为 .fpproj JSON 工程文件。
   * - 若该文档已有保留的句柄(之前打开/保存过)，直接覆写原位置；
   * - 否则：
   *   - silent=true(Ctrl+S) → 静默跳过，不弹任何对话框；
   *   - silent=false(工具栏按钮) → 弹另存为对话框让用户选择位置。
   * - 不支持 File System Access API 时回退到下载。
   * 工程文件包含：图层像素、调整、完整历史、选区，等价于 PSD。
   */
  async saveProject(silent = false): Promise<boolean> {
    const doc = state.activeTabId ? engine.get(state.activeTabId) : undefined;
    if (!doc) return false;
    const handle = projectHandles.get(doc.id);
    if (handle) {
      try {
        const json = await engine.serializeProject(doc);
        const blob = new Blob([JSON.stringify(json)], { type: PROJECT_MIME });
        const writable = await handle.createWritable();
        await writable.write(blob);
        await writable.close();
        // 保存成功 → 更新未保存标记(清除 *)
        markProjectSaved(doc.id);
        refresh();
        return true;
      } catch (err: any) {
        // 句柄失效(文件被删除/移动等) → 清缓存并走另存为
        projectHandles.delete(doc.id);
      }
    }
    // 无句柄：silent 模式下静默跳过，不弹框
    if (silent) return false;
    return this.saveProjectAs();
  },

  /** 另存为：弹保存对话框，保存后保留句柄供下次直写 */
  async saveProjectAs(): Promise<boolean> {
    const doc = state.activeTabId ? engine.get(state.activeTabId) : undefined;
    if (!doc) return false;
    const baseName = doc.name.replace(/\.[^.]+$/, "") + "-project";
    const json = await engine.serializeProject(doc);
    const text = JSON.stringify(json);
    // 优先 File System Access API
    if ("showSaveFilePicker" in window) {
      try {
        const handle = await (window as any).showSaveFilePicker({
          suggestedName: baseName + PROJECT_EXT,
          types: [
            {
              description: "fat-photo 工程文件",
              accept: { [PROJECT_MIME]: [PROJECT_EXT] },
            },
          ],
        });
        const blob = new Blob([text], { type: PROJECT_MIME });
        const writable = await handle.createWritable();
        await writable.write(blob);
        await writable.close();
        // 缓存句柄，下次「保存」直写
        projectHandles.set(doc.id, handle);
        // 保存成功 → 更新未保存标记(清除 *)
        markProjectSaved(doc.id);
        refresh();
        return true;
      } catch (err: any) {
        if (err.name === "AbortError") return false;
      }
    }
    // 回退：触发下载
    const url =
      "data:" + PROJECT_MIME + ";charset=utf-8," + encodeURIComponent(text);
    const a = document.createElement("a");
    a.href = url;
    a.download = baseName + PROJECT_EXT;
    document.body.appendChild(a);
    a.click();
    a.remove();
    // 下载保存也算保存成功 → 更新未保存标记
    markProjectSaved(doc.id);
    refresh();
    return true;
  },

  /**
   * 打开 .fpproj 工程文件，重建文档(含图层/历史/选区)并切到新 tab。
   * 若选择的是普通图片文件，则回退到普通图片打开流程。
   *
   * 优先使用 File System Access API 的 showOpenFilePicker，保留文件句柄，
   * 这样后续「保存」可直接覆写原位置，不再弹另存为对话框。
   * 不支持时回退到 <input type="file">。
   */
  async openProjectFile(): Promise<void> {
    // 优先 File System Access API：可保留句柄供 saveProject 直写
    if ("showOpenFilePicker" in window) {
      try {
        const handles = await (window as any).showOpenFilePicker({
          multiple: true,
          types: [
            {
              description: "fat-photo 工程文件 / 图片",
              accept: {
                [PROJECT_MIME]: [PROJECT_EXT],
                "image/*": [".png", ".jpg", ".jpeg", ".gif", ".bmp", ".webp"],
              },
            },
          ],
        });
        if (!handles || handles.length === 0) return;
        for (const handle of handles) {
          const f: File = await handle.getFile();
          await this._loadProjectOrImageFile(f, handle);
        }
        return;
      } catch (err: any) {
        if (err.name === "AbortError") return;
        // 其它错误 → 回退到 <input type="file">
      }
    }

    // 回退：<input type="file">（无句柄，保存时会走另存为）
    const input = document.createElement("input");
    input.type = "file";
    input.accept = PROJECT_EXT + ",application/json,image/*";
    input.multiple = true;
    const chosen = await new Promise<FileList | null>((resolve) => {
      input.onchange = () => resolve(input.files);
      input.click();
    });
    if (!chosen || chosen.length === 0) return;
    for (const f of Array.from(chosen)) {
      await this._loadProjectOrImageFile(f, null);
    }
  },

  /**
   * 内部：加载单个 .fpproj 工程文件或图片文件。
   * 若提供 handle（来自 showOpenFilePicker），则缓存句柄，使后续「保存」直写原位置。
   */
  async _loadProjectOrImageFile(
    f: File,
    handle: FileSystemFileHandle | null,
  ): Promise<void> {
    const isProject =
      f.name.toLowerCase().endsWith(PROJECT_EXT) ||
      f.type === "application/json";
    try {
      if (isProject) {
        const text = await f.text();
        const json = JSON.parse(text) as ProjectJSON;
        if (!json || json.version !== PROJECT_VERSION || !Array.isArray(json.layers)) {
          // 无效工程文件 → 忽略
          return;
        }
        const doc = await engine.deserializeProject(json);
        // 工程文件刚加载 → 视为已保存(尚未发生修改)
        markProjectSaved(doc.id);
        // 缓存句柄：下次「保存」直写原位置，不再弹另存为
        if (handle) projectHandles.set(doc.id, handle);
        refreshForTab(doc.id);
      } else {
        // 普通图片：走原流程
        const img = await readImageFile(f);
        const doc = engine.createFromImage(f.name, img);
        // 新打开的图片初始状态视为「已保存」
        markProjectSaved(doc.id);
        // 注意：图片文件不缓存句柄——「保存」按钮保存的是 .fpproj 工程内容，
        // 若复用图片句柄会把工程 JSON 写到原图片路径，覆盖原图。保留弹另存为。
        refreshForTab(doc.id);
      }
    } catch {
      // ignore
    }
  },

  /* ---- Tabs ---- */
  selectTab(id: string) {
    if (engine.has(id)) refreshForTab(id);
  },
  closeTab(id: string) {
    // 清理工程文件句柄缓存 + 未保存标记缓存
    projectHandles.delete(id);
    savedHistoryMarkers.delete(id);
    engine.remove(id);
    refresh();
  },
  addTab() {
    this.openFileDialog();
  },

  /* ---- 图层 ---- */
  selectLayer(id: string) {
    const doc = engine.get(state.activeTabId);
    if (doc) {
      engine.setActiveLayer(doc, id);
      const layer = engine.getLayer(doc, id);
      if (layer) {
        if (layer.kind === "text" && layer.textData) {
          state = {
            ...state,
            text: {
              ...state.text,
              fontSize: layer.textData.fontSize,
              bold: layer.textData.bold,
              italic: layer.textData.italic,
              underline: layer.textData.underline,
              strikethrough: layer.textData.strikethrough,
              fontFamily: layer.textData.fontFamily || DEFAULT_FONT_FAMILY,
            },
            fgColor: layer.textData.color,
          };
        } else if (layer.kind === "shape" && layer.shapeData) {
          state = {
            ...state,
            shape: {
              ...state.shape,
              kind: layer.shapeData.kind,
              lineWidth: layer.shapeData.size,
              fill: layer.shapeData.fill,
              sides: layer.shapeData.sides,
            },
            fgColor: layer.shapeData.color,
          };
        }
      }
      refresh();
    }
  },
  toggleLayerVisible(id: string) {
    const doc = engine.get(state.activeTabId);
    if (doc) {
      const l = engine.getLayer(doc, id);
      if (l) engine.setLayerVisible(doc, id, !l.visible);
      refresh();
    }
  },
  toggleLayerLock(id: string) {
    const doc = engine.get(state.activeTabId);
    if (doc) {
      const l = engine.getLayer(doc, id);
      if (l) engine.setLayerLock(doc, id, !l.locked);
      refresh();
    }
  },
  addLayer() {
    const doc = engine.get(state.activeTabId);
    if (doc) {
      engine.addLayer(doc);
      refresh();
    }
  },
  removeLayer(id: string) {
    const doc = engine.get(state.activeTabId);
    if (doc) {
      engine.removeLayer(doc, id);
      refresh();
    }
  },
  duplicateLayer(id: string) {
    const doc = engine.get(state.activeTabId);
    if (doc) {
      engine.duplicateLayer(doc, id);
      refresh();
    }
  },
  /** 拖拽调整图层顺序：将 fromId 移动到 targetId 的前/后位置 */
  reorderLayer(
    fromId: string,
    targetId: string,
    position: "before" | "after",
  ) {
    const doc = engine.get(state.activeTabId);
    if (doc) {
      engine.reorderLayer(doc, fromId, targetId, position);
      refresh();
    }
  },
  setLayerOpacity(v: number) {
    const doc = engine.get(state.activeTabId);
    if (doc) {
      engine.setLayerOpacity(doc, doc.activeLayerId, v);
      refresh();
    }
  },
  setLayerBlendMode(mode: string) {
    const doc = engine.get(state.activeTabId);
    if (doc) {
      engine.setLayerBlend(doc, doc.activeLayerId, mode);
      refresh();
    }
  },

  /* ---- 活动文字图层属性 ---- */
  updateActiveTextLayer(patch: {
    fontSize?: number;
    bold?: boolean;
    italic?: boolean;
    underline?: boolean;
    strikethrough?: boolean;
    color?: string;
    fontFamily?: string;
  }) {
    const doc = engine.get(state.activeTabId);
    if (!doc) return;
    const layer = engine.getLayer(doc, doc.activeLayerId);
    if (!layer || layer.kind !== "text" || !layer.textData) return;
    const newSize = patch.fontSize ?? layer.textData.fontSize;
    const newBold = patch.bold ?? layer.textData.bold;
    const newItalic = patch.italic ?? layer.textData.italic;
    const newUnderline = patch.underline ?? layer.textData.underline;
    const newStrikethrough = patch.strikethrough ?? layer.textData.strikethrough;
    const newColor = patch.color ?? layer.textData.color;
    const newFont = patch.fontFamily ?? layer.textData.fontFamily;
    engine.updateTextLayer(doc, layer.id, layer.textData.text, {
      color: newColor,
      size: newSize,
      bold: newBold,
      italic: newItalic,
      underline: newUnderline,
      strikethrough: newStrikethrough,
      fontFamily: newFont,
      opacity: layer.opacity,
    });
    state = {
      ...state,
      text: {
        ...state.text,
        fontSize: newSize,
        bold: newBold,
        italic: newItalic,
        underline: newUnderline,
        strikethrough: newStrikethrough,
        fontFamily: newFont,
      },
      fgColor: newColor,
    };
    refresh();
  },

  /* ---- 活动形状图层属性 ---- */
  updateActiveShapeLayer(patch: {
    kind?: ShapeKind;
    lineWidth?: number;
    fill?: boolean;
    sides?: number;
    color?: string;
  }) {
    const doc = engine.get(state.activeTabId);
    if (!doc) return;
    const layer = engine.getLayer(doc, doc.activeLayerId);
    if (!layer || layer.kind !== "shape" || !layer.shapeData) return;
    const sd = layer.shapeData;
    const newKind = patch.kind ?? sd.kind;
    const newColor = patch.color ?? sd.color;
    const newSize = patch.lineWidth ?? sd.size;
    const newFill = patch.fill ?? sd.fill;
    const newSides = patch.sides ?? sd.sides;
    engine.updateShapeLayer(doc, layer.id, sd.from, sd.to, {
      kind: newKind,
      color: newColor,
      size: newSize,
      fill: newFill,
      sides: newSides,
      opacity: layer.opacity,
    });
    const newTool = SHAPE_KIND_TOOL[newKind];
    state = {
      ...state,
      shape: {
        ...state.shape,
        kind: newKind,
        lineWidth: newSize,
        fill: newFill,
        sides: newSides,
      },
      fgColor: newColor,
      ...(newTool ? { activeTool: newTool } : {}),
    };
    refresh();
  },

  /* ---- 历史 ---- */
  selectHistory(id: string) {
    const doc = engine.get(state.activeTabId);
    if (!doc) return;
    const idx = doc.history.findIndex((h) => h.id === id);
    if (idx >= 0) {
      engine.restoreHistory(doc, idx);
      refresh();
    }
  },
  undo() {
    const doc = engine.get(state.activeTabId);
    if (doc) {
      engine.undo(doc);
      refresh();
    }
  },
  redo() {
    const doc = engine.get(state.activeTabId);
    if (doc) {
      engine.redo(doc);
      refresh();
    }
  },

  /* ---- 画笔 ---- */
  setBrush(patch: Partial<BrushState>) {
    state = { ...state, brush: { ...state.brush, ...patch } };
    emit();
  },
  resetBrush() {
    state = { ...state, brush: { ...DEFAULT_BRUSH } };
    emit();
  },

  /* ---- 仿制图章 ---- */
  setCloneStamp(patch: Partial<CloneStampSettings>) {
    state = { ...state, cloneStamp: { ...state.cloneStamp, ...patch } };
    emit();
  },
  /** 设置仿制图章源点(Alt+点击) */
  setCloneSource(x: number, y: number) {
    state = { ...state, cloneSource: { x: Math.round(x), y: Math.round(y) } };
    // 新源点：清零 aligned 累计偏移
    engine.resetCloneOffset();
    emit();
  },
  clearCloneSource() {
    if (!state.cloneSource) return;
    state = { ...state, cloneSource: null };
    engine.resetCloneOffset();
    emit();
  },

  /* ---- 油漆桶 ---- */
  setPaintBucket(patch: Partial<PaintBucketSettings>) {
    state = { ...state, paintBucket: { ...state.paintBucket, ...patch } };
    emit();
  },

  /* ---- 颜色取样器 ---- */
  /** 在 (x,y) 处放置一个取样点(超过 4 个时丢弃最旧的) */
  addColorSample(x: number, y: number) {
    const doc = engine.get(state.activeTabId);
    if (!doc) return;
    const color = engine.pickColor(doc, x, y);
    if (!color) return;
    const sample: ColorSample = {
      id: `cs_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
      x: Math.round(x),
      y: Math.round(y),
      color,
    };
    const next = [...state.colorSamples, sample];
    if (next.length > 4) next.shift();
    state = { ...state, colorSamples: next };
    emit();
  },
  removeColorSample(id: string) {
    state = {
      ...state,
      colorSamples: state.colorSamples.filter((s) => s.id !== id),
    };
    emit();
  },
  clearColorSamples() {
    if (state.colorSamples.length === 0) return;
    state = { ...state, colorSamples: [] };
    emit();
  },

  /* ---- 标尺 ---- */
  setRuler(m: RulerMeasurement | null) {
    state = { ...state, ruler: m };
    emit();
  },

  /* ---- 变换 ---- */
  /**
   * 修改活动图层的变换属性。X/Y/Rotation 直接对应图层字段；
   * W/H 通过 origW/origH 换算为 scaleX/scaleY(以图层内容中心为锚点)。
   * lockRatio 仅更新 UI 状态,不作用于 engine。
   */
  setTransform(patch: Partial<TransformState>) {
    const doc = engine.get(state.activeTabId);
    if (!doc) return;
    const layer = engine.getLayer(doc, doc.activeLayerId);
    if (!layer) return;
    const t = state.transform;
    const enginePatch: {
      offsetX?: number;
      offsetY?: number;
      scaleX?: number;
      scaleY?: number;
      rotation?: number;
    } = {};
    if (patch.x !== undefined) enginePatch.offsetX = patch.x;
    if (patch.y !== undefined) enginePatch.offsetY = patch.y;
    if (patch.rotation !== undefined) enginePatch.rotation = patch.rotation;
    // W/H → scaleX/scaleY: 用 origW/origH 换算; 锁比例时联动
    if (patch.w !== undefined && t.origW > 0) {
      const newW = Math.max(1, patch.w);
      enginePatch.scaleX = newW / t.origW;
      if (t.lockRatio && patch.h === undefined && t.origH > 0) {
        enginePatch.scaleY = newW / t.origW;
      }
    }
    if (patch.h !== undefined && t.origH > 0) {
      const newH = Math.max(1, patch.h);
      enginePatch.scaleY = newH / t.origH;
      if (t.lockRatio && patch.w === undefined && t.origW > 0) {
        enginePatch.scaleX = newH / t.origH;
      }
    }
    if (Object.keys(enginePatch).length > 0) {
      engine.setLayerTransform(doc, layer.id, enginePatch);
      engine.commitTransform(doc, "变换图层");
    }
    // lockRatio 等纯 UI 字段直接更新 state
    if (patch.lockRatio !== undefined) {
      state = {
        ...state,
        transform: { ...state.transform, lockRatio: patch.lockRatio },
      };
      emit();
    }
  },
  toggleLockRatio() {
    state = {
      ...state,
      transform: { ...state.transform, lockRatio: !state.transform.lockRatio },
    };
    emit();
  },

  /* ---- 调整 ---- */
  setAdjustment(patch: Partial<Adjustments>) {
    const doc = engine.get(state.activeTabId);
    if (doc) {
      engine.setAdjustments(doc, patch);
      refresh();
    }
  },
  /** 把当前调整烘焙到像素(永久应用) */
  bakeAdjustments() {
    const doc = engine.get(state.activeTabId);
    if (!doc) return;
    // 通过 exportPng 的方式生成带 filter 的图，再绘制回背景层
    const url = engine.exportPng(doc);
    const img = new Image();
    img.onload = () => {
      const bg = doc.layers[0];
      if (bg) {
        bg.ctx.clearRect(0, 0, doc.width, doc.height);
        bg.ctx.drawImage(img, 0, 0);
      }
      doc.adjustments = {
        brightness: 0,
        contrast: 0,
        saturation: 0,
        temperature: 0,
      };
      engine.renderComposite(doc);
      engine.pushHistory(doc, "应用调整");
      refresh();
    };
    img.src = url;
  },

  /* ---- 颜色 ---- */
  swapColors() {
    state = { ...state, fgColor: state.bgColor, bgColor: state.fgColor };
    emit();
  },
  setFgColor(color: string) {
    const doc = engine.get(state.activeTabId);
    if (doc) {
      const layer = engine.getLayer(doc, doc.activeLayerId);
      if (layer) {
        if (layer.kind === "text" && layer.textData) {
          engine.updateTextLayer(doc, layer.id, layer.textData.text, {
            color,
            size: layer.textData.fontSize,
            bold: layer.textData.bold,
            italic: layer.textData.italic,
            underline: layer.textData.underline,
            strikethrough: layer.textData.strikethrough,
            opacity: layer.opacity,
          });
        } else if (layer.kind === "shape" && layer.shapeData) {
          const sd = layer.shapeData;
          engine.updateShapeLayer(doc, layer.id, sd.from, sd.to, {
            kind: sd.kind,
            color,
            size: sd.size,
            fill: sd.fill,
            sides: sd.sides,
            opacity: layer.opacity,
          });
        }
      }
    }
    state = { ...state, fgColor: color };
    emit();
  },
  setBgColor(color: string) {
    state = { ...state, bgColor: color };
    emit();
  },

  /* ---- 折叠分组 ---- */
  toggleSection(key: string) {
    state = {
      ...state,
      collapsedSections: {
        ...state.collapsedSections,
        [key]: !state.collapsedSections[key],
      },
    };
    emit();
  },

  /* ---- 右侧面板 ---- */
  toggleRightSidebar() {
    state = { ...state, rightSidebarVisible: !state.rightSidebarVisible };
    emit();
  },
  toggleRightSidebarCollapsed() {
    state = { ...state, rightSidebarCollapsed: !state.rightSidebarCollapsed };
    emit();
  },

  /* ---- 选区裁剪 ---- */
  cropToSelection(rect: { x: number; y: number; w: number; h: number }) {
    const doc = engine.get(state.activeTabId);
    if (doc) {
      engine.crop(doc, rect);
      refresh();
    }
  },
};

/** 获取当前工具的状态栏名称 */
export const getActiveToolStatusName = (): string => {
  const t = TOOLS.find((x) => x.id === state.activeTool);
  return t ? t.statusName : "";
};

/* ============ React 订阅 hook ============ */
export const useEditor = (): EditorState => {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
};
