"""
FatNotes Plugin Backend Runtime

Lightweight JSON-RPC server for bespoke plugin backends.
Reads requests from stdin, dispatches to registered handlers, writes responses
to stdout. The host process communicates with this script via subprocess
stdin/stdout pipes.

Usage in your plugin's backend/main.py:

    from plugin_runtime import handler, run

    @handler("myHandler")
    def my_handler(params):
        return {"result": "ok"}

    if __name__ == "__main__":
        run()
"""

import sys
import json
import asyncio
import traceback
import os
from urllib import request as _urlrequest
from urllib import error as _urlerror
from typing import Callable, Dict, Any, Optional

_handlers: Dict[str, Callable] = {}

# Cached __fatHost context passed by the host with every invoke call.
# Used as a fallback when direct HTTP callbacks to the host fail, so that
# plugin config (including persisted workspaceRoot) is always available.
_cached_host_context: Optional[Dict[str, Any]] = None


def _set_host_context(ctx: Optional[Dict[str, Any]]) -> None:
    global _cached_host_context
    if isinstance(ctx, dict):
        _cached_host_context = ctx


def _host_base_url() -> str:
    return (os.getenv("FAT_NOTES_PLUGIN_HOST_URL") or "").strip().rstrip("/")


def _host_plugin_id() -> str:
    return (os.getenv("FAT_NOTES_PLUGIN_ID") or "").strip()


def _host_api_token() -> str:
    return (os.getenv("FAT_NOTES_API_TOKEN") or "").strip()


def _host_request_headers() -> Dict[str, str]:
    headers = {"Content-Type": "application/json"}
    token = _host_api_token()
    if token:
        headers["X-Fat-Api-Token"] = token
    return headers


def _host_call(method: str, params: Optional[Dict[str, Any]] = None) -> Any:
    base = _host_base_url()
    pid = _host_plugin_id()
    if not base:
        raise RuntimeError("FAT_NOTES_PLUGIN_HOST_URL is not set")
    if not pid:
        raise RuntimeError("FAT_NOTES_PLUGIN_ID is not set")
    url = f"{base}/app/pluginBackend/hostCall"
    payload = json.dumps(
        {"pluginId": pid, "method": method, "params": params or {}},
        ensure_ascii=False,
    ).encode("utf-8")
    req = _urlrequest.Request(
        url,
        data=payload,
        headers=_host_request_headers(),
        method="POST",
    )
    # 显式禁用代理：fat-notes 宿主侧是本机 HTTP 服务（如 127.0.0.1:8022），
    # 但子进程会继承系统代理设置（Windows 注册表 / 环境变量），导致
    # urllib.request 把请求发到代理服务器，代理无法转发到宿主端口，
    # 表现为 "Remote end closed connection without response"。
    # 通过自定义 ProxyHandler 空代理 + build_opener 强制直连。
    opener = _urlrequest.build_opener(_urlrequest.ProxyHandler({}))
    try:
        with opener.open(req, timeout=10) as resp:
            body = resp.read().decode("utf-8")
    except _urlerror.HTTPError as e:
        err = e.read().decode("utf-8", errors="ignore")
        if e.code == 401 and not _host_api_token():
            err = f"{err} FAT_NOTES_API_TOKEN is not set".strip()
        raise RuntimeError(f"Host API HTTPError {e.code}: {err}") from e
    except Exception as e:
        raise RuntimeError(f"Host API request failed: {e}") from e
    try:
        data = json.loads(body)
    except Exception as e:
        raise RuntimeError(f"Host API invalid response: {body[:200]}") from e
    if isinstance(data, dict) and data.get("isOk") is False:
        raise RuntimeError(data.get("message") or "Host API call failed")
    if isinstance(data, dict):
        return data.get("data")
    return data


def host_is_reachable() -> bool:
    """探测宿主 HTTP 通道是否已经可用。

    通过一次轻量 host call 判断；已缓存 __fatHost 上下文也算就绪。
    用于 backend 启动早期判断宿主是否已能响应回调。
    """
    if _cached_host_context is not None:
        return True
    base = _host_base_url()
    pid = _host_plugin_id()
    if not base or not pid:
        return False
    try:
        _host_call("pluginConfig.get", {})
        return True
    except Exception:
        return False


def wait_for_host_ready(
    timeout: float = 30.0, poll_interval: float = 0.5
) -> bool:
    """轮询等待宿主就绪，最多等待 timeout 秒。

    backend 进程启动后，巡检等后台线程可能先于宿主 HTTP 通道就绪运行，
    此时 host_get_plugin_config / host_get_system_paths 会因 HTTP 失败返回空，
    导致 get_workspace_root() 走 Path.cwd() 兜底，解析出非预期工作区路径。
    本函数在后台线程首次执行前调用，确保宿主可达后再开始工作。

    Returns:
        True 表示宿主已就绪；False 表示超时仍未就绪（调用方应自行兜底）。
    """
    import time

    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        if host_is_reachable():
            return True
        # 在等待期间也响应停止信号由调用方判断；这里仅做纯等待
        time.sleep(poll_interval)
    return False


def host_get_login_info() -> Dict[str, Any]:
    result = _host_call("auth.getLoginInfo", {})
    return result if isinstance(result, dict) else {}


