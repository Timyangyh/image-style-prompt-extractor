import type { MenuItemConstructorOptions } from "electron";

export const windowsApplicationMenuTemplate = (includeDeveloperTools: boolean): MenuItemConstructorOptions[] => {
  const viewSubmenu: MenuItemConstructorOptions[] = [
    { label: "实际大小", role: "resetZoom" },
    { label: "放大", role: "zoomIn" },
    { label: "缩小", role: "zoomOut" },
    { type: "separator" },
    { label: "全屏", role: "togglefullscreen" }
  ];
  if (includeDeveloperTools) {
    viewSubmenu.push({ type: "separator" }, { label: "开发者工具", role: "toggleDevTools" });
  }

  return [
    {
      label: "文件",
      submenu: [{ label: "退出", role: "quit" }]
    },
    {
      label: "编辑",
      submenu: [
        { label: "撤销", role: "undo" },
        { label: "重做", role: "redo" },
        { type: "separator" },
        { label: "剪切", role: "cut" },
        { label: "复制", role: "copy" },
        { label: "粘贴", role: "paste" },
        { label: "全选", role: "selectAll" }
      ]
    },
    { label: "查看", submenu: viewSubmenu },
    {
      label: "窗口",
      submenu: [
        { label: "最小化", role: "minimize" },
        { label: "关闭", role: "close" }
      ]
    }
  ];
};
