/*
 * fat-photo 编辑器引擎
 * ----------------------------------------------------------------------------
 * 持有真正的画布数据(HTMLCanvasElement / ImageData)，这些数据不能进入 React
 * 状态。store 仅持有可序列化的元数据 + 版本号，通过 bumpVersion 触发重渲染。
 *
 * 一个 DocumentEngine 对应一个 tab(一张图片)。多个 tab 共享一个 EditorEngine
 * 单例。所有写操作完成后调用 emit() 通知 store 重新拉取元数据。
 *
 * 高频像素操作(画笔/移动图层)只调 notifyCanvas() 重绘画布，不触发 store
 * 刷新；一笔结束后才 emit() 同步历史/图层元数据。
 */
import type { Adjustments } from "store";

/* ============ 类型 ============ */
export interface EngineLayer {
  id: string;
  name: string;
  /** 离屏画布，尺寸 = 文档尺寸 */
  canvas: HTMLCanvasElement;
  ctx: CanvasRenderingContext2D;
  visible: boolean;
  locked: boolean;
  opacity: number; // 0-100
  blendMode: string;
  /** 图层在文档中的偏移(移动工具) */
  offsetX: number;
  offsetY: number;
  /** X 缩放系数(1 = 原始大小)，以图层内容中心为锚点 */
  scaleX: number;
  /** Y 缩放系数(1 = 原始大小)，以图层内容中心为锚点 */
  scaleY: number;
  /** 旋转角度(度, 顺时针为正)，以图层内容中心为锚点 */
  rotation: number;
  /** 图层类型：普通像素 / 可编辑文字 / 可编辑形状 */
  kind: "image" | "text" | "shape";
  /** 文字图层的可编辑数据（仅 kind === "text" 时有效） */
  textData?: TextLayerData;
  /** 形状图层的可编辑数据（仅 kind === "shape" 时有效） */
  shapeData?: ShapeLayerData;
}

/** 文字图层的可编辑数据。坐标为图层本地坐标(相对 offsetX/offsetY) */
export interface TextLayerData {
  text: string;
  fontSize: number;
  bold: boolean;
  italic: boolean;
  underline: boolean;
  strikethrough: boolean;
  color: string;
  /** 字体(font-family 值)，见 TEXT_FONTS */
  fontFamily: string;
  /** 文本框宽度(图层本地坐标 px)。设置后文字按此宽度自动换行；undefined = 按内容自动宽度 */
  boxWidth?: number;
  /** 文字左上角在图层本地坐标系中的位置 */
  x: number;
  y: number;
}

/** 可选字体列表(label 用于 UI 显示，value 为 canvas/CSS font-family 值) */
export const TEXT_FONTS: Array<{ label: string; value: string }> = [
  {
    label: "系统默认",
    value:
      "-apple-system, BlinkMacSystemFont, 'Segoe UI', 'Noto Sans SC', sans-serif",
  },
  { label: "宋体", value: "SimSun, 'Songti SC', serif" },
  { label: "黑体", value: "SimHei, 'Heiti SC', sans-serif" },
  { label: "微软雅黑", value: "'Microsoft YaHei', sans-serif" },
  { label: "楷体", value: "KaiTi, 'Kaiti SC', serif" },
  { label: "仿宋", value: "FangSong, 'FangSong_GB2312', serif" },
  { label: "隶书", value: "LiSu, 'STLiti', serif" },
  { label: "幼圆", value: "YouYuan, 'YouYuan', sans-serif" },
  { label: "华文行楷", value: "'STXingkai', 'Xingkai SC', cursive" },
  { label: "华文中宋", value: "'STZhongsong', 'Songti SC', serif" },
  { label: "华文琥珀", value: "'STHupo', 'Hupo SC', sans-serif" },
  { label: "华文新魏", value: "'STXinwei', 'Xinwei SC', sans-serif" },
  { label: "华文细黑", value: "'STXihei', 'Xihei SC', sans-serif" },
  { label: "华文彩云", value: "'STCaoyun', 'Caoyun SC', sans-serif" },
  { label: "Arial", value: "Arial, Helvetica, sans-serif" },
  { label: "Times", value: "'Times New Roman', Times, serif" },
  { label: "Georgia", value: "Georgia, serif" },
  { label: "Verdana", value: "Verdana, Geneva, sans-serif" },
  { label: "Tahoma", value: "Tahoma, Geneva, sans-serif" },
  { label: "Trebuchet MS", value: "'Trebuchet MS', Helvetica, sans-serif" },
  { label: "Impact", value: "Impact, Charcoal, sans-serif" },
  { label: "Comic Sans MS", value: "'Comic Sans MS', 'Comic Sans', cursive" },
  {
    label: "Palatino",
    value: "'Palatino Linotype', 'Book Antiqua', Palatino, serif",
  },
  { label: "Garamond", value: "Garamond, 'Times New Roman', serif" },
  { label: "Courier", value: "'Courier New', Courier, monospace" },
  { label: "Consolas", value: "Consolas, 'Courier New', monospace" },
  { label: "Monaco", value: "Monaco, 'Courier New', monospace" },
];

/** 默认字体(系统默认) */
export const DEFAULT_FONT_FAMILY = TEXT_FONTS[0].value;

/** 形状图层的可编辑数据。from/to 为图层本地坐标(相对 offsetX/offsetY) */
export interface ShapeLayerData {
  kind: ShapeKind;
  color: string;
  /** 描边宽度 */
  size: number;
  fill: boolean;
  /** 起点与终点(矩形/椭圆: 对角点; 直线: 两端点) */
  from: { x: number; y: number };
  to: { x: number; y: number };
  /** 多边形/星星的边数(仅在 kind 为 polygon/star 时使用) */
  sides: number;
}

export interface HistoryStep {
  id: string;
  label: string;
  /** 每个图层在快照时刻的像素数据 */
  snapshots: Record<string, ImageData>;
  /** 快照时刻的图层元数据(顺序、可见性等) */
  layerStates: Array<{
    id: string;
    name: string;
    visible: boolean;
    locked: boolean;
    opacity: number;
    blendMode: string;
    offsetX: number;
    offsetY: number;
    scaleX: number;
    scaleY: number;
    rotation: number;
    kind: "image" | "text" | "shape";
    textData?: TextLayerData;
    shapeData?: ShapeLayerData;
  }>;
  activeLayerId: string;
  /** 快照时刻的选区蒙版（可能为 null） */
  selection: ImageData | null;
}

export interface DocumentEngine {
  id: string; // tab id
  name: string; // 文件名
  width: number;
  height: number;
  layers: EngineLayer[];
  activeLayerId: string;
  adjustments: Adjustments;
  history: HistoryStep[];
  currentHistoryIndex: number;
  /** 合成画布(所有可见图层按 blend/opacity 合成)，供画布显示与吸管采样 */
  composite: HTMLCanvasElement;
  compositeCtx: CanvasRenderingContext2D;
  /** 选区蒙版：与文档同尺寸，alpha 通道 255=已选/0=未选；null 表示无选区 */
  selectionMask: HTMLCanvasElement | null;
  selectionCtx: CanvasRenderingContext2D | null;
}

export interface StrokeOpts {
  color: string;
  size: number;
  hardness: number; // 0-100
  opacity: number; // 0-100
  flow: number; // 0-100
  eraser?: boolean;
}

export type ShapeKind =
  | "rect"
  | "ellipse"
  | "line"
  | "circle"
  | "triangle"
  | "polygon"
  | "star";

export interface ShapeOpts {
  kind: ShapeKind;
  color: string;
  size: number; // 描边宽度
  opacity: number;
  fill: boolean;
  /** 多边形/星星的边数(仅 polygon/star 使用) */
  sides: number;
}

/** 形状类型 → 中文名(用于图层名与历史标签) */
export const SHAPE_LABELS: Record<ShapeKind, string> = {
  rect: "矩形",
  ellipse: "椭圆",
  line: "直线",
  circle: "圆形",
  triangle: "三角形",
  polygon: "多边形",
  star: "星形",
};

export interface TextOpts {
  color: string;
  size: number;
  bold: boolean;
  italic: boolean;
  underline: boolean;
  strikethrough: boolean;
  opacity: number;
  /** 字体(font-family 值)；缺省沿用原值或系统默认 */
  fontFamily?: string;
  /** 文本框宽度(px)；设置后按此宽度换行 */
  boxWidth?: number;
  /** 提交时设置图层旋转角(度) */
  rotation?: number;
}

/** 选区操作类型（与 store.SelectionOp 一致） */
export type SelectionOp = "new" | "add" | "subtract" | "intersect";

/** 取样源：当前图层 / 所有可见图层合成 */
export type SampleSource = "active" | "all";

/* ============ 工具函数 ============ */
let idSeq = 0;
const nextId = (prefix: string) => `${prefix}_${Date.now()}_${idSeq++}`;

/** 创建一块尺寸 = (w,h) 的离屏画布 */
const createCanvas = (w: number, h: number): HTMLCanvasElement => {
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  return c;
};

const getCtx = (c: HTMLCanvasElement): CanvasRenderingContext2D => {
  const ctx = c.getContext("2d", { willReadFrequently: true });
  if (!ctx) throw new Error("2D context unavailable");
  return ctx;
};

/** 复制一块画布的像素 */
const cloneCanvas = (src: HTMLCanvasElement): HTMLCanvasElement => {
  const dst = createCanvas(src.width, src.height);
  const dctx = getCtx(dst);
  dctx.drawImage(src, 0, 0);
  return dst;
};

const hexToRgb = (hex: string): { r: number; g: number; b: number } => {
  const m = /^#?([0-9a-fA-F]{6})$/.exec(hex.trim());
  if (!m) return { r: 0, g: 0, b: 0 };
  const n = parseInt(m[1], 16);
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
};

/** 中文混合模式名 → canvas globalCompositeOperation 值 */
const BLEND_MAP: Record<string, GlobalCompositeOperation> = {
  正常: "source-over",
  正片叠底: "multiply",
  滤色: "screen",
  叠加: "overlay",
  柔光: "soft-light",
};

/* ---- 笔刷笔尖缓存(按 颜色|大小|硬度) ---- */
const tipCache = new Map<string, HTMLCanvasElement>();
const getBrushTip = (
  color: string,
  size: number,
  hardness: number,
): HTMLCanvasElement => {
  const s = Math.max(1, Math.round(size));
  const h = Math.max(0, Math.min(100, hardness));
  const key = `${color}|${s}|${h}`;
  const cached = tipCache.get(key);
  if (cached) return cached;
  const tip = createCanvas(s, s);
  const ctx = getCtx(tip);
  const r = s / 2;
  // 硬度 = 实心部分占比，之外径向渐隐
  const inner = (h / 100) * r;
  const { r: cr, g: cg, b: cb } = hexToRgb(color);
  const grad = ctx.createRadialGradient(
    r,
    r,
    Math.max(0, inner - 0.5),
    r,
    r,
    r,
  );
  grad.addColorStop(0, `rgba(${cr},${cg},${cb},1)`);
  grad.addColorStop(1, `rgba(${cr},${cg},${cb},0)`);
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, s, s);
  if (tipCache.size > 32) tipCache.clear();
  tipCache.set(key, tip);
  return tip;
};

/* ---- 进行中的一笔(画笔缓冲 / 橡皮直绘) ---- */
interface ActiveStroke {
  docId: string;
  layerId: string;
  eraser: boolean;
  /** 画笔: 先画到缓冲，避免叠点加深；橡皮: 直接 destination-out 到图层 */
  buffer: HTMLCanvasElement | null;
  bufferCtx: CanvasRenderingContext2D | null;
  /** 图层局部坐标系下的上一个采样点 */
  last: { x: number; y: number };
  opts: StrokeOpts;
  blocked: boolean;
}

/* ---- 进行中的仿制图章笔触 ---- */
interface CloneStroke {
  docId: string;
  layerId: string;
  /** 取样源画布(当前图层 or 合成画布) */
  sourceCanvas: HTMLCanvasElement;
  /** 源点在源画布坐标系中(已含 aligned 累计偏移) */
  srcX: number;
  srcY: number;
  /** 笔触起点(图层局部坐标) */
  startLocal: { x: number; y: number };
  buffer: HTMLCanvasElement;
  bufferCtx: CanvasRenderingContext2D;
  /** 图层局部坐标系下的上一个采样点 */
  last: { x: number; y: number };
  opts: StrokeOpts;
  aligned: boolean;
  blocked: boolean;
}

