/*
 * FatNotes Bespoke Plugin SDK — mirror of
 * `fat-notes/src/frontend/pluginSdk/types.ts`.
 *
 * Keep this file in sync with the host types when upgrading the CLI.
 * The host types `Block.Item` as a global namespace. Plugin projects do not
 * have that namespace, so this mirror uses `PluginBlockItem` instead.
 */
import type { ComponentType, CSSProperties, ReactNode } from "react";

export interface Disposable {
  dispose(): void;
}

export interface HostInfo {
  version: string;
  mode: "dev" | "prod";
}

export interface DataSourceItem {
  id: string;
  name: string;
  type: string;
  [key: string]: unknown;
}

export interface DataSourceApi {
  listDs(): Promise<DataSourceItem[]>;
  getDs(id: string): Promise<DataSourceItem | null>;
}

export interface QueryApi {
  run<T = unknown>(
    queryId: string,
    params?: Record<string, unknown>,
  ): Promise<T>;
  runRaw<T = unknown>(dsId: string, sql: string): Promise<T>;
}

export interface MutationApi {
  run<T = unknown>(
    mutationId: string,
    payload?: Record<string, unknown>,
  ): Promise<T>;
  insert<T = unknown>(
    dsId: string,
    table: string,
    row: Record<string, unknown>,
  ): Promise<T>;
}

export interface ToastApi {
  success(msg: string): void;
  warn(msg: string): void;
  error(msg: string): void;
  info(msg: string): void;
}

export interface ModalApi {
  confirm(options: {
    title: string;
    content?: string;
    okText?: string;
    cancelText?: string;
  }): Promise<boolean>;
}

export interface ThemeApi {
  get(): "light" | "dark" | string;
  onChange(cb: (theme: string) => void): Disposable;
}

export interface I18nApi {
  t(key: string, values?: Record<string, string | number>): string;
  locale: string;
  /**
   * Returns the host's full message catalog for the current locale.
   * Plugins should merge these with their own messages before rendering
   * host-provided remote components inside their own IntlProvider,
   * otherwise the host components will render raw i18n keys.
   */
  getMessages(): Record<string, string>;
  onChange(cb: (locale: string) => void): Disposable;
}

export interface UiApi {
  toast: ToastApi;
  modal: ModalApi;
  theme: ThemeApi;
  i18n: I18nApi;
}

export interface CommandsApi {
  register(
    id: string,
    handler: (...args: unknown[]) => unknown | Promise<unknown>,
  ): Disposable;
  execute<T = unknown>(id: string, ...args: unknown[]): Promise<T>;
}

export interface StoreApi {
  select<T>(selector: (state: unknown) => T): T;
  subscribe<T>(
    selector: (state: unknown) => T,
    cb: (value: T) => void,
  ): Disposable;
}

export type SidebarSlot = "primary" | "secondary";

export interface ActivityBarItemDef {
  id: string;
  title: string;
  /** Icon name (lucide-react key) or SVG URL */
  icon: string;
  onClick?: () => void;
  /** Optional — if provided, clicking selects this primary sidebar viewId */
  primarySidebarViewId?: string;
  /** Optional — plugin name for display in activity bar tooltip */
  pluginName?: string;
}

export interface SidebarViewDef {
  id: string;
  title: string;
  render: () => ReactNode;
}

export interface PanelTabDef {
  id: string;
  title: string | ReactNode;
  render: () => ReactNode;
  sortIndex?: number;
}

export interface FooterItemDef {
  id: string;
  /** Render arbitrary content inline in the footer */
  render: () => ReactNode;
  /** Optional alignment within the footer */
  align?: "left" | "right";
}

export interface RoutePageDef {
  path: string;
  title: string;
  render: () => ReactNode;
}

/**
 * 画布级时间上下文快照，由宿主从 TimeContext 提取后注入插件 block
 * 的 render props。图表类卡片依赖 startTime/endTime 发起数据查询，
 * 并通过 refreshTime 感知时间范围刷新。
 */
export interface BlockTimeContext {
  /** 相对时间 token（如 "/d"），绝对时间范围为空字符串 */
  relativeTime?: string;
  /** 开始时间（TIME_FORMAT: "YYYY-MM-DD HH:mm:ss"） */
  startTime?: string;
  /** 结束时间（TIME_FORMAT: "YYYY-MM-DD HH:mm:ss"） */
  endTime?: string;
  /** 刷新时间戳 — 变化时卡片应重新查询数据 */
  refreshTime?: number;
  /** 更新时间范围（由宿主时间选择器触发） */
  onUpdateTime: (
    relativeTime: string,
    startTime: string,
    endTime: string,
  ) => void;
}

/** 插件卡片可注册的触发方式 */
export interface BlockActionTriggerDef {
  /** 触发方式 id，写入事件 action.trigger，如 clickTrendDot */
  id: string;
  /** 展示文案。缺省时宿主使用 action.trigger.type.{id} */
  title?: string;
}

/** 插件卡片点击后上报给宿主事件菜单的参数。posX/posY 相对 chartId 元素左上角 */
export interface BlockActionShowParams {
  posX: number;
  posY: number;
  serieId?: string;
  mValue?: number;
  dValue?: string;
  mUnit?: string;
  xValue?: number;
  dimensions?: Array<{
    dsColId?: string;
    name?: string;
    value?: string;
  }>;
  startTime?: string;
  endTime?: string;
  relativeTime?: string;
  startTimestamp?: string;
  endTimestamp?: string;
  width?: number;
  height?: number;
}

/**
 * Loose view of the host block item (`Block.Item` in fat-notes-core).
 * Only the fields plugins commonly read are named; the host still passes the
 * full block, including reqParams and commonOptions.
 */
export interface PluginBlockItem {
  id: string;
  type: string;
  title?: string;
  boardId?: string;
  reqParams?: unknown;
  commonOptions?: unknown;
  options?: unknown;
  actions?: unknown[];
  [key: string]: unknown;
}

