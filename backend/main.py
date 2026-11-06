"""
FatNotes Bespoke Plugin — Backend Entry Point

This is the main entry file for your plugin's backend process.
Register handlers using the @handler decorator. Each handler receives
a params dict and should return a JSON-serializable result.

The frontend calls handlers via:
    const result = await sdk.backend.invoke("handlerName", { key: "value" });

IMPORTANT: Only write backend code for functionality that the SDK cannot provide.
Prefer sdk.query, sdk.mutation, sdk.dataSource for data operations.
Use backend handlers for: file processing, external API calls, heavy computation,
or when you need Python libraries not available in the host.
"""

import logging
import sys

from plugin_runtime import handler, run

# 后端通过 stdin/stdout 进行 JSON-RPC 通信，日志必须走 stderr。
logging.basicConfig(
    level=logging.INFO,
    stream=sys.stderr,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
)


@handler("hello")
def hello(params):
    """Example handler — replace with your own logic."""
    name = params.get("name", "World")
    return {"message": f"Hello from fat-photo backend, {name}!"}


@handler("echo")
def echo(params):
    """Echo back the received params — useful for testing."""
    return {"received": params}


if __name__ == "__main__":
    run()