/** 油漆桶设置 */
interface PaintBucketOpts {
  color: string;
  tolerance: number;
  contiguous: boolean;
  source: SampleSource;
  opacity: number;
}

/* ============ 单例 ============ */
class EditorEngine {
  private docs = new Map<string, DocumentEngine>();
  /** 单调递增版本号，每次 emit/notifyCanvas 自增。供画布组件感知像素变动 */
  private version = 0;
  private activeStroke: ActiveStroke | null = null;
  /** 仿制图章进行中的笔触 */
  private cloneStroke: CloneStroke | null = null;
  /** aligned 模式下累计的源点偏移(每次描边后更新；设置新源点时清零) */
  private cloneAlignedOffset = { x: 0, y: 0 };
  private canvasListeners = new Set<() => void>();

  /** 外部订阅函数(store 元数据刷新)，每次写操作后调用 */
  subscriber: (() => void) | null = null;

  subscribe(cb: () => void): () => void {
    this.subscriber = cb;
    return () => {
      if (this.subscriber === cb) this.subscriber = null;
    };
  }

  /** 画布级订阅(高频像素变动，不刷新 store 元数据) */
  subscribeCanvas(cb: () => void): () => void {
    this.canvasListeners.add(cb);
    return () => {
      this.canvasListeners.delete(cb);
    };
  }

  /** 当前版本号 */
  getVersion(): number {
    return this.version;
  }

  /** 仅通知画布重绘(笔画进行中) */
  private notifyCanvas() {
    this.version++;
    this.canvasListeners.forEach((l) => l());
  }

  /** 完整通知(元数据 + 画布) */
  private emit() {
    this.version++;
    this.canvasListeners.forEach((l) => l());
    this.subscriber?.();
  }

  has(id: string): boolean {
    return this.docs.has(id);
  }

  get(id: string): DocumentEngine | undefined {
    return this.docs.get(id);
  }

  list(): string[] {
    return Array.from(this.docs.keys());
  }

  remove(id: string) {
    this.docs.delete(id);
    this.emit();
  }

  private makeLayer(
    name: string,
    canvas: HTMLCanvasElement,
    locked: boolean,
  ): EngineLayer {
    return {
      id: nextId("layer"),
      name,
      canvas,
      ctx: getCtx(canvas),
      visible: true,
      locked,
      opacity: 100,
      blendMode: "正常",
      offsetX: 0,
      offsetY: 0,
      scaleX: 1,
      scaleY: 1,
      rotation: 0,
      kind: "image",
    };
  }

  /** 文字图层使用的字体字符串 */
  private textFont(size: number, bold: boolean, italic: boolean, fontFamily?: string): string {
    return `${italic ? "italic " : ""}${bold ? "700 " : "400 "}${size}px ${fontFamily || DEFAULT_FONT_FAMILY}`;
  }

  /**
   * 按 boxWidth 把文字折行(逐字符贪心换行)。boxWidth 为空则只按 \n 分行。
   * 调用前需先设置 ctx.font。
   */
  private wrapTextLines(
    ctx: CanvasRenderingContext2D,
    text: string,
    boxWidth?: number,
  ): string[] {
    const out: string[] = [];
    for (const raw of text.split("\n")) {
      if (!boxWidth || boxWidth <= 0) {
        out.push(raw);
        continue;
      }
      let cur = "";
      for (const ch of raw) {
        if (cur && ctx.measureText(cur + ch).width > boxWidth) {
          out.push(cur);
          cur = ch;
        } else {
          cur += ch;
        }
      }
      out.push(cur);
    }
    return out;
  }

  /** 把文字图层的 textData 重绘到它自己的 canvas 上（合成时由 renderComposite 完成叠加） */
  private renderTextLayer(layer: EngineLayer) {
    const ctx = layer.ctx;
    ctx.clearRect(0, 0, layer.canvas.width, layer.canvas.height);
    const td = layer.textData;
    if (!td || !td.text) return;
    ctx.save();
    ctx.globalAlpha = 1;
    ctx.fillStyle = td.color;
    ctx.font = this.textFont(td.fontSize, td.bold, td.italic, td.fontFamily);
    ctx.textBaseline = "top";
    const lineHeight = td.fontSize * 1.25;
    const lines = this.wrapTextLines(ctx, td.text, td.boxWidth);
    lines.forEach((line, i) => {
      const ly = td.y + i * lineHeight;
      ctx.fillText(line, td.x, ly);
      const m = ctx.measureText(line || " ");
      if (td.underline) {
        const uy = ly + td.fontSize + 1;
        ctx.fillRect(td.x, uy, m.width, 1);
      }
      if (td.strikethrough) {
        const sy = ly + td.fontSize * 0.55;
        ctx.fillRect(td.x, sy, m.width, 1);
      }
    });
    ctx.restore();
  }

  /** 计算文字图层内容的包围盒(图层本地坐标) */
  private getTextBBox(layer: EngineLayer): {
    x: number;
    y: number;
    w: number;
    h: number;
  } {
    const td = layer.textData;
    if (!td) return { x: 0, y: 0, w: 0, h: 0 };
    const ctx = layer.ctx;
    ctx.save();
    ctx.font = this.textFont(td.fontSize, td.bold, td.italic, td.fontFamily);
    const lines = this.wrapTextLines(ctx, td.text, td.boxWidth);
    let maxW = 0;
    for (const line of lines) {
      const m = ctx.measureText(line || " ");
      if (m.width > maxW) maxW = m.width;
    }
    ctx.restore();
    const lineHeight = td.fontSize * 1.25;
    return {
      x: td.x,
      y: td.y,
      w:
        td.boxWidth && td.boxWidth > 0
          ? td.boxWidth
          : Math.max(maxW, td.fontSize),
      h: lineHeight * Math.max(1, lines.length),
    };
  }

  /**
   * 获取图层内容包围盒的中心(图层本地坐标)，作为旋转/缩放的锚点。
   * - 文字: 文字 bbox 中心
   * - 形状: from/to 对角线中心
   * - 普通图层: 画布中心(近似为内容中心)
   */
  getLayerCenter(layer: EngineLayer): { x: number; y: number } {
    if (layer.kind === "text" && layer.textData) {
      const bbox = this.getTextBBox(layer);
      return { x: bbox.x + bbox.w / 2, y: bbox.y + bbox.h / 2 };
    }
    if (layer.kind === "shape" && layer.shapeData) {
      const sd = layer.shapeData;
      const x1 = Math.min(sd.from.x, sd.to.x);
      const y1 = Math.min(sd.from.y, sd.to.y);
      const x2 = Math.max(sd.from.x, sd.to.x);
      const y2 = Math.max(sd.from.y, sd.to.y);
      return { x: (x1 + x2) / 2, y: (y1 + y2) / 2 };
    }
    // 普通像素图层: 用画布中心
    return { x: layer.canvas.width / 2, y: layer.canvas.height / 2 };
  }

  /**
   * 计算图层内容未缩放的原始宽高(图层本地坐标)。
   * 用于 W/H 输入框与 scaleX/scaleY 之间的换算。
   */
  getLayerOrigSize(
    layer: EngineLayer,
    doc: DocumentEngine,
  ): { w: number; h: number } {
    if (layer.kind === "text" && layer.textData) {
      const bbox = this.getTextBBox(layer);
      return { w: bbox.w, h: bbox.h };
    }
    if (layer.kind === "shape" && layer.shapeData) {
      const sd = layer.shapeData;
      return {
        w: Math.abs(sd.to.x - sd.from.x),
        h: Math.abs(sd.to.y - sd.from.y),
      };
    }
    // 普通像素图层: 用文档尺寸(画布同尺寸)
    return { w: doc.width, h: doc.height };
  }

  /**
   * 图层内容在本地坐标系(未应用 offset/rotation/scale)的包围盒。
   * 用于绘制选框与旋转手柄定位。
   */
  getLayerBBoxLocal(
    layer: EngineLayer,
    doc: DocumentEngine,
  ): { x: number; y: number; w: number; h: number } {
    if (layer.kind === "text" && layer.textData) {
      return this.getTextBBox(layer);
    }
    if (layer.kind === "shape" && layer.shapeData) {
      const sd = layer.shapeData;
      const x = Math.min(sd.from.x, sd.to.x);
      const y = Math.min(sd.from.y, sd.to.y);
      return {
        x,
        y,
        w: Math.abs(sd.to.x - sd.from.x),
        h: Math.abs(sd.to.y - sd.from.y),
      };
    }
    return { x: 0, y: 0, w: doc.width, h: doc.height };
  }

  /**
   * 把图层本地坐标点经 offset/rotation/scale 变换后，得到文档坐标。
   * 用于旋转手柄定位等。
   */
  layerLocalToDoc(
    layer: EngineLayer,
    local: { x: number; y: number },
  ): { x: number; y: number } {
    const center = this.getLayerCenter(layer);
    const dx = local.x - center.x;
    const dy = local.y - center.y;
    const rad = (layer.rotation * Math.PI) / 180;
    const cos = Math.cos(rad);
    const sin = Math.sin(rad);
    const tx = dx * layer.scaleX;
    const ty = dy * layer.scaleY;
    return {
      x: layer.offsetX + center.x + (tx * cos - ty * sin),
      y: layer.offsetY + center.y + (tx * sin + ty * cos),
    };
  }

  /**
   * 把文档坐标点转换为图层本地坐标(逆向应用图层的 offset/rotation/scale)。
   * 用于命中测试: 用户点击文档某点 → 反算到图层本地坐标 → 与 bbox 比较。
   */
  private docToLayerLocal(
    layer: EngineLayer,
    pt: { x: number; y: number },
  ): { x: number; y: number } {
    const center = this.getLayerCenter(layer);
    // 1. 平移到图层原点(去掉 offset)
    let x = pt.x - layer.offsetX;
    let y = pt.y - layer.offsetY;
    // 2. 平移到旋转中心
    x -= center.x;
    y -= center.y;
    // 3. 反向旋转
    if (layer.rotation) {
      const rad = (-layer.rotation * Math.PI) / 180;
      const cos = Math.cos(rad);
      const sin = Math.sin(rad);
      const nx = x * cos - y * sin;
      const ny = x * sin + y * cos;
      x = nx;
      y = ny;
    }
    // 4. 反向缩放
    if (layer.scaleX !== 0) x /= layer.scaleX;
    if (layer.scaleY !== 0) y /= layer.scaleY;
    // 5. 平移回图层原点
    x += center.x;
    y += center.y;
    return { x, y };
  }

  /** 公开版 docToLayerLocal：文档坐标 → 图层本地坐标(逆向 offset/rotation/scale) */
  toLayerLocal(
    layer: EngineLayer,
    pt: { x: number; y: number },
  ): { x: number; y: number } {
    return this.docToLayerLocal(layer, pt);
  }

  /**
   * 进入文字就地编辑前调用：若图层带缩放，把缩放烘焙进 fontSize/boxWidth，
   * 并把 scaleX/scaleY 归 1，使编辑框可用未缩放的字体大小显示。
   * 不 pushHistory(并入随后的「编辑文字」历史条目)。
   */
  normalizeTextLayerScale(doc: DocumentEngine, layerId: string) {
    const l = this.getLayer(doc, layerId);
    if (!l || l.kind !== "text" || !l.textData) return;
    if (l.scaleX === 1 && l.scaleY === 1) return;
    const td = l.textData;
    td.fontSize = Math.max(1, Math.round(td.fontSize * l.scaleY));
    if (td.boxWidth)
      td.boxWidth = Math.max(1, Math.round(td.boxWidth * l.scaleX));
    l.scaleX = 1;
    l.scaleY = 1;
    this.renderTextLayer(l);
    this.renderComposite(doc);
    this.notifyCanvas();
  }

  /** 命中测试：在文档坐标 pt 处点击，返回最上层可见文字图层(若无返回 null) */
  hitTestTextLayer(
    doc: DocumentEngine,
    pt: { x: number; y: number },
  ): EngineLayer | null {
    for (let i = doc.layers.length - 1; i >= 0; i--) {
      const l = doc.layers[i];
      if (!l.visible || l.kind !== "text" || !l.textData) continue;
      const bbox = this.getTextBBox(l);
      // 反向应用图层变换(旋转/缩放)后，再与 bbox 比较
      const local = this.docToLayerLocal(l, pt);
      if (
        local.x >= bbox.x &&
        local.x <= bbox.x + bbox.w &&
        local.y >= bbox.y &&
        local.y <= bbox.y + bbox.h
      ) {
        return l;
      }
    }
    return null;
  }