/** Plugin block render props — 扩展字段均为可选，保持向后兼容 */
export interface BlockRenderProps {
  /** 卡片私有配置（Block.Item.options） */
  config: unknown;
  /** 宿主 Block.Item 完整数据（含 reqParams/commonOptions），供数据查询使用 */
  item?: PluginBlockItem;
  /** 是否渲染在配置抽屉的预览区 */
  inConfig?: boolean;
  /** 画布级时间上下文（仅画布/配置抽屉内提供） */
  time?: BlockTimeContext;
  /** 宿主事件浮层定位用的根节点 id，插件应以此计算点击偏移 */
  chartId?: string;
  /** 事件菜单是否正打开，用于隐藏图表 tooltip */
  actionsVisible?: boolean;
  /**
   * 打开宿主事件菜单。仅在卡片注册了 actionIds / triggers 且不在配置预览时提供。
   */
  onShowActions?: (params: BlockActionShowParams) => void;
}

/**
 * 组件配置抽屉下方「数据/查询」区域的自定义渲染。
 * 与 `BlockTypeDef.dataConfig === false`（隐藏）互斥：有 render 时替换宿主默认查询面板。
 */
export interface BlockDataConfigDef {
  /** 渲染于配置抽屉预览区下方，替代默认 DataConfig */
  render: () => ReactNode;
}

/** 配置说明里的一个字段。路径相对 options / reqParams / commonOptions。 */
export interface BlockConfigFieldDoc {
  path: string;
  name: string;
  /** string | number | boolean | object | array */
  dataType: string;
  description?: string;
  required?: boolean;
  enum?: Array<string | number | boolean>;
  default?: unknown;
}

/** 配置说明的一个分区：options 属性、reqParams 请求参数、commonOptions 公共配置。 */
export interface BlockConfigSectionDoc {
  key: "options" | "reqParams" | "commonOptions" | string;
  description: string;
  fields?: BlockConfigFieldDoc[];
  /** 这一区可直接写入创建卡片接口的示例 */
  example?: unknown;
}

/**
 * 给 AI 的卡片配置格式说明。
 * 随 registerBlockType 同步到宿主 MCP「查询卡片配置说明」。
 * 只能放可 JSON 序列化的数据，不要放函数或组件。
 */
export interface BlockConfigDoc {
  /** 与 BlockTypeDef.type 一致 */
  type: string;
  title: string;
  /** 一句话用途，参与关键词检索 */
  summary: string;
  category?: string;
  /** 额外检索词，例如趋势图、时序图 */
  keywords?: string[];
  layout?: { w?: number; h?: number; description?: string };
  sections?: BlockConfigSectionDoc[];
  notes?: string[];
}

export interface BlockTypeDef {
  type: string;
  title: string;
  icon?: string;
  iconUrl?: string;
  category?: string;
  /**
   * 添加组件菜单内的排序权重，数值越小越靠前。
   * 未设置时排在已设置 index 的项之后，并保持原有相对顺序。
   */
  index?: number;
  render: (props: BlockRenderProps) => ReactNode;
  defaultSize?: {
    w?: number;
    h?: number;
    minW?: number;
    minH?: number;
    maxW?: number;
    maxH?: number;
  };
  /**
   * 新建卡片时写入 options 的默认值。
   * 宿主 getDefaultBlockConf 在内置类型未命中时使用，调用方会深拷贝。
   */
  defaultOptions?: Record<string, unknown>;
  /**
   * 新建卡片时合并进 commonOptions 的默认值，调用方会深拷贝。
   */
  defaultCommonOptions?: Record<string, unknown>;
  /**
   * 组件配置抽屉下方「数据/查询」区域：
   * - 未设置：使用宿主默认查询配置（iframe/spider 仍走内置 CustomDataConfig）
   * - false：隐藏该区域（预览区占满左侧）
   * - { render }：用插件自定义内容替换默认查询配置
   */
  dataConfig?: false | BlockDataConfigDef;
  /**
   * 事件编辑器中可选的事件类型。
   * 内置 id：relate 联动、drill 下钻、update 更新、filter 过滤、delete 删除、linkTo 跳转、switchScene 切换场景页面。
   */
  actionIds?: string[];
  /**
   * 事件编辑器中可选的触发方式。
   * 字符串为触发 id（展示文案走 action.trigger.type.{id}），对象可自带 title。
   */
  triggers?: Array<string | BlockActionTriggerDef>;
  /**
   * 给 AI 的配置格式说明。宿主会同步到 MCP「查询卡片配置说明」。
   * 注册了卡片就应带上，这样助手创建该卡片前能查到 options、reqParams、commonOptions。
   */
  configDoc?: BlockConfigDoc;
}

/**
 * 添加组件菜单中的分类。插件用 `registerBlockCategory` 注册后，
 * `BlockTypeDef.category` 引用这里的 `id`。标题由插件按当前语言给出。
 */
export interface BlockCategoryDef {
  /** 分类 id，与 BlockTypeDef.category 对应，例如 "structure"。 */
  id: string;
  /** 已按当前语言翻译好的展示名。 */
  title: string;
  /**
   * 插在该分类 id 后面。锚点可以是内置分类，或更早注册的插件分类。
   * 锚点不存在时，排在内置「其他」之前。
   */
  after?: string;
}

export interface SettingsPageDef {
  id: string;
  title: string;
  render: () => ReactNode;
}

// ── Flow Node Type (plugin-contributed workflow nodes) ───────────────

/** Canvas render props handed to a plugin flow node's `render` component. */
export interface PluginFlowNodeRenderProps {
  /** The LogicFlow node being rendered (loose typing across SDK boundary). */
  node: unknown;
  /** Host i18n helper ({ text, field, locale }) — resolves host catalogs. */
  i18n: unknown;
}

/** Context passed to a plugin node's `initDefaultNode` when the node is created. */
export interface PluginFlowNodeInitCtx {
  node: unknown;
  flow: unknown;
  i18nText: (text: string) => string;
  extra?: unknown;
}

/**
 * A workflow (flow) node type contributed by a plugin.
 *
 * Mirrors the host's `Block.FlowTypeItem` metadata plus the UI pieces the
 * host needs to render/edit the node: `render` draws the canvas card,
 * `edit` renders inside the host's FlowEditDrawer (it should consume
 * `sdk.remoteComponents.FlowEditCommon.useFlowNode()` to read/write the
 * node), and `initDefaultNode` assigns type-specific defaults on creation.
 */
