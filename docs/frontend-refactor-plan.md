# 前端重构计划

状态：2026-09-10 已完成；验证记录见 [技术规划](technical-plan.md) 第 13 节。

目标：保留当前界面效果，将视觉原型整理为可维护的 React 模块；不改变业务能力，不接入真实数据。

1. 建立 `App.tsx`、全局设计 token 和 reset；`main.tsx` 只负责挂载 React。
2. 提取已经重复使用的 `Button`、`PageHeader`、状态标识和应用外壳，组件样式使用同目录的 CSS Module。
3. 将首页、项目、资料和设置拆到各自 feature，并把 `app.css` 中的样式迁移到对应模块；需要公共出口时使用局部 `index.ts`。
4. 安装并使用 `clsx`、`framer-motion` 和 `highlight.js`，然后执行格式检查、类型检查、构建、测试和 Electron 冒烟检查。

重构过程中不新增 Next.js、Tailwind、Biome 或通用 Manager/Service 层，也不提前实现路由、数据库和校园接口。