  /** 暂时清空文字图层画布(进入就地编辑时调用，避免与 textarea 重影) */
  clearTextLayerCanvas(doc: DocumentEngine, layerId: string) {
    const l = this.getLayer(doc, layerId);
    if (!l || l.kind !== "text") return;
    l.ctx.clearRect(0, 0, l.canvas.width, l.canvas.height);
    this.renderComposite(doc);
    this.notifyCanvas();
  }

  /** 按 textData 重新渲染文字图层画布(取消编辑时还原) */
  restoreTextLayerCanvas(doc: DocumentEngine, layerId: string) {
    const l = this.getLayer(doc, layerId);
    if (!l || l.kind !== "text") return;
    this.renderTextLayer(l);
    this.renderComposite(doc);
    this.notifyCanvas();
  }

  /** 新建文字图层并写入文字(pos 为文档坐标，新图层 offset=0 因此本地坐标=文档坐标) */
  addTextLayer(
    doc: DocumentEngine,
    pos: { x: number; y: number },
    text: string,
    opts: TextOpts,
  ): EngineLayer {
    const layer = this.makeLayer(
      text.trim().slice(0, 12) || "文字图层",
      createCanvas(doc.width, doc.height),
      false,
    );
    layer.kind = "text";
    layer.textData = {
      text,
      fontSize: opts.size,
      bold: opts.bold,
      italic: opts.italic,
      underline: opts.underline,
      strikethrough: opts.strikethrough,
      color: opts.color,
      fontFamily: opts.fontFamily || DEFAULT_FONT_FAMILY,
      boxWidth:
        opts.boxWidth && opts.boxWidth > 0
          ? Math.round(opts.boxWidth)
          : undefined,
      x: Math.round(pos.x),
      y: Math.round(pos.y),
    };
    if (opts.rotation) layer.rotation = opts.rotation;
    doc.layers.push(layer);
    doc.activeLayerId = layer.id;
    this.renderTextLayer(layer);
    this.pushHistory(doc, "添加文字");
    this.renderComposite(doc);
    this.emit();
    return layer;
  }

  /** 更新已有文字图层的内容/样式并重绘 */
  updateTextLayer(
    doc: DocumentEngine,
    layerId: string,
    text: string,
    opts: TextOpts,
  ): EngineLayer | null {
    const layer = this.getLayer(doc, layerId);
    if (!layer || layer.kind !== "text" || !layer.textData) return null;
    layer.textData = {
      ...layer.textData,
      text,
      fontSize: opts.size,
      bold: opts.bold,
      italic: opts.italic,
      underline: opts.underline,
      strikethrough: opts.strikethrough,
      color: opts.color,
      fontFamily: opts.fontFamily || layer.textData.fontFamily,
      boxWidth:
        opts.boxWidth !== undefined
          ? opts.boxWidth > 0
            ? Math.round(opts.boxWidth)
            : undefined
          : layer.textData.boxWidth,
    };
    if (opts.rotation !== undefined) layer.rotation = opts.rotation;
    layer.name = text.trim().slice(0, 12) || "文字图层";
    this.renderTextLayer(layer);
    this.pushHistory(doc, "编辑文字");
    this.renderComposite(doc);
    this.emit();
    return layer;
  }

  /* ============ 形状图层 ============ */

  /** 计算正多边形顶点(以 bbox 中心为圆心，min(w,h)/2 为半径，顶点朝上) */
  polygonPoints(
    x1: number,
    y1: number,
    x2: number,
    y2: number,
    sides: number,
  ): { x: number; y: number }[] {
    const cx = (x1 + x2) / 2;
    const cy = (y1 + y2) / 2;
    const r = Math.max(0.5, Math.min(Math.abs(x2 - x1), Math.abs(y2 - y1)) / 2);
    const n = Math.max(3, Math.floor(sides));
    const pts: { x: number; y: number }[] = [];
    for (let i = 0; i < n; i++) {
      const a = -Math.PI / 2 + (i * 2 * Math.PI) / n;
      pts.push({ x: cx + r * Math.cos(a), y: cy + r * Math.sin(a) });
    }
    return pts;
  }

  /** 计算星星顶点(外/内半径交替，外半径 = min(w,h)/2，内半径 = 外 * 0.4) */
  starPoints(
    x1: number,
    y1: number,
    x2: number,
    y2: number,
    points: number,
  ): { x: number; y: number }[] {
    const cx = (x1 + x2) / 2;
    const cy = (y1 + y2) / 2;
    const rOut = Math.max(
      0.5,
      Math.min(Math.abs(x2 - x1), Math.abs(y2 - y1)) / 2,
    );
    const rIn = rOut * 0.4;
    const n = Math.max(3, Math.floor(points));
    const pts: { x: number; y: number }[] = [];
    for (let i = 0; i < n * 2; i++) {
      const a = -Math.PI / 2 + (i * Math.PI) / n;
      const r = i % 2 === 0 ? rOut : rIn;
      pts.push({ x: cx + r * Math.cos(a), y: cy + r * Math.sin(a) });
    }
    return pts;
  }

  /** 把形状图层的 shapeData 重绘到它自己的 canvas 上 */
  private renderShapeLayer(layer: EngineLayer) {
    const ctx = layer.ctx;
    ctx.clearRect(0, 0, layer.canvas.width, layer.canvas.height);
    const sd = layer.shapeData;
    if (!sd) return;
    ctx.save();
    ctx.globalAlpha = 1;
    ctx.strokeStyle = sd.color;
    ctx.fillStyle = sd.color;
    ctx.lineWidth = sd.size;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    const x1 = sd.from.x;
    const y1 = sd.from.y;
    const x2 = sd.to.x;
    const y2 = sd.to.y;
    if (sd.kind === "rect") {
      const rx = Math.min(x1, x2);
      const ry = Math.min(y1, y2);
      const rw = Math.abs(x2 - x1);
      const rh = Math.abs(y2 - y1);
      if (sd.fill) ctx.fillRect(rx, ry, rw, rh);
      else ctx.strokeRect(rx, ry, rw, rh);
    } else if (sd.kind === "ellipse") {
      const cx = (x1 + x2) / 2;
      const cy = (y1 + y2) / 2;
      const rx = Math.abs(x2 - x1) / 2;
      const ry = Math.abs(y2 - y1) / 2;
      ctx.beginPath();
      ctx.ellipse(
        cx,
        cy,
        Math.max(0.5, rx),
        Math.max(0.5, ry),
        0,
        0,
        Math.PI * 2,
      );
      if (sd.fill) ctx.fill();
      else ctx.stroke();
    } else if (sd.kind === "circle") {
      // 圆形：以 bbox 中心为圆心，min(w,h)/2 为半径
      const cx = (x1 + x2) / 2;
      const cy = (y1 + y2) / 2;
      const r = Math.max(
        0.5,
        Math.min(Math.abs(x2 - x1), Math.abs(y2 - y1)) / 2,
      );
      ctx.beginPath();
      ctx.arc(cx, cy, r, 0, Math.PI * 2);
      if (sd.fill) ctx.fill();
      else ctx.stroke();
    } else if (sd.kind === "triangle") {
      const pts = this.polygonPoints(x1, y1, x2, y2, 3);
      ctx.beginPath();
      ctx.moveTo(pts[0].x, pts[0].y);
      for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
      ctx.closePath();
      if (sd.fill) ctx.fill();
      else ctx.stroke();
    } else if (sd.kind === "polygon") {
      const pts = this.polygonPoints(x1, y1, x2, y2, sd.sides);
      ctx.beginPath();
      ctx.moveTo(pts[0].x, pts[0].y);
      for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
      ctx.closePath();
      if (sd.fill) ctx.fill();
      else ctx.stroke();
    } else if (sd.kind === "star") {
      const pts = this.starPoints(x1, y1, x2, y2, sd.sides);
      ctx.beginPath();
      ctx.moveTo(pts[0].x, pts[0].y);
      for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
      ctx.closePath();
      if (sd.fill) ctx.fill();
      else ctx.stroke();
    } else {
      // line
      ctx.beginPath();
      ctx.moveTo(x1, y1);
      ctx.lineTo(x2, y2);
      ctx.stroke();
    }
    ctx.restore();
  }

  /** 形状图层命中测试：点击在形状 bounding box 或边线上返回 true(文档坐标) */
  private hitTestShape(
    layer: EngineLayer,
    pt: { x: number; y: number },
  ): boolean {
    const sd = layer.shapeData;
    if (!sd) return false;
    // 反向应用图层变换(旋转/缩放)后，再与 bbox 比较
    const local = this.docToLayerLocal(layer, pt);
    const lx = local.x;
    const ly = local.y;
    const x1 = Math.min(sd.from.x, sd.to.x);
    const y1 = Math.min(sd.from.y, sd.to.y);
    const x2 = Math.max(sd.from.x, sd.to.x);
    const y2 = Math.max(sd.from.y, sd.to.y);
    const tol = Math.max(4, sd.size); // 命中容差
    if (sd.kind === "line") {
      // 点到线段距离
      const ax = sd.from.x;
      const ay = sd.from.y;
      const bx = sd.to.x;
      const by = sd.to.y;
      const dx = bx - ax;
      const dy = by - ay;
      const len2 = dx * dx + dy * dy;
      if (len2 === 0) return Math.hypot(lx - ax, ly - ay) <= tol;
      let t = ((lx - ax) * dx + (ly - ay) * dy) / len2;
      t = Math.max(0, Math.min(1, t));
      const px = ax + t * dx;
      const py = ay + t * dy;
      return Math.hypot(lx - px, ly - py) <= tol;
    }
    // rect / ellipse / circle / triangle / polygon / star：填充走 bbox 内部，描边走 bbox 边缘 ± tol
    const inside =
      lx >= x1 - tol && lx <= x2 + tol && ly >= y1 - tol && ly <= y2 + tol;
    if (!inside) return false;
    if (sd.fill) return true;
    // 描边：靠近 bbox 边缘
    const nearEdge =
      Math.abs(lx - x1) <= tol ||
      Math.abs(lx - x2) <= tol ||
      Math.abs(ly - y1) <= tol ||
      Math.abs(ly - y2) <= tol;
    return nearEdge;
  }

  /** 命中测试：返回最上层可见形状图层 */
  hitTestShapeLayer(
    doc: DocumentEngine,
    pt: { x: number; y: number },
  ): EngineLayer | null {
    for (let i = doc.layers.length - 1; i >= 0; i--) {
      const l = doc.layers[i];
      if (!l.visible || l.kind !== "shape" || !l.shapeData) continue;
      if (this.hitTestShape(l, pt)) return l;
    }
    return null;
  }

  /** 新建形状图层(from/to 为文档坐标) */
  addShapeLayer(
    doc: DocumentEngine,
    from: { x: number; y: number },
    to: { x: number; y: number },
    opts: ShapeOpts,
  ): EngineLayer {
    const layer = this.makeLayer(
      SHAPE_LABELS[opts.kind] ?? "形状",
      createCanvas(doc.width, doc.height),
      false,
    );
    layer.kind = "shape";
    layer.shapeData = {
      kind: opts.kind,
      color: opts.color,
      size: opts.size,
      fill: opts.fill,
      from: { x: Math.round(from.x), y: Math.round(from.y) },
      to: { x: Math.round(to.x), y: Math.round(to.y) },
      sides: opts.sides,
    };
    doc.layers.push(layer);
    doc.activeLayerId = layer.id;
    this.renderShapeLayer(layer);
    this.pushHistory(doc, `添加${layer.name}`);
    this.renderComposite(doc);
    this.emit();
    return layer;
  }

  /** 更新已有形状图层的几何/样式并重绘 */
  updateShapeLayer(
    doc: DocumentEngine,
    layerId: string,
    from: { x: number; y: number },
    to: { x: number; y: number },
    opts: ShapeOpts,
  ): EngineLayer | null {
    const layer = this.getLayer(doc, layerId);
    if (!layer || layer.kind !== "shape" || !layer.shapeData) return null;
    layer.shapeData = {
      ...layer.shapeData,
      kind: opts.kind,
      color: opts.color,
      size: opts.size,
      fill: opts.fill,
      from: { x: Math.round(from.x), y: Math.round(from.y) },
      to: { x: Math.round(to.x), y: Math.round(to.y) },
      sides: opts.sides,
    };
    // 更新图层名以匹配新形状类型
    layer.name = SHAPE_LABELS[opts.kind] ?? layer.name;
    this.renderShapeLayer(layer);
    this.pushHistory(doc, "编辑形状");
    this.renderComposite(doc);
    this.emit();
    return layer;
  }