export interface PluginFlowNodeTypeDef {
  /** Node type id, e.g. "scBrowserClickWebElement". Must be globally unique. */
  type: string;
  /** Display name — host i18n key or plain text. */
  name: string;
  /** Host IconType value (e.g. "browser") or empty. */
  iconType?: string;
  iconUrl?: string;
  /** Theme color (e.g. "#1677ff", "green"). */
  color?: string;
  /** Panel category, e.g. "browser" | "media" | "ai". */
  category?: string;
  theme?: "light" | "dark" | string;
  /** Default description — host i18n key or plain text. */
  defaultDescription?: string;
  width?: number;
  height?: number;
  /** Assign type-specific defaults when a node of this type is created. */
  initDefaultNode?: (ctx: PluginFlowNodeInitCtx) => void;
  /** Canvas card component (rendered inside the node frame). */
  render: ComponentType<PluginFlowNodeRenderProps>;
  /** Edit-drawer component (rendered inside host FlowNodeContext). */
  edit: ComponentType<Record<string, unknown>>;
}

export interface WorkbenchPageDef {
  id: string;
  render: () => ReactNode;
}

// ── AI Settings Section (plugin-contributed AI settings tabs) ────────

/** Render props handed to a plugin AI-settings section's `render` callback. */
export interface PluginAiSettingsSectionRenderProps {
  /** Host i18n helper ({ text }) — resolves host catalogs. */
  i18n: { text: (key: string, values?: any) => string };
}

/**
 * A settings tab contributed by a plugin inside the host's "AI 配置"
 * (AiSettingsPage) work area. The section appears in the AiManage sidebar
 * menu (label resolved from `i18nTitleKey`) and its content renders inside
 * the AiSettingsPage container. When a section id collides with a host
 * built-in tab id, the plugin section takes precedence (mirrors
 * flow.getSysNodeTypes merging). When the plugin is not installed, a
 * persisted provider record keeps the menu entry alive with install
 * guidance.
 */
export interface PluginAiSettingsSectionDef {
  /** Section id, e.g. "kb". Same id as a host built-in tab overrides it. */
  id: string;
  /** Host i18n key for the sidebar menu label (e.g. "ai.manage.tab.kb"). */
  i18nTitleKey: string;
  /** Host IconType value (reserved for future menu icons). */
  iconType?: string;
  /**
   * Sort weight — smaller comes first. Host built-in tabs occupy 0..N;
   * sections without `order` append after all built-ins.
   */
  order?: number;
  /** Section content component (rendered inside host AiSettingsPage). */
  render: (props: PluginAiSettingsSectionRenderProps) => ReactNode;
}

export interface MenuItemDef {
  command: string;
  title?: string;
  when?: string;
}

export interface BlockDisplayConfigDef {
  /** Unique contribution id, recommend "<pluginId>.<name>" */
  id: string;
  /** Target block type; "*" means all block types. */
  blockType: string;
  /** Render display-config UI in BlockConfig > DisplayConfig panel. */
  render: () => ReactNode;
}

/** 插件注册到全局搜索的单个搜索项 */
export interface PluginSearchItemDef {
  /** 项唯一 id（插件内唯一，推荐 "<pluginId>.<itemId>"） */
  id: string;
  /** 名称（主匹配文本） */
  title: string;
  /** 描述（次匹配文本 + 搜索结果第二行） */
  desc?: string;
  /** 图标组件（搜索结果回显） */
  icon?: ComponentType<{ style?: CSSProperties }>;
  /** 额外匹配关键词（命中但不高亮） */
  keywords?: string[];
  /** 搜索结果类型标签文案（如 "工具"）；缺省用宿主 i18n type.plugin */
  tag?: string;
  /**
   * 输入内容匹配模式：用户搜索文本命中该正则时，本项也出现在结果中
   * （如计算器的算式输入 1+1、sqrt(16)）。命中优先级低于名称匹配。
   */
  inputPattern?: RegExp;
  /** 点击后需激活的活动栏/工作台页共用 id（如 fat-tools.main）；缺省不切换视图 */
  activityId?: string;
  /** 点击回调（宿主切换视图后执行）；query 为触发本次命中的搜索文本（inputPattern 场景自动填入用） */
  onSelect?: (query?: string) => void;
}

/** 插件注册的全局搜索提供者 */
export interface SearchProviderDef {
  /** 提供者 id，推荐 "<pluginId>.search" */
  id: string;
  /** 提供者名称（缺省类型标签回退） */
  name?: string;
  /** 项缺省图标组件 */
  icon?: ComponentType<{ style?: CSSProperties }>;
  /** 搜索项列表 */
  items: PluginSearchItemDef[];
}

export interface ContributionsApi {
  registerActivityBarItem(def: ActivityBarItemDef): Disposable;
  /** Register the plugin's primary sidebar contribution using only a render callback. */
  registerPrimarySidebar(render: () => ReactNode): Disposable;
  registerSidebarView(slot: SidebarSlot, def: SidebarViewDef): Disposable;
  registerPanelTab(def: PanelTabDef): Disposable;
  registerFooterItem(def: FooterItemDef): Disposable;
  registerRoutePage(def: RoutePageDef): Disposable;
  registerWorkbenchPage(def: WorkbenchPageDef): Disposable;
  registerBlockType(def: BlockTypeDef): Disposable;
  /**
   * 注册添加组件菜单的分类。卸载插件或 dispose 后分类消失，
   * 其下卡片若仍注册着，会排到菜单末尾。
   */
  registerBlockCategory(def: BlockCategoryDef): Disposable;
  registerBlockDisplayConfig(def: BlockDisplayConfigDef): Disposable;
  registerSettingsPage(def: SettingsPageDef): Disposable;
  registerSearchProvider(def: SearchProviderDef): Disposable;
  registerMenu(target: string, items: MenuItemDef[]): Disposable;
  /**
   * Register a workflow (flow) node type. The node appears in the host's
   * add-node panel under `def.category` and is rendered/edited with the
   * plugin-provided components. When the plugin is not installed, flows
   * that contain the node render a placeholder with install guidance.
   */
  registerFlowNodeType(def: PluginFlowNodeTypeDef): Disposable;
  /**
   * Register a tab section inside the host's "AI 配置" settings page
   * (AiSettingsPage + AiManage sidebar menu). The section's id may collide
   * with a host built-in tab id — the plugin section then takes precedence.
   * When the plugin is not installed, previously registered sections keep
   * showing a placeholder with install guidance.
   */
  registerAiSettingsSection(def: PluginAiSettingsSectionDef): Disposable;
  /**
   * Request the host to hide the secondary sidebar while this registration
   * is active. Disposing the returned `Disposable` restores the previous
   * visibility. Multiple plugins can request hiding simultaneously; the
   * sidebar stays hidden until all disposables are disposed.
   */
  registerHideSecondarySidebar(): Disposable;
  /**
   * Request the host to hide the bottom panel while this registration is
   * active. Disposing the returned `Disposable` restores the previous
   * visibility. Multiple plugins can request hiding simultaneously; the
   * panel stays hidden until all disposables are disposed.
   */
  registerHidePanel(): Disposable;
}

