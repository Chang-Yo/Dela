# src/ui

Dela 的 Design System，fork 自 [beautiful-ui](../../LICENSES/beautiful-ui.txt)，不再跟随上游。只依赖 react、radix、cva、lucide 与样式工具，不认识任何业务。

本文只写约定，不列组件清单：有哪些组件，直接看目录。

## 放什么

- 判断一个界面结构该不该进来，问一句：**去掉 Dela 的文案和业务，它还成立吗？**
  - 成立：通用组件，例如 Button、Dialog、Select。
  - 只在 Dela 的场景成立，但被多个模块共用：拼装件，例如 ConnectCard、DesktopOnlyNotice。它们也放在这里，因为模块不能引用 `app`。
  - 只有一个模块用：留在那个模块的 `view/`。
- 同样的结构出现两次以上才提取；API 只按现有的真实用法设计，不为以后预留。
- 目录：`hooks/` 放 hook，`lib/` 放工具函数，其余组件平铺在根目录。
- `agent/` 是 Agent 对话的外观组件，建在基础组件之上；基础组件不能反过来引用它。Markdown 渲染器不进 `ui`，渲染结果经 `children` 传入。

## 组件写法

以 `button.tsx`、`dialog.tsx` 为范本。现有文件还没全部改成这样，新代码照约定写。

- 一个文件一个概念，文件名是主导出名的 kebab-case（`dropdown-menu.tsx` 导出 `DropdownMenu`），配套的子组件以主名开头（`DropdownMenuItem`）。
- 用 `function` 声明组件，在文件末尾统一 `export { … }`。
- 根元素带 `data-slot`，透传原生元素或 Radix 的 props，`className` 最后经 `cn` 合并。样式变体用 `cva` 定义。
- 组件不持有模块级的可变状态；需要跨组件共享的状态放进 zustand 仓库。

## props 的命名

| 含义     | 名字                                                                                          |
| -------- | --------------------------------------------------------------------------------------------- |
| 外观     | `variant`                                                                                     |
| 大小     | `size`：`2xs`、`xs`、`sm`、`md`、`lg`、`xl`，默认 `md`，不用 `default`                        |
| 语义色   | `tone`：`accent`、`success`、`warning`、`danger`、`neutral`，不用色相名                       |
| 受控的值 | 沿用 Radix：`checked` / `onCheckedChange`、`value` / `onValueChange`、`open` / `onOpenChange` |

纯图标按钮用 `Button` 的 `size="icon-<大小>"`。它和同一大小的文字按钮等高，例如 `icon-sm` 和 `sm` 都是 28px，放在同一行天然对齐。纯图标按钮没有文字，必须写 `aria-label`。

「取消」「关闭」这类通用文案可以作为默认值写在组件里；带 Dela 内容的文案由调用方传入。

## 样式

- 颜色、阴影、圆角、层级与时长只用 `tokens.css` 里的通用 token（[ADR 0023](../../docs/adr/0023-design-token-naming.md)），不用应用调色板（`cal-*`、`syntax-*` 等）、Tailwind 原生色板和任意值。`pnpm lint` 会检查。
- 尺寸一律由 rem 派生，用户在设置里调字号时整体缩放。正文 `text-sm`，次要文字 `text-xs`。
- 按钮、输入框、下拉框这类基础控件用固定的 rem 高度（如 `h-8`），保证放在同一行时对齐；rem 会随字号设置一起缩放。