  /**
   * 实时调整形状几何(拖拽手柄中高频调用): 更新 from/to 并重绘，
   * 不 pushHistory。交互结束时由调用方 commitTransform 提交历史。
   */
  updateShapeGeometryLive(
    doc: DocumentEngine,
    layerId: string,
    from: { x: number; y: number },
    to: { x: number; y: number },
  ) {
    const l = this.getLayer(doc, layerId);
    if (!l || l.kind !== "shape" || !l.shapeData) return;
    l.shapeData.from = { x: from.x, y: from.y };
    l.shapeData.to = { x: to.x, y: to.y };
    this.renderShapeLayer(l);
    this.renderComposite(doc);
    this.notifyCanvas();
  }

  /** 进入形状重编辑前清空画布(避免与预览重影) */
  clearShapeLayerCanvas(doc: DocumentEngine, layerId: string) {
    const l = this.getLayer(doc, layerId);
    if (!l || l.kind !== "shape") return;
    l.ctx.clearRect(0, 0, l.canvas.width, l.canvas.height);
    this.renderComposite(doc);
    this.notifyCanvas();
  }

  /** 取消形状重编辑时还原画布 */
  restoreShapeLayerCanvas(doc: DocumentEngine, layerId: string) {
    const l = this.getLayer(doc, layerId);
    if (!l || l.kind !== "shape") return;
    this.renderShapeLayer(l);
    this.renderComposite(doc);
    this.notifyCanvas();
  }

  /** 由图片创建新文档，背景图层即原图 */
  createFromImage(name: string, img: HTMLImageElement): DocumentEngine {
    const w = img.naturalWidth || img.width;
    const h = img.naturalHeight || img.height;
    const id = nextId("doc");
    const bgCanvas = createCanvas(w, h);
    const bgCtx = getCtx(bgCanvas);
    bgCtx.drawImage(img, 0, 0);
    const bgLayer = this.makeLayer("背景", bgCanvas, false);
    const composite = createCanvas(w, h);
    const doc: DocumentEngine = {
      id,
      name,
      width: w,
      height: h,
      layers: [bgLayer],
      activeLayerId: bgLayer.id,
      adjustments: {
        brightness: 0,
        contrast: 0,
        saturation: 0,
        temperature: 0,
      },
      history: [],
      currentHistoryIndex: -1,
      composite,
      compositeCtx: getCtx(composite),
      selectionMask: null,
      selectionCtx: null,
    };
    this.docs.set(id, doc);
    this.pushHistory(doc, "打开文件");
    this.renderComposite(doc);
    this.emit();
    return doc;
  }

  /** 创建空白文档 */
  createBlank(name: string, w: number, h: number): DocumentEngine {
    const id = nextId("doc");
    const bgCanvas = createCanvas(w, h);
    const bgCtx = getCtx(bgCanvas);
    bgCtx.fillStyle = "#FFFFFF";
    bgCtx.fillRect(0, 0, w, h);
    const bgLayer = this.makeLayer("背景", bgCanvas, false);
    const composite = createCanvas(w, h);
    const doc: DocumentEngine = {
      id,
      name,
      width: w,
      height: h,
      layers: [bgLayer],
      activeLayerId: bgLayer.id,
      adjustments: {
        brightness: 0,
        contrast: 0,
        saturation: 0,
        temperature: 0,
      },
      history: [],
      currentHistoryIndex: -1,
      composite,
      compositeCtx: getCtx(composite),
      selectionMask: null,
      selectionCtx: null,
    };
    this.docs.set(id, doc);
    this.pushHistory(doc, "新建文档");
    this.renderComposite(doc);
    this.emit();
    return doc;
  }

  /* ============ 图层操作 ============ */
  getLayer(doc: DocumentEngine, id: string): EngineLayer | undefined {
    return doc.layers.find((l) => l.id === id);
  }

  addLayer(doc: DocumentEngine, name?: string): EngineLayer {
    const layer = this.makeLayer(
      name || `图层 ${doc.layers.length}`,
      createCanvas(doc.width, doc.height),
      false,
    );
    doc.layers.push(layer);
    doc.activeLayerId = layer.id;
    this.pushHistory(doc, "新建图层");
    this.renderComposite(doc);
    this.emit();
    return layer;
  }

  /**
   * 将图片作为新图层导入到当前文档。
   * - 图片像素直接绘制到图层画布(尺寸 = 文档尺寸)；位置默认居中
   * - 若图片大于文档，按比例缩放到文档内部(保留 8px 边距)
   * - pos 指定图片左上角在文档中的位置(已缩放后的位置)；省略则居中
   * 返回新建的图层。
   */
  addImageLayer(
    doc: DocumentEngine,
    img: HTMLImageElement,
    opts?: { name?: string; pos?: { x: number; y: number } },
  ): EngineLayer {
    const iw = img.naturalWidth || img.width;
    const ih = img.naturalHeight || img.height;
    if (iw <= 0 || ih <= 0) {
      // 无效图片，退化为空白图层
      return this.addLayer(doc, opts?.name);
    }
    const layer = this.makeLayer(
      opts?.name || `图片 ${doc.layers.length}`,
      createCanvas(doc.width, doc.height),
      false,
    );
    // 缩放：若图片大于文档，则按比例缩放使其能在文档内显示(留 8px 边距)
    let drawW = iw;
    let drawH = ih;
    const maxW = Math.max(1, doc.width - 16);
    const maxH = Math.max(1, doc.height - 16);
    if (drawW > maxW || drawH > maxH) {
      const k = Math.min(maxW / drawW, maxH / drawH);
      drawW = Math.max(1, Math.round(drawW * k));
      drawH = Math.max(1, Math.round(drawH * k));
    }
    // 位置：默认居中(基于缩放后尺寸)
    const x =
      opts?.pos !== undefined
        ? Math.round(opts.pos.x)
        : Math.round((doc.width - drawW) / 2);
    const y =
      opts?.pos !== undefined
        ? Math.round(opts.pos.y)
        : Math.round((doc.height - drawH) / 2);
    layer.ctx.drawImage(img, x, y, drawW, drawH);
    doc.layers.push(layer);
    doc.activeLayerId = layer.id;
    this.pushHistory(doc, "导入图片");
    this.renderComposite(doc);
    this.emit();
    return layer;
  }

  removeLayer(doc: DocumentEngine, id: string) {
    if (doc.layers.length <= 1) return; // 至少保留一层
    const idx = doc.layers.findIndex((l) => l.id === id);
    if (idx < 0) return;
    doc.layers.splice(idx, 1);
    if (doc.activeLayerId === id) {
      doc.activeLayerId = doc.layers[Math.min(idx, doc.layers.length - 1)].id;
    }
    this.pushHistory(doc, "删除图层");
    this.renderComposite(doc);
    this.emit();
  }

  duplicateLayer(doc: DocumentEngine, id: string): EngineLayer | null {
    const src = this.getLayer(doc, id);
    if (!src) return null;
    const copy = this.makeLayer(
      `${src.name} 副本`,
      cloneCanvas(src.canvas),
      false,
    );
    copy.visible = src.visible;
    copy.opacity = src.opacity;
    copy.blendMode = src.blendMode;
    copy.offsetX = src.offsetX;
    copy.offsetY = src.offsetY;
    copy.scaleX = src.scaleX;
    copy.scaleY = src.scaleY;
    copy.rotation = src.rotation;
    // 保留文字/形状图层类型与可编辑数据
    copy.kind = src.kind;
    if (src.textData) copy.textData = { ...src.textData };
    if (src.shapeData) {
      copy.shapeData = {
        ...src.shapeData,
        from: { ...src.shapeData.from },
        to: { ...src.shapeData.to },
      };
    }
    const idx = doc.layers.findIndex((l) => l.id === id);
    doc.layers.splice(idx + 1, 0, copy);
    doc.activeLayerId = copy.id;
    this.pushHistory(doc, "复制图层");
    this.renderComposite(doc);
    this.emit();
    return copy;
  }

  /**
   * 调整图层在堆栈中的位置(改变层级关系)。
   * - fromId: 待移动的图层 id
   * - targetId: 锚点图层 id(移动后的位置以此为参照)
   * - position: "before" 插入到锚点之前(更靠下层)；"after" 插入到锚点之后(更靠上层)
   * 移动后保持 activeLayerId 不变(被拖动的图层仍为活动图层)。
   */
  reorderLayer(
    doc: DocumentEngine,
    fromId: string,
    targetId: string,
    position: "before" | "after",
  ) {
    if (fromId === targetId) return;
    const fromIdx = doc.layers.findIndex((l) => l.id === fromId);
    if (fromIdx < 0) return;
    const [moved] = doc.layers.splice(fromIdx, 1);
    // 移除后重新查找锚点位置,避免索引偏移
    const targetIdx = doc.layers.findIndex((l) => l.id === targetId);
    if (targetIdx < 0) {
      // 锚点丢失(异常情况) → 还原位置
      doc.layers.splice(fromIdx, 0, moved);
      return;
    }
    const insertIdx = position === "after" ? targetIdx + 1 : targetIdx;
    doc.layers.splice(insertIdx, 0, moved);
    this.pushHistory(doc, "调整图层顺序");
    this.renderComposite(doc);
    this.emit();
  }

  setLayerVisible(doc: DocumentEngine, id: string, visible: boolean) {
    const l = this.getLayer(doc, id);
    if (l) {
      l.visible = visible;
      this.renderComposite(doc);
      this.emit();
    }
  }

  setLayerLock(doc: DocumentEngine, id: string, locked: boolean) {
    const l = this.getLayer(doc, id);
    if (l) {
      l.locked = locked;
      this.emit();
    }
  }

  setLayerOpacity(doc: DocumentEngine, id: string, opacity: number) {
    const l = this.getLayer(doc, id);
    if (l) {
      l.opacity = opacity;
      this.renderComposite(doc);
      this.emit();
    }
  }

  setLayerBlend(doc: DocumentEngine, id: string, blend: string) {
    const l = this.getLayer(doc, id);
    if (l) {
      l.blendMode = blend;
      this.renderComposite(doc);
      this.emit();
    }
  }

  /**
   * 设置图层的变换属性(offset / scale / rotation)，重绘画布并通知。
   * 注意: 此操作不 pushHistory，调用方需要在交互结束时自行提交历史。
   */
  setLayerTransform(
    doc: DocumentEngine,
    id: string,
    patch: {
      offsetX?: number;
      offsetY?: number;
      scaleX?: number;
      scaleY?: number;
      rotation?: number;
    },
  ) {
    const l = this.getLayer(doc, id);
    if (!l) return;
    if (patch.offsetX !== undefined) l.offsetX = Math.round(patch.offsetX);
    if (patch.offsetY !== undefined) l.offsetY = Math.round(patch.offsetY);
    if (patch.scaleX !== undefined) l.scaleX = patch.scaleX;
    if (patch.scaleY !== undefined) l.scaleY = patch.scaleY;
    if (patch.rotation !== undefined) l.rotation = patch.rotation;
    this.renderComposite(doc);
    this.emit();
  }

  /**
   * 实时变换(拖拽中高频调用): 只重绘合成画布 + 通知画布订阅者，
   * 不触发 store 元数据刷新。交互结束时调 commitTransform 提交历史。
   */
  setLayerTransformLive(
    doc: DocumentEngine,
    id: string,
    patch: {
      offsetX?: number;
      offsetY?: number;
      scaleX?: number;
      scaleY?: number;
      rotation?: number;
    },
  ) {
    const l = this.getLayer(doc, id);
    if (!l) return;
    if (patch.offsetX !== undefined) l.offsetX = Math.round(patch.offsetX);
    if (patch.offsetY !== undefined) l.offsetY = Math.round(patch.offsetY);
    if (patch.scaleX !== undefined) l.scaleX = patch.scaleX;
    if (patch.scaleY !== undefined) l.scaleY = patch.scaleY;
    if (patch.rotation !== undefined) l.rotation = patch.rotation;
    this.renderComposite(doc);
    this.notifyCanvas();
  }