export interface EventsApi {
  on(name: string, cb: (payload: unknown) => void): Disposable;
  emit(name: string, payload?: unknown): void;
}

/**
 * Backend API — allows the frontend plugin to invoke Python handler functions
 * running in the plugin's backend subprocess.
 *
 * Only available when `plugin.json` has `backend.enabled: true`.
 * If the plugin has no backend, `invoke()` rejects immediately.
 */
export interface BackendApi {
  /**
   * Call a named handler registered in the plugin backend.
   * @param handler - Handler name (decorated with `@handler(name)` in Python).
   * @param params - Optional JSON-serializable payload.
   * @param timeout - Optional response timeout in seconds (host default: 30).
   *                  Long-running handlers (e.g. script execution) should pass
   *                  a timeout covering their full expected duration.
   * @returns The handler's return value.
   */
  invoke<T = unknown>(
    handler: string,
    params?: Record<string, unknown>,
    timeout?: number,
  ): Promise<T>;
  /** Check if the backend process is currently running. */
  isRunning(): Promise<boolean>;
  /** Restart the backend process (stop + start). */
  restart(): Promise<void>;
}

export interface PluginConfigApi {
  get<T = Record<string, unknown>>(): Promise<T>;
  set<T = Record<string, unknown>>(
    config: T,
    options?: {
      merge?: boolean;
    },
  ): Promise<T>;
}

// ── AI ────────────────────────────────────────────────────────

/**
 * Sanitized view of a host-configured AI model.
 * `apiKey` is intentionally omitted — plugins must invoke models via
 * `AiApi.chat()` so the host handles authentication.
 */
export interface AiModelItem {
  id: string;
  name: string;
  model?: string;
  url?: string;
  supportImages?: boolean;
  isDefault?: boolean;
  apiType?: string;
  customParams?: Record<string, unknown>;
}

export interface AiChatMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string;
}

export interface AiSkillRef {
  type: "mcp" | "tool";
  objId: string;
  name?: string;
}

export interface AiChatInput {
  modelId: string;
  messages: AiChatMessage[];
  sysPrompt?: string;
  skills?: AiSkillRef[];
  toolIds?: string[];
  autoMcp?: boolean;
  toolChoice?: unknown;
  maxIterations?: number;
}

export interface AiToolStep {
  iteration: number;
  toolCalls: unknown[];
  toolResults: unknown[];
}

export interface AiChatResult {
  content: string;
  model: string;
  toolSteps: AiToolStep[];
  iterations: number;
  terminatedBy?: string;
}

// ── Knowledge Base / Vector Store ─────────────────────────────

export interface AiKnowledgeBaseStorage {
  type: string;
  path?: string;
  indexName?: string;
  namespace?: string;
  customParams?: Record<string, unknown>;
}

export interface AiKnowledgeBaseEmbedding {
  modelId: string;
  dims?: number;
  normalize?: boolean;
  batchSize?: number;
  customParams?: Record<string, unknown>;
}

export interface AiKnowledgeBaseItem {
  id: string;
  name: string;
  description?: string;
  tags?: string[];
  langs?: string[];
  visibility?: string;
  status?: string;
  createdAt?: string;
  updatedAt?: string;
  storage: AiKnowledgeBaseStorage;
  embedding: AiKnowledgeBaseEmbedding;
  stats?: Record<string, unknown>;
}

// ── MCP Tool ───────────────────────────────────────────────────

export interface AiMcpToolItem {
  id: string;
  name: string;
  description?: string;
  icon?: string;
  tags?: string[];
  langs?: string[];
  type?: string;
  enable?: boolean;
}

// ── Skill ──────────────────────────────────────────────────────

export interface AiSkillItem {
  id: string;
  name?: string;
  description?: string;
  icon?: string;
  tags?: string[];
  langs?: string[];
  enable?: boolean;
  createdAt?: string;
  updatedAt?: string;
}

export interface AiApi {
  /** List all configured models (apiKey stripped). */
  getModels(): Promise<AiModelItem[]>;
  /** Fetch a single model by id (apiKey stripped). */
  getModel(id: string): Promise<AiModelItem | null>;
  /** Invoke the host's chat completion endpoint. */
  chat(input: AiChatInput): Promise<AiChatResult>;
  /** List all knowledge bases (vector stores) configured in the host. */
  getKnowledgeBases(): Promise<AiKnowledgeBaseItem[]>;
  /** List all MCP tools configured in the host (sanitized, no conf). */
  getMcpTools(): Promise<AiMcpToolItem[]>;
  /** List all skills configured in the host (sanitized). */
  getSkills(): Promise<AiSkillItem[]>;
}

export interface PluginBoardDependency {
  id: string;
  type: string;
  version?: string;
  [key: string]: unknown;
}

export interface PluginBoardDetail<TBlock = unknown> {
  boardId: string;
  uniqueKey: string;
  name: string;
  type: string;
  blocks: TBlock[];
  config: Record<string, unknown>;
  dependencies: PluginBoardDependency[];
}

export interface PluginBoardSaveInput<TBlock = unknown> {
  name?: string;
  type?: string;
  blocks: TBlock[];
}

export interface PluginBoardBlockInput {
  id?: string;
  boardId?: string;
  name?: string;
  type?: string;
  defaultName?: string;
  showName?: boolean;
  parentId?: string | null;
  reqParams?: unknown;
  properties?: unknown;
  aiMarks?: unknown;
  layout?: {
    x?: number;
    y?: number;
    w?: number;
    h?: number;
    minW?: number;
    minH?: number;
  };
}

export interface FlowLike {
  id?: string;
  name?: string;
  description?: string;
  version?: string;
  nodes?: unknown[];
  lines?: unknown[];
  zoom?: number;
  zoomType?: string;
  [key: string]: unknown;
}

export interface FlowSummaryItem {
  id: string;
  name?: string;
  description?: string;
  tags?: string[];
  version?: string;
  boardId?: string;
  blockId?: string;
  blockType?: string;
  flowType?: string;
  [key: string]: unknown;
}

