/*
 * 独立的光标位置 store
 * ----------------------------------------------------------------------------
 * 画布鼠标移动会高频触发坐标更新。若放入全局 editorStore 会导致整个编辑器
 * (图层/历史/属性等)每帧重渲染。这里拆成独立 store，只有状态栏订阅。
 */
import { useSyncExternalStore } from "react";

interface CursorState {
  x: number;
  y: number;
  visible: boolean;
}

let state: CursorState = { x: 0, y: 0, visible: false };
const listeners = new Set<() => void>();

const emit = () => listeners.forEach((l) => l());

export const cursorActions = {
  set(x: number, y: number) {
    state = { x, y, visible: true };
    emit();
  },
  hide() {
    if (!state.visible) return;
    state = { ...state, visible: false };
    emit();
  },
};

export const useCursor = (): CursorState => {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    () => state,
    () => state,
  );
};