  /** 提交一次变换到历史(变换交互结束时调用) */
  commitTransform(doc: DocumentEngine, label = "变换图层") {
    this.pushHistory(doc, label);
    this.emit();
  }

  setActiveLayer(doc: DocumentEngine, id: string) {
    if (doc.layers.some((l) => l.id === id)) {
      doc.activeLayerId = id;
      this.emit();
    }
  }

  /** 移动图层到指定偏移(拖动中高频调用，只重绘画布) */
  moveLayerTo(doc: DocumentEngine, id: string, x: number, y: number) {
    const l = this.getLayer(doc, id);
    if (!l || l.locked) return;
    l.offsetX = Math.round(x);
    l.offsetY = Math.round(y);
    this.renderComposite(doc);
    this.notifyCanvas();
  }

  /** 移动结束，提交历史 */
  commitMove(doc: DocumentEngine) {
    this.pushHistory(doc, "移动图层");
    this.emit();
  }

  /* ============ 调整 ============ */
  setAdjustments(doc: DocumentEngine, a: Partial<Adjustments>) {
    doc.adjustments = { ...doc.adjustments, ...a };
    this.renderComposite(doc);
    this.emit();
  }

  /* ============ 合成 ============ */
  /** 将所有可见图层按 blend/opacity/offset/rotation/scale 合成到 composite 画布 */
  renderComposite(doc: DocumentEngine) {
    const ctx = doc.compositeCtx;
    ctx.clearRect(0, 0, doc.width, doc.height);
    for (const l of doc.layers) {
      if (!l.visible || l.opacity <= 0) continue;
      ctx.save();
      ctx.globalAlpha = l.opacity / 100;
      ctx.globalCompositeOperation = BLEND_MAP[l.blendMode] || "source-over";
      // 应用图层变换: 以图层内容中心为锚点进行旋转/缩放
      const center = this.getLayerCenter(l);
      ctx.translate(l.offsetX, l.offsetY);
      ctx.translate(center.x, center.y);
      if (l.rotation) ctx.rotate((l.rotation * Math.PI) / 180);
      if (l.scaleX !== 1 || l.scaleY !== 1) ctx.scale(l.scaleX, l.scaleY);
      ctx.translate(-center.x, -center.y);
      ctx.drawImage(l.canvas, 0, 0);
      // 进行中的画笔缓冲实时预览(仅画笔；橡皮已直接作用于图层)
      const st = this.activeStroke;
      if (st && !st.eraser && !st.blocked && st.layerId === l.id && st.buffer) {
        ctx.globalCompositeOperation = "source-over";
        ctx.globalAlpha = (l.opacity / 100) * (st.opts.opacity / 100);
        ctx.drawImage(st.buffer, 0, 0);
      }
      // 进行中的仿制图章缓冲实时预览
      const cs = this.cloneStroke;
      if (cs && !cs.blocked && cs.layerId === l.id) {
        ctx.globalCompositeOperation = "source-over";
        ctx.globalAlpha = (l.opacity / 100) * (cs.opts.opacity / 100);
        ctx.drawImage(cs.buffer, 0, 0);
      }
      ctx.restore();
    }
  }

  /* ============ 历史 ============ */
  /** 推入一条历史快照。在操作完成后调用。 */
  pushHistory(doc: DocumentEngine, label: string) {
    // 丢弃 redo 尾巴
    if (doc.currentHistoryIndex < doc.history.length - 1) {
      doc.history = doc.history.slice(0, doc.currentHistoryIndex + 1);
    }
    const snapshots: Record<string, ImageData> = {};
    const layerStates = doc.layers.map((l) => ({
      id: l.id,
      name: l.name,
      visible: l.visible,
      locked: l.locked,
      opacity: l.opacity,
      blendMode: l.blendMode,
      offsetX: l.offsetX,
      offsetY: l.offsetY,
      scaleX: l.scaleX,
      scaleY: l.scaleY,
      rotation: l.rotation,
      kind: l.kind,
      textData: l.textData ? { ...l.textData } : undefined,
      shapeData: l.shapeData
        ? {
            ...l.shapeData,
            from: { ...l.shapeData.from },
            to: { ...l.shapeData.to },
          }
        : undefined,
    }));
    for (const l of doc.layers) {
      snapshots[l.id] = l.ctx.getImageData(0, 0, doc.width, doc.height);
    }
    // 保存选区快照（若存在）
    let selection: ImageData | null = null;
    if (doc.selectionMask && doc.selectionCtx) {
      selection = doc.selectionCtx.getImageData(0, 0, doc.width, doc.height);
    }
    doc.history.push({
      id: nextId("hist"),
      label,
      snapshots,
      layerStates,
      activeLayerId: doc.activeLayerId,
      selection,
    });
    // 限制历史长度，避免内存爆炸
    const MAX = 40;
    if (doc.history.length > MAX) {
      doc.history = doc.history.slice(doc.history.length - MAX);
    }
    doc.currentHistoryIndex = doc.history.length - 1;
  }

  /** 跳转到指定历史索引，恢复像素 */
  restoreHistory(doc: DocumentEngine, index: number) {
    if (index < 0 || index >= doc.history.length) return;
    const step = doc.history[index];
    // 重建图层列表(以历史快照中的 layerStates 为准)
    const newLayers: EngineLayer[] = [];
    for (const ls of step.layerStates) {
      const existing = doc.layers.find((l) => l.id === ls.id);
      const canvas = existing
        ? existing.canvas
        : createCanvas(doc.width, doc.height);
      const ctx = getCtx(canvas);
      const img = step.snapshots[ls.id];
      if (img) ctx.putImageData(img, 0, 0);
      newLayers.push({
        id: ls.id,
        name: ls.name,
        canvas,
        ctx,
        visible: ls.visible,
        locked: ls.locked,
        opacity: ls.opacity,
        blendMode: ls.blendMode,
        offsetX: ls.offsetX,
        offsetY: ls.offsetY,
        scaleX: ls.scaleX,
        scaleY: ls.scaleY,
        rotation: ls.rotation,
        kind: ls.kind,
        textData: ls.textData ? { ...ls.textData } : undefined,
        shapeData: ls.shapeData
          ? {
              ...ls.shapeData,
              from: { ...ls.shapeData.from },
              to: { ...ls.shapeData.to },
            }
          : undefined,
      });
    }
    doc.layers = newLayers;
    doc.activeLayerId = step.activeLayerId;
    // 恢复选区
    if (step.selection) {
      if (!doc.selectionMask) {
        doc.selectionMask = createCanvas(doc.width, doc.height);
        doc.selectionCtx = getCtx(doc.selectionMask);
      }
      doc.selectionCtx!.putImageData(step.selection, 0, 0);
    } else {
      doc.selectionMask = null;
      doc.selectionCtx = null;
    }
    doc.currentHistoryIndex = index;
    this.renderComposite(doc);
    this.emit();
  }

  undo(doc: DocumentEngine) {
    if (doc.currentHistoryIndex > 0) {
      this.restoreHistory(doc, doc.currentHistoryIndex - 1);
    }
  }

  redo(doc: DocumentEngine) {
    if (doc.currentHistoryIndex < doc.history.length - 1) {
      this.restoreHistory(doc, doc.currentHistoryIndex + 1);
    }
  }

  /* ============ 画笔 / 橡皮 ============ */

  /** 在缓冲或图层上盖一个笔尖 */
  private dab(
    target: CanvasRenderingContext2D,
    x: number,
    y: number,
    opts: StrokeOpts,
  ) {
    const tip = getBrushTip(
      opts.eraser ? "#000000" : opts.color,
      opts.size,
      opts.hardness,
    );
    target.save();
    if (opts.eraser) {
      target.globalCompositeOperation = "destination-out";
      target.globalAlpha = (opts.flow / 100) * (opts.opacity / 100);
    } else {
      target.globalAlpha = opts.flow / 100;
    }
    target.drawImage(tip, x - tip.width / 2, y - tip.height / 2);
    target.restore();
  }

  /** 开始一笔(pt 为文档坐标) */
  beginStroke(
    doc: DocumentEngine,
    pt: { x: number; y: number },
    opts: StrokeOpts,
  ) {
    const layer = this.getLayer(doc, doc.activeLayerId);
    if (!layer || layer.locked) {
      this.activeStroke = null;
      return;
    }
    const local = { x: pt.x - layer.offsetX, y: pt.y - layer.offsetY };
    if (opts.eraser) {
      this.activeStroke = {
        docId: doc.id,
        layerId: layer.id,
        eraser: true,
        buffer: null,
        bufferCtx: null,
        last: local,
        opts,
        blocked: false,
      };
      this.dab(layer.ctx, local.x, local.y, opts);
    } else {
      const buffer = createCanvas(doc.width, doc.height);
      const bufferCtx = getCtx(buffer);
      this.activeStroke = {
        docId: doc.id,
        layerId: layer.id,
        eraser: false,
        buffer,
        bufferCtx,
        last: local,
        opts,
        blocked: false,
      };
      this.dab(bufferCtx, local.x, local.y, opts);
    }
    this.renderComposite(doc);
    this.notifyCanvas();
  }

  /** 一笔进行中(pt 为文档坐标)，按间距补点 */
  strokeTo(doc: DocumentEngine, pt: { x: number; y: number }) {
    const st = this.activeStroke;
    if (!st || st.blocked || st.docId !== doc.id) return;
    const layer = this.getLayer(doc, st.layerId);
    if (!layer) return;
    const x = pt.x - layer.offsetX;
    const y = pt.y - layer.offsetY;
    const dx = x - st.last.x;
    const dy = y - st.last.y;
    const dist = Math.hypot(dx, dy);
    const spacing = Math.max(1, st.opts.size * 0.08);
    if (dist < spacing) return;
    const target = st.eraser ? layer.ctx : st.bufferCtx!;
    const steps = Math.floor(dist / spacing);
    for (let i = 1; i <= steps; i++) {
      this.dab(
        target,
        st.last.x + (dx * spacing * i) / dist,
        st.last.y + (dy * spacing * i) / dist,
        st.opts,
      );
    }
    st.last = {
      x: st.last.x + (dx * spacing * steps) / dist,
      y: st.last.y + (dy * spacing * steps) / dist,
    };
    this.renderComposite(doc);
    this.notifyCanvas();
  }

  /** 结束一笔: 缓冲落盘到图层 + 提交历史 */
  endStroke(doc: DocumentEngine, label: string) {
    const st = this.activeStroke;
    this.activeStroke = null;
    if (!st || st.blocked || st.docId !== doc.id) return;
    const layer = this.getLayer(doc, st.layerId);
    if (!layer) return;
    if (!st.eraser && st.buffer) {
      layer.ctx.save();
      layer.ctx.globalAlpha = st.opts.opacity / 100;
      layer.ctx.drawImage(st.buffer, 0, 0);
      layer.ctx.restore();
    }
    this.pushHistory(doc, label);
    this.renderComposite(doc);
    this.emit();
  }

  /** 是否有进行中的笔画(用于判断按下是否有效) */
  hasActiveStroke(): boolean {
    return !!this.activeStroke && !this.activeStroke.blocked;
  }

  /* ============ 仿制图章 ============ */

  /** 重置 aligned 累计偏移(设置新源点时调用) */
  resetCloneOffset() {
    this.cloneAlignedOffset = { x: 0, y: 0 };
  }

  /** 取仿制图章的源画布。sampleAll=true 用合成画布，否则用当前图层 */
  private getCloneSourceCanvas(
    doc: DocumentEngine,
    sampleAll: boolean,
  ): HTMLCanvasElement | null {
    if (sampleAll) return doc.composite;
    const layer = this.getLayer(doc, doc.activeLayerId);
    return layer ? layer.canvas : null;
  }