export interface FlowExecuteInput<TFlow = FlowLike> {
  flowId?: string;
  flow?: TFlow;
  inputs?: Record<string, unknown>;
}

export interface FlowExecuteResult {
  session_id?: string;
  success: boolean;
  outputs: Record<string, unknown>;
  error?: string | null;
  duration_ms?: number;
  execution_path?: string[];
  [key: string]: unknown;
}

export interface FlowApi {
  list(): Promise<FlowSummaryItem[]>;
  get<TFlow = FlowLike>(flowId: string): Promise<TFlow | null>;
  execute<
    TResult extends FlowExecuteResult = FlowExecuteResult,
    TFlow = FlowLike,
  >(
    input: FlowExecuteInput<TFlow>,
  ): Promise<TResult>;
}

export interface PluginBoardsApi {
  getBoard<T = Record<string, unknown>>(uniqueKey: string): Promise<T>;
  setBoard<T = Record<string, unknown>>(
    uniqueKey: string,
    config: T,
    options?: {
      merge?: boolean;
    },
  ): Promise<T>;
  getDependencies(uniqueKey: string): Promise<PluginBoardDependency[]>;
  getBoardBlocks(uniqueKey: string): Promise<unknown[]>;
  getBoardDetail<TBlock = unknown>(
    uniqueKey: string,
  ): Promise<PluginBoardDetail<TBlock>>;
  setDependencies(
    uniqueKey: string,
    dependencies: PluginBoardDependency[],
    options?: {
      merge?: boolean;
    },
  ): Promise<PluginBoardDependency[]>;
  addConfigCard(
    uniqueKey: string,
    options?: {
      title?: string;
      type?: string;
      layout?: { x?: number; y?: number; w?: number; h?: number };
      dependencies?: PluginBoardDependency[];
    },
  ): Promise<Record<string, unknown>>;
  saveBoardDetail<TBlock = unknown>(
    uniqueKey: string,
    input: PluginBoardSaveInput<TBlock>,
  ): Promise<PluginBoardDetail<TBlock>>;
  createBlock<T = Record<string, unknown>>(
    uniqueKey: string,
    block: PluginBoardBlockInput,
  ): Promise<T>;
  updateBlock<T = Record<string, unknown>>(
    uniqueKey: string,
    block: PluginBoardBlockInput,
  ): Promise<T>;
  deleteBlock(uniqueKey: string, blockId: string): Promise<void>;
}

export interface PluginBlockBoxBoardApi<TBlock = unknown> {
  loadBoard?: () => Promise<{
    name?: string;
    type?: string;
    blocks?: TBlock[];
  } | null>;
  saveBoard?: (input: PluginBoardSaveInput<TBlock>) => Promise<unknown>;
  createCard?: (block: PluginBoardBlockInput) => Promise<unknown>;
  updateCard?: (block: PluginBoardBlockInput) => Promise<unknown>;
  deleteCard?: (blockId: string) => Promise<void>;
}

export interface ThinkFlowComponentProps<TFlow = FlowLike> {
  flow?: TFlow;
  className?: string;
  minHeight?: number | string;
  showToolbar?: boolean;
  flowToolbar?: Record<string, unknown>;
  flowStyle?: Record<string, unknown>;
  inputs?: Record<string, unknown>;
  autoRun?: boolean;
  /**
   * Controls the ordering (and filtering) of node categories shown in the
   * "add node" panel. When omitted, the host uses the Think-card default
   * (`think, logic, flow, ...`). Pass the etlDag order
   * (`logic, flow, inAndOut, spider, data, ...`) to get the data-processing
   * card's add-option order — the `think` and `static` categories will be
   * omitted and `spider` will appear before `data`.
   */
  categoriesSort?: string[];
  onChange?: (flow: TFlow) => void;
  onSave?: (flow: TFlow) => void | Promise<unknown>;
  onEndOutput?: (result: FlowExecuteResult) => void;
  /**
   * 渲染 end 节点编辑面板底部的额外内容。
   *
   * 宿主（fat-notes）在 end 节点编辑器底部调用此函数，由插件（如
   * fat-monitor）提供具体内容（提示文案、说明、交互组件等）。宿主
   * 不关心返回内容的具体形式，只负责渲染。
   *
   * 调用时机：end 节点编辑面板渲染时（每次都会调用，插件可返回
   * `null`/`undefined` 表示不渲染任何内容）。
   *
   * @param ctx - 包含当前 flow 的上下文
   * @returns ReactNode - 返回 null/undefined 表示不渲染
   */
  renderEndNodeExtra?: (ctx: { flow: TFlow }) => ReactNode;
}

/**
 * Props for the host trend-chart remote component.
 *
 * The trend chart is the same block used by the host's `Trend` dashboard
 * block. It reads its data and display configuration from a block config
 * (the same `Block.Item` shape used by `sdk.boards` APIs). Plugins
 * typically obtain one via `sdk.boards.getBoardBlocks()` / `getBoardDetail()`
 * or construct one to feed the chart with a custom query + display config.
 */
export interface TrendComponentProps {
  /**
   * Block configuration (`Block.Item` shape). Carries the data-query
   * config (`properties.base.query`) and trend display config
   * (`properties.trend`). Typed as `unknown` to avoid leaking the host's
   * internal `Block` namespace across the SDK boundary.
   */
  item: unknown;
  /** Whether the chart is rendered inside a config panel (disables hover). */
  inConfig?: boolean;
  /** Optional className for the outer container. */
  className?: string;
  /**
   * Concrete pixel height for the chart container. AutoSizer (used inside
   * the host Trend) requires a definite parent height; when omitted, the
   * adapter falls back to 460px (matching the ThinkFlow default).
   */
  minHeight?: number | string;
  /**
   * Optional time-range override. When provided, the adapter wraps the
   * Trend block in a `TimeContext.Provider` so the chart queries data
   * for the given range. When omitted, the Trend block falls back to
   * whatever `TimeContext` is provided by ancestors (which may be empty
   * when rendered standalone inside a plugin page).
   */
  startTime?: string;
  endTime?: string;
  relativeTime?: string;
  /**
   * Refresh tick — increment to force a re-query without changing the
   * time range. Mirrors the host's `refreshTime` semantics.
   */
  refreshTime?: number;
  /**
   * Called when the user picks a new time range via the host's
   * `TimeSelector` (if rendered by the plugin alongside the Trend).
   * Mirrors the host's `TimeContext.onUpdateTime` signature.
   */
  onUpdateTime?: (
    relativeTime: string,
    startTime: string,
    endTime: string,
  ) => void;
}

