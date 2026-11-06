import React from "react";
import type { FatNotesPluginSDK } from "fat-notes-sdk";
import { InitSdk, LeftSidebar } from "components";

interface ControlMenusPageProps {
  sdk: FatNotesPluginSDK;
}

/*
 * 主侧边栏：渲染编辑器左侧栏(工具条 + 图层 + 历史)
 * 状态由单例 editorStore 在主侧边栏与工作区之间共享
 */
const ControlMenusPage = ({ sdk }: ControlMenusPageProps) => {
  return (
    <InitSdk sdk={sdk}>
      <LeftSidebar />
    </InitSdk>
  );
};

export default ControlMenusPage;