  /** 单个仿制图章笔尖：从源画布取样 + 应用硬度 mask + 画到 buffer */
  private cloneDab(target: CanvasRenderingContext2D, lx: number, ly: number) {
    const st = this.cloneStroke;
    if (!st) return;
    const size = Math.max(1, Math.round(st.opts.size));
    const half = size / 2;
    // aligned: 源点随笔触同步偏移；非 aligned: 每个笔尖都从原 srcX/srcY 取样
    const sx = st.aligned ? st.srcX + (lx - st.startLocal.x) : st.srcX;
    const sy = st.aligned ? st.srcY + (ly - st.startLocal.y) : st.srcY;
    // 临时画布: 先取样源像素，再用笔尖 alpha mask 裁切
    const tip = createCanvas(size, size);
    const tctx = getCtx(tip);
    // drawImage 超出源画布范围会画透明，正合心意
    tctx.drawImage(
      st.sourceCanvas,
      sx - half,
      sy - half,
      size,
      size,
      0,
      0,
      size,
      size,
    );
    // 用缓存的笔尖 alpha 作 mask
    const mask = getBrushTip("#FFFFFF", size, st.opts.hardness);
    tctx.globalCompositeOperation = "destination-in";
    tctx.drawImage(mask, 0, 0);
    tctx.globalCompositeOperation = "source-over";
    // 画到 buffer(流量×不透明度)
    target.save();
    target.globalAlpha = (st.opts.flow / 100) * (st.opts.opacity / 100);
    target.drawImage(tip, lx - half, ly - half);
    target.restore();
  }

  /** 开始一笔仿制图章(pt 为文档坐标, src 为文档坐标源点) */
  beginCloneStroke(
    doc: DocumentEngine,
    pt: { x: number; y: number },
    src: { x: number; y: number },
    opts: StrokeOpts,
    aligned: boolean,
    sampleAll: boolean,
  ) {
    const layer = this.getLayer(doc, doc.activeLayerId);
    if (!layer || layer.locked) {
      this.cloneStroke = null;
      return;
    }
    const sourceCanvas = this.getCloneSourceCanvas(doc, sampleAll);
    if (!sourceCanvas) {
      this.cloneStroke = null;
      return;
    }
    const startLocal = { x: pt.x - layer.offsetX, y: pt.y - layer.offsetY };
    // 把文档坐标源点换算到源画布坐标系(图层源 = 文档坐标 - 图层偏移)
    let srcX: number;
    let srcY: number;
    if (sampleAll) {
      srcX = src.x + this.cloneAlignedOffset.x;
      srcY = src.y + this.cloneAlignedOffset.y;
    } else {
      srcX = src.x - layer.offsetX + this.cloneAlignedOffset.x;
      srcY = src.y - layer.offsetY + this.cloneAlignedOffset.y;
    }
    const buffer = createCanvas(doc.width, doc.height);
    const bufferCtx = getCtx(buffer);
    this.cloneStroke = {
      docId: doc.id,
      layerId: layer.id,
      sourceCanvas,
      srcX,
      srcY,
      startLocal,
      buffer,
      bufferCtx,
      last: startLocal,
      opts,
      aligned,
      blocked: false,
    };
    this.cloneDab(bufferCtx, startLocal.x, startLocal.y);
    this.renderComposite(doc);
    this.notifyCanvas();
  }

  /** 仿制图章笔触进行中(pt 为文档坐标) */
  cloneStrokeTo(doc: DocumentEngine, pt: { x: number; y: number }) {
    const st = this.cloneStroke;
    if (!st || st.blocked || st.docId !== doc.id) return;
    const layer = this.getLayer(doc, st.layerId);
    if (!layer) return;
    const x = pt.x - layer.offsetX;
    const y = pt.y - layer.offsetY;
    const dx = x - st.last.x;
    const dy = y - st.last.y;
    const dist = Math.hypot(dx, dy);
    const spacing = Math.max(1, st.opts.size * 0.08);
    if (dist < spacing) return;
    const steps = Math.floor(dist / spacing);
    for (let i = 1; i <= steps; i++) {
      this.cloneDab(
        st.bufferCtx,
        st.last.x + (dx * spacing * i) / dist,
        st.last.y + (dy * spacing * i) / dist,
      );
    }
    st.last = {
      x: st.last.x + (dx * spacing * steps) / dist,
      y: st.last.y + (dy * spacing * steps) / dist,
    };
    this.renderComposite(doc);
    this.notifyCanvas();
  }

  /** 结束仿制图章笔触: 缓冲落盘 + aligned 累计偏移 + 提交历史 */
  endCloneStroke(doc: DocumentEngine, label: string) {
    const st = this.cloneStroke;
    this.cloneStroke = null;
    if (!st || st.blocked || st.docId !== doc.id) return;
    const layer = this.getLayer(doc, st.layerId);
    if (!layer) return;
    layer.ctx.save();
    layer.ctx.globalAlpha = st.opts.opacity / 100;
    layer.ctx.drawImage(st.buffer, 0, 0);
    layer.ctx.restore();
    // aligned 模式累计偏移，下一笔从本次结束位置继续取样
    if (st.aligned) {
      this.cloneAlignedOffset.x += st.last.x - st.startLocal.x;
      this.cloneAlignedOffset.y += st.last.y - st.startLocal.y;
    }
    this.pushHistory(doc, label);
    this.renderComposite(doc);
    this.emit();
  }

  /** 是否有进行中的仿制图章笔触 */
  hasActiveCloneStroke(): boolean {
    return !!this.cloneStroke && !this.cloneStroke.blocked;
  }

  /* ============ 形状 ============ */
  /* 形状图层操作见 addShapeLayer / updateShapeLayer / hitTestShapeLayer */

  /* ============ 文字 ============ */
  /* 文字图层操作见 addTextLayer / updateTextLayer / hitTestTextLayer */

  /** 从合成画布采样颜色 → 返回 #RRGGBB */
  pickColor(doc: DocumentEngine, x: number, y: number): string | null {
    if (x < 0 || y < 0 || x >= doc.width || y >= doc.height) return null;
    const data = doc.compositeCtx.getImageData(
      Math.floor(x),
      Math.floor(y),
      1,
      1,
    ).data;
    const hex =
      "#" +
      [data[0], data[1], data[2]]
        .map((v) => v.toString(16).padStart(2, "0"))
        .join("")
        .toUpperCase();
    return hex;
  }

  /* ============ 选区 ============
   * 蒙版存储：selectionMask 是与文档同尺寸的离屏画布，
   * 像素 alpha 通道：255=已选 / 0=未选；RGB 通道不使用。
   * 所有「选区操作」先在一个临时画布上绘制新区域，
   * 再按 op 用 globalCompositeOperation 合并进 selectionMask。
   */

  /** 当前是否有选区（蒙版非空且至少一个像素 alpha>0） */
  hasSelection(doc: DocumentEngine): boolean {
    if (!doc.selectionMask || !doc.selectionCtx) return false;
    // 取一次最低 mipmap 风格判定：扫描 alpha 通道
    const data = doc.selectionCtx.getImageData(
      0,
      0,
      doc.width,
      doc.height,
    ).data;
    for (let i = 3; i < data.length; i += 4) {
      if (data[i] > 0) return true;
    }
    return false;
  }

  /** 获取选区蒙版画布（可能为 null） */
  getSelectionMask(doc: DocumentEngine): HTMLCanvasElement | null {
    return doc.selectionMask;
  }

  /** 内部：确保 selectionMask 已分配 */
  private ensureSelectionCanvas(doc: DocumentEngine) {
    if (!doc.selectionMask) {
      doc.selectionMask = createCanvas(doc.width, doc.height);
      doc.selectionCtx = getCtx(doc.selectionMask);
    }
  }

  /**
   * 应用一块新选区到当前选区蒙版。
   * - patch 是一个临时画布，其 alpha 通道代表「新增的选区形状」
   * - 按 op 决定如何合并：new=替换 / add=并 / subtract=差 / intersect=交
   */
  private applyPatch(
    doc: DocumentEngine,
    patch: HTMLCanvasElement,
    op: SelectionOp,
  ) {
    this.ensureSelectionCanvas(doc);
    const ctx = doc.selectionCtx!;
    ctx.save();
    switch (op) {
      case "new":
        ctx.clearRect(0, 0, doc.width, doc.height);
        ctx.drawImage(patch, 0, 0);
        break;
      case "add":
        ctx.globalCompositeOperation = "source-over";
        ctx.drawImage(patch, 0, 0);
        break;
      case "subtract":
        // destination-out：用 patch 的 alpha 擦除已有选区
        ctx.globalCompositeOperation = "destination-out";
        ctx.drawImage(patch, 0, 0);
        break;
      case "intersect":
        // source-in：仅保留 patch 与已有选区的交集
        ctx.globalCompositeOperation = "source-in";
        ctx.drawImage(patch, 0, 0);
        break;
    }
    ctx.restore();
    // 若合并后蒙版全空，回收为 null（hasSelection 会快速返回 false）
    if (!this.hasSelection(doc)) {
      doc.selectionMask = null;
      doc.selectionCtx = null;
    }
  }

  /** 清除选区 */
  clearSelection(doc: DocumentEngine) {
    doc.selectionMask = null;
    doc.selectionCtx = null;
    this.notifyCanvas();
    this.emit();
  }

  /** 全选 */
  selectAll(doc: DocumentEngine) {
    const patch = createCanvas(doc.width, doc.height);
    const pctx = getCtx(patch);
    pctx.fillStyle = "rgba(0,0,0,1)";
    pctx.fillRect(0, 0, doc.width, doc.height);
    this.applyPatch(doc, patch, "new");
    this.notifyCanvas();
    this.emit();
  }

  /** 反选：将蒙版 alpha 取反 */
  invertSelection(doc: DocumentEngine) {
    this.ensureSelectionCanvas(doc);
    const ctx = doc.selectionCtx!;
    const img = ctx.getImageData(0, 0, doc.width, doc.height);
    const d = img.data;
    for (let i = 0; i < d.length; i += 4) {
      d[i] = 0;
      d[i + 1] = 0;
      d[i + 2] = 0;
      d[i + 3] = 255 - d[i + 3];
    }
    ctx.putImageData(img, 0, 0);
    if (!this.hasSelection(doc)) {
      doc.selectionMask = null;
      doc.selectionCtx = null;
    }
    this.notifyCanvas();
    this.emit();
  }

  /**
   * 用多边形顶点设置选区（顶点为文档像素坐标）。
   * 自动闭合首尾。
   */
  selectPolygon(
    doc: DocumentEngine,
    points: Array<{ x: number; y: number }>,
    op: SelectionOp,
  ) {
    if (points.length < 2) return;
    const patch = createCanvas(doc.width, doc.height);
    const pctx = getCtx(patch);
    pctx.fillStyle = "rgba(0,0,0,1)";
    pctx.beginPath();
    pctx.moveTo(points[0].x, points[0].y);
    for (let i = 1; i < points.length; i++) {
      pctx.lineTo(points[i].x, points[i].y);
    }
    pctx.closePath();
    pctx.fill();
    this.applyPatch(doc, patch, op);
    this.notifyCanvas();
    this.emit();
  }

  /** 用矩形设置选区（文档像素坐标） */
  selectRect(
    doc: DocumentEngine,
    rect: { x: number; y: number; w: number; h: number },
    op: SelectionOp,
  ) {
    const patch = createCanvas(doc.width, doc.height);
    const pctx = getCtx(patch);
    pctx.fillStyle = "rgba(0,0,0,1)";
    pctx.fillRect(rect.x, rect.y, rect.w, rect.h);
    this.applyPatch(doc, patch, op);
    this.notifyCanvas();
    this.emit();
  }