/**
 * Trend-chart area fill config (mirrors the host's `Block.TrendAreaFill`).
 *
 * Plugins construct one of these (inside `properties.trend.areaFills` of a
 * trend block item) to render a colored rectangle and/or override the line
 * color of any series passing through the region.
 */
export interface TrendAreaFill {
  /** Unique id (any string). */
  id?: string;
  /**
   * Y-axis lower bound (y1). When only `yMin` is set, the region above
   * `yMin` is filled. When both `yMin` and `yMax` are set, the
   * `[min(yMin,yMax), max(yMin,yMax)]` interval is filled.
   */
  yMin?: number;
  /**
   * Y-axis upper bound (y2). When only `yMax` is set, the region below
   * `yMax` is filled.
   */
  yMax?: number;
  /**
   * X-axis lower bound (x1). When only `xMin` is set, the region to the
   * right of `xMin` is filled. When both `xMin` and `xMax` are set, the
   * `[min(xMin,xMax), max(xMin,xMax)]` interval is filled.
   */
  xMin?: number;
  /** X-axis upper bound (x2). When only `xMax` is set, the region to the left of `xMax` is filled. */
  xMax?: number;
  /** Fill color (hex). Defaults to `#ff0000` when omitted. */
  color?: string;
  /** Fill alpha (0–1). Defaults to `0.2`. */
  alpha?: number;
  /**
   * Whether the fill color is applied. Defaults to `true`. At least one of
   * `fillEnabled` / `lineEnabled` must be `true`; the host UI prevents
   * unchecking the last enabled toggle.
   */
  fillEnabled?: boolean;
  /**
   * Line color applied to every visible series passing through the region
   * (only effective when `lineEnabled` is `true`). The host re-strokes the
   * line segments clipped to the region on top of the original line.
   */
  lineColor?: string;
  /**
   * Whether the line-color override is applied. Defaults to `false`. At
   * least one of `fillEnabled` / `lineEnabled` must be `true`.
   */
  lineEnabled?: boolean;
}

export interface BlockConfigCommonApi {
  DisplayBox: unknown;
  DisplayHighLight: unknown;
  BlockName: unknown;
  DisplayCollapse: unknown;
  PanelDisplay: unknown;
  DisplayMulitHighLightInput: unknown;
  LegendDisplay: unknown;
  GraphTheme: unknown;
  TooltipDisplay: unknown;
  BoxPadding: unknown;
  BoxBordersRadius: unknown;
  BoxBordersWidth: unknown;
  QueryFormatsDisplay: unknown;
  SimpleInputBox: unknown;
  ShowCount: unknown;
  DisplayValues: unknown;
  ChartDisplay: unknown;
  GradientColorsDisplay: unknown;
  ColorationSelector: unknown;
  ChartSort: unknown;
  VMLegendDisplay: unknown;
  FlowToolbarDisplay: unknown;
  FlowStyleDisplay: unknown;
  FlowRunningStyleDisplay: unknown;
  ValidateRulesSelector: unknown;
  InputStyleDisplay: unknown;
  VarNameInput: unknown;
  SelectOptionsDisplay: unknown;
  ModalFooterDisplay: unknown;
  DrawerFooterDisplay: unknown;
  RelateLabelDisplay: unknown;
  AiMarksDisplay: unknown;
}

export interface DataQueryCommonApi {
  QueriesSelector: unknown;
  Query: unknown;
  QueryContext: unknown;
  QueryHeader: unknown;
  MetricSelector: unknown;
  FuncOperations: unknown;
  ExpressionInput: unknown;
  QueryOptions: unknown;
  TableQueryConfig: unknown;
  AddQuery: unknown;
  AddExpression: unknown;
}

/**
 * Date-coloring mark for the host's `TimeSelector` calendar mode.
 *
 * Each entry dyes one calendar cell (e.g. trading-day highlighting).
 */
export interface CalendarDateMark {
  /** Date to dye, `YYYY-MM-DD`. */
  date: string;
  /** Text color of the day number. */
  color?: string;
  /** Cell background color. */
  background?: string;
}

export interface TimeSelectorProps {
  startTime?: string;
  endTime?: string;
  relativeTime?: string;
  showRefresh?: boolean;
  autoRefresh?: boolean;
  /**
   * Selection mode: `default` (relative + absolute ranges) or `calendar`
   * (last-90-days single-day picker emitting absolute day range).
   */
  mode?: "default" | "calendar";
  /**
   * Calendar mode only: dye specific dates (e.g. trading days).
   * Ignored in `default` mode.
   */
  calendarDateMarks?: CalendarDateMark[];
  /** Triggered when the user picks a new time range. */
  onUpdateTime: (
    relativeTime: string,
    startTime: string,
    endTime: string,
  ) => void;
}

/**
 * Props for the host's UnitSelector remote component.
 *
 * The UnitSelector renders a searchable Cascader of all units defined in the
 * host's unit registry (`state.unit.unitLines` / `state.unit.units`). Plugins
 * can use it to pick a `customUnit` (a unit id string) the same way the host's
 * own trend-chart data-format config does.
 */
export interface UnitSelectorProps {
  /** Currently selected unit id. */
  value?: string;
  /** Called with the selected unit id (last segment of the cascader path). */
  onSelect: (unitId: string) => void;
  placeholder?: string;
  /** When true, unit labels are shown in English (unit.id); otherwise localized. */
  enUnit?: boolean;
  style?: CSSProperties;
  className?: string;
}

/**
 * Props for the host's CronSelector remote component.
 *
 * The CronSelector is the host's visual cron-expression editor (based on
 * `react-js-cron`). It optionally shows a free-text input alongside the
 * visual picker so users can paste an expression directly. The component
 * reads the host locale internally, so it renders Chinese labels when the
 * host is in `zh_CN`.
 */
export interface CronSelectorProps {
  /** Current 5-field cron expression (e.g. "0 * * * *"). */
  value?: string;
  /** Called with the new expression whenever the user edits it. */
  onChange: (v: string) => void;
  /** When true, renders a free-text input next to the visual picker. */
  showTextInput?: boolean;
  /** Where the text input sits relative to the picker: "left" | "right" | "top". */
  inputPostion?: "left" | "right" | "top" | string;
  allowClear?: boolean;
  clearButton?: boolean;
}

