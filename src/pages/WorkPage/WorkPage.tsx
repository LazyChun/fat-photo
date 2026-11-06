import React from "react";
import type { FatNotesPluginSDK } from "fat-notes-sdk";
import { InitSdk, CenterArea, RightSidebar, StatusBar } from "components";
import { useEditor } from "store";
import styles from "./WorkPage.less";

interface WorkPageProps {
  sdk: FatNotesPluginSDK;
}

/*
 * 工作区页面：渲染编辑器中间区(标签+工具栏+画布) + 右侧栏(属性) + 底部状态栏
 * 与左侧栏(主侧边栏 ControlMenusPage)通过单例 editorStore 共享状态
 */
const WorkPage = ({ sdk }: WorkPageProps) => {
  const s = useEditor();
  return (
    <InitSdk sdk={sdk}>
      <div className={styles.container}>
        <div className={styles.body}>
          <CenterArea />
          {s.rightSidebarVisible && <RightSidebar />}
        </div>
        <StatusBar />
      </div>
    </InitSdk>
  );
};

export default WorkPage;
