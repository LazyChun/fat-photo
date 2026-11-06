declare module "*.less" {
  const content: { [className: string]: string };
  export default content;
}
declare module "*.svg";
declare module "*.png";
declare module "*.jpg";
declare module "*.jpeg";
declare module "*.gif";
declare module "*.bmp";
declare module "*.tiff";
type RefreshDep = object | number | string | undefined | boolean;
declare type Nullable<T = any> = T | null;
declare module "threadpool";

// Bespoke plugin loader — runtime package shipped separately.
declare module "@module-federation/runtime" {
  export interface RemoteInfo {
    name: string;
    entry: string;
    alias?: string;
    shareScope?: string;
  }
  export interface InitOptions {
    name: string;
    remotes: RemoteInfo[];
    shared?: unknown;
    plugins?: unknown[];
  }
  export function init(options: InitOptions): void;
  export function registerRemotes(
    remotes: RemoteInfo[],
    options?: { force?: boolean },
  ): void;
  export function loadRemote<T = unknown>(id: string): Promise<T>;
}
interface fatNotes {
  // get请求
  get: <T>(
    url: string,
    params?: { [key: string]: string },
    headers?: HeadersInit,
  ) => Promise<Resp<T>>;
  refreshKey: (...deps: RefreshDep[]) => string;
  // post请求
  post: <T>(
    url: string,
    params?: object | FormData,
    headers?: HeadersInit,
  ) => Promise<Resp<T>>;
  // put请求
  put: <T>(
    url: string,
    params?: object,
    headers?: HeadersInit,
  ) => Promise<Resp<T>>;
  // delete请求
  delete: <T>(
    url: string,
    params?: object,
    headers?: HeadersInit,
  ) => Promise<Resp<T>>;
  // post流式请求
  postStream: (
    url: string,
    params?: object | FormData,
  ) => {
    next: () => Promise<{ done: boolean; value: string }>;
    cancel: () => void;
  };
  // push跳转
  push: (path: string, params?: string | { [key: string]: string }) => void;
  // open跳转
  open: (path: string, params?: string | { [key: string]: string }) => void;
  // 全局方法，复制到剪切板
  copy: (
    copyInfo: Nullable<string | string[] | undefined>,
    successHint?: string,
    options?: CopyOptions,
  ) => Promise;
  success: (content: string) => void;
  warn: (content: string) => void;
  error: (content: string) => void;
  confirm: (
    title: string | ReactNode,
    content: string | ReactNode,
    okText?: string,
    cancelText?: string,
    type?: "confirm" | "info" | "error" | "success",
    icon?: ReactNode,
    style?: React.CSSProperties,
    className?: string,
  ) => Promise;
}

// 复制选项
interface CopyOptions {
  debug?: boolean;
  message?: string;
  format?: string; // MIME type
  onCopy?: (clipboardData: object) => void;
}

interface Resp<T> {
  code: number;
  message: string;
  data: T;
  isOk: boolean;
}

// 线程池对象
interface MyThreadPool {
  // 线程池启动
  run: () => void;
  // 线程池关闭
  close: () => void;
  // 加入到线程池队列中
  queue: (thread?: () => Promise<void>) => void;
}

// 国际化函数返回
interface I18nFn {
  text: (id?: string, values?: Record<string, string | number>) => string;
  textField: (record: object | undefined, fieldName: string) => string;
  locale: string;
  value: string;
}

interface Window {
  $: fatNotes | null;
  i18n: I18nFn;
}

declare let $: fatNotes;