/**
 * Props for the host's VarInput remote component.
 *
 * `VarInput` is a lightweight, mention-style variable input backed by antd
 * `Mentions`. The user types `$` to trigger a dropdown of available variables
 * and picks one; the selected variable name is inserted inline. This mirrors
 * the `$变量名` reference form used across the host (e.g. flow node inputs).
 *
 * The host exposes two variants:
 * - `VarInput` (default): single-line input.
 * - `VarInput.TextArea`: multi-line input for longer templates.
 *
 * Plugins supply the `vars` array (variable id + display name) and receive
 * the raw string (containing `$varName` references) via `onChange`. The
 * plugin is responsible for resolving variables at runtime.
 */
export interface VarInputProps {
  /** Available variables shown in the `$`-triggered dropdown. */
  vars: { id: string; name: string }[];
  /** Current value (a string that may contain `$varName` references). */
  value?: string;
  /** Called with the new string whenever the user edits the input. */
  onChange?: (value: string) => void;
  /** Placeholder shown when empty. */
  placeholder?: string;
  /** Whether the input is read-only. */
  readOnly?: boolean;
  /** Auto-size for the TextArea variant ({ minRows, maxRows }). */
  autoSize?: { minRows?: number; maxRows?: number };
  /** Optional className. */
  className?: string;
}

/**
 * Loose bag of host flow-edit infrastructure exposed to plugins that
 * contribute flow node types. Every entry is the actual host export —
 * components render inside the host tree so contexts (Redux, Intl,
 * FlowNodeContext) keep working.
 */
export interface FlowEditCommonApi {
  useFlowNode: unknown;
  useI18n: unknown;
  useAppDispatch: unknown;
  useAppSelector: unknown;
  fetchAiConf: unknown;
  FlowNodeContext: unknown;
  FatForm: unknown;
  EasyVarInput: unknown;
  VarInput: unknown;
  Tip: unknown;
  Icon: unknown;
  EllipsisText: unknown;
  FatJsonEditor: unknown;
  IconType: unknown;
  requests: unknown;
  basic: unknown;
  // FlowEditDrawer shared base components
  VarsInputs: unknown;
  VarsOutputs: unknown;
  FlowCollapse: unknown;
  VarValue: unknown;
  VarName: unknown;
  VarSelector: unknown;
  BlockLine: unknown;
  FlowIcon: unknown;
  ErrorHandle: unknown;
  ErrorOutput: unknown;
  VarParams: unknown;
  DsTableSelector: unknown;
  DsConditions: unknown;
  DsColsUpdate: unknown;
  BasicConditions: unknown;
  BasicFlowNodeEdit: unknown;
  ErrorIgnore: unknown;
  ActionsAfterDone: unknown;
  MousePosPicker: unknown;
  MouseRegionPicker: unknown;
  MouseColorPicker: unknown;
  MouseTextPicker: unknown;
  WebElementSelectorPicker: unknown;
  ModelSelect: unknown;
  FrameStyleEdit: unknown;
  // AI settings shared symbols (AiSettingsPage plugin sections)
  addKnowledgeBase: unknown;
  editKnowledgeBase: unknown;
  deleteKnowledgeBase: unknown;
  reorderKnowledgeBases: unknown;
  addOcr: unknown;
  editOcr: unknown;
  deleteOcr: unknown;
  reorderOcrs: unknown;
  setDefaultOcr: unknown;
  IconButton: unknown;
  AiSettingsEmpty: unknown;
  getServerBase: unknown;
  TIME_FORMAT: unknown;
}

/** Loose bag of host canvas-node base components (BlockFlowNode base). */
export interface FlowNodeCommonApi {
  InputTags: unknown;
  OutputTags: unknown;
  DotRegion: unknown;
}

export interface RemoteComponentsApi {
  PluginBlockBox: ComponentType<{
    blocks?: unknown[];
    boardId?: string;
    minHeight?: number;
    className?: string;
    boardApi?: PluginBlockBoxBoardApi;
  }>;
  /** Host think-flow editor/runner for plugin-managed workflow configs. */
  ThinkFlow: ComponentType<ThinkFlowComponentProps>;
  /** Public block-config common components for bespoke plugins. */
  BlockConfigCommon: BlockConfigCommonApi;
  /** Public data-query config components for bespoke plugins. */
  DataQueryCommon: DataQueryCommonApi;
  /**
   * Host flow-edit infrastructure for plugins contributing flow node types
   * (via `sdk.contributions.registerFlowNodeType`). Contains the shared
   * edit-drawer base components (VarsInputs, VarsOutputs, ErrorHandle,
   * FlowCollapse, FatForm, ...), the `useFlowNode`/`useI18n` hooks, the
   * host `FlowNodeContext`, and misc utils (requests, basic). All members
   * are loose `unknown` — plugin projects re-type them locally.
   */
  FlowEditCommon: FlowEditCommonApi;
  /**
   * Host canvas-node base components (InputTags, OutputTags, ...) for
   * plugin flow node `render` components.
   */
  FlowNodeCommon: FlowNodeCommonApi;
  /** Host time-range selector for bespoke plugins. */
  TimeSelector: ComponentType<TimeSelectorProps>;
  /** Host unit selector (searchable cascader) for bespoke plugins. */
  UnitSelector: ComponentType<UnitSelectorProps>;
  /** Host cron-expression selector for bespoke plugins. */
  CronSelector: ComponentType<CronSelectorProps>;
  /**
   * Host variable input for bespoke plugins. Renders a mention-style input
   * where typing `$` opens a dropdown of `vars`. Use `VarInput.TextArea`
   * for multi-line templates.
   */
  VarInput: ComponentType<VarInputProps> & {
    TextArea: ComponentType<VarInputProps>;
  };
}

// ── Asset Repository ─────────────────────────────────────────

export interface AssetCategory {
  id: string;
  name: string;
  parentId?: string;
  description?: string;
  target_folder: string;
  target_folders?: string[];
  tags?: string[];
}

export interface AssetItem {
  guid: string;
  file_path: string;
  file_type: string;
  file_name: string;
  file_size: number;
  created_at: number;
  updated_at?: number;
  category_id?: string;
  description?: string;
  tags?: string[];
}

