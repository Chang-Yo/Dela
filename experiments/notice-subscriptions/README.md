# 通用公告订阅框架实验

面向 Issue #185，支持公开 HTML、RSS/Atom 的栏目发现、用户确认、规则重放和新增公告识别。原理、测试结果、解析成功率和截图见 [PR 说明](../../docs/notice-subscriptions-proposal.md)。

## 运行

在仓库根目录启用已有工具，预览页面后按实际候选序号保存基线，再手动刷新：

```powershell
. ./scripts/use-local-tools.ps1
node experiments/notice-subscriptions/run.ts preview https://jwc.sjtu.edu.cn/index/mxxsdtz.htm
node experiments/notice-subscriptions/run.ts preview https://jwc.sjtu.edu.cn/index/mxxsdtz.htm --select 1 --save .tools/notice-subscriptions/state.json
node experiments/notice-subscriptions/run.ts refresh .tools/notice-subscriptions/state.json
```

`--file <HTML路径>` 改为解析本地文件，不访问目标网页；URL 用于补全相对链接。`--sample <完整标题>` 辅助定位栏目。动态页可显式使用 `--render`，刷新沿用保存的获取模式。`--snapshot <路径>` 保存输入，`--out <路径>` 保存 JSON，输出目录需已存在。

## 验证

```powershell
pnpm check
pnpm smoke
```

`pnpm check` 包含格式、lint、类型、构建、单元测试及公告严格验收；结果写入 `.tools/notice-framework/`。复用核心时，按[框架契约](validation/framework/FRAMEWORK_CONTRACT.md)处理用户交互、持久化和通知交付。
