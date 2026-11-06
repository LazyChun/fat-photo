/*
 * Entry point of the FatNotes bespoke plugin.
 *
 * - `activate(sdk)` is called by FatNotes after the remote is loaded.
 *   Register contributions and store every `Disposable` you get back.
 * - `deactivate()` is called when the plugin is toggled off or uninstalled.
 *   Dispose everything you registered.
 *
 * NOTE: writes to the *secondary* sidebar are reserved for the Chat block
 * and will be rejected at the host SDK layer.
 */
import React from "react";
import type { Disposable, FatNotesPluginSDK } from "fat-notes-sdk";
import { ControlMenusPage, WorkPage } from "./pages";
import { ROUTE_PATHS } from "./routes";
import { initStore } from "./store";
import "./styles/editor.css";

const disposables: Disposable[] = [];

/**
 * 路由页面注册表 — 同时在宿主 (fat-notes) 中注册，便于宿主构建面包屑、
 * 全局导航等。实际的页面渲染由 WorkPage 根据
 * `sdk.router.getCurrent().path` 进行分发。
 */
const ROUTE_PAGE_TITLES: Record<string, string> = {
  [ROUTE_PATHS.HOME]: "menu.home",
};

export async function activate(sdk: FatNotesPluginSDK): Promise<void> {
  // 初始化 store：加载持久化的 UI 状态(工具选择、颜色、缩放、布局等)
  // 后续状态变更会自动保存回宿主配置
  await initStore(sdk);

  // 1. Activity bar icon that activates a primary sidebar view.
  disposables.push(
    sdk.contributions.registerActivityBarItem({
      id: "fat-photo.main",
      title: "fat-photo",
      icon: "Image",
    }),
  );

  // 2. Primary sidebar bound to the activity bar item above.
  disposables.push(
    sdk.contributions.registerPrimarySidebar(() =>
      React.createElement(ControlMenusPage, { sdk }),
    ),
  );

  // 3. Workbench page shown when the activity bar item is active.
  disposables.push(
    sdk.contributions.registerWorkbenchPage({
      id: "fat-photo.main",
      render: () => React.createElement(WorkPage, { sdk }),
    }),
  );

  // 4. Register all plugin routes in the host so the host has visibility
  //    (for breadcrumbs / global navigation). Render is a no-op — actual
  //    rendering is handled by the WorkbenchPage above based on
  //    `sdk.router.getCurrent().path`.
  for (const [path, titleKey] of Object.entries(ROUTE_PAGE_TITLES)) {
    disposables.push(
      sdk.contributions.registerRoutePage({
        path,
        title: titleKey,
        render: () => null,
      }),
    );
  }

  // 5. Footer status item.
  disposables.push(
    sdk.contributions.registerFooterItem({
      id: "fat-photo.footer",
      align: "right",
      render: () =>
        React.createElement(
          "span",
          { style: { opacity: 0.75 } },
          `[fat-photo] ready`,
        ),
    }),
  );

  // 6. Example command — invoke via sdk.commands.execute(...).
  disposables.push(
    sdk.commands.register("fat-photo.ping", async () => {
      sdk.ui.toast.info(`[fat-photo] pong (host ${sdk.host.version})`);
      return "pong";
    }),
  );

  // 7. While the fat-photo workbench page is active, hide both the secondary
  //    sidebar and the bottom panel. On other pages both follow their normal
  //    state.
  const FAT_PHOTO_ACTIVITY_KEY = "bespoke:fat-photo.main";
  const selectActivityMenuKey = (state: unknown): string | undefined => {
    if (state && typeof state === "object") {
      const frame = (state as { frame?: unknown }).frame;
      if (frame && typeof frame === "object") {
        const key = (frame as { activityMenuKey?: unknown }).activityMenuKey;
        if (typeof key === "string") return key;
      }
    }
    return undefined;
  };

  let hideSecondarySidebarDisposable: Disposable | null = null;
  let hidePanelDisposable: Disposable | null = null;
  const syncHideOnActivePage = (activeKey: string | undefined): void => {
    const shouldHide = activeKey === FAT_PHOTO_ACTIVITY_KEY;
    if (shouldHide) {
      if (!hideSecondarySidebarDisposable) {
        hideSecondarySidebarDisposable =
          sdk.contributions.registerHideSecondarySidebar();
      }
      if (!hidePanelDisposable) {
        hidePanelDisposable = sdk.contributions.registerHidePanel();
      }
    } else {
      if (hideSecondarySidebarDisposable) {
        hideSecondarySidebarDisposable.dispose();
        hideSecondarySidebarDisposable = null;
      }
      if (hidePanelDisposable) {
        hidePanelDisposable.dispose();
        hidePanelDisposable = null;
      }
    }
  };

  // Apply to the current state immediately, then react to changes.
  syncHideOnActivePage(sdk.store.select(selectActivityMenuKey));
  disposables.push(
    sdk.store.subscribe(selectActivityMenuKey, (nextKey) =>
      syncHideOnActivePage(nextKey),
    ),
  );
  disposables.push({
    dispose() {
      if (hideSecondarySidebarDisposable) {
        hideSecondarySidebarDisposable.dispose();
        hideSecondarySidebarDisposable = null;
      }
      if (hidePanelDisposable) {
        hidePanelDisposable.dispose();
        hidePanelDisposable = null;
      }
    },
  });
}

export function deactivate(): void {
  while (disposables.length) {
    try {
      disposables.pop()?.dispose();
    } catch (e) {
      // Swallow — deactivate() must never throw.
      // eslint-disable-next-line no-console
      console.warn("[fat-photo] dispose error", e);
    }
  }
}