  /**
   * 在选区蒙版上画一个软笔刷笔触（用于「快速选择」逐笔添加）。
   * 直接在 selectionCtx 上 source-over 绘制。
   * 仅支持 add（快速选择典型用法）。
   */
  paintSelectionBrush(
    doc: DocumentEngine,
    from: { x: number; y: number },
    to: { x: number; y: number },
    size: number,
    op: SelectionOp = "add",
  ) {
    this.ensureSelectionCanvas(doc);
    const ctx = doc.selectionCtx!;
    ctx.save();
    if (op === "subtract") {
      ctx.globalCompositeOperation = "destination-out";
    } else {
      ctx.globalCompositeOperation = "source-over";
    }
    ctx.strokeStyle = "rgba(0,0,0,1)";
    ctx.fillStyle = "rgba(0,0,0,1)";
    ctx.lineWidth = size;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.beginPath();
    ctx.moveTo(from.x, from.y);
    ctx.lineTo(to.x, to.y);
    ctx.stroke();
    // 起点圆点（确保单击也能产生选区）
    ctx.beginPath();
    ctx.arc(to.x, to.y, size / 2, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
    this.notifyCanvas();
  }

  /**
   * 魔棒：基于颜色容差在取样源上做洪水填充选区。
   * - 起点 (x,y) 的颜色为基准色
   * - tolerance 0-255：rgb 距离总和 ≤ tolerance*3 视为同色
   * - contiguous=true：仅 4 邻接 flood fill；false：全图同色像素全选
   * - source=all：从合成画布取样；否则从当前图层取样
   */
  magicWand(
    doc: DocumentEngine,
    start: { x: number; y: number },
    opts: {
      tolerance: number;
      contiguous: boolean;
      source: SampleSource;
    },
    op: SelectionOp,
  ) {
    const sx = Math.floor(start.x);
    const sy = Math.floor(start.y);
    if (sx < 0 || sy < 0 || sx >= doc.width || sy >= doc.height) return;
    // 取样源 ImageData
    let srcData: ImageData;
    if (opts.source === "all") {
      srcData = doc.compositeCtx.getImageData(0, 0, doc.width, doc.height);
    } else {
      const layer = this.getLayer(doc, doc.activeLayerId);
      if (!layer) return;
      srcData = layer.ctx.getImageData(0, 0, doc.width, doc.height);
    }
    const sd = srcData.data;
    const w = doc.width;
    const h = doc.height;
    const baseIdx = (sy * w + sx) * 4;
    const br = sd[baseIdx];
    const bg = sd[baseIdx + 1];
    const bb = sd[baseIdx + 2];
    const tol3 = opts.tolerance * 3;
    // 结果掩码（true=选中）
    const mask = new Uint8Array(w * h);
    const match = (idx: number) => {
      const dr = sd[idx] - br;
      const dg = sd[idx + 1] - bg;
      const db = sd[idx + 2] - bb;
      return Math.abs(dr) + Math.abs(dg) + Math.abs(db) <= tol3;
    };
    if (opts.contiguous) {
      // 4 邻接 BFS
      const stack = [sy * w + sx];
      mask[sy * w + sx] = 1;
      while (stack.length) {
        const p = stack.pop()!;
        const px = p % w;
        // 上
        if (p >= w) {
          const u = p - w;
          if (!mask[u] && match(u * 4)) {
            mask[u] = 1;
            stack.push(u);
          }
        }
        // 下
        if (p + w < w * h) {
          const d = p + w;
          if (!mask[d] && match(d * 4)) {
            mask[d] = 1;
            stack.push(d);
          }
        }
        // 左
        if (px > 0) {
          const l = p - 1;
          if (!mask[l] && match(l * 4)) {
            mask[l] = 1;
            stack.push(l);
          }
        }
        // 右
        if (px < w - 1) {
          const r = p + 1;
          if (!mask[r] && match(r * 4)) {
            mask[r] = 1;
            stack.push(r);
          }
        }
      }
    } else {
      // 全图同色
      for (let i = 0; i < w * h; i++) {
        if (match(i * 4)) mask[i] = 1;
      }
    }
    // 转 patch 画布
    const patch = createCanvas(w, h);
    const pctx = getCtx(patch);
    const img = pctx.createImageData(w, h);
    const id = img.data;
    for (let i = 0; i < mask.length; i++) {
      if (mask[i]) {
        const j = i * 4;
        id[j] = 0;
        id[j + 1] = 0;
        id[j + 2] = 0;
        id[j + 3] = 255;
      }
    }
    pctx.putImageData(img, 0, 0);
    this.applyPatch(doc, patch, op);
    this.notifyCanvas();
    this.emit();
  }

  /* ============ 油漆桶(颜色填充) ============ */

  /**
   * 油漆桶: 以起点像素颜色为基准，将容差范围内的像素替换为目标颜色
   * 支持连续(4邻接 BFS)与全图同色两种模式
   */
  paintBucket(
    doc: DocumentEngine,
    start: { x: number; y: number },
    opts: PaintBucketOpts,
  ) {
    const sx = Math.floor(start.x);
    const sy = Math.floor(start.y);
    if (sx < 0 || sy < 0 || sx >= doc.width || sy >= doc.height) return;
    const layer = this.getLayer(doc, doc.activeLayerId);
    if (!layer || layer.locked) return;

    // 取样源 ImageData
    let srcData: ImageData;
    if (opts.source === "all") {
      srcData = doc.compositeCtx.getImageData(0, 0, doc.width, doc.height);
    } else {
      srcData = layer.ctx.getImageData(0, 0, doc.width, doc.height);
    }
    const sd = srcData.data;
    const w = doc.width;
    const h = doc.height;
    const baseIdx = (sy * w + sx) * 4;
    const br = sd[baseIdx];
    const bg = sd[baseIdx + 1];
    const bb = sd[baseIdx + 2];
    const ba = sd[baseIdx + 3];
    const tol3 = opts.tolerance * 3;
    const alphaTol = opts.tolerance;

    // 目标颜色
    const { r: tr, g: tg, b: tb } = hexToRgb(opts.color);
    const topa = Math.round(255 * (opts.opacity / 100));

    // 结果掩码（true=需要填充）
    const mask = new Uint8Array(w * h);
    const match = (idx: number) => {
      const dr = sd[idx] - br;
      const dg = sd[idx + 1] - bg;
      const db = sd[idx + 2] - bb;
      const da = sd[idx + 3] - ba;
      const colorMatch = Math.abs(dr) + Math.abs(dg) + Math.abs(db) <= tol3;
      const alphaMatch = Math.abs(da) <= alphaTol;
      return colorMatch && alphaMatch;
    };

    if (opts.contiguous) {
      // 4 邻接 BFS
      const stack = [sy * w + sx];
      mask[sy * w + sx] = 1;
      while (stack.length) {
        const p = stack.pop()!;
        const px = p % w;
        // 上
        if (p >= w) {
          const u = p - w;
          if (!mask[u] && match(u * 4)) {
            mask[u] = 1;
            stack.push(u);
          }
        }
        // 下
        if (p + w < w * h) {
          const d = p + w;
          if (!mask[d] && match(d * 4)) {
            mask[d] = 1;
            stack.push(d);
          }
        }
        // 左
        if (px > 0) {
          const l = p - 1;
          if (!mask[l] && match(l * 4)) {
            mask[l] = 1;
            stack.push(l);
          }
        }
        // 右
        if (px < w - 1) {
          const r = p + 1;
          if (!mask[r] && match(r * 4)) {
            mask[r] = 1;
            stack.push(r);
          }
        }
      }
    } else {
      // 全图同色
      for (let i = 0; i < w * h; i++) {
        if (match(i * 4)) mask[i] = 1;
      }
    }

    // 获取当前图层的 ImageData，直接在上面修改像素
    const layerImg = layer.ctx.getImageData(0, 0, w, h);
    const ld = layerImg.data;
    let changed = false;
    for (let i = 0; i < mask.length; i++) {
      if (mask[i]) {
        const j = i * 4;
        // 颜色叠加：如果目标不透明则覆盖，否则按 alpha 混合
        const dstA = ld[j + 3];
        const srcA = topa;
        if (srcA >= 255) {
          ld[j] = tr;
          ld[j + 1] = tg;
          ld[j + 2] = tb;
          ld[j + 3] = 255;
        } else {
          // alpha 混合
          const outA = srcA + (dstA * (255 - srcA)) / 255;
          if (outA > 0) {
            ld[j] = Math.round(
              (tr * srcA + (ld[j] * dstA * (255 - srcA)) / 255) / outA,
            );
            ld[j + 1] = Math.round(
              (tg * srcA + (ld[j + 1] * dstA * (255 - srcA)) / 255) / outA,
            );
            ld[j + 2] = Math.round(
              (tb * srcA + (ld[j + 2] * dstA * (255 - srcA)) / 255) / outA,
            );
            ld[j + 3] = Math.round(outA);
          }
        }
        changed = true;
      }
    }

    if (!changed) return; // 无变化，不 push 历史

    layer.ctx.putImageData(layerImg, 0, 0);
    this.pushHistory(doc, "油漆桶填充");
    this.renderComposite(doc);
    this.emit();
  }

  /**
   * 提交一次选区编辑到历史（用于选区工具松开鼠标后调用）。
   * 选区本身不是像素操作，但为支持撤销/重做，仍记录一条历史。
   */
  commitSelection(doc: DocumentEngine, label: string) {
    this.pushHistory(doc, label);
    this.emit();
  }

  /** 取样源 ImageData（active 或 all） */
  sampleSourceImageData(doc: DocumentEngine, source: SampleSource): ImageData {
    if (source === "all") {
      return doc.compositeCtx.getImageData(0, 0, doc.width, doc.height);
    }
    const layer = this.getLayer(doc, doc.activeLayerId);
    if (!layer)
      return doc.compositeCtx.getImageData(0, 0, doc.width, doc.height);
    return layer.ctx.getImageData(0, 0, doc.width, doc.height);
  }

  /**
   * 磁性套索：基于起点与一条用户拖动轨迹，沿路径采样边缘点，
   * 返回一个多边形顶点列表用于 selectPolygon。
   * 简化实现：对轨迹上每隔 frequency 像素取一个采样点，
   * 在该点附近 ±width 范围内寻找局部对比度最大位置作为顶点。
   */
  buildMagneticPath(
    doc: DocumentEngine,
    path: Array<{ x: number; y: number }>,
    opts: { width: number; contrast: number; frequency: number },
    source: SampleSource,
  ): Array<{ x: number; y: number }> {
    if (path.length === 0) return [];
    const sd = this.sampleSourceImageData(doc, source).data;
    const w = doc.width;
    const h = doc.height;
    const sample = (x: number, y: number) => {
      const xi = Math.max(0, Math.min(w - 1, Math.floor(x)));
      const yi = Math.max(0, Math.min(h - 1, Math.floor(y)));
      const idx = (yi * w + xi) * 4;
      // 灰度
      return (sd[idx] + sd[idx + 1] + sd[idx + 2]) / 3;
    };
    const half = Math.max(1, Math.floor(opts.width));
    const step = Math.max(1, Math.floor(opts.frequency));
    const threshold = (opts.contrast / 100) * 255;
    const result: Array<{ x: number; y: number }> = [];
    let acc = 0;
    let lastPt = path[0];
    result.push({ x: path[0].x, y: path[0].y });
    for (let i = 1; i < path.length; i++) {
      const dx = path[i].x - lastPt.x;
      const dy = path[i].y - lastPt.y;
      const d = Math.hypot(dx, dy);
      if (d < step) continue;
      // 在路径方向上前进 step 像素，沿垂直方向找最强对比点
      const ux = dx / d;
      const uy = dy / d;
      const vx = -uy;
      const vy = ux;
      const cx = lastPt.x + ux * step;
      const cy = lastPt.y + uy * step;
      let bestX = cx;
      let bestY = cy;
      let bestScore = -1;
      for (let off = -half; off <= half; off++) {
        const px = cx + vx * off;
        const py = cy + vy * off;
        const g0 = sample(px - vx, py - vy);
        const g1 = sample(px + vx, py + vy);
        const score = Math.abs(g0 - g1);
        if (score > bestScore && score >= threshold) {
          bestScore = score;
          bestX = px;
          bestY = py;
        }
      }
      result.push({ x: bestX, y: bestY });
      lastPt = { x: bestX, y: bestY };
      acc += step;
    }
    // 闭合回起点
    if (result.length > 1) {
      result.push({ x: path[0].x, y: path[0].y });
    }
    return result;
  }

  /** 按选区裁剪所有图层(选区以画布像素坐标给出) */
  crop(
    doc: DocumentEngine,
    rect: { x: number; y: number; w: number; h: number },
  ) {
    const x = Math.max(0, Math.floor(rect.x));
    const y = Math.max(0, Math.floor(rect.y));
    const w = Math.min(doc.width - x, Math.floor(rect.w));
    const h = Math.min(doc.height - y, Math.floor(rect.h));
    if (w <= 0 || h <= 0) return;
    for (const l of doc.layers) {
      const nc = createCanvas(w, h);
      const nctx = getCtx(nc);
      // 源坐标需要换算到图层本地坐标(画布坐标 - 图层偏移)
      const sx = x - l.offsetX;
      const sy = y - l.offsetY;
      nctx.drawImage(l.canvas, sx, sy, w, h, 0, 0, w, h);
      l.canvas = nc;
      l.ctx = nctx;
      // 裁剪后新图层本地坐标已对齐新画布(0,0)，重置偏移
      l.offsetX = 0;
      l.offsetY = 0;
    }
    doc.width = w;
    doc.height = h;
    doc.composite = createCanvas(w, h);
    doc.compositeCtx = getCtx(doc.composite);
    this.pushHistory(doc, "裁剪");
    this.renderComposite(doc);
    this.emit();
  }

  /** 导出为 PNG data URL */
  exportPng(doc: DocumentEngine): string {
    const out = createCanvas(doc.width, doc.height);
    const octx = getCtx(out);
    octx.filter = buildFilterString(doc.adjustments);
    octx.drawImage(doc.composite, 0, 0);
    return out.toDataURL("image/png");
  }

  /** 导出为 JPEG data URL */
  exportJpeg(doc: DocumentEngine, quality = 0.92): string {
    const out = createCanvas(doc.width, doc.height);
    const octx = getCtx(out);
    // JPEG 不支持透明，先填充白色背景
    octx.fillStyle = "#FFFFFF";
    octx.fillRect(0, 0, doc.width, doc.height);
    octx.filter = buildFilterString(doc.adjustments);
    octx.drawImage(doc.composite, 0, 0);
    return out.toDataURL("image/jpeg", quality);
  }

  /** 导出为 WebP data URL */
  exportWebp(doc: DocumentEngine, quality = 0.92): string {
    const out = createCanvas(doc.width, doc.height);
    const octx = getCtx(out);
    octx.filter = buildFilterString(doc.adjustments);
    octx.drawImage(doc.composite, 0, 0);
    return out.toDataURL("image/webp", quality);
  }

  /** 导出为 SVG 字符串（将栅格图嵌入 SVG <image>） */
  exportSvg(doc: DocumentEngine): string {
    const pngBase64 = this.exportPng(doc).replace(/^data:image\/png;base64,/, "");
    return [
      `<?xml version="1.0" encoding="UTF-8"?>`,
      `<svg xmlns="http://www.w3.org/2000/svg"`,
      `     xmlns:xlink="http://www.w3.org/1999/xlink"`,
      `     width="${doc.width}" height="${doc.height}"`,
      `     viewBox="0 0 ${doc.width} ${doc.height}">`,
      `  <image x="0" y="0" width="${doc.width}" height="${doc.height}"`,
      `         xlink:href="data:image/png;base64,${pngBase64}" />`,
      `</svg>`,
    ].join("\n");
  }

  /* ============ 工程文件 (.fpproj) 序列化 ============
   * 将一个 DocumentEngine 完整序列化为 JSON，包含：
   * - 文档元数据(名称/尺寸/调整)
   * - 所有图层(像素 dataURL + 元数据 + 文字/形状可编辑数据)
   * - 完整历史(每步含图层元数据 + 像素快照 + 选区)
   * 反序列化时还原所有字段，使撤销/重做、图层编辑、变换等全部可用。
   */

  /** 把一个画布转为 base64 PNG dataURL */
  private canvasToDataURL(canvas: HTMLCanvasElement): string {
    return canvas.toDataURL("image/png");
  }

  /** 把 ImageData 编码为 base64 PNG dataURL(借临时画布) */
  private imageDataToDataURL(img: ImageData): string {
    const c = createCanvas(img.width, img.height);
    getCtx(c).putImageData(img, 0, 0);
    return c.toDataURL("image/png");
  }

  /** 从 dataURL 加载到一个新画布(异步) */
  private dataURLToCanvas(url: string, w: number, h: number): Promise<HTMLCanvasElement> {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => {
        const c = createCanvas(w, h);
        const ctx = getCtx(c);
        ctx.drawImage(img, 0, 0, w, h);
        resolve(c);
      };
      img.onerror = (e) => reject(e);
      img.src = url;
    });
  }

  /** 从 dataURL 加载 ImageData(异步，尺寸 = 文档尺寸) */
  private dataURLToImageData(url: string, w: number, h: number): Promise<ImageData> {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => {
        const c = createCanvas(w, h);
        const ctx = getCtx(c);
        ctx.drawImage(img, 0, 0, w, h);
        resolve(ctx.getImageData(0, 0, w, h));
      };
      img.onerror = (e) => reject(e);
      img.src = url;
    });
  }

  /** 把当前文档序列化为可 JSON 化的对象 */
  async serializeProject(doc: DocumentEngine): Promise<ProjectJSON> {
    // 1. 图层
    const layers: ProjectLayerJSON[] = [];
    for (const l of doc.layers) {
      layers.push({
        id: l.id,
        name: l.name,
        visible: l.visible,
        locked: l.locked,
        opacity: l.opacity,
        blendMode: l.blendMode,
        offsetX: l.offsetX,
        offsetY: l.offsetY,
        scaleX: l.scaleX,
        scaleY: l.scaleY,
        rotation: l.rotation,
        kind: l.kind,
        // 所有图层都保存像素(文字/形状图层在编辑后也会有像素残留)
        png: this.canvasToDataURL(l.canvas),
        textData: l.textData ? { ...l.textData } : undefined,
        shapeData: l.shapeData
          ? {
              ...l.shapeData,
              from: { ...l.shapeData.from },
              to: { ...l.shapeData.to },
            }
          : undefined,
      });
    }

    // 2. 历史
    const history: ProjectHistoryStepJSON[] = [];
    for (const step of doc.history) {
      const snapshots: Record<string, string> = {};
      for (const [lid, img] of Object.entries(step.snapshots)) {
        snapshots[lid] = this.imageDataToDataURL(img);
      }
      let selection: string | null = null;
      if (step.selection) {
        selection = this.imageDataToDataURL(step.selection);
      }
      history.push({
        id: step.id,
        label: step.label,
        layerStates: step.layerStates.map((ls) => ({
          id: ls.id,
          name: ls.name,
          visible: ls.visible,
          locked: ls.locked,
          opacity: ls.opacity,
          blendMode: ls.blendMode,
          offsetX: ls.offsetX,
          offsetY: ls.offsetY,
          scaleX: ls.scaleX,
          scaleY: ls.scaleY,
          rotation: ls.rotation,
          kind: ls.kind,
          textData: ls.textData ? { ...ls.textData } : undefined,
          shapeData: ls.shapeData
            ? {
                ...ls.shapeData,
                from: { ...ls.shapeData.from },
                to: { ...ls.shapeData.to },
              }
            : undefined,
        })),
        snapshots,
        activeLayerId: step.activeLayerId,
        selection,
      });
    }

    return {
      version: PROJECT_VERSION,
      name: doc.name,
      width: doc.width,
      height: doc.height,
      adjustments: { ...doc.adjustments },
      activeLayerId: doc.activeLayerId,
      currentHistoryIndex: doc.currentHistoryIndex,
      layers,
      history,
    };
  }

  /** 从 JSON 对象重建 DocumentEngine 并注册到 docs(异步，因需加载图片) */
  async deserializeProject(json: ProjectJSON): Promise<DocumentEngine> {
    const w = json.width;
    const h = json.height;
    const id = nextId("doc");

    // 1. 还原图层
    const layers: EngineLayer[] = [];
    for (const lj of json.layers) {
      const canvas = await this.dataURLToCanvas(lj.png, w, h);
      const layer: EngineLayer = {
        id: lj.id,
        name: lj.name,
        canvas,
        ctx: getCtx(canvas),
        visible: lj.visible,
        locked: lj.locked,
        opacity: lj.opacity,
        blendMode: lj.blendMode,
        offsetX: lj.offsetX,
        offsetY: lj.offsetY,
        scaleX: lj.scaleX,
        scaleY: lj.scaleY,
        rotation: lj.rotation,
        kind: lj.kind,
        textData: lj.textData ? { ...lj.textData } : undefined,
        shapeData: lj.shapeData
          ? {
              ...lj.shapeData,
              from: { ...lj.shapeData.from },
              to: { ...lj.shapeData.to },
            }
          : undefined,
      };
      layers.push(layer);
    }

    // 2. 还原历史(每个快照 dataURL → ImageData)
    const history: HistoryStep[] = [];
    for (const sj of json.history) {
      const snapshots: Record<string, ImageData> = {};
      for (const [lid, url] of Object.entries(sj.snapshots)) {
        snapshots[lid] = await this.dataURLToImageData(url, w, h);
      }
      let selection: ImageData | null = null;
      if (sj.selection) {
        selection = await this.dataURLToImageData(sj.selection, w, h);
      }
      history.push({
        id: sj.id,
        label: sj.label,
        snapshots,
        layerStates: sj.layerStates.map((ls) => ({
          id: ls.id,
          name: ls.name,
          visible: ls.visible,
          locked: ls.locked,
          opacity: ls.opacity,
          blendMode: ls.blendMode,
          offsetX: ls.offsetX,
          offsetY: ls.offsetY,
          scaleX: ls.scaleX,
          scaleY: ls.scaleY,
          rotation: ls.rotation,
          kind: ls.kind,
          textData: ls.textData ? { ...ls.textData } : undefined,
          shapeData: ls.shapeData
            ? {
                ...ls.shapeData,
                from: { ...ls.shapeData.from },
                to: { ...ls.shapeData.to },
              }
            : undefined,
        })),
        activeLayerId: sj.activeLayerId,
        selection,
      });
    }

    const composite = createCanvas(w, h);
    const doc: DocumentEngine = {
      id,
      name: json.name,
      width: w,
      height: h,
      layers,
      activeLayerId: json.activeLayerId,
      adjustments: { ...json.adjustments },
      history,
      currentHistoryIndex: json.currentHistoryIndex,
      composite,
      compositeCtx: getCtx(composite),
      selectionMask: null,
      selectionCtx: null,
    };

    // 3. 还原选区(若有)：从最后历史步的 selection 取出，重建 selectionMask
    const lastStep = history[history.length - 1];
    if (lastStep && lastStep.selection) {
      const mask = createCanvas(w, h);
      const mctx = getCtx(mask);
      mctx.putImageData(lastStep.selection, 0, 0);
      doc.selectionMask = mask;
      doc.selectionCtx = mctx;
    }

    // 4. 重新渲染文字/形状图层画布(确保与 textData/shapeData 一致)
    for (const l of layers) {
      if (l.kind === "text") this.renderTextLayer(l);
      else if (l.kind === "shape") this.renderShapeLayer(l);
    }

    this.docs.set(id, doc);
    this.renderComposite(doc);
    this.emit();
    return doc;
  }
}