def host_get_system_paths() -> Dict[str, Any]:
    """获取宿主软件的工作目录及配置路径信息。"""
    try:
        result = _host_call("system.getPaths", {})
        if isinstance(result, dict) and result:
            return result
    except Exception:
        pass
    # Fallback: use systemPaths from cached __fatHost context (if host included it)
    if _cached_host_context and isinstance(_cached_host_context.get("systemPaths"), dict):
        return _cached_host_context["systemPaths"]
    return {}


def host_get_plugin_config() -> Dict[str, Any]:
    try:
        result = _host_call("pluginConfig.get", {})
        if isinstance(result, dict) and result:
            return result
    except Exception:
        pass
    # Fallback: use config from cached __fatHost context
    if _cached_host_context and isinstance(_cached_host_context.get("config"), dict):
        return _cached_host_context["config"]
    return {}


def host_set_plugin_config(
    config_data: Optional[Dict[str, Any]], merge: bool = True
) -> Dict[str, Any]:
    if not isinstance(config_data, dict):
        config_data = {}
    result = _host_call(
        "pluginConfig.set",
        {"config": config_data, "merge": bool(merge)},
    )
    return result if isinstance(result, dict) else {}


def handler(name: str):
    """Decorator to register a backend handler.

    Args:
        name: The handler name that the frontend will use to invoke this function
              via sdk.backend.invoke(name, params).

    Example:
        @handler("processFile")
        def process_file(params):
            file_path = params.get("path")
            # ... do work ...
            return {"status": "done"}
    """
    def decorator(fn: Callable) -> Callable:
        _handlers[name] = fn
        return fn
    return decorator


def list_handlers():
    """Return a list of all registered handler names."""
    return list(_handlers.keys())


def _execute_handler(fn: Callable, params: Dict[str, Any]) -> Any:
    """Execute a handler function, supporting both sync and async."""
    if asyncio.iscoroutinefunction(fn):
        try:
            loop = asyncio.get_running_loop()
        except RuntimeError:
            loop = None
        if loop and loop.is_running():
            # If there's already a running loop, create a new one in a thread
            import concurrent.futures
            with concurrent.futures.ThreadPoolExecutor() as pool:
                future = pool.submit(asyncio.run, fn(params))
                return future.result()
        else:
            return asyncio.run(fn(params))
    else:
        return fn(params)


def run():
    """Main loop: read JSON-RPC requests from stdin, dispatch, write responses to stdout.

    Protocol:
        Request (one JSON object per line):
            {"id": "req-1", "handler": "handlerName", "params": {"key": "value"}}

        Response (one JSON object per line):
            {"id": "req-1", "status": "success", "result": <any>}
            {"id": "req-1", "status": "error", "error": "message", "traceback": "..."}

    Special handlers (built-in):
        - "__ping__": Returns {"pong": true} — used by host to check process health.
        - "__list_handlers__": Returns list of registered handler names.
        - "__shutdown__": Gracefully exits the process.
    """
    # Signal readiness to the host
    ready_msg = json.dumps({"status": "ready", "handlers": list_handlers()})
    print(ready_msg)
    sys.stdout.flush()

    while True:
        try:
            line = sys.stdin.readline()
            if not line:
                # stdin closed — host terminated the pipe
                break

            line = line.strip()
            if not line:
                continue

            try:
                req = json.loads(line)
            except json.JSONDecodeError as e:
                resp = {"id": None, "status": "error", "error": f"Invalid JSON: {e}"}
                print(json.dumps(resp, ensure_ascii=False))
                sys.stdout.flush()
                continue

            req_id = req.get("id")
            handler_name = req.get("handler", "")
            params = req.get("params", {})

            # Cache __fatHost context (passed by host with every invoke call)
            # before dispatching, so host API fallbacks work even if HTTP
            # callbacks fail.
            if isinstance(params, dict) and "__fatHost" in params:
                _set_host_context(params.get("__fatHost"))

            # Built-in handlers
            if handler_name == "__ping__":
                resp = {"id": req_id, "status": "success", "result": {"pong": True}}
            elif handler_name == "__list_handlers__":
                resp = {"id": req_id, "status": "success", "result": list_handlers()}
            elif handler_name == "__shutdown__":
                resp = {"id": req_id, "status": "success", "result": {"shutdown": True}}
                print(json.dumps(resp, ensure_ascii=False))
                sys.stdout.flush()
                break
            else:
                fn = _handlers.get(handler_name)
                if not fn:
                    resp = {
                        "id": req_id,
                        "status": "error",
                        "error": f"Handler not found: {handler_name}. Available: {list_handlers()}",
                    }
                else:
                    try:
                        result = _execute_handler(fn, params)
                        resp = {"id": req_id, "status": "success", "result": result}
                    except Exception as e:
                        resp = {
                            "id": req_id,
                            "status": "error",
                            "error": str(e),
                            "traceback": traceback.format_exc(),
                        }

            print(json.dumps(resp, ensure_ascii=False))
            sys.stdout.flush()

        except KeyboardInterrupt:
            break
        except Exception as e:
            # Unexpected error in the main loop — try to report and continue
            try:
                resp = {"id": None, "status": "error", "error": f"Runtime error: {e}"}
                print(json.dumps(resp, ensure_ascii=False))
                sys.stdout.flush()
            except Exception:
                pass