export interface AssetListQuery {
  category_id?: string;
  file_type?: string[];
  keyword?: string;
  tags?: string[];
  page?: number;
  page_size?: number;
}

export interface AssetListResult {
  list: AssetItem[];
  total: number;
}

export interface AssetUploadInput {
  category_id: string;
  target_folder?: string;
  file: File | Blob;
  filename?: string;
}

export interface AssetPasteInput {
  category_id: string;
  target_folder?: string;
}

export interface AssetCreateFolderInput {
  category_id: string;
  target_folder?: string;
  folder_name: string;
}

export interface AssetUpdateInput {
  description?: string;
  tags?: string[];
}

export interface AssetRevision {
  revision: number;
}

/**
 * Asset repository API — exposes the host's resource library
 * (`/app/asset/*` endpoints) to bespoke plugins so they can list, upload,
 * rename, move, and otherwise manage asset files inside host-configured
 * category folders.
 */
export interface AssetApi {
  /** List all configured asset categories. */
  listCategories(): Promise<AssetCategory[]>;
  /** Create or update a category. If `id` is empty, a new category is created. */
  saveCategory(category: Partial<AssetCategory>): Promise<AssetCategory>;
  /** Delete a category by id. */
  deleteCategory(id: string): Promise<void>;
  /** Paginated, filtered list of assets. */
  list(query: AssetListQuery): Promise<AssetListResult>;
  /** Upload a file into a category folder. */
  upload(input: AssetUploadInput): Promise<void>;
  /** Force re-sync of the asset index (optionally for a single category). */
  refresh(category_id?: string): Promise<AssetRevision>;
  /** Get current revision counter (use for change detection polling). */
  getRevision(category_id?: string): Promise<AssetRevision>;
  /** Delete an asset by guid. */
  delete(guid: string): Promise<void>;
  /** Rename an asset file. */
  rename(guid: string, new_name: string): Promise<void>;
  /** Update asset metadata (description, tags). */
  update(guid: string, payload: AssetUpdateInput): Promise<void>;
  /** Copy an asset to the clipboard. */
  copy(guid: string): Promise<void>;
  /** Cut an asset to the clipboard. */
  cut(guid: string): Promise<void>;
  /** Paste clipboard contents into a category folder. */
  paste(input: AssetPasteInput): Promise<{ copied: number }>;
  /** Create a new subfolder inside a category folder. */
  createFolder(input: AssetCreateFolderInput): Promise<void>;
  /** Move an asset to a different folder. */
  move(guid: string, target_folder: string): Promise<void>;
  /**
   * Build an absolute URL that streams the asset file. Suitable for use as
   * `<img src>` / `<video src>` etc.
   */
  previewUrl(filePath: string): string;
}

/**
 * Time helpers exposed to plugins so they can convert rTime tokens
 * produced by `sdk.remoteComponents.TimeSelector` into concrete time
 * strings in the host's expected format.
 */
export interface TimeApi {
  /** Standard time format used by the host's query API. */
  TIME_FORMAT: string;
  /**
   * Convert an rTime token (e.g. "/d", "-15m", "-1d/d ~ /d") into a
   * `[startTime, endTime]` pair formatted as `TIME_FORMAT` strings.
   * Returns `null` for unknown / unparseable values.
   *
   * When the user picks a quick range, `TimeSelector` calls
   * `onUpdateTime(rTime, "", "")` with empty startTime/endTime.
   * Plugins MUST call this to resolve the actual range before passing
   * it to `sdk.remoteComponents.Trend` — the host's `useQuery` skips
   * loading when startTime/endTime are empty.
   */
  parseShortcutValue(value?: string): [string, string] | null;
}

// ── Router ───────────────────────────────────────────────────

/**
 * Current route snapshot returned by `sdk.router.getCurrent()` and emitted
 * via `sdk.router.onChange()`.
 *
 * Plugins register route pages through `sdk.contributions.registerRoutePage()`
 * (which stores them in the host registry so the host can build breadcrumbs,
 * global navigation, etc.). Navigation itself goes through `sdk.router` —
 * the host maintains a single in-memory history stack and notifies
 * subscribers on every change.
 *
 * `params` is an arbitrary JSON-serializable object the navigating plugin
 * passed to `navigate()`; route pages read it via `getCurrent()` / the
 * `onChange` callback to render themselves contextually.
 */
export interface RouteSnapshot {
  path: string;
  params: Record<string, unknown>;
}

export interface RouterApi {
  /** Push a new entry onto the history stack and notify subscribers. */
  navigate(path: string, params?: Record<string, unknown>): void;
  /** Replace the current entry without pushing onto the history stack. */
  replace(path: string, params?: Record<string, unknown>): void;
  /** Pop the history stack; no-op when only the root entry remains. */
  back(): void;
  /** Current route snapshot. */
  getCurrent(): RouteSnapshot;
  /** Subscribe to route changes. Returns a Disposable to unsubscribe. */
  onChange(cb: (snapshot: RouteSnapshot) => void): Disposable;
}

export interface FatNotesPluginSDK {
  host: HostInfo;
  pluginId: string;
  dataSource: DataSourceApi;
  query: QueryApi;
  mutation: MutationApi;
  ui: UiApi;
  commands: CommandsApi;
  store: StoreApi;
  contributions: ContributionsApi;
  events: EventsApi;
  /** Backend API — only functional if plugin has `backend.enabled: true`. */
  backend: BackendApi;
  /** Per-plugin runtime config stored by host (`confs/bespokePluginConfig.json`). */
  config: PluginConfigApi;
  /** Host workflow list/read/execute APIs. */
  flow: FlowApi;
  /** Per-plugin board configs stored under `confs/boards/<uniqueKey>/`. */
  boards: PluginBoardsApi;
  /** Host remote components available to bespoke plugins. */
  remoteComponents: RemoteComponentsApi;
  /** Host time helpers (parseShortcutValue, TIME_FORMAT). */
  time: TimeApi;
  /** Host AI models and chat completion. */
  ai: AiApi;
  /** Host asset repository (categories + files). */
  asset: AssetApi;
  /** In-memory router shared across bespoke plugins. */
  router: RouterApi;
}

export interface PluginModule {
  activate(sdk: FatNotesPluginSDK): void | Promise<void>;
  deactivate?(): void | Promise<void>;
}