/* ============ 工程文件 JSON 类型 ============ */
export const PROJECT_VERSION = 1;
export const PROJECT_EXT = ".fpproj";
export const PROJECT_MIME = "application/json";

export interface ProjectLayerJSON {
  id: string;
  name: string;
  visible: boolean;
  locked: boolean;
  opacity: number;
  blendMode: string;
  offsetX: number;
  offsetY: number;
  scaleX: number;
  scaleY: number;
  rotation: number;
  kind: "image" | "text" | "shape";
  /** 图层画布的 base64 PNG dataURL */
  png: string;
  textData?: TextLayerData;
  shapeData?: ShapeLayerData;
}

export interface ProjectHistoryStepJSON {
  id: string;
  label: string;
  layerStates: Array<{
    id: string;
    name: string;
    visible: boolean;
    locked: boolean;
    opacity: number;
    blendMode: string;
    offsetX: number;
    offsetY: number;
    scaleX: number;
    scaleY: number;
    rotation: number;
    kind: "image" | "text" | "shape";
    textData?: TextLayerData;
    shapeData?: ShapeLayerData;
  }>;
  /** 每个图层的像素快照: layerId → base64 PNG dataURL */
  snapshots: Record<string, string>;
  activeLayerId: string;
  /** 选区快照 base64 PNG dataURL，或 null */
  selection: string | null;
}

export interface ProjectJSON {
  version: number;
  name: string;
  width: number;
  height: number;
  adjustments: Adjustments;
  activeLayerId: string;
  currentHistoryIndex: number;
  layers: ProjectLayerJSON[];
  history: ProjectHistoryStepJSON[];
}

/* ============ 调整 → CSS filter 字符串 ============ */
export const buildFilterString = (a: Adjustments): string => {
  const brightness = 1 + a.brightness / 100;
  const contrast = 1 + a.contrast / 100;
  const saturate = 1 + a.saturation / 100;
  const sepia = Math.max(0, a.temperature) / 200;
  const hue = a.temperature < 0 ? 180 * (-a.temperature / 100) : 0;
  return `brightness(${brightness.toFixed(3)}) contrast(${contrast.toFixed(3)}) saturate(${saturate.toFixed(3)}) sepia(${sepia.toFixed(3)}) hue-rotate(${hue.toFixed(1)}deg)`;
};

/** 全局单例 */
export const engine = new EditorEngine();
